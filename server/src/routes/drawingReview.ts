/**
 * 图纸路由 · AI 复核（二次确认）+ 人工反馈闭环
 *
 * 设计原则：规则提取是唯一数据源（确定性、可追溯到坐标文本）；AI 只做「校准审核」——
 * 对最终输出的缺失/乱码/不一致/推定值出复核报告，永远不直接改数；人工指出错误后
 * AI 结合反馈定向重核并更新疑点状态。所有复核产物随任务目录落地，纳入每周备份。
 *
 * 文件协议：
 *   out/review.json         当前复核状态（model/findings[]/stats/updated_at）
 *   out/review-history.json 追加式记录：AI 复核 / 人工反馈 / AI 重核回应
 *
 * 接口：
 *   GET  /api/drawing/jobs/:id/review           读复核状态 + 历史
 *   POST /api/drawing/jobs/:id/review           发起 AI 复核（预扫描 + GLM）
 *   POST /api/drawing/jobs/:id/review/feedback  人工反馈 → AI 重新复核
 */
import { Router, Request, Response, NextFunction } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from './auth.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..', '..', 'uploads', 'drawing');

const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };

const ID_RE = /^[a-z0-9-]+$/;
function validId(id: string): boolean { return ID_RE.test(id) && id.length >= 6 && id.length <= 64; }

// ============== 复核产物读写 ==============

interface Finding {
  id: string;              // S1..（预扫描）/ A1..（AI 补充），跨轮保持稳定
  source: 'scan' | 'ai';   // 疑点来源：确定性预扫描 or AI 补充
  type: string;            // 缺失 | 乱码 | 不一致 | 推定 | 其他
  severity: string;        // 高 | 中 | 低
  sheet: string; row: string;
  problem: string;
  evidence: string;
  suggestion: string;
  confidence: string;      // 高 | 中 | 低
  status: string;          // 待复核 | AI已复核 | 人工已反馈 | 已解决 | 无需处理
}

interface ReviewState {
  model: string;
  updated_at: string;
  findings: Finding[];
  stats: Record<string, number>;
  summary: string;
}

function reviewPath(id: string) { return { cur: join(BASE, id, 'out', 'review.json'), hist: join(BASE, id, 'out', 'review-history.json') }; }

function loadReview(id: string): { review: ReviewState | null; history: any[] } {
  const p = reviewPath(id);
  let review: ReviewState | null = null;
  let history: any[] = [];
  try { review = JSON.parse(readFileSync(p.cur, 'utf8')); } catch {}
  try { history = JSON.parse(readFileSync(p.hist, 'utf8')); } catch {}
  return { review, history };
}

function saveReview(id: string, review: ReviewState, history: any[]) {
  const p = reviewPath(id);
  writeFileSync(p.cur, JSON.stringify(review, null, 2));
  writeFileSync(p.hist, JSON.stringify(history, null, 2));
}

// ============== 确定性预扫描（缺失/乱码/推定） ==============

function prescan(id: string): Finding[] {
  const out: Finding[] = [];
  let idx = 0;
  const push = (f: Omit<Finding, 'id' | 'source' | 'status'>) => {
    out.push({ id: `S${++idx}`, source: 'scan', status: '待复核', ...f });
  };
  // 1) report 警告
  try {
    const report = JSON.parse(readFileSync(join(BASE, id, 'out', 'report.json'), 'utf8'));
    for (const w of report.warnings || []) {
      push({ type: '其他', severity: '中', sheet: '(管线)', row: '—', problem: String(w),
        evidence: 'report.json warnings', suggestion: '确认该警告对应数据是否需人工补录', confidence: '高' });
    }
  } catch { /* 无 report */ }
  // 2) sheet 逐格扫描
  let sheets: any[] = [];
  try { sheets = JSON.parse(readFileSync(join(BASE, id, 'out', 'sheets', 'index.json'), 'utf8')); } catch { return out; }
  // 同类单元格合并成一条疑点（如「中压柜缺映射」50 格 → 1 条，避免刷屏）
  const byPattern = new Map<string, Finding & { count: number; rows: string[] }>();
  for (const meta of sheets) {
    let data: any = null;
    try { data = JSON.parse(readFileSync(join(BASE, id, 'out', 'sheets', meta.file), 'utf8')); } catch { continue; }
    const rows: string[][] = data.rows || [];
    rows.forEach((r, ri) => {
      r.forEach((c, ci) => {
        const s = String(c ?? '');
        if (!s) return;
        let type = '', problem = '';
        if (/None|undefined/.test(s)) { type = '乱码'; problem = `单元格含程序空值拼接：${s.slice(0, 60)}`; }
        else if (/[?？]/.test(s) && /(→|kVA|台|\(？|\（？)/.test(s)) { type = '缺失'; problem = `含未识别占位问号：${s.slice(0, 60)}`; }
        else if (/（推定）/.test(s)) { type = '推定'; problem = `按同名组推定的值：${s.slice(0, 60)}`; }
        else if (s.length > 3 && /[\u{E000}-\u{F8FF}]/u.test(s)) { type = '乱码'; problem = `含异常字符：${s.slice(0, 40)}`; }
        if (!type) return;
        const key = `${type}|${meta.name}|${problem.slice(0, 24)}`;
        const prev = byPattern.get(key);
        if (prev) { prev.count++; prev.rows.push(`r${ri}c${ci}`); }
        else byPattern.set(key, { ...{ id: '', source: 'scan', status: '待复核' },
          type, severity: type === '乱码' ? '高' : type === '缺失' ? '高' : '低',
          sheet: meta.name, row: `r${ri}`, problem, evidence: `单元格原文：${s.slice(0, 90)}`,
          suggestion: type === '推定' ? '核对图纸该设备实际容量后确认或修正' : '结合图纸原文定位缺失原因，人工补录正确值',
          confidence: '高', count: 1, rows: [`r${ri}c${ci}`] });
      });
    });
  }
  for (const f of byPattern.values()) {
    const extra = f.count > 1 ? `（同类共 ${f.count} 格：${f.rows.slice(0, 6).join('、')}${f.count > 6 ? '…' : ''}）` : '';
    push({ type: f.type, severity: f.severity, sheet: f.sheet, row: f.row,
      problem: f.problem + extra, evidence: f.evidence, suggestion: f.suggestion, confidence: '高' });
  }  return out;
}

// ============== GLM 调用（思考开启，不联网，强约束 JSON） ==============

async function callGLMJSON(system: string, user: string): Promise<{ json: any; raw: string }> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('ZHIPU_API_KEY 未设置');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 165000);
  try {
    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'glm-5.2',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: 'medium',   // 复核是结构化任务，medium 足够且避免 max 思考跑满超时
        temperature: 1.0,
        max_tokens: 8192,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`GLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const data: any = await resp.json();
    const raw: string = data.choices?.[0]?.message?.content || '';
    // 剥掉可能的 ```json 围栏后取首个 { 到末个 } 的 JSON 体
    const text = raw.replace(/```(?:json)?/g, '').trim();
    const lo = text.indexOf('{'); const hi = text.lastIndexOf('}');
    if (lo < 0 || hi <= lo) throw new Error('AI 未返回 JSON');
    return { json: JSON.parse(text.slice(lo, hi + 1)), raw };
  } finally { clearTimeout(timer); }
}

const SYS_REVIEW = `你是数据中心配电图纸路由表的复核专家（测试部 AI 校准审核角色）。
规则引擎已从 DWG 图纸的坐标文本确定性提取数据并生成路由表；你拿到【预扫描疑点】和关键表格内容。
你的职责是校准审核，不是重新提取：
1. 逐条评估预扫描疑点：判断问题定性是否准确、严重级别是否合适、给出可执行建议（如何补录/如何核对）；
2. 结合表格内容补充预扫描漏掉的跨表不一致（如配电室统计与中压/低压表数量对不上、A/B 路不配对）；
3. 对推断性建议（如按楼层同构推测缺失映射）必须在 suggestion 里写明推断依据，confidence 只能给"低"或"中"；
4. 铁律：所有结论必须引用给定材料原文，不得编造单元格内容；你不能修改数据，只输出复核意见；禁止臆造具体数值当作事实。
输出严格 JSON（无 markdown）：{"findings":[{"sid":"预扫描id，AI补充则null","type":"缺失|乱码|不一致|推定|其他","severity":"高|中|低","sheet":"表名","row":"行","problem":"问题","evidence":"引用的原文依据","suggestion":"建议","confidence":"高|中|低"}],"summary":"整体结论2-3句"}
findings 最多 40 条，预扫描已有的每条都要出现在结果里（可修订字段），再补充新的。`;

const SYS_REVERIFY = `你是数据中心配电图纸路由表的复核专家。上一轮 AI 复核产出了疑点清单，现在测试人员给出了人工反馈（指出 AI 哪里说错了/补充了事实）。
你的职责是结合人工反馈重新复核：
1. 对每条反馈逐条回应：承认并修正错误、或说明理由坚持原判断（引用材料原文）；
2. 输出【完整更新后的 findings 全量清单】（不是增量）：人工已确认修正的条目 status 设"已解决"；被反馈纠正的条目修正 problem/suggestion 并 status 设"人工已反馈"；其余维持；
3. 铁律同前：不得编造，推断必须标注，你不能修改数据本身。
输出严格 JSON（无 markdown）：{"responses":[{"to":"对应反馈原文摘录","conclusion":"回应与处理"}],"findings":[同上结构，每条多一个"status"字段],"summary":"2-3句"}`;

// ============== 路由 ==============

/** GET 复核状态 + 历史 */
router.get('/jobs/:id/review', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const { review, history } = loadReview(id);
  res.json({ success: true, review, history });
}));

/** 摘取小表全文 + 大表规模，控制送入 GLM 的上下文体积 */
function buildContext(id: string, scanFindings: Finding[]): string {
  const parts: string[] = [];
  parts.push('【预扫描疑点】\n' + JSON.stringify(
    scanFindings.map(f => ({ id: f.id, type: f.type, severity: f.severity, sheet: f.sheet, row: f.row, problem: f.problem, evidence: f.evidence })),
    null, 1));
  let sheets: any[] = [];
  try { sheets = JSON.parse(readFileSync(join(BASE, id, 'out', 'sheets', 'index.json'), 'utf8')); } catch {}
  for (const meta of sheets) {
    let data: any = null;
    try { data = JSON.parse(readFileSync(join(BASE, id, 'out', 'sheets', meta.file), 'utf8')); } catch { continue; }
    const rows: string[][] = data.rows || [];
    if (rows.length <= 40) {
      // 小表全量（配电室统计/中压系统是复核重点）
      parts.push(`【表：${meta.name}（${rows.length}行）】\n` +
        rows.map((r, i) => `r${i}: ` + r.map(c => String(c ?? '')).join(' | ')).join('\n'));
    } else {
      // 大表只送表头 + 前5行样例 + 规模
      parts.push(`【表：${meta.name}（${rows.length}行，仅样例）】\n` +
        rows.slice(0, 6).map((r, i) => `r${i}: ` + r.map(c => String(c ?? '')).join(' | ')).join('\n'));
    }
  }
  try {
    const validate = readFileSync(join(BASE, id, 'out', 'validate.txt'), 'utf8');
    parts.push('【结构校验报告（截断）】\n' + validate.slice(0, 1500));
  } catch { /* 无 */ }
  return parts.join('\n\n');
}

/** POST 发起 AI 复核 */
router.post('/jobs/:id/review', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  if (!existsSync(join(BASE, id, 'out', 'sheets', 'index.json'))) {
    res.status(400).json({ success: false, message: '任务尚未生成表格，无法复核' }); return;
  }
  const scan = prescan(id);
  const context = buildContext(id, scan);
  const t0 = Date.now();
  const { json } = await callGLMJSON(SYS_REVIEW, context);
  // 合并：预扫描为事实底座，AI 输出按 sid 修订，AI 新增条目追加
  const bySid = new Map<string, any>(scan.map(f => [f.id, { ...f }]));
  let aiIdx = 0;
  for (const af of (json.findings || []) as any[]) {
    if (!af || !af.problem) continue;
    if (af.sid && bySid.has(String(af.sid))) {
      const cur = bySid.get(String(af.sid));
      cur.type = af.type || cur.type;
      cur.severity = af.severity || cur.severity;
      cur.problem = af.problem || cur.problem;
      if (af.evidence) cur.evidence = af.evidence;
      if (af.suggestion) cur.suggestion = af.suggestion;
      cur.confidence = af.confidence || cur.confidence;
      cur.status = 'AI已复核';
    } else if (!af.sid) {
      bySid.set(`A${++aiIdx}`, {
        id: `A${aiIdx}`, source: 'ai', type: af.type || '其他', severity: af.severity || '中',
        sheet: af.sheet || '', row: af.row || '', problem: af.problem,
        evidence: af.evidence || '', suggestion: af.suggestion || '',
        confidence: af.confidence || '中', status: 'AI已复核',
      });
    }
  }
  // 预扫描未被 AI 覆盖的条目保留原样（不丢事实）
  const findings = [...bySid.values()];
  const stats: Record<string, number> = {
    total: findings.length,
    high: findings.filter(f => f.severity === '高').length,
    medium: findings.filter(f => f.severity === '中').length,
    low: findings.filter(f => f.severity === '低').length,
  };
  const review: ReviewState = {
    model: 'glm-5.2', updated_at: new Date().toISOString(),
    findings, stats, summary: String(json.summary || ''),
  };
  const { history } = loadReview(id);
  history.push({ role: 'ai', kind: 'review', at: review.updated_at, dur_sec: Math.round((Date.now() - t0) / 1000),
    by: (req as any).user?.username || '', stats, summary: review.summary });
  saveReview(id, review, history);
  res.json({ success: true, review });
}));

/** POST 人工反馈 → AI 重新复核 */
router.post('/jobs/:id/review/feedback', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const msg = String(req.body?.message || '').trim();
  if (!msg) { res.status(400).json({ success: false, message: '反馈内容不能为空' }); return; }
  const { review, history } = loadReview(id);
  if (!review) { res.status(400).json({ success: false, message: '请先发起一次 AI 复核' }); return; }
  const username = (req as any).user?.username || (req as any).user?.name || '';
  const at = new Date().toISOString();
  history.push({ role: 'human', kind: 'feedback', at, by: username, message: msg });
  const userPayload =
    `【上一轮复核 findings】\n${JSON.stringify(review.findings, null, 1)}\n\n` +
    `【人工反馈】（反馈人：${username}）\n${msg}\n\n` +
    `【原始表格上下文】\n${buildContext(id, [])}`;
  const t0 = Date.now();
  const { json } = await callGLMJSON(SYS_REVERIFY, userPayload);
  // 以 AI 输出的全量 findings 为新状态（保留 id 兼容：AI 沿用原 id）
  const findings: Finding[] = ((json.findings || []) as any[]).filter(f => f && f.problem).map((f, i) => ({
    id: String(f.id || f.sid || `F${i + 1}`),
    source: f.source === 'ai' ? 'ai' : 'scan',
    type: f.type || '其他', severity: f.severity || '中',
    sheet: f.sheet || '', row: f.row || '',
    problem: f.problem, evidence: f.evidence || '', suggestion: f.suggestion || '',
    confidence: f.confidence || '中', status: f.status || 'AI已复核',
  }));
  const stats: Record<string, number> = {
    total: findings.length,
    high: findings.filter(f => f.severity === '高').length,
    medium: findings.filter(f => f.severity === '中').length,
    low: findings.filter(f => f.severity === '低').length,
  };
  const updated: ReviewState = {
    ...review, updated_at: new Date().toISOString(), findings, stats,
    summary: String(json.summary || review.summary),
  };
  history.push({ role: 'ai', kind: 'reverify', at: updated.updated_at, dur_sec: Math.round((Date.now() - t0) / 1000),
    responses: json.responses || [], summary: updated.summary });
  saveReview(id, updated, history);
  res.json({ success: true, review: updated, responses: json.responses || [] });
}));

export default router;
