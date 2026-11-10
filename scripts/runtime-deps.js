// 按 server/package.json 的真实解析结果，把指定运行时依赖（含传递依赖）拷进绿色包。
"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

function cpDir(from, to, { skipNodeModules = false } = {}) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    force: true,
    filter: skipNodeModules ? (src) => path.basename(src) !== 'node_modules' : undefined,
  });
}

function countFiles(dir, skipNodeModules = false) {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipNodeModules && entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countFiles(p, skipNodeModules);
    else n += 1;
  }
  return n;
}

function packageDir(req, name) {
  try { return path.dirname(req.resolve(name + "/package.json")); } catch { /* exports 限制 */ }
  let dir = path.dirname(req.resolve(name));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("cannot resolve package " + name);
}

function copyRuntimeDeps({ root, appDir, deps, skip = [] }) {
  const req = createRequire(path.join(root, "server", "package.json"));
  const seen = new Set(skip);
  function copy(name) {
    if (seen.has(name)) return;
    seen.add(name);
    let dir;
    try { dir = packageDir(req, name); } catch { return; }
    const dest = path.join(appDir, "node_modules", ...name.split("/"));
    // 自家 workspace 包的嵌套 node_modules 是 devDependencies（vitest/vite-node 等），
    // 运行时依赖由本函数按 package.json 逐个解析拷贝，不整目录带入。
    const skipNodeModules = name.startsWith("@devflow/");
    cpDir(dir, dest, { skipNodeModules });
    if (countFiles(dest) < countFiles(dir, skipNodeModules)) throw new Error("runtime dep copy incomplete: " + name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const next = [
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
    ];
    for (const dep of next) copy(dep);
  }
  for (const name of deps) copy(name);
}

module.exports = { copyRuntimeDeps };
