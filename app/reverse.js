/* Read-only recovery of MapCinema frames and offline MP4 export. */
(function (root) {
  'use strict';
  const C = root.MapCinemaCore, D = root.MapCinemaDisk;
  const text = new TextDecoder(), encode = new TextEncoder();
  const MAX_BLOCK = 16 * 1048576;
  let aacFallback = false;
  function ensure(ok, message) { if (!ok) throw new Error(message); }
  function uint(bytes, at) { ensure(at >= 0 && at + 4 <= bytes.length, '数据库整数不完整。'); return new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, true); }
  function varint(bytes, state) {
    let value = 0n;
    for (let shift = 0n; shift <= 63n; shift += 7n) {
      ensure(state.at < bytes.length, '数据库变长整数不完整。');
      const b = bytes[state.at++]; value |= BigInt(b & 127) << shift;
      if (!(b & 128)) { ensure(value <= BigInt(Number.MAX_SAFE_INTEGER), '数据库偏移超出范围。'); return Number(value); }
    }
    throw new Error('数据库变长整数过长。');
  }
  function stringBytes(bytes, state) {
    const size = varint(bytes, state), at = state.at; state.at += size;
    ensure(state.at <= bytes.length, '数据库字段长度无效。'); return bytes.subarray(at, state.at);
  }
  function mapKey(bytes) {
    if (bytes.length < 5 || bytes.length > 23 || bytes[0] !== 109 || bytes[1] !== 97 || bytes[2] !== 112 || bytes[3] !== 95) return null;
    const id = text.decode(bytes.subarray(4)); return /^[1-9]\d{0,18}$/.test(id) ? id : null;
  }
  function manifestFiles(bytes) {
    const tables = new Map(); let log = 0, previousLog = 0;
    for (const record of C.records(bytes)) {
      const s = { at: 0 };
      while (s.at < record.length) {
        const tag = varint(record, s);
        if (tag === 1) ensure(text.decode(stringBytes(record, s)) === 'leveldb.BytewiseComparator', '不支持此世界的数据库排序器。');
        else if (tag === 2) log = varint(record, s);
        else if (tag === 9) previousLog = varint(record, s);
        else if (tag === 3 || tag === 4) varint(record, s);
        else if (tag === 5) { varint(record, s); stringBytes(record, s); }
        else if (tag === 6) { const level = varint(record, s), number = varint(record, s); tables.delete(`${level}:${number}`); }
        else if (tag === 7) { const level = varint(record, s), number = varint(record, s), size = varint(record, s); stringBytes(record, s); stringBytes(record, s); tables.set(`${level}:${number}`, { number, size }); }
        else throw new Error(`暂不支持此世界的数据库清单字段 ${tag}。`);
      }
    }
    return { tables: [...tables.values()], log, previousLog };
  }
  function blockEntries(bytes) {
    ensure(bytes.length >= 4, '数据库块不完整。');
    const count = uint(bytes, bytes.length - 4), end = bytes.length - 4 - count * 4;
    ensure(count >= 1 && end >= 0, '数据库块重启索引损坏。');
    const result = [], state = { at: 0 }; let previous = new Uint8Array();
    while (state.at < end) {
      const shared = varint(bytes, state), rest = varint(bytes, state), length = varint(bytes, state);
      ensure(shared <= previous.length && shared + rest <= 1048576 && state.at + rest + length <= end, '数据库块键值长度无效。');
      const key = new Uint8Array(shared + rest); key.set(previous.subarray(0, shared)); key.set(bytes.subarray(state.at, state.at + rest), shared); state.at += rest;
      result.push({ key, at: state.at, length }); state.at += length; previous = key;
    }
    ensure(state.at === end, '数据库块有多余数据。'); return result;
  }
  function snappy(bytes) {
    const state = { at: 0 }, size = varint(bytes, state);
    ensure(size <= MAX_BLOCK, '解压后的数据库块过大。'); const out = new Uint8Array(size); let at = 0;
    while (state.at < bytes.length) {
      const tag = bytes[state.at++], type = tag & 3; let length, offset;
      if (type === 0) {
        length = tag >>> 2;
        if (length < 60) length++;
        else { const n = length - 59; ensure(state.at + n <= bytes.length, 'Snappy 数据不完整。'); length = 0; for (let i = 0; i < n; i++) length += bytes[state.at++] * 2 ** (8 * i); length++; }
        ensure(state.at + length <= bytes.length && at + length <= size, 'Snappy 字面量越界。'); out.set(bytes.subarray(state.at, state.at + length), at); state.at += length; at += length;
      } else {
        const n = type === 1 ? 1 : type === 2 ? 2 : 4; ensure(state.at + n <= bytes.length, 'Snappy 复制数据不完整。');
        length = type === 1 ? 4 + (tag >>> 2 & 7) : 1 + (tag >>> 2); offset = type === 1 ? (tag & 224) * 8 : 0;
        for (let i = 0; i < n; i++) offset += bytes[state.at++] * 2 ** (8 * i);
        ensure(offset > 0 && offset <= at && at + length <= size, 'Snappy 复制越界。'); for (let i = 0; i < length; i++) { out[at] = out[at - offset]; at++; }
      }
    }
    ensure(at === size, 'Snappy 长度不一致。'); return out;
  }
  async function collect(stream, limit) {
    const reader = stream.getReader(), chunks = []; let size = 0, done = false;
    try {
      for (;;) { const next = await reader.read(); if (next.done) { done = true; break; } size += next.value.length; ensure(size <= limit, '解压数据超过安全上限。'); chunks.push(next.value); }
    } finally { if (!done) try { await reader.cancel(); } catch {} reader.releaseLock(); }
    return C.concat(chunks);
  }
  class MapDatabase {
    constructor(archive, wanted, checkCancelled, onProgress) {
      this.archive = archive; this.wanted = wanted; this.check = checkCancelled; this.progress = onProgress;
      this.index = new Map(); this.cachedPath = null; this.cachedBytes = null; this.cachedRecords = null; this.cachedBlock = null;
    }
    async file(path) {
      if (this.cachedPath !== path) { this.cachedBytes = await this.archive.file(path).async('uint8array'); this.cachedPath = path; this.cachedRecords = null; this.cachedBlock = null; }
      return this.cachedBytes;
    }
    put(id, sequence, value) {
      if (id && this.wanted.has(id) && (!this.index.has(id) || sequence > this.index.get(id).sequence)) this.index.set(id, { ...value, sequence });
    }
    async readBlock(path, offset, size) {
      const bytes = await this.file(path);
      ensure(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && offset >= 0 && size >= 0 && size <= MAX_BLOCK && offset + size + 5 <= bytes.length - 48, '数据库块偏移无效。');
      if (this.cachedBlock?.offset === offset) return this.cachedBlock.bytes;
      const payload = bytes.subarray(offset, offset + size), kind = bytes[offset + size], crc = C.crc32c(bytes.subarray(offset, offset + size + 1));
      const masked = (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;
      ensure(masked === uint(bytes, offset + size + 1), '数据库块校验失败，请关闭游戏后重新导出世界。');
      let result;
      if (kind === 0) result = payload;
      else if (kind === 1) result = snappy(payload);
      else if (kind === 2 || kind === 4) {
        ensure(typeof DecompressionStream === 'function', '系统 WebView 不支持数据库解压，请更新后重试。');
        result = await collect(new Blob([payload]).stream().pipeThrough(new DecompressionStream(kind === 2 ? 'deflate' : 'deflate-raw')), MAX_BLOCK);
      } else throw new Error(`暂不支持数据库压缩类型 ${kind}，未输出不完整视频。`);
      this.cachedBlock = { offset, bytes: result }; return result;
    }
    async table(path, expectedSize) {
      const bytes = await this.file(path);
      ensure(bytes.length === expectedSize && bytes.length >= 48, '数据库表长度与清单不一致。');
      const footer = bytes.subarray(bytes.length - 48), view = new DataView(footer.buffer, footer.byteOffset, 48);
      ensure(view.getBigUint64(40, true) === 0xdb4775248b80fb57n, '数据库表格式无效。');
      const s = { at: 0 }; varint(footer, s); varint(footer, s);
      const offset = varint(footer, s), size = varint(footer, s), index = await this.readBlock(path, offset, size);
      for (const entry of blockEntries(index)) {
        this.check(); const h = { at: entry.at }, blockOffset = varint(index, h), blockSize = varint(index, h);
        const block = await this.readBlock(path, blockOffset, blockSize);
        for (const record of blockEntries(block)) {
          if (record.key.length < 8) throw new Error('数据库内部键缺少序列号。');
          const end = record.key.length - 8, id = mapKey(record.key.subarray(0, end)); if (!id || !this.wanted.has(id)) continue;
          const tag = new DataView(record.key.buffer, record.key.byteOffset + end, 8).getBigUint64(0, true), kind = Number(tag & 255n);
          ensure(kind === 0 || kind === 1, '数据库地图记录类型无效。');
          this.put(id, tag >> 8n, { path, blockOffset, blockSize, at: record.at, length: record.length, deleted: kind === 0 });
        }
      }
    }
    async journal(path, indexing) {
      const bytes = await this.file(path);
      if (!this.cachedRecords) this.cachedRecords = C.records(bytes);
      if (!indexing) return this.cachedRecords;
      for (let batch = 0; batch < this.cachedRecords.length; batch++) {
        this.check(); const bytes = this.cachedRecords[batch]; ensure(bytes.length >= 12, '数据库写入批次损坏。');
        const sequence = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true), count = uint(bytes, 8), s = { at: 12 };
        ensure(count <= bytes.length, '数据库批次数量无效。');
        for (let i = 0; i < count; i++) {
          ensure(s.at < bytes.length, '数据库批次记录缺失。'); const kind = bytes[s.at++]; ensure(kind === 0 || kind === 1, '数据库批次类型无效。');
          const id = mapKey(stringBytes(bytes, s)); let at = s.at, length = 0;
          if (kind === 1) { const value = stringBytes(bytes, s); at = s.at - value.length; length = value.length; }
          this.put(id, sequence + BigInt(i), { path, batch, at, length, deleted: kind === 0 });
        }
        ensure(s.at === bytes.length, '数据库批次尾部有额外数据。');
      }
    }
    async open() {
      const current = this.archive.file('db/CURRENT'); ensure(current, '世界缺少地图数据库。');
      const name = (await current.async('string')).trim(); ensure(/^MANIFEST-\d+$/.test(name) && this.archive.file('db/' + name), '数据库清单缺失或无效。');
      const active = manifestFiles(await this.archive.file('db/' + name).async('uint8array'));
      const files = active.tables.map(t => {
        const base = 'db/' + String(t.number).padStart(6, '0'), path = this.archive.file(base + '.ldb') ? base + '.ldb' : base + '.sst';
        ensure(this.archive.file(path), '世界缺少活动数据库表：' + base); return { path, size: t.size };
      });
      for (const path of Object.keys(this.archive.files)) {
        const match = /^db\/(\d+)\.log$/.exec(path);
        if (match && (+match[1] >= active.log || +match[1] === active.previousLog)) files.push({ path });
      }
      for (let i = 0; i < files.length; i++) {
        this.check(); const file = files[i];
        if (file.size === undefined) await this.journal(file.path, true); else await this.table(file.path, file.size);
        await this.progress((i + 1) / Math.max(files.length, 1), i + 1, files.length);
      }
      for (const id of this.wanted) ensure(this.index.has(id) && !this.index.get(id).deleted, `缺少地图 ${id} 的像素，无法完整导出视频。`);
      this.cachedPath = null; this.cachedBytes = this.cachedRecords = this.cachedBlock = null; return this;
    }
    async pixels(id) {
      this.check(); const location = this.index.get(id); ensure(location && !location.deleted, '地图像素缺失：' + id);
      const bytes = location.batch === undefined ? await this.readBlock(location.path, location.blockOffset, location.blockSize) : (await this.journal(location.path, false))[location.batch];
      const map = C.readWorldNbt(bytes.subarray(location.at, location.at + location.length)).value;
      ensure(map.width === 128 && map.height === 128 && map.colors?.length === 65536 && String(map.mapId) === id, '地图尺寸、编号或像素格式无效：' + id);
      return map.colors;
    }
  }
  async function openSource(file, { checkCancelled = () => {}, onProgress = async () => {} } = {}) {
    let reader = await D.ZipReader.open(file);
    if (!reader.entries.has('video.json')) reader = await D.openWorld(file);
    const archive = new D.Archive(reader, null);
    let info, frames;
    if (archive.file('video.json')) {
      info = await C.readVideoPackage(archive, { maxRawBytes: D.MAX_RAW_BYTES });
      const tiles = info.columns * info.rows;
      frames = Array.from({ length: info.frameCount }, (_, frame) => Array.from({ length: tiles }, (_, tile) => info.maps[info.mapIndices ? info.mapIndices[frame * tiles + tile] : frame * tiles + tile].id));
    } else {
      ensure(archive.file('level.dat'), '请选择方映 .mcvideo 或完整 .mcworld 世界文件。');
      const candidates = [];
      for (const path of Object.keys(archive.files).filter(n => /^MapCinema-[a-zA-Z0-9_]+\.json$/.test(n))) {
        const m = JSON.parse(await archive.file(path).async('string')); if (m.namespace && (m.frames || m.frameCount)) candidates.push(m);
      }
      ensure(candidates.length === 1, '目前支持含一个完整方映播放器的世界；普通地图墙或多个播放器的世界不能自动确定视频。');
      const m = candidates[0], ns = m.namespace, count = m.frames || m.frameCount, ticks = m.ticks || m.ticksPerFrame;
      ensure(/^mv_[a-z0-9_]{1,64}$/.test(ns) && Number.isInteger(count) && count >= 1 && count <= C.LIMITS.MAX_FRAMES, '世界播放器信息无效。');
      const base = `behavior_packs/${ns}/structures/${ns}/`, first = archive.file(base + 'f000000.mcstructure'); ensure(first, '世界缺少完整首帧结构。');
      const [columns, rows, depth] = C.readWorldNbt(await first.async('uint8array')).value.size;
      ensure(depth === 2 && [columns, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 16), '世界屏幕尺寸无效。');
      const timing = C.frameTiming(count, ticks, m.frameTicks); ensure(m.totalTicks === undefined || m.totalTicks === timing.totalTicks, '世界播放时序不一致。');
      info = { ...m, namespace: ns, columns, rows, frameCount: count, ticks, frameTicks: timing.durations, totalTicks: timing.totalTicks };
      if (archive.file(`MapCinema-${ns}-audio.json`)) info.audio = JSON.parse(await archive.file(`MapCinema-${ns}-audio.json`).async('string'));
      frames = []; let previous;
      for (let i = 0; i < count; i++) {
        checkCancelled(); const entry = archive.file(base + 'f' + String(i).padStart(6, '0') + '.mcstructure'); ensure(entry, '世界缺少播放帧 ' + i);
        previous = C.worldFrameIds(await entry.async('uint8array'), columns, rows, previous).ids; frames.push(previous.map(String));
        if (i % 32 === 0) await onProgress(i / count * 0.15, '正在读取画面顺序…');
      }
    }
    const timing = C.frameTiming(info.frameCount, info.ticks, info.frameTicks);
    ensure(timing.durations.every(n => n % info.ticks === 0), '帧持续时间不是采样刻数的整数倍。');
    info = { ...info, totalTicks: timing.totalTicks, frameTicks: timing.durations, width: info.columns * 128, height: info.rows * 128, fps: 20 / info.ticks, outputFrames: timing.totalTicks / info.ticks };
    ensure(Number.isInteger(info.outputFrames) && info.outputFrames >= 1 && info.outputFrames <= C.LIMITS.MAX_SAMPLES, '还原后的采样帧数量超过支持范围。');
    if (info.audio) await C.readAudio(archive, info.namespace, info.audio, info.totalTicks);
    let database;
    if (!archive.file('video.json')) database = await new MapDatabase(archive, new Set(frames.flat()), checkCancelled, async f => onProgress(0.15 + f * 0.85, '正在读取地图数据库…')).open();
    const maps = info.maps && Array.isArray(info.maps) ? new Map(info.maps.map(map => [map.id, map.pixels])) : null;
    let lastIds, image;
    return { info, reader, archive, frames,
      async frame(index) {
        checkCancelled(); ensure(index >= 0 && index < frames.length, '播放帧越界。');
        if (!image) image = new Uint8ClampedArray(info.width * info.height * 4);
        const ids = frames[index];
        for (let tile = 0; tile < ids.length; tile++) {
          if (lastIds?.[tile] === ids[tile]) continue;
          const pixels = database ? await database.pixels(ids[tile]) : await reader.read(maps.get(ids[tile]), 65536);
          ensure(pixels.length === 65536, '视频包地图像素不完整。');
          const x = tile % info.columns * 128, y = Math.floor(tile / info.columns) * 128;
          for (let line = 0; line < 128; line++) image.set(pixels.subarray(line * 512, (line + 1) * 512), ((y + line) * info.width + x) * 4);
        }
        lastIds = ids; return image;
      } };
  }
  async function audioReader(source, checkCancelled) {
    const { audio } = source.info, entry = source.reader.entries.get(audio.path);
    let stream = await source.reader.compressedStream(entry);
    if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader(); let pending = new Uint8Array(), at = 0, consumed = 0, crc = 0;
    async function read(size) {
      const out = new Uint8Array(size); let written = 0;
      while (written < size) {
        checkCancelled();
        if (at === pending.length) { const next = await reader.read(); ensure(!next.done, '音轨数据被截断。'); pending = next.value; crc = D.crc32(pending, crc); at = 0; }
        const n = Math.min(size - written, pending.length - at); out.set(pending.subarray(at, at + n), written); at += n; written += n;
      }
      consumed += size; return out;
    }
    try {
      const header = await read(44), expected = root.MapCinemaAudio.wavHeader(audio.sampleCount, audio.sampleRate);
      ensure(header.every((n, i) => n === expected[i]), '音轨不是方映标准 PCM WAV，无法自动合成。');
    } catch (error) { try { await reader.cancel(); } catch {} throw error; }
    return { read, async finish() { ensure(consumed === 44 + audio.sampleCount * 2 && at === pending.length && (await reader.read()).done && crc === entry.crc, '音轨长度或校验值与视频不一致。'); reader.releaseLock(); }, async cancel() { try { await reader.cancel(); } catch {} } };
  }
  async function exportMp4(source, { sink, includeAudio = true, checkCancelled = () => {}, onProgress = async () => {} } = {}) {
    const M = root.Mediabunny, info = source.info;
    ensure(M && typeof root.VideoEncoder === 'function', '系统缺少 MP4 编码功能，请更新系统 WebView／Chrome，或使用新版电脑版。');
    const quality = new M.Quality('high');
    ensure(await M.canEncodeVideo('avc', { width: info.width, height: info.height, frameRate: info.fps, quality }), '当前设备不支持此尺寸的 H.264 编码；请使用电脑版或支持该分辨率的设备。');
    if (includeAudio && info.audio && !await M.canEncodeAudio('aac', { sampleRate: 24000, numberOfChannels: 1, quality: new M.Quality({ bitrate: 96000 }) })) { root.MediabunnyAacEncoder.registerAacEncoder(); aacFallback = true; }
    const parts = []; let bytes = 0, output, pcm;
    const stream = new WritableStream({ async write(data) {
      checkCancelled(); bytes += data.length;
      if (sink) await sink.write(data);
      else { ensure(bytes <= 256 * 1048576, 'MP4 超过内存模式 256 MiB 上限，请改用直接保存。'); parts.push(data.slice()); }
    }, async close() { if (sink) await sink.close(); }, async abort() { if (sink) await sink.abort(); } });
    try {
      const canvas = root.document.createElement('canvas'); canvas.width = info.width; canvas.height = info.height;
      const context = canvas.getContext('2d', { alpha: false }); ensure(context, '无法创建画面画布。');
      const video = new M.CanvasSource(canvas, { codec: 'avc', quality, keyFrameInterval: 2, latencyMode: 'realtime' });
      output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }), target: new M.AppendOnlyStreamTarget(stream) });
      output.addVideoTrack(video, { frameRate: info.fps });
      let audio;
      if (includeAudio && info.audio) { pcm = await audioReader(source, checkCancelled); audio = new M.AudioSampleSource({ codec: 'aac', quality: new M.Quality({ bitrate: 96000 }) }); output.addAudioTrack(audio); }
      await output.start(); let elapsed = 0, frames = 0;
      for (let frame = 0; frame < info.frameCount; frame++) {
        checkCancelled(); context.putImageData(new ImageData(await source.frame(frame), info.width, info.height), 0, 0);
        for (let held = 0; held < info.frameTicks[frame]; held += info.ticks) {
          checkCancelled(); await video.add(elapsed / 20, info.ticks / 20);
          if (audio) {
            const data = await pcm.read(info.ticks * 2400);
            // FFmpeg AAC-LC primes one 1024-sample frame; preserve its negative timestamp for the MP4 edit list.
            const sample = new M.AudioSample({ format: 's16', sampleRate: 24000, numberOfChannels: 1, timestamp: elapsed / 20 - (aacFallback ? 1024 / 24000 : 0), data });
            try { await audio.add(sample); } finally { sample.close(); }
          }
          elapsed += info.ticks; frames++;
          await onProgress(frames / info.outputFrames, `正在编码 ${frames} / ${info.outputFrames} 帧…`);
        }
      }
      video.close(); if (audio) { await pcm.finish(); pcm = null; audio.close(); }
      checkCancelled(); await output.finalize();
      return { bytes, frames, width: info.width, height: info.height, fps: info.fps, seconds: info.totalTicks / 20, audio: !!audio, blob: sink ? null : new Blob(parts, { type: 'video/mp4' }) };
    } catch (error) { if (output) try { await output.cancel(); } catch {} if (pcm) await pcm.cancel(); if (sink) try { await sink.abort(); } catch {} throw error; }
  }
  root.MapCinemaReverse = { openSource, exportMp4, MapDatabase, manifestFiles, blockEntries, snappy };
  if (!root.document) return;
  const $ = id => root.document.getElementById(id); let working = false, cancelled = false, download;
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  const checkCancelled = () => { if (cancelled) throw new Error('已取消 MP4 导出，原文件保持原样。'); };
  $('reverse-storage').value = typeof root.showSaveFilePicker === 'function' ? 'disk' : 'memory';
  $('reverse-cancel').onclick = () => { cancelled = true; };
  const syncBusy = () => { if (!working) { const busy = $('convert').disabled || $('merge-button').disabled; $('reverse-export').disabled = busy; if (busy) { $('reverse-result').hidden = true; $('reverse-preview').pause(); } } };
  for (const id of ['convert', 'merge-button']) new MutationObserver(syncBusy).observe($(id), { attributes: true, attributeFilter: ['disabled'] });
  $('reverse-form').addEventListener('submit', async event => {
    event.preventDefault(); if (working || $('convert').disabled || $('merge-button').disabled) return;
    const file = $('reverse-file').files[0]; if (!file) return;
    const includeAudio = $('reverse-audio').checked, disk = $('reverse-storage').value === 'disk';
    const fields = [...root.document.querySelectorAll('input,select')]; working = true; cancelled = false;
    for (const id of ['convert', 'merge-button', 'reverse-export']) $(id).disabled = true;
    fields.forEach(f => { f.disabled = true; }); $('reverse-cancel').hidden = false; $('reverse-result').hidden = true; $('reverse-download').hidden = true;
    $('reverse-preview').removeAttribute('src'); $('reverse-preview').load();
    const progress = async (fraction, label) => { $('reverse-progress').value = fraction * 100; $('reverse-status').textContent = label; await pause(); checkCancelled(); };
    let sink, wakeLock;
    try {
      if (download) { URL.revokeObjectURL(download); download = null; }
      const name = file.name.replace(/\.(mcworld|mcvideo|zip)$/i, '') + '-地图画面.mp4';
      if (disk) {
        ensure(typeof root.showSaveFilePicker === 'function', '当前环境不支持直接保存，请使用内存模式。');
        const handle = await root.showSaveFilePicker({ suggestedName: name, types: [{ description: 'MP4 视频', accept: { 'video/mp4': ['.mp4'] } }] });
        ensure(handle.name.toLowerCase().endsWith('.mp4') && handle.name.toLowerCase() !== file.name.toLowerCase(), '请另存为 .mp4 文件，不能覆盖同名输入文件。');
        sink = await handle.createWritable();
      }
      try { wakeLock = await root.navigator.wakeLock?.request('screen'); } catch {}
      await progress(0, '正在读取视频包／世界…');
      const source = await openSource(file, { checkCancelled, onProgress: (f, label) => progress(f * 0.3, label) });
      $('reverse-info').textContent = `${source.info.width}×${source.info.height} · ${source.info.fps} FPS · ${(source.info.totalTicks / 20).toFixed(2)} 秒 · ${source.info.audio && includeAudio ? '合成现有音轨' : '无音轨'}`;
      const result = await exportMp4(source, { sink, includeAudio, checkCancelled, onProgress: (f, label) => progress(0.3 + f * 0.7, label) });
      $('reverse-result').hidden = false; $('reverse-status').textContent = `已导出 ${result.frames} 帧，${(result.bytes / 1048576).toFixed(2)} MiB。原文件未修改。`;
      if (result.blob) { download = URL.createObjectURL(result.blob); $('reverse-download').href = download; $('reverse-download').download = name; $('reverse-download').hidden = false; $('reverse-preview').src = download; }
      else $('reverse-result-text').textContent = 'MP4 已保存到所选位置，可使用视频播放器打开。';
      if (result.blob) $('reverse-result-text').textContent = '可预览并下载 MP4，画面分辨率与存档中的地图数据一致。';
      $('reverse-progress').value = 100;
    } catch (error) {
      if (sink) try { await sink.abort(); } catch {}
      $('reverse-status').textContent = error.name === 'AbortError' ? '已取消保存位置选择。' : error.message || String(error);
      $('reverse-progress').value = 0;
    } finally {
      working = false; fields.forEach(f => { f.disabled = false; });
      for (const id of ['convert', 'merge-button', 'reverse-export']) $(id).disabled = false;
      $('reverse-cancel').hidden = true;
      $('merge-action').dispatchEvent(new Event('change')); $('converter').dispatchEvent(new Event('input'));
      try { await wakeLock?.release(); } catch {}
    }
  });
})(globalThis);
