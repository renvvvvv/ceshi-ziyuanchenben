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

/** 全量读取（小型文件可全量读） */
export function loadCorrections(): Record<string, Correction> {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/** 写入落盘 */
function persist(corrections: Record<string, Correction>): void {
  ensureFile();
  fs.writeFileSync(FILE, JSON.stringify(corrections, null, 2), 'utf-8');
}

/**
 * 添加或累加一条纠错记录（key = original）
 */
export function addCorrection(original: string, suggestion: string, source: string = 'user'): Correction {
  const all = loadCorrections();
  const existing = all[original];
  if (existing) {
    existing.count += 1;
    existing.lastSeen = new Date().toISOString();
    if (suggestion && suggestion !== existing.suggestion) {
      // 用户提供了不同建议，采纳新建议
      existing.suggestion = suggestion;
    }
    persist(all);
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
  persist(all);
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
