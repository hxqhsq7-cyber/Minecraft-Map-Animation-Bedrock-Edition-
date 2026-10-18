# 第三方组件

项目保留了原始 HTML 中 JSZip 与 pako 的版权声明。当前仓库未为项目本体另外指定许可证；以下说明仅列出第三方组件，不将其许可证扩展为项目本体的授权。

| 组件 | 用途 | 上游与许可 |
| --- | --- | --- |
| JSZip 3.10.1 | 内嵌 ZIP 读写 | [上游项目](https://github.com/Stuk/jszip)，MIT 或 GPLv3 双许可；[完整上游许可文本](docs/licenses/JSZip-LICENSE.markdown)。 |
| pako | JSZip 内嵌压缩实现 | [上游项目](https://github.com/nodeca/pako)，[MIT 许可文本](docs/licenses/pako-LICENSE)。 |
| Electron 44.9.0 | Windows 桌面运行时 | [官方项目](https://github.com/electron/electron)。便携包保留官方运行时的 `LICENSE` 和 `LICENSES.chromium.html`。 |
| rcedit 5.0.2 npm 包中的 x64 工具 | 构建时设置 EXE 图标与版本 | [官方项目](https://github.com/electron/node-rcedit)，MIT；只用于构建，不作为应用运行依赖。 |

源码仓库不包含 Minecraft 游戏、官方专用服务端程序、用户世界或用户视频。测试夹具为小型回归素材；官方引擎验证范围见 [验证说明](docs/验证说明.md)。
