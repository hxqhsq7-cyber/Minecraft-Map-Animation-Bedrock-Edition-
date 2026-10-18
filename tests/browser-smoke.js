(async function (base64, legacy) {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(predicate, label) {
    const deadline = Date.now() + 45000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(label + ': ' + $('error').textContent + ' / ' + $('progress-label').textContent);
      await sleep(40);
    }
  }
  const report = { title: document.title, secureContext: isSecureContext, nodeInRenderer: typeof require,
    savePicker: typeof showSaveFilePicker, directoryPicker: typeof showDirectoryPicker,
    audioBudget: $('audio-budget').value, audioBudgets: [...$('audio-budget').options].map(o => o.value),
    diskDefault: $('storage-mode').value, modules: ['JSZip', 'MapCinemaAudio', 'MapCinemaCore', 'MapCinemaDisk', 'MapCinemaLarge', 'MapCinemaCommands'].map(k => [k, typeof window[k]]) };
  check(report.secureContext && report.nodeInRenderer === 'undefined', 'Renderer isolation or trusted context failed');
  check(report.modules.every(([, type]) => type !== 'undefined'), 'An inline application module failed to load');
  check(report.savePicker === 'function' && report.directoryPicker === 'function', 'File System Access unavailable');
  check(report.diskDefault === 'disk' && report.audioBudget === '512' && report.audioBudgets.includes('4096'), 'Original large-file defaults changed');
  let blocked = false;
  try { await fetch('https://example.com/mapcinema-network-probe'); } catch { blocked = true; }
  check(blocked, 'Unexpected external network access');
  report.externalNetworkBlocked = blocked;
  const C = MapCinemaCore, A = MapCinemaAudio;
  const pcm = new Uint8Array(48000), pcmView = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.length / 2; i++) pcmView.setInt16(i * 2, Math.round(Math.sin(i / 24000 * 2 * Math.PI * 440) * 16000), true);
  const wav = new File([A.wavHeader(24000), pcm], 'test.wav', { type: 'audio/wav' });
  wav.arrayBuffer = () => { throw new Error('PCM input must not be read in full'); };
  const clip = await A.prepare({ file: wav, start: 0.25, duration: 0.5, disk: true, budgetMiB: 512 });
  check(clip.sampleCount === 12000 && clip.bytes.length === 24044 && clip.peak > 0, 'PCM WAV slicing failed');
  report.pcmClip = { sampleCount: clip.sampleCount, bytes: clip.bytes.length, wholeFileReadBlocked: true };
  const input = new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'smoke.mp4', { type: 'video/mp4' });
  const transfer = new DataTransfer(); transfer.items.add(input); $('video-file').files = transfer.files;
  $('video-file').dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => $('video-info').textContent.includes('128'), 'H.264 MP4 loading');
  report.decodedVideo = { width: $('video').videoWidth, height: $('video').videoHeight, duration: $('video').duration };
  for (const [id, value] of Object.entries({ columns: '1', rows: '1', ticks: '4', duration: '0.8',
    'project-name': 'smoke-memory', 'pos-y': '64', 'storage-mode': 'memory', 'capacity': '128', 'output-type': 'video', 'audio-mode': 'video' })) $(id).value = value;
  $('converter').dispatchEvent(new Event('input', { bubbles: true }));
  async function convert() {
    $('converter').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !$('convert').disabled, 'Conversion completion');
    check($('error').hidden && !$('result').hidden, 'Conversion failed: ' + $('error').textContent);
  }
  await convert();
  const memoryBlob = await (await fetch($('download').href)).blob();
  const memoryZip = await JSZip.loadAsync(memoryBlob);
  const memory = await C.readVideoPackage(memoryZip);
  check(memory.frameCount > 0 && memory.audio && memory.audio.sampleCount > 0, 'Memory conversion did not include video and AAC audio');
  report.memoryVideo = { frames: memory.frameCount, bytes: memoryBlob.size, audioSamples: memory.audio.sampleCount };
  $('download').click();

  // Real Chromium filesystem streams in OPFS; only OS picker selection is substituted in this test.
  const directory = await navigator.storage.getDirectory();
  const saved = await directory.getFileHandle('smoke-disk.mcvideo', { create: true });
  const originalSave = window.showSaveFilePicker;
  window.showSaveFilePicker = async () => saved;
  $('storage-mode').value = 'disk'; $('project-name').value = 'smoke-disk';
  await convert();
  const diskFile = await saved.getFile();
  const diskZip = await JSZip.loadAsync(diskFile);
  const disk = await C.readVideoPackage(diskZip);
  check(disk.frameCount === memory.frameCount && disk.audio.sampleCount === memory.audio.sampleCount, 'Disk conversion differs from memory conversion');
  report.diskVideo = { frames: disk.frameCount, bytes: diskFile.size, audioSamples: disk.audio.sampleCount, nativeWritableStream: true };
  const a = document.createElement('a'); a.download = 'smoke-disk.mcvideo'; a.href = URL.createObjectURL(diskFile); a.click();
  window.showSaveFilePicker = originalSave;
  const folder = await directory.getDirectoryHandle('smoke-world', { create: true });
  const originalDirectory = window.showDirectoryPicker;
  window.showDirectoryPicker = async () => folder;
  $('output-type').value = 'folder'; $('project-name').value = 'smoke-world';
  await convert();
  const level = await (await folder.getFileHandle('level.dat')).getFile();
  const database = await folder.getDirectoryHandle('db');
  const databaseFiles = []; for await (const name of database.keys()) databaseFiles.push(name);
  check(level.size > 0 && databaseFiles.length > 0, 'World folder export incomplete');
  report.folderWorld = { levelDatBytes: level.size, databaseFiles };
  window.showDirectoryPicker = originalDirectory;
  $('storage-mode').value = 'memory'; $('output-type').value = 'world'; $('project-name').value = 'smoke-world';
  await convert();
  const worldZip = await JSZip.loadAsync(await (await fetch($('download').href)).blob());
  check(worldZip.file('level.dat') && worldZip.file('levelname.txt') && Object.keys(worldZip.files).some(p => p.startsWith('db/')), 'World archive incomplete');
  report.worldArchive = { entries: Object.keys(worldZip.files).length };
  $('download').click();
  const generated = await JSZip.loadAsync(memoryBlob);
  const controller = await generated.file(memory.dir + 'structures/' + memory.namespace + '/controller.mcstructure').async('uint8array');
  const size = C.controllerDimensions(controller);
  check(size.width === 1 && size.height === 1 && size.depth === 1 && memory.controllerLayout === 'clock-v2', 'Generated package still contains the old large controller');
  report.fixedController = size;
  if (legacy) {
    const decode = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const oldVideo = await JSZip.loadAsync(decode(legacy.video));
    const before = await C.readVideoPackage(oldVideo);
    const oldWorld = await JSZip.loadAsync(decode(legacy.world));
    const framePath = before.dir + 'structures/' + before.namespace + '/f000001.mcstructure';
    const frameBefore = await oldWorld.file(framePath).async('uint8array');
    const oldStop = await oldWorld.file(before.dir + 'functions/' + before.namespace + '/stop.mcfunction').async('string');
    const repaired = await C.installVideoPackage(oldWorld, oldVideo, { repairController: true });
    const frameAfter = await oldWorld.file(framePath).async('uint8array');
    check(repaired.controllerLayout === 'clock-v2' && repaired.frameCount === before.frameCount, 'Legacy repair did not upgrade the controller');
    check(frameBefore.length === frameAfter.length && frameBefore.every((b, i) => b === frameAfter[i]), 'Controller repair changed an existing picture');
    const newStop = await oldWorld.file(before.dir + 'functions/' + before.namespace + '/stop.mcfunction').async('string');
    check(oldStop.trim().split('\n').every(line => newStop.includes(line)), 'Legacy cleanup area was lost');
    const optimizedWorld = await JSZip.loadAsync(decode(legacy.world));
    const optimized = await C.installVideoPackage(optimizedWorld, oldVideo, { optimizeExisting: true, reuseTiles: true });
    check(optimized.controllerLayout === 'clock-v2' && optimized.frameCount === before.frameCount && optimized.totalTicks === before.totalTicks, 'Legacy optimization changed the timeline');
    report.legacyV13Upgrade = { controllerRepair: true, existingFrameBytesPreserved: true, oldCleanupPreserved: true,
      optimization: true, frameCount: optimized.frameCount, totalTicks: optimized.totalTicks };
    const directBytes = decode(legacy.direct), direct = new File([directBytes], 'old.mcworld', { type: 'application/zip' });
    const worldTransfer = new DataTransfer(); worldTransfer.items.add(direct); $('import-world').files = worldTransfer.files;
    $('import-video').value = '';
    $('merge-action').value = 'world'; $('merge-action').dispatchEvent(new Event('change', { bubbles: true }));
    check(!$('import-video').required && $('import-video').disabled && $('merger').checkValidity(), 'World-only form still requires a video package');
    check($('merge-button').textContent.includes('生成升级副本') && $('merge-action-hint').textContent.includes('不需要原视频'), 'World-only entry or guidance missing');
    async function upgrade() {
      $('merger').requestSubmit();
      await until(() => !$('merge-button').disabled, 'World-only upgrade completion');
      check($('error').hidden && !$('result').hidden, 'World-only UI failed: ' + $('error').textContent);
      check($('import-video').disabled && !$('import-video').required, 'World-only form state lost after processing');
    }
    async function auditWorld(zip) {
      const name = 'MapCinema-world_only_test.json', m = JSON.parse(await zip.file(name).async('string'));
      check(m.worldOnlyUpgrade && m.frames === 45 && m.totalTicks === 45 && m.fullFrameCount === 2, 'World-only output timeline or keyframes incorrect');
      check(m.controllerSize.join(',') === '1,1,1' && m.control[2] === 10, 'World-only rotated control location incorrect');
      const source = await JSZip.loadAsync(directBytes);
      const protectedPaths = Object.keys(source.files).filter(n => !source.files[n].dir && /^(db|resource_packs)\//.test(n));
      for (const name of protectedPaths) {
        const before = await source.file(name).async('uint8array'), after = await zip.file(name).async('uint8array');
        check(before.length === after.length && before.every((b, i) => b === after[i]), 'Database or audio changed: ' + name);
      }
      return { frames: m.frames, totalTicks: m.totalTicks, fullFrames: m.fullFrameCount, protectedFiles: protectedPaths.length };
    }
    function download(file, name) {
      const link = document.createElement('a'); link.download = name; link.href = URL.createObjectURL(file); link.click();
    }
    $('storage-mode').value = 'memory'; $('merge-output').value = 'world';
    await upgrade();
    const memoryWorld = await (await fetch($('download').href)).blob();
    const memoryUpgrade = await auditWorld(await JSZip.loadAsync(memoryWorld));
    download(memoryWorld, 'world-only-memory.mcworld');
    const upgradedHandle = await directory.getFileHandle('world-only-disk.mcworld', { create: true });
    window.showSaveFilePicker = async () => upgradedHandle;
    $('storage-mode').value = 'disk';
    await upgrade();
    const diskWorld = await upgradedHandle.getFile();
    const diskUpgrade = await auditWorld(await JSZip.loadAsync(diskWorld));
    download(diskWorld, 'world-only-disk.mcworld');
    const upgradedFolder = await directory.getDirectoryHandle('world-only-folder', { create: true });
    window.showDirectoryPicker = async () => upgradedFolder;
    $('merge-output').value = 'folder';
    await upgrade();
    const folderLevel = await (await upgradedFolder.getFileHandle('level.dat')).getFile();
    check(folderLevel.size > 0, 'World-only folder output missing level.dat');
    window.showDirectoryPicker = originalDirectory;
    $('merge-output').value = 'world';
    window.showSaveFilePicker = async () => { throw new DOMException('test-cancel', 'AbortError'); };
    $('merger').requestSubmit();
    await until(() => !$('merge-button').disabled, 'World-only cancel');
    check(!$('error').hidden && $('error').textContent.includes('取消') && $('import-video').disabled, 'Cancel did not restore the world-only UI');
    window.showSaveFilePicker = originalSave;
    $('merge-action').value = 'install'; $('merge-action').dispatchEvent(new Event('change', { bubbles: true }));
    check($('import-video').required && !$('import-video').disabled && !$('merger').checkValidity(), 'Package mode did not restore required validation');
    report.worldOnlyUI = { packageNotRequired: true, realFormSubmit: true, memory: memoryUpgrade, disk: diskUpgrade,
      folderOutput: true, cancellationRestoresControls: true, packageModeRestored: true };
    $('storage-mode').value = 'memory'; $('output-type').value = 'video'; $('project-name').value = 'smoke-multi-anchor';
    $('anchor-mode').value = 'armor_stand'; $('anchor-name').value = '方映 屏幕16';
    $('converter').dispatchEvent(new Event('input', { bubbles: true }));
    check($('facing').disabled && $('anchor-info').textContent.includes('所有同名'), 'Facing-follow UI not active');
    await convert();
    const anchorBlob = await (await fetch($('download').href)).blob(), anchorZip = await JSZip.loadAsync(anchorBlob);
    const anchored = await C.readVideoPackage(anchorZip), selectors = C.anchorSelectors(anchored.namespace, anchored.anchor);
    check(anchored.anchor.name === '方映 屏幕16' && !selectors.named.includes('c='), 'Multiple anchors still restricted to one stand');
    const anchorFn = anchored.dir + 'functions/' + anchored.namespace + '/';
    const renderFirst = await anchorZip.file(anchorFn + 'first_frame.mcfunction').async('string');
    check((renderFirst.match(/ run structure load /g) || []).length === 4, 'Per-stand facing commands absent');
    const commands = [...document.querySelectorAll('#commands .command-text')].map(field => field.value);
    check(commands.includes('/summon armor_stand "方映 屏幕16" ~ ~ ~'), 'Copyable named-stand command missing');
    check(commands.some(text => text.includes('positioned as @s run tp @s ~ ~ ~ ~ 0')), 'Copyable orientation command missing');
    check(commands.length === 7 && [...document.querySelectorAll('#commands .command-text')].every(field => field.readOnly), 'Command cards did not render complete selectable commands');
    download(anchorBlob, 'smoke-multi-anchor.mcvideo');
    const installedWorld = new JSZip(); installedWorld.file('level.dat', C.levelDat('multi-anchor')); installedWorld.file('levelname.txt', 'multi-anchor');
    const installedAnchor = await C.installVideoPackage(installedWorld, anchorZip, {});
    check(installedAnchor.anchor.name === anchored.anchor.name && installedAnchor.totalTicks === anchored.totalTicks, 'Anchored package installation changed anchor or timeline');
    const anchorWorldBlob = await installedWorld.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    download(anchorWorldBlob, 'smoke-multi-anchor.mcworld');
    const anchorWorldTransfer = new DataTransfer(); anchorWorldTransfer.items.add(new File([anchorWorldBlob], 'anchor-world.mcworld'));
    $('import-world').files = anchorWorldTransfer.files; $('import-video').value = '';
    $('merge-action').value = 'world'; $('merge-action').dispatchEvent(new Event('change', { bubbles: true }));
    await upgrade();
    const worldOnlyAnchorBlob = await (await fetch($('download').href)).blob(), worldOnlyAnchor = await JSZip.loadAsync(worldOnlyAnchorBlob);
    const anchorMetadataPath = Object.keys(worldOnlyAnchor.files).find(p => /^MapCinema-[a-zA-Z0-9_]+\.json$/.test(p) && p !== 'video.json');
    const upgradedAnchorMeta = JSON.parse(await worldOnlyAnchor.file(anchorMetadataPath).async('string'));
    check(upgradedAnchorMeta.anchor.name === anchored.anchor.name && upgradedAnchorMeta.worldOnlyUpgrade, 'World-only upgrade did not preserve the armor-stand mode');
    $('anchor-mode').value = 'fixed'; $('converter').dispatchEvent(new Event('input', { bubbles: true }));
    check(!$('facing').disabled, 'Fixed screen direction control was not restored');
    report.multiAnchorUI = { converterSubmit: true, loadedPackageValidated: true, allNamedSelector: true,
      fourDirectionBranches: true, copyableSpawnAndOrientationCards: true, commandCards: commands.length,
      audioIncluded: !!anchored.audio, installation: true, frames: anchored.frameCount, totalTicks: anchored.totalTicks,
      fixedModeRestored: true, worldOnlyUpgradeWithoutVideoPackage: true };
  }
  report.uiConversionPassed = true;
  return report;
})
