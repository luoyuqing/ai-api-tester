#!/usr/bin/env node
/**
 * 零依赖导入自检。
 *
 * 本项目在没有 node_modules 的环境下也需要能发现「导入了不存在的模块 / 不存在的导出」
 * 这类硬伤，因此用轻量正则做一次静态扫描。它不是类型检查器，只回答两个问题：
 *   1. `@/xxx` 能否解析到真实文件？
 *   2. 具名导入的符号，目标文件是否真的导出了（含 re-export 传递）？
 * 误报优于漏报：拿不准的情况一律放行，只报证据确凿的断裂。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** 递归收集 src 下所有 ts/tsx 源文件。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** 把 `@/a/b` 或相对路径解析成磁盘上的真实文件。 */
function resolveModule(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // 第三方包，不在本工具职责内

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined; // 明确解析失败
}

const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;

/** 拆出 import 子句里的具名符号（忽略默认导入与命名空间导入）。 */
function parseNamed(clause) {
  const m = clause.match(/\{([\s\S]*?)\}/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^type\s+/, ''))
    .map((s) => s.split(/\s+as\s+/)[0].trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
}

const exportCache = new Map();

/** 收集一个文件对外暴露的所有具名导出，跟随 `export * from` 传递。 */
function collectExports(file, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (seen.has(file)) return new Set();
  seen.add(file);

  const src = readFileSync(file, 'utf8');
  const names = new Set();

  // export const/let/var/function/class/interface/type/enum X
  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  // export { a, b as c }
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}(?!\s*from)/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const alias = t.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).replace(/^type\s+/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  // export { a, b as c } from './x'
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const alias = t.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).replace(/^type\s+/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  if (/export\s+default/.test(src)) names.add('default');

  // export * from './x' —— 递归并入
  for (const m of src.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveModule(m[1], file);
    if (target) for (const n of collectExports(target, seen)) names.add(n);
  }
  // export * as ns from './x'
  for (const m of src.matchAll(/export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) {
    names.add(m[1]);
  }

  exportCache.set(file, names);
  return names;
}

// 已声明的第三方依赖 —— 用来拦截「引入了 package.json 里没有的包」。
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
]);
const NODE_BUILTIN = /^(node:|fs$|path$|url$|crypto$|http$|https$|os$|util$|stream$|events$|zlib$|buffer$|child_process$|worker_threads$)/;

/** `@mui/material/Box` → `@mui/material`；`react-dom/client` → `react-dom`。 */
function packageNameOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const files = walk(SRC);
const missingModules = [];
const missingExports = [];
const undeclaredDeps = new Map();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const clause = m[2];
    const spec = m[3];
    const target = resolveModule(spec, file);
    if (target === null) {
      // 第三方包：校验是否已在 package.json 声明
      if (!NODE_BUILTIN.test(spec)) {
        const name = packageNameOf(spec);
        if (!declared.has(name)) {
          if (!undeclaredDeps.has(name)) undeclaredDeps.set(name, new Set());
          undeclaredDeps.get(name).add(relative(ROOT, file));
        }
      }
      continue;
    }
    if (target === undefined) {
      missingModules.push(`${relative(ROOT, file)} → '${spec}'`);
      continue;
    }
    const exported = collectExports(target);
    // 目标文件若含 `export * from` 未能解析的第三方，宁可放行
    for (const name of parseNamed(clause)) {
      if (!exported.has(name)) {
        missingExports.push(
          `${relative(ROOT, file)} → '${spec}' 缺少导出 '${name}'  [目标: ${relative(ROOT, target)}]`,
        );
      }
    }
  }
}

console.log(`扫描文件数: ${files.length}`);
console.log(`\n[1] 无法解析的模块 (${missingModules.length})`);
missingModules.forEach((x) => console.log('  ✗ ' + x));
console.log(`\n[2] 缺失的具名导出 (${missingExports.length})`);
missingExports.forEach((x) => console.log('  ✗ ' + x));
console.log(`\n[3] 未在 package.json 声明的依赖 (${undeclaredDeps.size})`);
for (const [name, users] of undeclaredDeps) {
  console.log(`  ✗ ${name}  ← ${[...users].join(', ')}`);
}

if (missingModules.length || missingExports.length || undeclaredDeps.size) process.exitCode = 1;
else console.log('\n✓ 导入关系自检通过');
