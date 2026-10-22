# 第三方组件

项目保留了原始 HTML 中 JSZip 与 pako 的版权声明。当前仓库未为项目本体另外指定许可证；以下说明仅列出第三方组件，不将其许可证扩展为项目本体的授权。

| 组件 | 用途 | 上游与许可 |
| --- | --- | --- |
| JSZip 3.10.1 | 内嵌 ZIP 读写 | [上游项目](https://github.com/Stuk/jszip)，MIT 或 GPLv3 双许可；[完整上游许可文本](docs/licenses/JSZip-LICENSE.markdown)。 |
| pako | JSZip 内嵌压缩实现 | [上游项目](https://github.com/nodeca/pako)，[MIT 许可文本](docs/licenses/pako-LICENSE)。 |
| Electron 44.9.0 | Windows 桌面运行时 | [官方项目](https://github.com/electron/electron)。便携包保留官方运行时的 `LICENSE` 和 `LICENSES.chromium.html`。 |
| rcedit 5.0.2 npm 包中的 x64 工具 | 构建时设置 EXE 图标与版本 | [官方项目](https://github.com/electron/node-rcedit)，MIT；只用于构建，不作为应用运行依赖。 |
| Mediabunny 1.61.6 | 离线 MP4 封装与 WebCodecs 接入 | [上游源码](https://github.com/Vanilagy/mediabunny/tree/v1.61.6)，MPL-2.0；[许可全文](docs/licenses/Mediabunny-MPL-2.0.txt)。 |
| @mediabunny/aac-encoder 1.61.6 | 缺少原生 AAC 编码时的离线备用编码器 | [上游源码与构建方法](https://github.com/Vanilagy/mediabunny/tree/v1.61.6/packages/aac-encoder)，MPL-2.0；其中内置 FFmpeg AAC WebAssembly，保留 [FFmpeg LGPL-2.1 文本](docs/licenses/FFmpeg-LGPL-2.1.txt)。 |

`app/media-bundle.js` 按顺序拼接上述两个 npm 包的未修改发行文件，保留版权头；版本、官方 npm 地址、完整性与文件校验值见 `tools/media-dependencies.json`。执行 `python tools/fetch_media.py` 可重新获取并校验。导出模块通过独立脚本使用这些组件，其许可证不扩展到项目中独立编写的其他文件。

AAC 备用编码器使用 FFmpeg 项目的代码，适用 LGPLv2.1 或后续版本。FFmpeg 源码位于 [官方仓库](https://github.com/FFmpeg/FFmpeg)，AAC 桥接源码、内置构建文件与编译参数位于固定版本上游包及 README，本项目未修改编码器。上游原始发行包可从 [Mediabunny 源码包](https://registry.npmjs.org/mediabunny/-/mediabunny-1.61.6.tgz) 与 [AAC 扩展源码包](https://registry.npmjs.org/@mediabunny/aac-encoder/-/aac-encoder-1.61.6.tgz) 获取。

源码仓库不包含 Minecraft 游戏、官方专用服务端程序、用户世界或用户视频。测试夹具为小型回归素材；官方引擎验证范围见 [验证说明](docs/验证说明.md)。

中国版普通世界数据库格式参考 [HTMonkeyG/XOR-MC-Archive-Decrypt](https://github.com/HTMonkeyG/XOR-MC-Archive-Decrypt) 的公开算法说明及用户提供的本地工具验证结果。v20 在 `app/china-world.cjs` 中独立实现固定魔数与默认周期 XOR，不捆绑该项目的 EXE，不处理附加包或资源中心二次加密。功能范围见 [中国版导入说明](docs/中国版电脑版导入.md)。
