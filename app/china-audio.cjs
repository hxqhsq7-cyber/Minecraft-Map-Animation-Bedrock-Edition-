'use strict';
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path');
const { createHash } = require('node:crypto');
const defaultClient = () => path.join(process.env.APPDATA || '', 'MinecraftPC_Netease_PB');
async function clientDirectory(directory = defaultClient()) {
  const root = await fsp.realpath(directory).catch(() => { throw new Error('未找到普通中国版数据目录：' + directory); });
  for (const name of ['minecraftWorlds', 'games/com.netease/resource_packs']) {
    if (!(await fsp.stat(path.join(root, name)).catch(() => null))?.isDirectory()) throw new Error('请选择含 minecraftWorlds 和 games/com.netease/resource_packs 的普通中国版数据目录。');
  }
  return root;
}
async function inspect(directory, namespace, headerId) {
  if (!/^fy_cn_[0-9a-f]{12}$/.test(namespace)) throw new Error('音轨标识无效。');
  const root = await fsp.realpath(directory);
  if (path.basename(root) !== namespace + '_audio') throw new Error('音轨目录不匹配。');
  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.header?.uuid !== headerId || !manifest.modules?.some(m => m.type === 'resources')) throw new Error('音轨清单不匹配。');
  const files = {};
  async function walk(folder) {
    for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('音轨目录中不能包含链接。');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
        files[path.relative(root, file).split(path.sep).join('/')] = hash.digest('hex');
      } else throw new Error('音轨目录包含不支持的文件。');
    }
  }
  await walk(root);
  if (!files['sounds/sound_definitions.json'] || !files[`sounds/mapcinema/${namespace}/13.wav`]) throw new Error('音轨文件不完整，请重新生成世界副本。');
  return { root, files };
}
async function location(options) {
  const audio = await inspect(options.directory, options.namespace, options.headerId);
  const clientRoot = await clientDirectory(options.clientRoot);
  const resourceRoot = await fsp.realpath(path.join(clientRoot, 'games/com.netease/resource_packs'));
  const link = path.join(resourceRoot, options.namespace + '_audio');
  return { ...audio, clientRoot, link };
}
async function register(options) {
  if (process.platform !== 'win32') throw new Error('普通中国版音轨部署仅支持 Windows。');
  const { root: directory, files, clientRoot, link } = await location(options);
  const existing = await fsp.lstat(link).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing) {
    if (!existing.isSymbolicLink() || (await fsp.realpath(link)) !== directory) throw new Error('资源目录已有其他内容，未替换：' + link);
  } else await fsp.symlink(directory, link, 'junction');
  const result = { ok: true, directory, clientRoot, link, files, restartRequired: true };
  await fsp.writeFile(directory + '.registration.json', JSON.stringify(result, null, 2));
  return result;
}
async function unregister(options) {
  const { root, link } = await location(options);
  const existing = await fsp.lstat(link).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing) {
    if (!existing.isSymbolicLink() || await fsp.realpath(link) !== root) throw new Error('登记位置已变化，未移除其他资源。');
    await fsp.unlink(link);
  }
  await fsp.rm(root + '.registration.json', { force: true });
  return { ok: false, removed: true, directory: root, link, restartRequired: true };
}
module.exports = { register, unregister, clientDirectory, defaultClient };
