package dev.mapcinema.offline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Offline-only WebView host. All reads/writes use Android document pickers. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/index.html";
    private static final int PICK_INPUT = 2101, PICK_OUTPUT = 2102;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Map<String, Export> exports = Collections.synchronizedMap(new HashMap<String, Export>());
    private final Set<Uri> inputs = Collections.synchronizedSet(new HashSet<Uri>());
    private ValueCallback<Uri[]> chooser;
    private WebView web;
    private FrameLayout root;
    private String pendingSave, pendingName, pendingMime;
    private boolean destroyed;

    private static final class Export {
        final Uri uri; final String name, mime;
        OutputStream stream; long size; boolean done;
        Export(Uri uri, String name, String mime) { this.uri=uri; this.name=name; this.mime=mime; }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this); root.setBackgroundColor(Color.rgb(246,247,240));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(root);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false); s.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled(false);
        web.addJavascriptInterface(new Bridge(), "MapCinemaNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u=req.getUrl();
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost()) && u.getPath()!=null && u.getPath().startsWith("/assets/")) {
                    String path=u.getPath().substring(8);
                    if (path.contains("..") || path.contains("\\")) return denied();
                    try {
                        InputStream in=getAssets().open(path);
                        String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".html")?"text/html":"application/octet-stream";
                        Map<String,String> headers=new HashMap<String,String>();
                        headers.put("Cache-Control","no-store");
                        headers.put("X-Content-Type-Options","nosniff");
                        return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,in);
                    } catch (IOException e) { return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.<String,String>emptyMap(),new ByteArrayInputStream(new byte[0])); }
                }
                String scheme=u.getScheme();
                if ("blob".equals(scheme) || "data".equals(scheme) || "content".equals(scheme)) return null;
                return denied();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u=req.getUrl();
                return !("https".equals(u.getScheme()) && HOST.equals(u.getHost()) && u.getPath()!=null && u.getPath().startsWith("/assets/"));
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                root.removeView(view); view.destroy(); web=null;
                closeStreams();
                new AlertDialog.Builder(MainActivity.this).setTitle("页面已停止")
                    .setMessage("系统 WebView 可能因内存不足退出。请减少屏幕地图数量、降低音频额度，或改用独立音频；未完成的导出文件请勿导入游戏。")
                    .setPositiveButton("重新打开",(d,w)->recreate()).setNegativeButton("退出",(d,w)->finish()).setCancelable(false).show();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (chooser!=null) chooser.onReceiveValue(null);
                chooser=callback;
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                List<String> mime=new ArrayList<String>(); boolean hasExtensions=false;
                for (String raw:params.getAcceptTypes()) for (String a:raw.split(",")) {
                    a=a.trim(); if (a.startsWith(".")) hasExtensions=true;
                    else if (a.contains("/") && !a.equals("*/*")) mime.add(a);
                }
                if (!hasExtensions && !mime.isEmpty()) intent.putExtra(Intent.EXTRA_MIME_TYPES,mime.toArray(new String[0]));
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent,PICK_INPUT); }
                catch (RuntimeException e) { chooser.onReceiveValue(null); chooser=null; toast("没有可用的系统文件选择器。"); }
                return true;
            }
        });
        web.setDownloadListener((url,userAgent,disposition,mime,length)->toast("请使用页面内的“保存文件”按钮。"));
        web.loadUrl(START);
    }
    private static WebResourceResponse denied() {
        return new WebResourceResponse("text/plain","UTF-8",403,"Offline application",Collections.<String,String>emptyMap(),new ByteArrayInputStream(new byte[0]));
    }
    private void toast(String text) { runOnUiThread(()->Toast.makeText(this,text,Toast.LENGTH_LONG).show()); }
    private static String safeName(String name) {
        if (name==null || name.trim().isEmpty()) return "MapCinema.mcworld";
        name=name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_").trim();
        if (name.length()<=160) return name;
        int dot=name.lastIndexOf('.');
        String extension=dot>0 && name.length()-dot<=20 ? name.substring(dot) : "";
        return name.substring(0,160-extension.length())+extension;
    }
    private String displayName(Uri uri, String fallback) {
        try (Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)) {
            if (c!=null && c.moveToFirst()) { String name=c.getString(0); if (name!=null && !name.isEmpty()) return name; }
        } catch (RuntimeException ignored) { }
        return fallback;
    }
    private boolean sameInput(Uri uri) {
        synchronized (inputs) { for (Uri input:inputs) {
            if (uri.normalizeScheme().equals(input.normalizeScheme())) return true;
            try { if (uri.getAuthority().equals(input.getAuthority()) && DocumentsContract.getDocumentId(uri).equals(DocumentsContract.getDocumentId(input))) return true; } catch (RuntimeException ignored) { }
        } }
        return false;
    }
    private void respond(String request, JSONObject value) {
        if (request==null || destroyed) return;
        runOnUiThread(()->{ if (web!=null && !destroyed) web.evaluateJavascript("window.MapCinemaAndroid&&window.MapCinemaAndroid.onResult("+JSONObject.quote(request)+","+value.toString()+");",null); });
    }
    private void fail(String request, String message, boolean cancelled) {
        try { JSONObject o=new JSONObject(); o.put("ok",false); o.put("name",cancelled?"AbortError":"Error"); o.put("message",message); respond(request,o); } catch (Exception ignored) { }
    }
    private JSONObject ok() { JSONObject o=new JSONObject(); try {o.put("ok",true);}catch(Exception ignored){} return o; }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if (request==PICK_INPUT) {
            ValueCallback<Uri[]> callback=chooser; chooser=null; if (callback==null) return;
            if (result!=RESULT_OK || data==null) {callback.onReceiveValue(null);return;}
            ArrayList<Uri> values=new ArrayList<Uri>();
            if (data.getClipData()!=null) for(int i=0;i<data.getClipData().getItemCount();i++) values.add(data.getClipData().getItemAt(i).getUri());
            else if(data.getData()!=null) values.add(data.getData());
            for(Uri uri:values) {
                inputs.add(uri);
                try {getContentResolver().takePersistableUriPermission(uri,data.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(RuntimeException ignored){}
            }
            callback.onReceiveValue(values.isEmpty()?null:values.toArray(new Uri[0])); return;
        }
        if (request==PICK_OUTPUT) {
            final String callback=pendingSave, name=pendingName, mime=pendingMime;
            pendingSave=null; pendingName=null; pendingMime=null;
            if(result!=RESULT_OK || data==null || data.getData()==null) {fail(callback,"已取消保存位置选择。",true);return;}
            final Uri uri=data.getData();
            if(sameInput(uri)) {fail(callback,"输出文件不能覆盖本次选中的输入文件，请换一个文件名。",false);return;}
            io.execute(()->{
                try {
                    Export export=new Export(uri,displayName(uri,name),mime);
                    export.stream=getContentResolver().openOutputStream(uri,"wt");
                    if(export.stream==null) throw new IOException("无法写入所选文件");
                    String token=UUID.randomUUID().toString(); exports.put(token,export);
                    JSONObject o=ok();o.put("token",token);o.put("name",export.name);respond(callback,o);
                }catch(Exception e){fail(callback,"无法保存文件："+e.getMessage(),false);}
            });
        }
    }
    public final class Bridge {
        @JavascriptInterface public void beginSave(final String request,final String proposed,final String mime) {
            runOnUiThread(()->{
                if(pendingSave!=null) {fail(request,"另一个保存窗口尚未关闭。",false);return;}
                pendingSave=request;pendingName=safeName(proposed);pendingMime=mime!=null&&mime.contains("/")?mime:"application/octet-stream";
                // A ZIP MIME can make document providers append .zip to Minecraft files.
                if(pendingName.endsWith(".mcworld")) pendingMime="application/x-mcworld";
                else if(pendingName.endsWith(".mcvideo")) pendingMime="application/x-mapcinema-video";
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(pendingMime);intent.putExtra(Intent.EXTRA_TITLE,pendingName);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                try {startActivityForResult(intent,PICK_OUTPUT);}catch(RuntimeException e){pendingSave=null;fail(request,"没有可用的系统文件保存器。",false);}
            });
        }
        @JavascriptInterface public void write(final String request,final String token,final String encoded) {
            io.execute(()->{
                Export e=exports.get(token);
                try {
                    if(e==null || e.stream==null || e.done) throw new IOException("输出文件已关闭");
                    if(encoded==null || encoded.length()>90000) throw new IOException("写入分块过大");
                    byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);e.stream.write(bytes);e.size+=bytes.length;respond(request,ok());
                }catch(Exception ex){fail(request,"文件写入失败："+ex.getMessage(),false);}
            });
        }
        @JavascriptInterface public void close(final String request,final String token,final boolean abort) {
            io.execute(()->{
                Export e=exports.get(token);
                try {
                    if(e==null) throw new IOException("找不到输出文件");
                    if(e.stream!=null) {if(!abort)e.stream.flush();e.stream.close();e.stream=null;}
                    e.done=!abort;
                    JSONObject o=ok();o.put("token",token);o.put("name",e.name);o.put("bytes",e.size);respond(request,o);
                    if(abort) {exports.remove(token);toast("导出已中断；请删除未完成文件，不要将它导入游戏。");}
                }catch(Exception ex){fail(request,"关闭文件失败："+ex.getMessage(),false);}
            });
        }
        @JavascriptInterface public void openDocument(final String token,final boolean share) {
            Export e=exports.get(token);if(e==null||!e.done){toast("文件尚未完成保存。");return;}
            runOnUiThread(()->{
                Intent intent=new Intent(share?Intent.ACTION_SEND:Intent.ACTION_VIEW);
                String mime=e.name.endsWith(".mcworld")?"application/x-mcworld":e.name.endsWith(".txt")?"text/plain":e.name.endsWith(".html")?"text/html":"application/octet-stream";
                if(share){intent.setType(mime);intent.putExtra(Intent.EXTRA_STREAM,e.uri);}else intent.setDataAndType(e.uri,mime);
                intent.setClipData(ClipData.newRawUri(e.name,e.uri));intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try{startActivity(Intent.createChooser(intent,share?"分享文件":"选择应用打开／导入"));}catch(RuntimeException ex){toast("未找到可打开此格式的应用，可在文件管理器中查看已保存文件。");}
            });
        }
        @JavascriptInterface public void setBusy(final boolean busy) {runOnUiThread(()->{if(busy)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);});}
        @JavascriptInterface public String versionInfo() {
            try{JSONObject o=new JSONObject();o.put("android",Build.VERSION.SDK_INT);o.put("webview",WebView.getCurrentWebViewPackage()==null?"unknown":WebView.getCurrentWebViewPackage().versionName);return o.toString();}catch(Exception e){return "{}";}
        }
    }
    @Override public void onBackPressed() {
        if(web==null){finish();return;}
        web.evaluateJavascript("Boolean(document.getElementById('convert')?.disabled && document.getElementById('merge-button')?.disabled)",busy->{
            if("true".equals(busy)) new AlertDialog.Builder(this).setTitle("正在处理视频或世界")
                .setMessage("退出会中断处理，并可能留下未完成的输出文件。")
                .setNegativeButton("继续处理",null).setPositiveButton("停止并退出",(d,w)->finish()).show();
            else if(web.canGoBack())web.goBack();else finish();
        });
    }
    private void closeStreams(){io.execute(()->{synchronized(exports){for(Export e:exports.values()){try{if(e.stream!=null)e.stream.close();}catch(IOException ignored){}e.stream=null;}}});}
    @Override protected void onDestroy(){destroyed=true;if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}closeStreams();io.shutdown();if(web!=null){web.removeJavascriptInterface("MapCinemaNative");web.destroy();web=null;}super.onDestroy();}
}
