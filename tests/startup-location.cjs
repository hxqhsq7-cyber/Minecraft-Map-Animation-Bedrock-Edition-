'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), temporary = path.join(root, 'tests/runs/simulated-temp');
const source = fs.readFileSync(path.join(root, 'app/main.cjs'), 'utf8');
function probe(base, override) {
  const stopped = {}, result = { messages: [], writes: [], exits: [] };
  const electron = { app: { isPackaged: true, exit(code) { result.exits.push(code); throw stopped; } }, dialog: { showErrorBox(title, text) { result.messages.push({ title, text }); } } };
  const fakeFs = { ...fs, mkdirSync(file) { result.writes.push(file); throw stopped; } };
  const fakeRequire = name => name === 'electron' ? electron : name === 'node:fs' ? fakeFs : name === 'node:os' ? { tmpdir: () => temporary } : require(name);
  try { vm.runInNewContext(source, { require: fakeRequire, process: { execPath: path.join(base, '方映.exe'), env: { TEMP: temporary, ...(override ? { MAPCINEMA_DATA_DIR: override } : {}) } }, __dirname: path.join(root, 'app'), module: { exports: {} } }); }
  catch (error) { if (error !== stopped) throw error; }
  return result;
}
const blocked = probe(path.join(temporary, 'BNZ.extract/app'));
assert.deepEqual(blocked.exits, [1]); assert.equal(blocked.writes.length, 0); assert.ok(blocked.messages[0].text.includes('完整解压'));
const normal = probe(temporary + '-fixed/app'); assert.equal(normal.messages.length, 0); assert.equal(normal.writes.length, 1);
const explicit = probe(path.join(temporary, 'BNZ.extract/app'), path.join(root, 'tests/runs/explicit-data'));
assert.equal(explicit.messages.length, 0); assert.ok(explicit.writes[0].startsWith(path.join(root, 'tests/runs/explicit-data')));
console.log('PASS: temporary archive launch stops before any Data write; fixed folder and explicit workspace profile remain allowed.');
