"""Build the Windows portable app using the pinned official toolchain."""
from pathlib import Path
import hashlib
import json
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '44.9.0'
TOOLCHAIN = ROOT / '.toolchain'
RUNTIME = TOOLCHAIN / 'downloads' / f'electron-v{VERSION}-win32-x64.zip'
TARGET = ROOT / 'release/方映-电脑版-v20.6'


def main():
    from setup_toolchain import prepare
    prepare()
    media = json.loads((ROOT / 'tools/media-dependencies.json').read_bytes())
    assert hashlib.sha256((ROOT / 'app/media-bundle.js').read_bytes()).hexdigest() == media['bundle_sha256'], 'Media bundle changed; run tools/fetch_media.py'
    checks = json.loads((ROOT / 'tools/toolchain-lock.json').read_bytes())
    with RUNTIME.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != checks['electron']['sha256']:
        raise SystemExit('Official Electron checksum mismatch')
    if TARGET.resolve().parent != (ROOT / 'release').resolve():
        raise SystemExit('Refusing to write to a redirected release directory')
    TARGET.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(RUNTIME) as archive:
        runtime_names = [i.filename for i in archive.infolist() if not i.is_dir()]
        archive.extractall(TARGET)
    exe = TARGET / '方映.exe'
    (TARGET / 'electron.exe').replace(exe)
    default = TARGET / 'resources/default_app.asar'
    if default.exists():
        default.unlink()
    shutil.copytree(ROOT / 'app', TARGET / 'resources/app', dirs_exist_ok=True)
    subprocess.run([str(TOOLCHAIN / 'tools/rcedit-x64.exe'), str(exe),
                    '--set-icon', str(ROOT / 'app/icon.ico'),
                    '--set-file-version', '20.6.0.0', '--set-product-version', '20.6.0.0',
                    '--set-version-string', 'ProductName', '方映',
                    '--set-version-string', 'FileDescription', '方映电脑大音频版 v20.6',
                    '--set-version-string', 'CompanyName', 'MapCinema',
                    '--set-version-string', 'OriginalFilename', '方映.exe',
                    '--set-requested-execution-level', 'asInvoker'], check=True)
    assert (TARGET / 'resources/app/MapCinema.html').read_bytes() == (ROOT / 'app/MapCinema.html').read_bytes()
    with exe.open('rb') as stream:
        assert stream.read(2) == b'MZ'
        stream.seek(0x3c)
        pe = struct.unpack('<I', stream.read(4))[0]
        stream.seek(pe)
        assert stream.read(4) == b'PE\0\0'
        assert struct.unpack('<H', stream.read(2))[0] == 0x8664
    (TARGET / '开始使用.txt').write_text(
        '方映 · 电脑大音频版 v20.6（Windows 10/11，64 位）\n\n'
        '双击“方映.exe”启动。不需要安装 Python、Node.js 或浏览器。\n'
        '请将整个文件夹放到可写目录中，例如 D 盘或 F 盘；不要只移动 exe 或删除旁边的文件。\n'
        '程序配置、缓存和临时文件保存在旁边自动生成的 Data 文件夹，不写入 C 盘安装目录。\n'
        '请先完整解压再运行；v20.6 检测到 ZIP 临时解压目录时会在创建 Data 前停止，避免音轨随临时目录被清理。\n'
        '默认直接写磁盘，转换开始时会让你选择输出位置；也可选择内存模式，完成后点击下载。\n'
        '盔甲架模式：所有同名盔甲架同步播放，每帧跟随各自的东南西北朝向。结果区可复制新增播放点及调整朝向指令。\n'
        '多个屏幕须在同维度已加载区块中；移动或转向会留下旧画面。新增的是同名盔甲架，不克隆装备和姿势。\n'
        '地图动画导出 MP4：在主页第 04 区域选择方映 .mcvideo 或保留完整播放器的 .mcworld，可合成已有音轨。\n'
        '无需原视频；按地图分辨率与原播放时序导出一轮，支持直接保存和内存下载。\n'
        '此功能使用离线 H.264 与 AAC 编码；原存档只读。需要现代系统／WebView 的 H.264 编码能力。\n'
        '上空提前加载：在设置中开启，可选 1–200 帧、上方 8–64 格，每排 5 幅完整画面向上堆叠；按观看者的 16×16 区块迁移，实际墙体可超出区块，需要足够空中空间和高度。\n'
        '旧世界可在合并／升级面板单独开启，无需原视频包。需要基岩版 1.21.90+ 稳定脚本 API；只使用空中空气区。\n'
        '此功能仍需客户端实测，无法保证消除空白；额外地图刷新可能增加卡顿。\n'
        '中国版旧／新存档添加（实验性）：保存后完全关闭游戏；在主页第 05 区域选择 .mcvideo 和要添加视频的存档文件夹或 level.dat。\n'
        '添加方式可选直接追加，或“一键往返”：软件内解密为国际版格式，用国际版核心添加视频，再转中国版原生播放器、加密并备份写回原存档。\n'
        '无需启动国际版或手动转移文件；保留原区块、玩家数据、旧播放器及其他设置，默认保留名称。生成时启用作弊和命令方块。\n'
        '支持普通默认密钥的 1.21 世界，以纯存档命令链播放完整画面；1.21.120 小样已确认循环播放。\n'
        '文件夹窗口不显示 level.dat 属于正常现象；可直接选择 level.dat，误选 db 时自动修正为世界目录，选择后立即检查。\n'
        '支持沿用／自定义命名盔甲架，所有同名播放点按各自朝向播放；结果区提供复制盔甲架指令。\n'
        '普通中国版音轨：选择加入音轨后，默认自动部署到本机普通客户端，无需开发工作台。全局路径方式已在 1.21.120 提示音小样中确认可发声。\n'
        '音轨实际文件保存在本程序旁 Data/ChinaAudio，普通客户端资源目录只登记链接。不要删除或移动此数据目录。\n'
        '默认自动备份并替换所选目标存档的文件，保留原文件夹名；生成结果 ZIP 在 Data/Exports，替换前原始备份另在 Data/ChinaBackups。\n'
        '追加后的完整副本写回所选的同一个存档，原始备份另存。请选择空地放置新屏幕及控制区；与已有方映控制区重叠时拒绝生成。\n'
        '生成后目标有变化时停止写回，需重新生成；游戏运行中则关闭后可重试。大存档需要多份副本的空间；结果 ZIP 不压缩存储。\n'
        '目标继续使用中国版既有存档位置，可能在 C 盘；程序、配置、音轨、原始备份和 ZIP 留在方映所在盘。\n'
        '完成后从网易发烧游戏启动普通客户端，进入原来的同一个目标存档；更换电脑或移动方映后，需重新生成并部署。\n'
        '只退出世界或返回主菜单不能替代重启客户端；聊天提示“已播放声音”也不代表音轨资源已加载。\n'
        '可更改普通中国版数据目录；部署失败不会丢失 ZIP，结果区提供重试及移除本次音轨登记。移除登记保留音轨和世界。\n'
        '中国版上空提前加载：在第 05 区域沿用包内设置、关闭或自定义 1–200 帧；每排 5 幅向上堆叠。\n'
        '按主世界玩家所在 16×16 区块固定，离开后清理，同区块共用；范围为屏幕原点周围 64 格，最多 4 处。\n'
        '首轮分批准备，完成后自动启动正片与音轨；需加载主控制区、南侧相邻辅助区和整座墙所在区块，保持墙体为空气。\n'
        '8×4 屏幕预加载 200 帧需要 40×160×2 格及 6400 展示框；总高最多 256 格。预热有等待，额外刷新可能增加卡顿。\n'
        '中国版客户端纹理加载、缺图改善、长视频音画同步和多盔甲架听感仍需实测；远处盔甲架暂不预加载。\n'
        '仅导出 ZIP 时，先备份，再用全部 ZIP 内容（含 db）写回本次所选原存档；复制本次完整带引号及 :play 后缀的中国版播放命令。\n'
        '长视频需要更多命令方块和已加载区块；世界高度不足会拒绝生成，不支持资源中心二次加密。\n'
        '所有视频与音频在本机处理，不上传。退出处理中的任务会要求确认。播放时钟固定大小，开始前等待 20 游戏刻；画面变化时约每 40 游戏刻补写完整帧。\n'
        '没有视频包：找到“已有世界：合并／升级”，将“处理内容”改为“仅用旧世界升级（无需视频包）”，只选择 .mcworld，再点“生成升级副本”。\n'
        '此入口暂支持世界中只有一个完整方映播放器，固定坐标和命名盔甲架均可；保留地图 ID、时序和音轨，并补入周期完整帧。\n'
        '只替换 exe 不会更新已导入的世界；需要重新生成世界副本。原世界文件保留。\n\n'
        '音频额度选项保持原 v13 的 128–4096 MiB，默认 512 MiB；额度不代表实际可用内存。\n'
        '压缩音频仍需完整解码，PCM WAV 可以分块读取；大文件是否成功取决于设备内存、格式与存储空间。\n'
        '.mcvideo 需在工具中合并进世界；.mcworld 才交给 Minecraft 导入。\n'
        '程序启动和小样例转换会进行本机构建验证，Minecraft 游戏内表现仍需另外测试。\n'
        '按钮重播：另放脉冲、无条件、需要红石的命令方块，填写软件给出的完整播放命令并连接按钮；不要只给播放时钟通电。\n'
        '未配置 Windows 代码签名证书，exe 未进行 Authenticode 发布签名。\n\n'
        '原版功能用法见“原版功能说明.txt”；其中关于 Python 和浏览器的启动方法不适用于此 exe 版。\n', encoding='utf-8-sig')
    shutil.copyfile(ROOT / 'docs/使用说明-v13.txt', TARGET / '原版功能说明.txt')
    shutil.copyfile(ROOT / 'THIRD_PARTY_NOTICES.md', TARGET / 'THIRD_PARTY_NOTICES.md')
    shutil.copytree(ROOT / 'docs/licenses', TARGET / 'docs/licenses', dirs_exist_ok=True)
    shutil.copyfile(ROOT / 'docs/验证说明.md', TARGET / 'docs/验证说明.md')
    shutil.copyfile(ROOT / 'docs/中国版电脑版导入.md', TARGET / 'docs/中国版电脑版导入.md')
    names = set(runtime_names) - {'electron.exe', 'resources/default_app.asar'}
    names.update(['方映.exe', '开始使用.txt', '原版功能说明.txt', 'THIRD_PARTY_NOTICES.md'])
    names.update(p.relative_to(TARGET).as_posix() for p in (TARGET / 'docs').rglob('*') if p.is_file())
    names.update('resources/app/' + p.relative_to(ROOT / 'app').as_posix() for p in (ROOT / 'app').rglob('*') if p.is_file())
    files = [TARGET / name for name in sorted(names)]
    record = {'electron': VERSION, 'runtime_zip_sha256': actual,
              'html_sha256': hashlib.sha256((ROOT / 'app/MapCinema.html').read_bytes()).hexdigest(),
              'playback_fix_applied': True, 'world_only_upgrade_ui': True, 'china_import_ui': True,
              'temporary_archive_launch_blocked': True, 'complete_client_restart_notice': True,
              'china_selected_world_replacement': True, 'china_original_world_backup': True, 'automatic_china_zip_output': True,
              'china_native_prefetch': True, 'china_prefetch_max_frames': 200, 'china_prefetch_client_verified': False,
              'china_existing_world_append': True, 'china_international_roundtrip': True, 'china_world_name_preserved_by_default': True,
              'china_import_scope': 'China PC 1.21 replace the selected launcher-created world directory; workspace original backup and source fingerprint guard; rollback on publish failure; named anchors and ordinary-client audio deployment; updated client flow and long-video sync unverified', 'machine': 'AMD64', 'authenticode_signed': False,
              'files': {p.relative_to(TARGET).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
    print('Built Windows executable:', exe, flush=True)
    print('Runtime size:', sum(p.stat().st_size for p in files), 'bytes', flush=True)
    package = ROOT / 'release/方映-电脑版-v20.6-Windows-x64.zip'
    with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in files:
            archive.write(file, file.relative_to(ROOT / 'release').as_posix())
    with package.open('rb') as stream:
        package_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
    (package.with_suffix('.sha256.txt')).write_text(package_sha + '  ' + package.name + '\n', encoding='utf-8')
    record.update(package=package.name, package_sha256=package_sha, package_bytes=package.stat().st_size)
    (ROOT / 'release/build-manifest.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Packaged:', package, 'SHA256=', package_sha, flush=True)


if __name__ == '__main__':
    main()
