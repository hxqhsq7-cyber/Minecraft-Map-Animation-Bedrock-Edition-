(async function (fixtures) {
  const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
  function check(ok, message) { if (!ok) throw new Error(message); }
  const results = [];
  async function until(predicate) { const end = Date.now() + 60000; while (!predicate()) { if (Date.now() > end) throw new Error('Export timeout: ' + $('reverse-status').textContent); await wait(10); } }
  const originalPicker = window.showSaveFilePicker, dir = await navigator.storage.getDirectory();
  const nativeAac = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 24000, numberOfChannels: 1, bitrate: 96000 })).supported;
  for (const [name, base64] of Object.entries(fixtures)) {
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name)); $('reverse-file').files = transfer.files;
    $('reverse-storage').value = name === 'source.mcworld' ? 'disk' : 'memory';
    const saved = await dir.getFileHandle('restored-world.mp4', { create: true }); window.showSaveFilePicker = async () => saved;
    $('reverse-form').requestSubmit(); await until(() => !$('reverse-export').disabled);
    check(!$('reverse-result').hidden, name + ': ' + $('reverse-status').textContent);
    let blob;
    if ($('reverse-storage').value === 'disk') blob = await saved.getFile();
    else blob = await (await fetch($('reverse-download').href)).blob();
    check(blob.size > 1000, name + ' output empty');
    const input = new Mediabunny.Input({ source: new Mediabunny.BlobSource(blob), formats: Mediabunny.ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack(), duration = await input.computeDuration();
    check(v.displayWidth === 256 && v.displayHeight === 256, 'Wrong MP4 resolution');
    check(Math.abs(duration - 0.6) < 0.045 && a !== null, 'Duration or audio missing');
    const fileName = name.replace(/\./g, '-') + '-restored.mp4';
    results.push({ name, fileName, bytes: blob.size, width: v.displayWidth, height: v.displayHeight, duration, audio: true });
    input.dispose();
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = fileName; link.click();
  }
  // The form must preserve silent export and restore every control after cancellation.
  $('reverse-storage').value = 'memory'; $('reverse-audio').checked = false;
  $('reverse-form').requestSubmit(); await until(() => !$('reverse-export').disabled);
  check(!$('reverse-result').hidden, 'Silent export failed');
  const silent = await (await fetch($('reverse-download').href)).blob(), silentInput = new Mediabunny.Input({ source: new Mediabunny.BlobSource(silent), formats: Mediabunny.ALL_FORMATS });
  check(await silentInput.getPrimaryAudioTrack() === null, 'Silent export retained an audio track'); silentInput.dispose();
  const observer = new MutationObserver(() => { if ($('reverse-progress').value > 30) $('reverse-cancel').click(); });
  observer.observe($('reverse-progress'), { attributes: true, attributeFilter: ['value'] });
  $('reverse-form').requestSubmit(); await until(() => !$('reverse-export').disabled); observer.disconnect();
  check($('reverse-status').textContent.includes('取消') && $('reverse-result').hidden, 'Cancellation did not discard incomplete output');
  check(!$('convert').disabled && !$('merge-button').disabled && !$('reverse-file').disabled, 'Controls remained locked');
  window.showSaveFilePicker = originalPicker;
  return { cases: results, nativeAac, offlineAacFallback: !nativeAac, silentExport: true, cancellation: true, controlsRestored: true, actualEncoderAndMuxer: true };
})
