'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { register, unregister } = require('../app/china-audio.cjs');
async function main() {
  const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../logs/china-feature-results.json'), 'utf8'));
  const root = await fs.mkdtemp(path.join(fixture.output || path.dirname(fixture.target), 'audio-registration-'));
  const clientRoot = path.join(root, 'ordinary-client'), directory = path.join(root, fixture.namespace + '_audio');
  await fs.mkdir(path.join(clientRoot, 'minecraftWorlds'), { recursive: true });
  const packs = path.join(clientRoot, 'games/com.netease/resource_packs'); await fs.mkdir(packs, { recursive: true });
  await fs.cp(path.join(fixture.plain, fixture.audio.dir), directory, { recursive: true });
  const options = { directory, namespace: fixture.namespace, headerId: fixture.audio.headerId, clientRoot };
  const result = await register(options); assert.ok(result.ok); assert.ok((await fs.lstat(result.link)).isSymbolicLink());
  assert.equal(await fs.realpath(result.link), await fs.realpath(directory));
  assert.deepEqual(await fs.readFile(path.join(result.link, 'sounds/sound_definitions.json')), await fs.readFile(path.join(directory, 'sounds/sound_definitions.json')));
  assert.equal((await register(options)).link, result.link, 'retry must reuse its own junction');
  await unregister(options); await assert.rejects(fs.lstat(result.link), { code: 'ENOENT' });
  assert.ok((await fs.stat(path.join(directory, 'manifest.json'))).isFile(), 'removal keeps audio files');
  await fs.mkdir(result.link); await fs.writeFile(path.join(result.link, 'other-user.txt'), 'preserve');
  await assert.rejects(register(options), /未替换/); await assert.rejects(unregister(options), /未移除/);
  assert.equal(await fs.readFile(path.join(result.link, 'other-user.txt'), 'utf8'), 'preserve');
  await assert.rejects(register({ ...options, namespace: '../escape' }), /标识/);
  await assert.rejects(register({ ...options, headerId: 'wrong' }), /清单/);
  await assert.rejects(register({ ...options, clientRoot: root }), /数据目录/);
  console.log('PASS: ordinary-client audio junction, hash inspection, repeat deployment, safe removal, collision preservation and path/UUID checks. All files stay in the test workspace.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
