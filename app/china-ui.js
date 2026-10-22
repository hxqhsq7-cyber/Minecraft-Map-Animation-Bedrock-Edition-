/* Desktop-only world-copy importer. Native file access stays behind the preload bridge. */
(function () {
  'use strict';
  if (!globalThis.MapCinemaChina) return;
  document.querySelector('.topbar .badge').textContent = '电脑版 · v20.6';
  const shortcut = document.createElement('a'); shortcut.href = '#china-panel'; shortcut.className = 'secondary-link';
  shortcut.textContent = '中国版世界导入（实验性） ↘'; document.querySelector('.intro').append(shortcut);
  const bridge = MapCinemaChina, panel = document.createElement('section');
  panel.className = 'panel merge-panel'; panel.id = 'china-panel';
  panel.innerHTML = `<div class="section-title"><span class="step">05</span><h2>中国版电脑版：导入地图视频（实验性）</h2></div>
    <p class="hint">支持已有存档和新建存档。先保存并完全关闭游戏，选择视频包和要添加视频的存档；方映在完整副本中追加地图和播放器，备份原存档后写回同一目录，保留原有区块、玩家数据与原文件夹名。默认保留世界名称。</p>
    <p class="hint">本入口使用完整画面及命令方块链，不依赖方映行为包。支持同名盔甲架按各自朝向播放。可开启中国版上空预加载：先分批准备，再自动启动正片和音轨；额外地图刷新与命令执行会增加开销，是否改善缺图仍需在客户端实测。</p>
    <form id="china-form">
      <div class="field"><label for="china-pipeline">添加方式</label><select id="china-pipeline"><option value="native">直接向中国版存档追加（支持旧存档）</option><option value="international">一键往返：中国版解密 → 国际版添加视频 → 加密写回</option></select><p class="hint">一键往返会在方映内部使用国际版合并核心，再转换为中国版原生命令播放器；无需启动国际版或手动转移文件。两种方式均备份原存档并检查它是否发生变化。不转换游戏版本，不处理资源中心二次加密。</p><label class="toggle"><input id="china-keep-name" type="checkbox" checked><span>保留原世界名称（旧存档建议保留）</span></label></div>
      <div class="field"><button type="button" class="text-button" id="china-pick-video">选择 .mcvideo 视频包</button><p class="hint" id="china-video-path">尚未选择</p></div>
      <div class="field"><button type="button" class="text-button" id="china-pick-world">选择中国版已有／新建的目标存档</button> <button type="button" class="text-button" id="china-pick-level">直接选择目标 level.dat</button><p class="hint">此处选择的存档将被追加视频后的完整副本写回，请确认路径。替换前自动完整备份到方映旁 Data/ChinaBackups；文件夹窗口不显示 level.dat，可直接选文件或选择其 db 子目录。</p><p class="hint" id="china-world-path">尚未选择替换目标</p><p class="hint" id="china-world-check" aria-live="polite"></p></div>
      <div class="field"><label>屏幕结构原点 X / Y / Z</label><div class="coordinates"><label>X<input id="china-x" type="number" value="0" required></label><label>Y<input id="china-y" type="number" value="5" min="-64" max="319" required></label><label>Z<input id="china-z" type="number" value="0" required></label></div><p class="hint">长视频的命令链最高 256 格；Y 过高时软件会提示调整。仅在主世界播放，并保持屏幕与命令链所在区块加载。旧世界请选未建造的空地，执行播放命令时会放置屏幕与控制链；生成时会启用作弊、命令和命令方块。</p></div>
      <div class="two-columns"><div class="field"><label for="china-facing">屏幕正面朝向</label><select id="china-facing"><option value="0">南 · +Z</option><option value="180">北 · −Z</option><option value="270">东 · +X</option><option value="90">西 · −X</option></select></div><label class="toggle"><input id="china-loop" type="checkbox" checked><span>循环播放</span></label></div>
      <div class="field"><label for="china-anchor-mode">画面定位</label><select id="china-anchor-mode"><option value="package">沿用视频包（含命名盔甲架）</option><option value="fixed">固定坐标</option><option value="armor_stand">自定义命名盔甲架</option></select><p class="hint">同名盔甲架同步播放，朝向跟随各自的东南西北方向。每帧需要 4 条命令，帧数上限相应降低；移动或转向会留下旧画面。</p></div>
      <div id="china-anchor-options" hidden><div class="field"><label for="china-anchor-name">盔甲架名称</label><input id="china-anchor-name" value="方映屏幕" maxlength="40"></div><div class="coordinates"><label>偏移 X<input id="china-anchor-x" type="number" value="0"></label><label>偏移 Y<input id="china-anchor-y" type="number" value="2"></label><label>偏移 Z<input id="china-anchor-z" type="number" value="0"></label></div></div>
      <div class="field"><label for="china-audio-mode">包内音轨</label><select id="china-audio-mode"><option value="off">不加入音轨</option><option value="package">加入音轨并部署到普通中国版</option></select><p class="hint">音轨保存在方映旁 Data/ChinaAudio，普通客户端只登记目录链接。完成后完全重启普通客户端；请保留此音轨目录。更换电脑或移动方映后，需要重新生成并部署。ZIP 内有音轨不等于另一台电脑已部署。</p><label class="toggle"><input id="china-deploy-audio" type="checkbox" checked><span>生成后自动部署本机音轨（取消后仅导出，稍后可部署）</span></label><button type="button" class="text-button" id="china-pick-client">更改普通中国版数据目录</button><p class="hint" id="china-client-path">默认自动检测本机普通中国版数据目录，无需开发工作台。</p></div>
      <div class="field"><label for="china-prefetch-mode">上空提前加载</label><select id="china-prefetch-mode"><option value="package">沿用视频包（包内未开启则关闭）</option><option value="on">开启并自定义</option><option value="off">关闭</option></select><div id="china-prefetch-options" hidden><div class="two-columns"><div class="field"><label for="china-prefetch-frames">预加载帧数</label><input id="china-prefetch-frames" type="number" value="3" min="1" max="200"></div><div class="field"><label for="china-prefetch-height">玩家上方 / 格</label><input id="china-prefetch-height" type="number" value="12" min="8" max="64"></div></div></div><p class="hint">支持 1–200 帧，每排 5 幅向上堆叠。按玩家所在 16×16 区块固定，离开后清理；同区块共用，最多 4 处。覆盖屏幕原点周围 64 格，远处盔甲架暂不预加载。只在足够的空中空气区建墙，墙体可超出区块，总高最多 256 格。准备阶段会等待；需同时加载主控制区及其南侧相邻区块。请勿在墙内建造或删除预加载标记实体。</p></div>
      <div class="field"><label class="toggle"><input id="china-deploy-world" type="checkbox" checked><span>生成后自动备份并替换所选目标存档</span></label><p class="hint">生成结果保留读取时的旧世界数据，并写回同一个存档；旧存档无需搬到新世界。客户端运行中或存档生成后有变化时停止替换，保留 ZIP 并显示原因；音轨按上方设置部署。</p><button type="button" class="text-button" id="china-pick-output">自定义生成 ZIP 位置</button><p class="hint" id="china-output-path">未指定时保存到方映旁 Data/Exports；这是生成结果，替换前原存档备份另存于 Data/ChinaBackups。仅导出时需选择 ZIP。</p></div>
      <button type="submit" class="merge-button" id="china-import">生成并替换目标存档 ↗</button><button type="button" class="text-button" id="china-cancel" hidden>取消导入</button>
    </form>
    <progress id="china-progress" max="100" value="0" style="width:100%"></progress><p class="hint" id="china-status" aria-live="polite">选择要追加视频的已有或新建中国版存档，并完全关闭游戏；备份写回后进入原来的同一个存档。</p>
    <div id="china-result" hidden><p class="hint" id="china-result-info"></p><p class="hint" id="china-world-status" aria-live="polite"></p><button type="button" class="text-button" id="china-deploy-world-now">替换／重试所选目标存档</button><button type="button" class="text-button" id="china-reveal-world" hidden>打开目标存档位置</button><button type="button" class="text-button" id="china-reveal-backup" hidden>打开替换前备份</button><div id="china-audio-actions" hidden><p class="hint" id="china-audio-status" aria-live="polite"></p><button type="button" class="text-button" id="china-deploy-now">部署／重试本机音轨</button><button type="button" class="text-button" id="china-remove-audio" hidden>移除本机音轨登记</button></div><div id="china-commands"></div><button type="button" class="text-button" id="china-reveal">打开生成 ZIP 位置</button></div>`;
  document.getElementById('reverse-panel').after(panel);
  const $ = id => document.getElementById(id); let busy = false;
  const cleanError = error => (error.message || String(error)).replace(/^Error invoking remote method '[^']+': Error:\s*/, '');
  for (const kind of ['video', 'world', 'level', 'output', 'client']) $('china-pick-' + kind).addEventListener('click', async () => {
    try { const selected = await bridge.choose(kind), key = kind === 'level' ? 'world' : kind; if (selected) { $('china-' + key + '-path').textContent = selected; if (key === 'world') $('china-world-check').textContent = '检查通过：level.dat 和 db/CURRENT 均存在。'; } }
    catch (error) { if (['world','level'].includes(kind)) { $('china-world-path').textContent = '世界未选择，请重新选择'; $('china-world-check').textContent = cleanError(error); } if (kind === 'client') $('china-client-path').textContent = '普通客户端目录无效，请重新选择'; $('china-status').textContent = cleanError(error); }
  });
  $('china-anchor-mode').addEventListener('change', () => { $('china-anchor-options').hidden = $('china-anchor-mode').value !== 'armor_stand'; });
  const prefetchFields = () => { const custom = $('china-prefetch-mode').value === 'on'; $('china-prefetch-options').hidden = !custom; $('china-prefetch-options').querySelectorAll('input').forEach(input => { input.disabled = !custom; }); };
  $('china-prefetch-mode').addEventListener('change', prefetchFields); prefetchFields();
  $('china-deploy-world').addEventListener('change', () => { $('china-import').textContent = $('china-deploy-world').checked ? '生成并替换目标存档 ↗' : '仅生成中国版 ZIP ↗'; });
  bridge.onProgress(({ value, label }) => { $('china-progress').value = value; $('china-status').textContent = label; });
  $('china-cancel').addEventListener('click', () => bridge.cancel());
  $('china-reveal').addEventListener('click', () => bridge.reveal());
  $('china-reveal-world').addEventListener('click', () => bridge.revealWorld());
  $('china-reveal-backup').addEventListener('click', () => bridge.revealBackup());
  const showWorld = state => {
    $('china-world-status').textContent = state?.ok ? `${state.reused ? '本次结果已替换过，保留当前游戏进度。' : '所选目标存档已备份并替换完成。'}重新启动普通中国版，进入原来的同一个存档。目标：${state.directory}；替换前备份：${state.backupDirectory}` : state?.error ? 'ZIP 已保留，但目标存档替换未完成：' + state.error : '尚未替换目标存档。可点击替换，或使用生成 ZIP 自行替换目标中的文件。';
    $('china-reveal-world').hidden = !state?.ok;
    $('china-reveal-backup').hidden = !state?.ok;
  };
  $('china-deploy-world-now').addEventListener('click', async () => {
    if (busy) return; busy = true;
    const disabled = [...panel.querySelectorAll('input,select,button')].map(element => [element, element.disabled]);
    disabled.forEach(([element]) => { element.disabled = true; });
    try { showWorld(await bridge.deployWorld()); } catch (error) { $('china-world-status').textContent = cleanError(error); }
    finally { busy = false; disabled.forEach(([element, value]) => { element.disabled = value; }); }
  });
  const showAudio = state => {
    $('china-audio-status').textContent = state?.ok ? `本机音轨已部署，必须完整重启普通中国版才能加载。请退出整个游戏，再从网易发烧游戏启动；只退回主菜单无效。聊天提示“已播放声音”不能代替实际听感检测。音轨固定目录：${state.directory}` : state?.removed ? '本机音轨登记已移除，音轨文件和世界保留；重启客户端后生效。' : state?.error ? '世界副本已生成，但本机音轨部署失败：' + state.error + '。修正后可点击部署／重试，无需重新生成。' : '音轨已导出，尚未部署到普通客户端。请点击部署本机音轨，完成后重启普通客户端。';
    $('china-audio-status').style.fontWeight = state?.ok ? '700' : '';
    $('china-audio-status').style.color = state?.ok ? '#9a431c' : '';
    $('china-remove-audio').hidden = !state?.ok;
  };
  for (const [id, method] of [['china-deploy-now','deployAudio'],['china-remove-audio','removeAudio']]) $(id).addEventListener('click', async () => {
    const buttons = [$('china-deploy-now'), $('china-remove-audio')]; buttons.forEach(b => { b.disabled = true; });
    try { showAudio(await bridge[method]()); } catch (error) { $('china-audio-status').textContent = cleanError(error); }
    finally { buttons.forEach(b => { b.disabled = false; }); }
  });
  $('china-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    if ($('convert').disabled || $('merge-button').disabled || $('reverse-export').disabled) { $('china-status').textContent = '请等待其他转换／导出任务完成。'; return; }
    busy = true; $('china-result').hidden = true; $('china-progress').value = 0;
    const disabled = [...document.querySelectorAll('input,select,button')].map(element => [element, element.disabled]);
    const options = { origin: ['x', 'y', 'z'].map(axis => Number($('china-' + axis).value)), rotation: Number($('china-facing').value), loop: $('china-loop').checked,
      anchorMode: $('china-anchor-mode').value, anchor: { mode: 'armor_stand', name: $('china-anchor-name').value, offset: ['x','y','z'].map(axis => Number($('china-anchor-' + axis).value)) },
      audioMode: $('china-audio-mode').value, deployAudio: $('china-deploy-audio').checked, deployWorld: $('china-deploy-world').checked,
      pipeline:$('china-pipeline').value, keepWorldName:$('china-keep-name').checked,
      prefetchMode:$('china-prefetch-mode').value, prefetch:{enabled:true,frames:Number($('china-prefetch-frames').value),height:Number($('china-prefetch-height').value)} };
    disabled.forEach(([element]) => { element.disabled = true; }); $('china-cancel').hidden = false; $('china-cancel').disabled = false;
    try {
      const result = await bridge.run(options);
      const players=result.players||[result], hasAudio=Boolean(result.audio||result.audioTracks?.length);
      $('china-result-info').textContent = `${result.internationalCoreUsed ? '已完成解密 → 国际版核心添加 → 中国版播放器转换 → 加密。' : ''}世界：${result.worldName}。${players.map(p=>`${p.name}：${p.frameCount} 帧、${p.mapCount} 张独立地图；${p.anchor ? '命名盔甲架：'+p.anchor.name+'；' : ''}控制区原点 ${p.controlOrigin.join(' ')}，命令链 ${p.controllerSize.join(' × ')} 格。`).join(' ')}生成 ZIP：${result.target}。写回状态见下方，进入原来的同一个存档后，复制本次新生成的完整播放命令。${hasAudio ? '本机音轨部署结果见下方。' : options.audioMode==='package'?'视频包没有内置音轨，本次未加入音轨。':''}旧数据保留检查通过不代表游戏内验收；当前输出仍需游戏实测。`;
      showWorld(result.worldDeployment);
      for(const p of players)if(p.prefetch)$('china-result-info').textContent+=` 已开启 ${p.prefetch.frames} 帧预加载，每排 5 幅向上堆叠，墙体 ${p.prefetch.wallSize.join(' × ')}；辅助控制区 ${p.prefetch.helperOrigin.join(' ')}。空间或高度不足时不建墙，实际客户端效果仍需验证。`;
      $('china-audio-actions').hidden = !hasAudio; if (hasAudio) showAudio(result.audioDeployment);
      $('china-commands').replaceChildren();
      for (const command of result.commands) {
        const card = document.createElement('div'), label = document.createElement('p'), field = document.createElement('textarea'), button = document.createElement('button');
        label.textContent = command.label; field.value = command.text; field.readOnly = true; field.style.width = '100%'; field.rows = 2;
        button.type = 'button'; button.className = 'text-button'; button.textContent = '复制整条';
        button.addEventListener('click', async () => { button.textContent = await MapCinemaCommands.copyFullCommand(field, command.text) ? '已复制' : '已全选，请复制'; });
        card.append(label, field, button); $('china-commands').append(card);
      }
      $('china-result').hidden = false; $('china-status').textContent = result.worldDeployment?.ok ? '所选目标存档替换完成，原内容已备份。重新启动普通中国版，进入原来的同一个存档。' : 'ZIP 已生成；目标存档替换状态见下方，可按提示重试。';
    } catch (error) { $('china-status').textContent = cleanError(error); }
    finally { busy = false; disabled.forEach(([element, value]) => { element.disabled = value; }); $('china-cancel').hidden = true; }
  });
})();
