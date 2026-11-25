/**
 * 学习纠错库 — 自我学习能力
 *
 * 策略：
 *   1. 启动时从 data/learned-corrections.json 加载（不存在则初始化为空）
 *   2. 每次审核结果返回前端后，前端可"确认/采纳"纠错，被采纳的纠错
 *      POST 到 /api/report-review/learn，触发本库 addCorrection
 *   3. 注入 prompt 时，把 top-N 高频纠错作为"已知错误词表"提示词
 *
 * 这个模块是 in-memory + 异步落盘，多实例部署需替换为 Redis / DB
 */

import fs from 'fs';
import path from 'path';

// 用 process.cwd() 解析，兼容：
//   - 生产：Docker WORKDIR=/app，node dist/src/index.js → cwd=/app → /app/data
//   - 开发：tsx watch src/index.ts → cwd=server/ → server/data
const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'learned-corrections.json');

export interface Correction {
  original: string;
  suggestion: string;
  count: number;       // 被采纳次数
  lastSeen: string;    // ISO 时间
  source?: string;     // 来源（user / ai-auto）
}

/** 确保文件存在 */
function ensureFile(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '{}', 'utf-8');
}

/** 这几个键名会落到对象原型上：original 是用户输入，必须拒掉，否则 all[original] 取到的是 Object.prototype，
 *  往上面写 suggestion / count 会污染本进程里所有对象 */
function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

/** 全量读取（小型文件可全量读） */
export function loadCorrections(): Record<string, Correction> {
  ensureFile();
  let raw: string;
  try {
    raw = fs.readFileSync(FILE, 'utf-8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    // 只保留形状正确的自有条目（解析结果里混入的数组、原型键等都丢弃）
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('格式不是对象');
    const out: Record<string, Correction> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (isUnsafeKey(k) || !v || typeof v !== 'object') continue;
      out[k] = v as Correction;
    }
    return out;
  } catch (err) {
    // 解析失败时不能当作“空库”返回：那样下一次写入会把整个库文件覆盖成只有一条，历史学习记录全部丢失。
    // 先把坏文件改名留底，再从空库起步，并打出醒目日志。
    const backup = `${FILE}.corrupt-${Date.now()}`;
    try { fs.renameSync(FILE, backup); } catch { /* 改名也失败就只告警 */ }
    console.error('[learnedCorrections] 库文件解析失败，已留底为', backup, '并从空库起步：', (err as Error).message);
    return {};
  }
}

/** 写入落盘：先写临时文件再改名，避免写到一半崩溃留下半截文件（删除条目的路由也用它，别再各写各的） */
export function persistCorrections(corrections: Record<string, Correction>): void {
  try {
    ensureFile();
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(corrections, null, 2), 'utf-8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    // data 目录无写权限时降级为内存模式（不阻塞审核业务，但重启会丢失学习记录）
    console.warn('[learnedCorrections] 写入失败，降级为内存模式（需修复 data 目录权限）：', (err as Error).message);
  }
}

/**
 * 添加或累加一条纠错记录（key = original）
 */
export function addCorrection(original: string, suggestion: string, source: string = 'user'): Correction | null {
  if (!original || isUnsafeKey(original)) return null;
  const all = loadCorrections();
  if (Object.hasOwn(all, original)) {
    const existing = all[original];
    existing.count += 1;
    existing.lastSeen = new Date().toISOString();
    if (suggestion && suggestion !== existing.suggestion) {
      // 用户提供了不同建议，采纳新建议
      existing.suggestion = suggestion;
    }
    persistCorrections(all);
    return existing;
  }
  const created: Correction = {
    original,
    suggestion,
    count: 1,
    lastSeen: new Date().toISOString(),
    source,
  };
  all[original] = created;
  persistCorrections(all);
  return created;
}

/**
 * 取出现频次最高的 N 条（注入 prompt 用）
 */
export function getTopCorrections(n: number = 30): Correction[] {
  const all = loadCorrections();
  return Object.values(all).sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * 拼接成 prompt 文本
 */
export function buildLearnedPrompt(): string {
  const top = getTopCorrections(50);
  if (top.length === 0) return '';
  const lines = top.map((c) => `- "${c.original}" → "${c.suggestion}"（历史采纳 ${c.count} 次）`);
  return `【已学习纠错库（来自历史采纳，优先级最高）】\n${lines.join('\n')}`;
}

/**
 * 关键字索引：把 original 拼成数组，便于后处理去重 / 查找
 */
export function getKnownOriginals(): string[] {
  return Object.keys(loadCorrections());
}
