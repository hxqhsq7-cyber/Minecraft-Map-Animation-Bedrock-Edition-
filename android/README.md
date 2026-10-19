# 方映 MapCinema Android v18

安卓版将仓库中的共享转换界面与引擎内置到离线 WebView，通过 Android 系统文件选择器读取视频、音频与世界，通过系统保存器分块写入导出文件。APK 不申请联网或所有文件访问权限。

## 安装与使用

从 [Android 发布页](https://github.com/hxqhsq7-cyber/Minecraft-Map-Animation-Bedrock-Edition-/releases/tag/android-v18) 下载 `MapCinema-Android-v18.apk`。要求 Android 8.0 或以上，并建议先更新 Android System WebView／Chrome。

本次发布包名仍为 `dev.mapcinema.offline`，版本号为 `18`，内部版本号从 v17 的 `3` 提高到 `4`，沿用此前发布 APK 的签名证书。对于安装了同一签名 v15／v16.1／v17 的设备，具备覆盖升级条件；实际安装结果仍取决于设备和系统策略，尚未在连接的手机上验收。

选择视频并设置地图墙、目标帧率和播放定位方式，优先使用“边转换边保存”。系统保存完成后，可通过“打开／导入”交给 Minecraft，或使用“分享文件”。安卓端不提供世界文件夹导出。

“已有世界：合并／升级 → 仅用旧世界升级（无需视频包）”可以只选择 `.mcworld`，为保留一个完整方映播放器的旧世界生成升级副本。新版本也包含地图复用、播放时钟、同名盔甲架多屏与各自水平朝向功能。

非循环视频再次播放时，需要执行完整播放命令；按钮应连接独立的脉冲命令方块，由它执行该命令，单纯重新给播放时钟通红石不会复位。

v17 已有“上空提前加载（实验性）”，与电脑版共用核心，可自定义 1–8 帧、上方 8–64 格，范围固定为观看者所在的 16×16 区块。跨区块清理并迁移，同一区块多人共用。旧世界也可在“仅用旧世界升级”中开启，无需原视频包。默认关闭，开启后要求基岩版 1.21.90+ 稳定脚本 API；额外地图刷新可能增加卡顿，客户端减少空白的效果尚未验收。详细位置、清理和兼容限制见根目录 README。

大视频、音频解码和地图数量仍可能受到手机内存、WebView、存储及 Minecraft 客户端限制。请保持转换在前台，按页面估算预留空间，并保留原世界副本。Windows 中的转换或引擎检查不能代替手机运行验收。

v18 新增主页第 04 区域“地图动画 → 导出 MP4”：选择方映 .mcvideo 或保留一个完整播放器的 .mcworld，逐帧拼接为 H.264 视频，并可合成现有音轨为 AAC。优先直接保存，完成后可用视频播放器打开／分享；也支持内存下载。无需原视频，输入文件不修改。手机需要支持对应尺寸的系统 H.264 编码，真机编码及安装尚未验收。

## 源码与构建

`tools/sync_assets.py` 从仓库的 `app/MapCinema.html` 生成安卓界面、六个共享引擎模块和适配后的界面脚本。生成文件不重复提交，`android.js` 是单独维护的安卓文件保存桥接。APK 构建会自动执行同步。

本次 Windows 构建使用 Microsoft OpenJDK 21、Android SDK Platform 35 和 Build Tools 35.0.0；固定版本、官方来源和校验值见 `tools/toolchain-lock.json`。所有工具都可以解压到工作区，避免全局安装。

配置现有的工作区 JDK 与官方 Android SDK，例如：

```powershell
$env:JAVA_HOME = 'F:\MapCinemaTools\jdk-21'
$env:ANDROID_HOME = 'F:\MapCinemaTools\android-sdk'
# 若 SDK 中还没有 Platform 35 和 Build Tools 35.0.0：
python android/tools/fetch_toolchain.py
.\android\build.ps1
```

首次准备 SDK 时，需先将 Google 官方 Android Command-line Tools 放到 SDK 的 `cmdline-tools/latest` 目录，并按官方工具提示处理所需许可证。缓存、临时文件、输出默认保存在项目目录；产物位于 `release/android/`。

默认签名文件位于本地 `android/private/`。该目录及 `.p12` 密钥均被 Git 忽略。要发布可覆盖旧版的更新，构建时将 `MAPCINEMA_SIGNING_DIR` 指向已有密钥目录，其中需要 `mapcinema-release.p12` 与 `keystore-password.txt`，不得将它们提交或上传。

若没有现有密钥，构建脚本会为自己的构建生成新密钥；这种 APK 与官方发布 APK 签名不同，不能直接覆盖安装已有的官方发布版本。

可以设置 `MAPCINEMA_EXPECTED_CERT_SHA256`，使构建在证书不匹配时停止。此项目发布证书的 SHA-256 为：

```text
4d710146a63680c8c6be874c60f677b5b826653739b9719877077c5ef1d2ceea
```

开发检查需要 Node.js 24 或更新版本：

```powershell
python android/tools/sync_assets.py
node android/tools/test_synced_assets.cjs
node android/tools/test_android_bridge.js
```

构建还会自动运行官方 `apksigner` 与 `zipalign`，检查 APK 签名、ZIP CRC、对齐和打包资源与生成源文件的一致性。

## 当前验证范围

已检查同名盔甲架、朝向分支、旧世界升级入口、修复后的记分板语法，以及分块写入顺序、取消与写入失败处理。APK 已编译并进行签名和包结构检查。

没有连接的安卓设备，因此尚未完成手机安装、系统文件窗口、视频转换、保存后导入 Minecraft，以及长视频播放的真机验收。
