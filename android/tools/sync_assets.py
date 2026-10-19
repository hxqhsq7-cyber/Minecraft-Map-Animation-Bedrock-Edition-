"""Generate Android assets from the shared desktop HTML, retaining the native SAF bridge."""
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'app/MapCinema.html'
DEST = ROOT / 'app/src/main/assets'
SCRIPTS = ['jszip.min.js', 'audio.js', 'core.js', 'disk.js', 'large.js', 'commands.js', 'app.js']


def sync():
    html = SOURCE.read_text(encoding='utf-8')
    scripts = re.findall(r'<script[^>]*>([\s\S]*?)</script>', html)
    styles = re.findall(r'<style[^>]*>([\s\S]*?)</style>', html)
    if len(scripts) != len(SCRIPTS) or len(styles) != 1:
        raise RuntimeError('Shared HTML layout changed; refusing to generate incomplete Android assets.')
    DEST.mkdir(parents=True, exist_ok=True)
    for name, code in zip(SCRIPTS, scripts):
        if name == 'app.js':
            replacements = {
                '电脑模式：选择保存位置，边转换边写磁盘；支持 ZIP64 大文件。输出世界文件夹必须为空。':
                    '安卓应用：通过系统选择保存位置，边转换边写入文件；支持 ZIP64。请保持应用在前台并留足存储空间。',
                '超过此规模请在电脑 Chrome／Edge 使用磁盘模式。': '更大规模可改用“边转换边保存”。',
                '超过 1024 MiB 的视频请切换到“电脑：直接写磁盘”，避免浏览器内存和普通 ZIP 的限制。':
                    '超过 1024 MiB 的视频请切换到“边转换边保存”，避免在内存中打包。',
                '此浏览器不支持磁盘直写，请使用电脑 Chrome／Edge。安卓可继续使用兼容模式。':
                    '系统保存接口不可用，请重新打开应用，或改用兼容模式。',
                '浏览器未允许磁盘访问。请用电脑 Chrome／Edge；若本地 HTML 被限制，请解压电脑版并运行本地启动器。':
                    '系统未允许保存文件，请重新选择可写入的位置，或改用兼容模式。',
                '大视频包请切换到电脑磁盘模式，不要在内存中加载整个文件。':
                    '大视频包请切换到“边转换边保存”，避免在内存中加载整个文件。',
            }
            for old, new in replacements.items():
                code = code.replace(old, new)
        (DEST / name).write_text(code, encoding='utf-8', newline='\n')
    css = styles[0] + '\n.android-export-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-top:1px solid #dfe5da}.android-export-row>span{flex:1 1 100%;overflow-wrap:anywhere;font-size:13px}.android-export-row button{min-height:42px;padding:8px 14px;background:#edf4e8;border-radius:6px}#android-exports{margin-top:20px}\n'
    (DEST / 'style.css').write_text(css, encoding='utf-8', newline='\n')
    names = iter(SCRIPTS)
    html = re.sub(r'<script[^>]*>[\s\S]*?</script>', lambda _: '<script src="' + next(names) + '"></script>', html)
    html = re.sub(r'<style[^>]*>[\s\S]*?</style>', '<link rel="stylesheet" href="style.css">', html)
    html = html.replace('<script src="jszip.min.js">', '<script src="android.js"></script><script src="jszip.min.js">', 1)
    html = html.replace('电脑：直接写磁盘（大容量）', '安卓：边转换边保存（推荐）')
    html = html.replace('安卓／兼容：内存打包', '兼容模式：内存打包')
    html = html.replace('电脑磁盘模式最高 64 GiB 地图数据，边生成边保存', '应用直写模式最高 64 GiB 地图数据，边生成边保存')
    html = html.replace('沿用上方“处理方式”。超大 ZIP64 世界若无法被游戏导入，可改选文件夹。选择文件夹前请关闭游戏，且输出文件夹必须为空。',
                        '沿用上方“处理方式”。本应用通过安卓系统保存文件；.mcworld 保存后可选择 Minecraft 打开。超大世界是否能导入取决于游戏客户端。')
    html = html.replace('磁盘模式需要电脑 Chrome／Edge 的文件保存授权；', '直写模式使用安卓系统文件保存器；')
    html = html.replace('电脑磁盘模式按块读取大文件', '边转换边保存模式按块读取大文件')
    (DEST / 'index.html').write_text(html, encoding='utf-8', newline='\n')
    shutil.copytree(ROOT.parent / 'docs/licenses', DEST / 'licenses', dirs_exist_ok=True)
    shutil.copyfile(ROOT.parent / 'THIRD_PARTY_NOTICES.md', DEST / 'THIRD_PARTY_NOTICES.md')
    print('Synced Android v17 assets from the shared HTML.')


if __name__ == '__main__':
    sync()
