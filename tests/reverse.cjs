'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const zlib = require('node:zlib');
const helpers = fs.readFileSync(path.join(__dirname, 'playback.cjs'), 'utf8').split('async function main()')[0];
const { modules } = new Function('require', '__dirname', helpers + '\nreturn { modules };')(require, __dirname);
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'app/MapCinema.html'), 'utf8');
const ctx = modules(html);
Object.assign(ctx, { Response, ReadableStream, WritableStream, DecompressionStream });
vm.runInContext([...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][3][1], ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'app/reverse.js'), 'utf8'), ctx);
const C = ctx.MapCinemaCore, R = ctx.MapCinemaReverse, output = path.join(__dirname, 'output/reverse');
const variable = n => { const b = []; for (let v = BigInt(n);;) { const low = Number(v & 127n); v >>= 7n; b.push(low | (v ? 128 : 0)); if (!v) return Buffer.from(b); } };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const field = b => Buffer.concat([variable(b.length), Buffer.from(b)]);
function makeBlock(entries) { return Buffer.concat([...entries.map(([key, value]) => Buffer.concat([variable(0), variable(key.length), variable(value.length), key, value])), u32(0), u32(1)]); }
function compressedBlock(bytes, kind) {
  let data = bytes;
  if (kind === 2) data = zlib.deflateSync(bytes); else if (kind === 4) data = zlib.deflateRawSync(bytes);
  else if (kind === 1) { const length = bytes.length - 1, n = length < 256 ? 1 : length < 65536 ? 2 : 3; const literal = Buffer.alloc(n); literal.writeUIntLE(length, 0, n); data = Buffer.concat([variable(bytes.length), Buffer.from([(59 + n) * 4]), literal, bytes]); }
  const payload = Buffer.concat([data, Buffer.from([kind])]), crc = C.crc32c(payload), masked = (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;
  return Buffer.concat([payload, u32(masked)]);
}
function table(records, kind) {
  const data = compressedBlock(makeBlock(records), kind), handle = Buffer.concat([variable(0), variable(data.length - 5)]);
  const index = compressedBlock(makeBlock([[records.at(-1)[0], handle]]), 0);
  const footer = Buffer.alloc(48); Buffer.concat([variable(0), variable(0), variable(data.length), variable(index.length - 5)]).copy(footer); footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40);
  return Buffer.concat([data, index, footer]);
}
async function bytes(zip) { return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 1 } }); }
async function open(zip) { return R.openSource(new Blob([await bytes(zip)])); }
function pixels(sample, tile) {
  const colors = [[230, 20, 30], [20, 220, 30], [20, 30, 220], [220, 200, 40]];
  const color = sample >= 4 ? [50 + tile * 40, 80, 160] : sample >= 2 && tile === 0 ? [120, 30, 150] : colors[tile];
  const result = new Uint8Array(65536); for (let i = 0; i < result.length; i += 4) result.set([...color, 255], i); return result;
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const samples = 6, ticks = 2, audioCount = samples * ticks * 1200, wav = new Uint8Array(44 + audioCount * 2), view = new DataView(wav.buffer);
  wav.set(ctx.MapCinemaAudio.wavHeader(audioCount)); for (let i = 0; i < audioCount; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i / 24000 * 2 * Math.PI * 440) * 12000), true);
  const video = new ctx.JSZip();
  const info = await C.writeVideoFrames(video, { options: { name: 'reverse-fixture', output: 'video', columns: 2, rows: 2, ticks, start: 0, origin: [0, 64, 0], rotation: 90, loop: true, reuseTiles: true, dedupe: true,
    audioData: { bytes: wav, sampleRate: 24000, sampleCount: audioCount, channels: 1, peak: 12000 / 32768, paddedSeconds: 0 } }, count: samples, id: 'reverse_test', frameAt: async sample => [0, 1, 2, 3].map(tile => pixels(sample, tile)), zipLib: null });
  const world = new ctx.JSZip(); world.file('level.dat', C.levelDat('reverse-fixture')); world.file('levelname.txt', 'reverse-fixture');
  await C.installVideoPackage(world, video, { reuseTiles: true });
  for (const [name, zip] of [['source.mcvideo', video], ['source.mcworld', world]]) {
    fs.writeFileSync(path.join(output, name), await bytes(zip));
    const source = await open(zip); assert.equal(source.info.width, 256); assert.equal(source.info.height, 256); assert.equal(source.info.frameCount, 3); assert.equal(source.info.outputFrames, 6); assert.equal(source.info.totalTicks, 12); assert.equal(source.info.fps, 10);
    for (let frame = 0; frame < 3; frame++) {
      const image = await source.frame(frame);
      for (let tile = 0; tile < 4; tile++) {
        const x = tile % 2 * 128, y = Math.floor(tile / 2) * 128, expected = pixels(frame * 2, tile);
        for (const [dx, dy] of [[0, 0], [70, 55], [127, 127]]) assert.deepEqual([...image.subarray(((y + dy) * 256 + x + dx) * 4, ((y + dy) * 256 + x + dx) * 4 + 4)], [...expected.subarray(0, 4)], `${name}: frame ${frame}, tile ${tile}`);
      }
    }
  }
  // Independent SST writer exercises compression and compacted-world lookup, not just WALs.
  const source = await open(world), records = [], wanted = new Set(source.frames.flat()); let seq = 0;
  for (const id of wanted) {
    const db = await new R.MapDatabase(new ctx.MapCinemaDisk.Archive(await ctx.MapCinemaDisk.ZipReader.open(new Blob([await bytes(world)])), null), wanted, () => {}, async () => {}).open();
    const rgba = await db.pixels(id), key = Buffer.concat([Buffer.from('map_' + id), u64((BigInt(++seq) << 8n) | 1n)]);
    records.push([key, Buffer.from(C.mapRecord(BigInt(id), rgba))]);
  }
  records.sort((a, b) => Buffer.compare(a[0], b[0]));
  for (const kind of [0, 1, 2, 4]) {
    const compacted = await ctx.JSZip.loadAsync(await bytes(world));
    for (const name of Object.keys(compacted.files)) if (name.startsWith('db/')) compacted.remove(name);
    const sst = table(records, kind), manifest = new C.Journal();
    manifest.add(Buffer.concat([variable(1), field(Buffer.from('leveldb.BytewiseComparator')), variable(7), variable(0), variable(1), variable(sst.length), field(records[0][0]), field(records.at(-1)[0]), variable(2), variable(2)]));
    compacted.file('db/CURRENT', 'MANIFEST-000003\n'); compacted.file('db/MANIFEST-000003', manifest.data()); compacted.file('db/000001.ldb', sst);
    const reopened = await open(compacted); assert.deepEqual([...await reopened.frame(2)], [...await source.frame(2)]);
    if (kind === 4) fs.writeFileSync(path.join(output, 'compacted.mcworld'), await bytes(compacted));
    compacted.file('db/000099.ldb', Buffer.from('obsolete-invalid-file')); await open(compacted);
    const bad = Buffer.from(sst); bad[4] ^= 1; compacted.file('db/000001.ldb', bad); await assert.rejects(open(compacted), /校验/);
  }
  assert.deepEqual([...R.snappy(Uint8Array.from([5, 0, 65, 1, 1]))], [65, 65, 65, 65, 65]);
  assert.throws(() => R.snappy(Uint8Array.from([5, 1, 0])), /越界/);
  const latest = await ctx.JSZip.loadAsync(fs.readFileSync(path.join(output, 'compacted.mcworld'))), id = source.frames[0][0];
  const changed = new Uint8Array(65536).fill(127), value = C.mapRecord(BigInt(id), changed), journal = new C.Journal();
  journal.add(Buffer.concat([u64(999), u32(1), Buffer.from([1]), field(Buffer.from('map_' + id)), field(Buffer.from(value))])); latest.file('db/000002.log', journal.data());
  assert.deepEqual([...(await (await open(latest)).frame(0)).subarray(0, 4)], [127, 127, 127, 127], 'Latest WAL update lost to old SST');
  const deleted = new C.Journal(); deleted.add(Buffer.concat([u64(1000), u32(1), Buffer.from([0]), field(Buffer.from('map_' + id))])); latest.file('db/000004.log', deleted.data());
  await assert.rejects(open(latest), /缺少地图/);
  const broken = await ctx.JSZip.loadAsync(await bytes(world)); for (const name of Object.keys(broken.files)) if (/db\/\d+\.log$/.test(name)) broken.remove(name);
  await assert.rejects(open(broken), /缺少地图/);
  await assert.rejects(R.openSource(new Blob([await bytes(world)]), { checkCancelled() { throw new Error('cancel-test'); } }), /cancel-test/);
  const summary = { portableAndWorld: true, rgbaTileOrderAndVerticalOrientation: true, deltaFrames: true, duplicateFrameDurations: true, mapReuse: true, audioPreserved: true, walReads: true, latestSequenceWins: true, deletionsRespected: true, sstCompression: [0, 1, 2, 4], obsoleteFilesIgnored: true, corruptedBlockRejected: true, missingMapRejected: true, cancellation: true, encoderTested: false };
  fs.writeFileSync(path.join(root, 'logs/reverse-core-tests.json'), JSON.stringify(summary, null, 2)); console.log('PASS:', JSON.stringify(summary));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
