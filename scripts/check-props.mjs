#!/usr/bin/env node
/**
 * 零依赖 JSX props 契约自检。
 *
 * 背景：多条工线并行写 UI 时，最容易出现的事故不是「导入不到」，而是
 * 「A 按旧签名调用、B 换了新签名」——导入自检看不出来，只有 tsc 能抓。
 * 在 node_modules 尚未就绪时，这个脚本用轻量正则先兜住这类断裂：
 *   1. 调用处传了 Props 里没声明的属性
 *   2. Props 里的必填属性调用处没传
 * 保守优先：解析不确定的一律跳过，只报证据确凿的。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

function resolveModule(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return undefined;
}

/** 用花括号配平截取 interface 体，避免嵌套对象把正则带偏。 */
function extractBody(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** 解析 `export interface XxxProps {...}` → { 属性名: 是否必填 }。 */
function parsePropsInterfaces(src) {
  const result = new Map();
  for (const m of src.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*Props)\b([^{]*)/g)) {
    const name = m[1];
    // 继承了别的接口（如 extends BoxProps）时字段不全，标记为不可判定
    const inherits = /extends/.test(m[2]);
    const body = extractBody(src, m.index);
    if (body === null) continue;
    const fields = new Map();
    // 逐行取顶层字段，跳过嵌套内容与注释
    let depth = 0;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
        // 注释行也可能含括号，不参与配平
        continue;
      }
      if (depth === 0) {
        const fm = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*[:(]/);
        if (fm) fields.set(fm[1], !fm[2]); // true = 必填
      }
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth < 0) depth = 0;
    }
    result.set(name, { fields, inherits });
  }
  return result;
}

// ── 建立「组件名 → props 定义」索引 ───────────────────────────────
const files = walk(SRC);
/** 文件路径 → { componentName, props } */
const componentByFile = new Map();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const interfaces = parsePropsInterfaces(src);
  if (interfaces.size === 0) continue;
  // 默认导出的组件名：`const Xxx: React.FC<XxxProps>` 或 `export default Xxx`
  const fcMatch = src.match(/const\s+([A-Za-z_$][\w$]*)\s*:\s*React\.FC<\s*([A-Za-z_$][\w$]*Props)\s*>/);
  if (fcMatch && interfaces.has(fcMatch[2])) {
    componentByFile.set(file, { name: fcMatch[1], props: interfaces.get(fcMatch[2]) });
    continue;
  }
  // 退化：文件里只有一个 Props 接口时，按文件名推断组件名
  if (interfaces.size === 1) {
    const [propsName, def] = [...interfaces.entries()][0];
    componentByFile.set(file, { name: propsName.replace(/Props$/, ''), props: def });
  }
}

/** 抓取 `<Comp ... >` 的属性名集合（含展开则跳过该次调用）。 */
function extractJsxUsages(src, componentName) {
  const usages = [];
  const re = new RegExp(`<${componentName}(\\s|/|>)`, 'g');
  for (const m of src.matchAll(re)) {
    let i = m.index + componentName.length + 1;
    let depth = 0;
    let inStr = null;
    let attrText = '';
    // 扫到标签闭合为止，忽略字符串与嵌套花括号里的内容
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (inStr) {
        if (ch === inStr && src[i - 1] !== '\\') inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
      if (ch === '{') { depth += 1; continue; }
      if (ch === '}') { depth -= 1; continue; }
      if (depth === 0) {
        if (ch === '>') break;
        attrText += ch;
      }
    }
    if (/\{\s*\.\.\./.test(src.slice(m.index, i))) { usages.push(null); continue; } // 有展开，放弃判定
    const names = [...attrText.matchAll(/(?:^|\s)([A-Za-z_$][\w$]*)\s*=/g)].map((x) => x[1]);
    usages.push(new Set(names));
  }
  return usages;
}

const extraProps = [];
const missingRequired = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // 找出本文件从项目内导入的组件（默认导入）
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g)) {
    const localName = m[1];
    const target = resolveModule(m[2], file);
    if (!target || !componentByFile.has(target)) continue;
    const { props } = componentByFile.get(target);
    if (props.inherits) continue; // 字段不全，跳过

    for (const used of extractJsxUsages(src, localName)) {
      if (used === null) continue;
      for (const attr of used) {
        if (attr === 'key' || attr === 'ref' || attr === 'children') continue;
        if (!props.fields.has(attr)) {
          extraProps.push(
            `${relative(ROOT, file)}: <${localName} ${attr}=…>  未在 ${relative(ROOT, target)} 的 Props 中声明`,
          );
        }
      }
      for (const [field, required] of props.fields) {
        if (required && !used.has(field) && field !== 'children') {
          missingRequired.push(
            `${relative(ROOT, file)}: <${localName}> 缺少必填属性 '${field}'  [定义: ${relative(ROOT, target)}]`,
          );
        }
      }
    }
  }
}

console.log(`已建立索引的组件: ${componentByFile.size}`);
console.log(`\n[1] 传入了未声明的属性 (${extraProps.length})`);
extraProps.forEach((x) => console.log('  ✗ ' + x));
console.log(`\n[2] 缺少必填属性 (${missingRequired.length})`);
missingRequired.forEach((x) => console.log('  ✗ ' + x));

if (extraProps.length || missingRequired.length) process.exitCode = 1;
else console.log('\n✓ props 契约自检通过');
