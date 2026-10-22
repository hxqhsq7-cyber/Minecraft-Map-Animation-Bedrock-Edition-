'use strict';
const fs = require('node:fs').promises, path = require('node:path');
async function resolveWorld(input) {
  let directory = await fs.realpath(input), stat = await fs.stat(directory);
  if (stat.isFile()) {
    if (path.basename(directory).toLowerCase() !== 'level.dat') throw new Error('请选择世界中的 level.dat 文件。');
    directory = path.dirname(directory);
  } else if (stat.isDirectory() && path.basename(directory).toLowerCase() === 'db') {
    // The folder dialog hides files; choosing db is a common one-level-too-deep selection.
    try { if ((await fs.stat(path.join(directory, '..', 'level.dat'))).isFile()) directory = path.dirname(directory); } catch {}
  }
  const missing = [];
  for (const name of ['level.dat', 'db/CURRENT']) {
    try { if (!(await fs.stat(path.join(directory, name))).isFile()) missing.push(name); }
    catch { missing.push(name); }
  }
  if (missing.length) throw new Error(`世界路径：${directory}\n缺少：${missing.join('、')}。请选择 level.dat，或同时含 level.dat 和 db 的世界文件夹；不要选择 minecraftWorlds 总目录。`);
  return directory;
}
module.exports = { resolveWorld };
