/**
 * 图纸路由 · AI 复核（二次确认）+ 人工反馈闭环 + 自学习库
 *
 * 设计原则：规则提取是唯一数据源（确定性、可追溯到坐标文本）；AI 只做「校准审核」——
 * 对最终输出的缺失/乱码/不一致/推定值出复核报告，永远不直接改数；人工指出错误后
 * AI 结合反馈定向重核并更新疑点状态。所有复核产物随任务目录落地，纳入每周备份。
 *
 * 自学习：人工反馈中的可复用事实结论（映射确认/容量确认/版式说明）由 AI 提炼入库
 * （data/drawing-learnings.json，与学习纠错库同模式：内存+落盘+引用计数），后续任何
 * 任务的复核/重核自动注入相关经验，AI 引用后在 finding.learning_ids 里记账——
 * 精度随人工反馈积累持续提升，同样的错不犯第二次。
 *
 * 文件协议：
 *   out/review.json         当前复核状态（model/findings[]/stats/updated_at）
 *   out/review-history.json 追加式记录：AI 复核 / 人工反馈 / AI 重核回应
 *
 * 接口：
 *   GET  /api/drawing/jobs/:id/review           读复核状态 + 历史 + 自学习库
 *   POST /api/drawing/jobs/:id/review           发起 AI 复核（预扫描 + GLM）
 *   POST /api/drawing/jobs/:id/review/feedback  人工反馈 → AI 重新复核（并沉淀经验）
 */
import { Router, Request, Response, NextFunction } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = join(__dirname, '..', '..', '..', 'uploads', 'drawing');

const asyncH = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(fn(req, res, next)).catch(next); };

const ID_RE = /^[a-z0-9-]+$/;
function validId(id: string): boolean { return ID_RE.test(id) && id.length >= 6 && id.length <= 64; }

// ============== 同任务串行锁（防并发复核互相覆盖 review/history/学习库） ==============
const jobLocks = new Map<string, Promise<void>>();
async function withJobLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = jobLocks.get(id) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  jobLocks.set(id, gate);
  try {
    await prev.catch(() => undefined);
    return await fn();
  } finally {
    release();
    if (jobLocks.get(id) === gate) jobLocks.delete(id); // 仅当自己仍是队尾才清，防误删后来者
  }
}

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
  status: string;          // 待复核 | AI已复核 | 人工已反馈 | 已修正 | 已解决 | 无需处理
  learning_ids?: string[]; // 本条引用了哪些历史经验（自学习记账）
  /** 人工修正值（结构化）：复核时直接填写正确值，入学习库供管线回写 */
  corrected_value?: string;
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

/** 原子写：tmp + rename，防止崩溃留下半截 JSON 丢失已有人工反馈 */
import { renameSync } from 'fs';
function saveReview(id: string, review: ReviewState, history: any[]) {
  const p = reviewPath(id);
  for (const [f, data] of [[p.cur, review], [p.hist, history]] as const) {
    const tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, f);
  }
}

// ============== 自学习库（人工反馈沉淀 → 后续复核自动复用） ==============
// 与 learnedCorrections 同模式：data/ 目录 JSON 持久化（容器挂载，随每周备份）

interface Learning {
  id: string;              // L1, L2…
  kind: string;            // 映射确认 | 容量确认 | 版式说明 | 修正值 | 优化建议 | 其他
  content: string;         // 可复用的事实结论
  buildings: string[];     // 关联楼栋/项目标识（从任务标题提取，用于匹配后续任务）
  source_job: string;
  created_by: string;
  at: string;
  applied: number;         // 被后续复核引用次数
  /** 结构化修正值（人工复核时逐条填写，管线回写消费）：如 {pattern:'F3-P3-T06', field:'ah', value:'1AH5'} */
  correction?: { finding_id: string; sheet: string; row: string; problem: string; value: string };
}

const DATA_DIR = join(__dirname, '..', '..', '..', 'data');
const LEARN_FILE = join(DATA_DIR, 'drawing-learnings.json');

function loadLearnings(): Learning[] {
  try { return JSON.parse(readFileSync(LEARN_FILE, 'utf8')); } catch { return []; }
}

function saveLearnings(list: Learning[]) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = LEARN_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(list, null, 2));
    renameSync(tmp, LEARN_FILE);
  } catch (e: any) { console.warn('[drawingReview] 学习库写入失败:', e?.message); }
}

/** 从任务标题提取楼栋/项目标识（A3、7#、D7、乌兰三期…），供经验与任务匹配 */
function buildingKeys(title: string): string[] {
  const t = String(title || '');
  const keys = new Set<string>([t.trim()].filter(Boolean));
  for (const m of t.matchAll(/[A-Za-z]\d{1,2}(?=#|楼|期|[-_ ]|$)|\d{1,2}#|D\d{1,2}|乌兰\S{0,4}/g)) {
    keys.add(m[0].toUpperCase());
  }
  return [...keys];
}

/** 与某任务相关的经验（双向匹配：经验标识∩任务标识，或任务标识出现在经验内容里） */
function matchLearnings(list: Learning[], title: string): Learning[] {
  const keys = buildingKeys(title).map(k => k.toUpperCase());
  const hit = (l: Learning) => {
    if (!l.buildings?.length) return true; // 未绑定标识 = 通用经验
    if (l.buildings.some(b => !b || keys.includes(b.toUpperCase()))) return true;
    // 任务标识（如 A3、7#）作为子串出现在经验内容里 → 相关
    const content = l.content.toUpperCase();
    return keys.some(k => k.length >= 2 && content.includes(k));
  };
  return list.filter(hit);
}

/** 归一化指纹：去空白与标点，用于内容去重 */
const fp = (s: string) => String(s || '').replace(/[\s，。；、,.;:：()（）"'\-—]/g, '').slice(0, 80);

/** 沉淀新经验（去重），返回 [新库, 新增条数, 重复条数] */
function addLearnings(
  items: any[], jobId: string, title: string, by: string,
): [Learning[], number, number] {
  const list = loadLearnings();
  const seen = new Set(list.map(l => fp(l.content)));
  let added = 0, dup = 0;
  for (const it of items || []) {
    const content = String(it?.content || '').trim();
    if (!content) continue;
    if (seen.has(fp(content))) { dup++; continue; }
    seen.add(fp(content));
    list.push({
      id: `L${list.length + 1}`, kind: String(it.kind || '其他'),
      content: content.slice(0, 500),
      // 楼栋标识：任务标题 ∪ 经验内容（内容里出现 A3/7# 等也能被后续同楼栋任务命中）
      buildings: [...new Set([...buildingKeys(title), ...buildingKeys(content)])],
      source_job: jobId, created_by: by, at: new Date().toISOString(), applied: 0,
    });
    added++;
  }
  if (added) saveLearnings(list);
  return [list, added, dup];
}

/** AI 引用记账：findings.learning_ids → applied++（仅统计真实存在的 id） */
function countLearningApplied(findings: Finding[], list: Learning[]): number {
  const ids = new Set(findings.flatMap(f => f.learning_ids || []));
  if (!ids.size) return 0;
  let n = 0;
  for (const l of list) {
    if (ids.has(l.id)) { l.applied++; n++; }
  }
  if (n) saveLearnings(list);
  return n;
}

/** 拼注入 prompt 的经验块（带编号，AI 引用时回填 learning_ids） */
function learningsBlock(all: Learning[], title: string): string {
  const matched = matchLearnings(all, title);
  if (!matched.length) return '';
  const items = matched.slice(0, 30).map(l =>
    `${l.id} [${l.kind}] ${l.content.slice(0, 160)}（来源任务 ${l.source_job}，已被引用 ${l.applied} 次）`);
  return `【历史学习知识（人工反馈沉淀，可直接作为依据引用）】\n` + items.join('\n');
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
  const timer = setTimeout(() => controller.abort(), 175000); // nginx 反代 180s，留 5s 余量
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
    const body = text.slice(lo, hi + 1);
    try {
      return { json: JSON.parse(body), raw };
    } catch {
      // 输出超长被截断时兜底打捞：逐元素括号扫描重建 findings 数组（丢掉残缺的末尾元素）
      const salvaged = salvageFindingsJSON(body);
      if (salvaged) {
        console.warn(`[drawingReview] JSON 截断已打捞：${salvaged.findings?.length ?? 0} 条 findings`);
        return { json: salvaged, raw };
      }
      throw new Error('AI 返回 JSON 解析失败（截断且无法打捞）');
    }
  } finally { clearTimeout(timer); }
}

/** 截断 JSON 打捞：从残缺文本中提取完整的 findings 元素与 summary */
function salvageFindingsJSON(text: string): any | null {
  const arrStart = text.indexOf('"findings"');
  if (arrStart < 0) return null;
  const open = text.indexOf('[', arrStart);
  if (open < 0) return null;
  const items: any[] = [];
  let depth = 0, str = false, esc = false, objStart = -1;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
    if (ch === '"') { str = true; continue; }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try { items.push(JSON.parse(text.slice(objStart, i + 1))); } catch { /* 残缺元素丢弃 */ }
        objStart = -1;
      }
    } else if (ch === ']' && depth === 0) break;
  }
  if (!items.length) return null;
  const out: any = { findings: items };
  const sm = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (sm) { try { out.summary = JSON.parse('"' + sm[1] + '"'); } catch { /* 忽略 */ } }
  return out;
}

const SYS_REVIEW = `你是数据中心配电图纸路由表的复核专家（测试部 AI 校准审核角色）。
规则引擎已从 DWG 图纸的坐标文本确定性提取数据并生成路由表；你拿到【预扫描疑点】和关键表格内容；
若下方提供【历史学习知识】，那是此前测试人员人工反馈沉淀下来的事实结论，可直接作为复核依据引用。
你的职责是校准审核，不是重新提取：
1. 逐条评估预扫描疑点：判断问题定性是否准确、严重级别是否合适、给出可执行建议（如何补录/如何核对）；
   能用历史知识直接解答的疑点，suggestion 写明结论并引用经验编号；
2. 结合表格内容补充预扫描漏掉的跨表不一致（如配电室统计与中压/低压表数量对不上、A/B 路不配对）；
3. 对推断性建议（如按楼层同构推测缺失映射）必须在 suggestion 里写明推断依据，confidence 只能给"低"或"中"；
   但若历史知识中已有人工确认的同款结论，则可直接采用且 confidence 给"高"；
4. 铁律：所有结论必须引用给定材料原文，不得编造单元格内容；你不能修改数据，只输出复核意见；禁止臆造具体数值当作事实。
输出严格 JSON（无 markdown）：{"findings":[{"sid":"预扫描id，AI补充则null","type":"缺失|乱码|不一致|推定|其他","severity":"高|中|低","sheet":"表名","row":"行","problem":"问题(≤60字)","evidence":"引用的原文依据(≤60字)","suggestion":"建议(≤120字)","confidence":"高|中|低","learning_ids":["引用的历史经验编号，如[\"L3\"]，未引用则省略"]}],"summary":"整体结论2-3句"}
铁律：预扫描的每一条都必须在输出中逐条对应（sid 填该条的 id，禁止合并、禁止遗漏），AI 补充的新发现才用 sid=null；字段务必简短，防止输出截断。`;

const SYS_REVERIFY = `你是数据中心配电图纸路由表的复核专家。上一轮 AI 复核产出了疑点清单，现在测试人员给出了人工反馈（指出 AI 哪里说错了/补充了事实）。
你的职责是结合人工反馈重新复核：
1. 对每条反馈逐条回应：承认并修正错误、或说明理由坚持原判断（引用材料原文）；
2. 输出【完整更新后的 findings 全量清单】（不是增量）：人工已确认修正的条目 status 设"已解决"；被反馈纠正的条目修正 problem/suggestion 并 status 设"人工已反馈"；其余维持；
3. 同时从人工反馈中提炼【可复用的经验结论】进 learnings：只收事实性、以后同类任务还用得上的结论
   （映射确认：某房间变压器↔中压柜对应关系；容量确认：某设备实际容量；版式说明：某图版式特征导致规则识别不到），
   排除一次性讨论、情绪表达、与图纸无关的内容；每条 content 要自包含：开头写明楼栋/项目（如「A3楼：…」），
   写清房间/设备/结论，不写"如上所述"；
4. 铁律同前：不得编造，推断必须标注，你不能修改数据本身。
输出严格 JSON（无 markdown）：{"responses":[{"to":"对应反馈原文摘录(≤30字)","conclusion":"回应与处理(≤100字)"}],"findings":[同复核结构，每条多一个"status"字段，可含"learning_ids"，最多25条],"learnings":[{"kind":"映射确认|容量确认|版式说明|其他","content":"自包含的事实结论(≤150字)"}],"summary":"2-3句"}
responses 每条反馈一个；findings 是全量清单，字段务必简短，防止输出截断。`;

// ============== 路由 ==============

/** GET 复核状态 + 历史 + 自学习库 */
router.get('/jobs/:id/review', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const { review, history } = loadReview(id);
  const all = loadLearnings();
  res.json({ success: true, review, history, learnings: all.slice(-200) }); // 最新200条，防止库增大后拖慢详情打开
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
  // 同任务串行：防止并发复核互相覆盖 review/history/学习库
  const result = await withJobLock(id, () => runReview(id, req));
  if (result.err) { res.status(502).json({ success: false, message: result.err }); return; }
  res.json({ success: true, review: result.review, learnings: loadLearnings() });
}));

async function runReview(id: string, req: Request): Promise<{ review?: ReviewState; err?: string }> {
  const jobRows = await db.allAsync(`SELECT title FROM drawing_jobs WHERE id=$1`, id) as any[];
  const jobTitle: string = jobRows[0]?.title || '';
  const scan = prescan(id);
  const learnAll = loadLearnings();
  const lblock = learningsBlock(learnAll, jobTitle);
  const context = (lblock ? lblock + '\n\n' : '') + buildContext(id, scan);
  const t0 = Date.now();
  const { json } = await callGLMJSON(SYS_REVIEW, context);
  // 合并：预扫描为事实底座，AI 输出按 sid 修订，AI 新增条目追加
  const bySid = new Map<string, any>(scan.map(f => [f.id, { ...f }]));
  const updated = new Set<string>();
  const applyTo = (cur: any, af: any, lids?: string[]) => {
    cur.type = af.type || cur.type;
    cur.severity = af.severity || cur.severity;
    cur.problem = af.problem || cur.problem;
    if (af.evidence) cur.evidence = af.evidence;
    if (af.suggestion) cur.suggestion = af.suggestion;
    cur.confidence = af.confidence || cur.confidence;
    if (lids) cur.learning_ids = lids;
    cur.status = 'AI已复核';
  };
  let aiIdx = 0;
  for (const af of (json.findings || []) as any[]) {
    if (!af || !af.problem) continue;
    const lids: string[] | undefined = Array.isArray(af.learning_ids) ? af.learning_ids.map(String) : undefined;
    const sid = String(af.sid || af.id || '');
    if (sid && bySid.has(sid) && !updated.has(sid)) {
      applyTo(bySid.get(sid), af, lids);
      updated.add(sid);
      continue;
    }
    // sid 缺失/对不上时按 表名+行 兜底匹配（防 AI 改写 id 造成映射落空）
    const rowKey = String(af.row || '');
    const byPos = [...bySid.keys()].find(k => !updated.has(k)
      && bySid.get(k).sheet === String(af.sheet || '') && String(bySid.get(k).row) === rowKey);
    if (byPos) {
      applyTo(bySid.get(byPos), af, lids);
      updated.add(byPos);
      continue;
    }
    if (!sid || !bySid.has(sid)) {
      bySid.set(`A${++aiIdx}`, {
        id: `A${aiIdx}`, source: 'ai', type: af.type || '其他', severity: af.severity || '中',
        sheet: af.sheet || '', row: af.row || '', problem: af.problem,
        evidence: af.evidence || '', suggestion: af.suggestion || '',
        confidence: af.confidence || '中', status: 'AI已复核',
        ...(lids ? { learning_ids: lids } : {}),
      });
    }
  }
  // 预扫描未被 AI 覆盖的条目保留原样（不丢事实）
  const findings = [...bySid.values()];
  // 自学习记账：本轮 AI 引用了哪些历史经验（全局锁内读改写）
  const appliedN = await withJobLock('__learnings__', async () => countLearningApplied(findings as Finding[], learnAll));
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
    by: (req as any).user?.username || '', stats, summary: review.summary,
    learned_applied: appliedN, learnings_known: matchLearnings(learnAll, jobTitle).length });
  saveReview(id, review, history);
  return { review };
}

/** POST 人工反馈 → AI 重新复核 */
router.post('/jobs/:id/review/feedback', requireAuth, asyncH(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const msg = String(req.body?.message || '').trim();
  if (!msg) { res.status(400).json({ success: false, message: '反馈内容不能为空' }); return; }
  const { review } = loadReview(id);
  if (!review) { res.status(400).json({ success: false, message: '请先发起一次 AI 复核' }); return; }
  const result = await withJobLock(id, () => runFeedback(id, req, msg));
  if (result.savedFeedbackOnly) {
    // AI 重核失败但人工反馈已落盘，绝不丢用户的反馈
    res.status(502).json({ success: false, message: `AI 重核失败（${result.err}）。你的反馈已保存，可稍后重新提交重核` });
    return;
  }
  if (result.err) { res.status(502).json({ success: false, message: result.err }); return; }
  res.json({ success: true, review: result.review, responses: result.responses, learnings: loadLearnings() });
}));

async function runFeedback(id: string, req: Request, msg: string): Promise<{
  review?: ReviewState; responses?: any[]; err?: string; savedFeedbackOnly?: boolean;
}> {
  const { review, history } = loadReview(id);
  if (!review) return { err: '请先发起一次 AI 复核' };
  const username = (req as any).user?.username || (req as any).user?.name || '';
  const at = new Date().toISOString();
  history.push({ role: 'human', kind: 'feedback', at, by: username, message: msg });
  const jobRows = await db.allAsync(`SELECT title FROM drawing_jobs WHERE id=$1`, id) as any[];
  const jobTitle: string = jobRows[0]?.title || '';
  const learnAll = loadLearnings();
  const lblock = learningsBlock(learnAll, jobTitle);
  const userPayload =
    (lblock ? lblock + '\n\n' : '') +
    `【上一轮复核 findings】\n${JSON.stringify(review.findings, null, 1)}\n\n` +
    `【人工反馈】（反馈人：${username}）\n${msg}\n\n` +
    `【原始表格上下文】\n${buildContext(id, [])}`;
  const t0 = Date.now();
  let json: any;
  try {
    json = (await callGLMJSON(SYS_REVERIFY, userPayload)).json;
  } catch (e: any) {
    // AI 失败也要保住人工反馈（历史已 push，先落盘再返回）
    saveReview(id, review, history);
    return { err: e?.message || 'AI 重核失败', savedFeedbackOnly: true };
  }
  // 沉淀反馈中的可复用经验（去重）；学习库为全局文件，用全局锁防跨任务并发丢失更新
  const [, addedN, dupN] = await withJobLock('__learnings__', async () => addLearnings(json.learnings, id, jobTitle, username));
  // 以 AI 输出的全量 findings 为新状态；source 沿用上一轮同 id 的值（AI 不回传该字段）
  const prevSource = new Map(review.findings.map(f => [f.id, f.source]));
  const findings: Finding[] = ((json.findings || []) as any[]).filter(f => f && f.problem).map((f, i) => ({
    id: String(f.id || f.sid || `F${i + 1}`),
    source: prevSource.get(String(f.id || f.sid || '')) || (f.source === 'ai' ? 'ai' : 'scan'),
    type: f.type || '其他', severity: f.severity || '中',
    sheet: f.sheet || '', row: f.row || '',
    problem: f.problem, evidence: f.evidence || '', suggestion: f.suggestion || '',
    confidence: f.confidence || '中', status: f.status || 'AI已复核',
    ...(Array.isArray(f.learning_ids) ? { learning_ids: f.learning_ids.map(String) } : {}),
  }));
  // 自学习记账：本轮引用了哪些历史经验（全局锁内读改写）
  const appliedN = await withJobLock('__learnings__', async () => countLearningApplied(findings, loadLearnings()));
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
    responses: json.responses || [], summary: updated.summary,
    learned_added: addedN, learned_dup: dupN, learned_applied: appliedN });
  saveReview(id, updated, history);
  return { review: updated, responses: json.responses || [] };
}

// ============== 人工修正值 + 优化建议（精度闭环的生产端） ==============

/** POST /api/drawing/jobs/:id/review/correct
 *  人工复核逐条修正：直接填写正确值（如缺失的中压柜号、推定的容量）。
 *  结构化入学习库（kind=修正值，confidence=高），管线回写按楼栋匹配自动应用。
 */
router.post('/jobs/:id/review/correct', requireAuth, requireRole(['管理者', '编辑者']), async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const findingId = String(req.body?.findingId || '');
  const value = String(req.body?.value || '').trim();
  if (!findingId || !value || value.length > 200) {
    res.status(400).json({ success: false, message: '需要 findingId 和修正值（≤200字）' }); return;
  }
  const { review, history } = loadReview(id);
  if (!review) { res.status(400).json({ success: false, message: '请先发起一次 AI 复核' }); return; }
  const f = review.findings.find(x => x.id === findingId);
  if (!f) { res.status(404).json({ success: false, message: '疑点不存在' }); return; }

  const username = (req as any).user?.username || '';
  const at = new Date().toISOString();
  // 更新疑点：修正值 + 状态
  f.corrected_value = value;
  f.status = '已修正';
  // 学习库结构化条目（高置信：人工确认值）
  const jobRows = await db.allAsync(`SELECT title FROM drawing_jobs WHERE id=$1`, id) as any[];
  const jobTitle: string = jobRows[0]?.title || '';
  const list = await withJobLock('__learnings__', async () => {
    const l = loadLearnings();
    l.push({
      id: `L${l.length + 1}`, kind: '修正值',
      content: `${f.sheet} ${f.row}：${f.problem.slice(0, 60)} → 正确值 ${value}`,
      buildings: buildingKeys(jobTitle),
      source_job: id, created_by: username, at, applied: 0,
      correction: { finding_id: findingId, sheet: f.sheet, row: f.row, problem: f.problem.slice(0, 200), value },
    });
    saveLearnings(l);
    return l;
  });
  history.push({ role: 'human', kind: 'correct', at, by: username, finding: findingId, value });
  saveReview(id, review, history);
  res.json({ success: true, review, learnings: list.slice(-200) });
});

/** POST /api/drawing/jobs/:id/review/suggest
 *  管线优化建议：版式问题/识别缺陷/改进想法，进建议库供规则迭代消费。
 */
router.post('/jobs/:id/review/suggest', requireAuth, async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) { res.status(400).json({ success: false }); return; }
  const msg = String(req.body?.message || '').trim();
  if (!msg || msg.length > 1000) { res.status(400).json({ success: false, message: '建议内容不能为空（≤1000字）' }); return; }
  const username = (req as any).user?.username || '';
  const jobRows = await db.allAsync(`SELECT title FROM drawing_jobs WHERE id=$1`, id) as any[];
  const jobTitle: string = jobRows[0]?.title || '';
  const SUG_FILE = join(DATA_DIR, 'drawing-suggestions.json');
  const list = await withJobLock('__suggestions__', async () => {
    let arr: any[] = [];
    try { arr = JSON.parse(readFileSync(SUG_FILE, 'utf8')); } catch {}
    arr.push({
      id: `G${arr.length + 1}`, message: msg, job: id, title: jobTitle,
      buildings: buildingKeys(jobTitle), by: username, at: new Date().toISOString(),
      status: '待处理', // 待处理 | 已采纳 | 已解决
    });
    try { writeFileSync(SUG_FILE, JSON.stringify(arr, null, 2)); } catch (e: any) { console.warn('[drawingReview] 建议库写入失败:', e?.message); }
    return arr;
  });
  // 历史也记一笔
  const { review, history } = loadReview(id);
  history.push({ role: 'human', kind: 'suggest', at: new Date().toISOString(), by: username, message: msg });
  if (review) saveReview(id, review, history);
  res.json({ success: true, suggestions: list });
});

/** GET /api/drawing/jobs/:id/review/suggestions 本任务建议（列表页用） */

/** GET /api/drawing/suggestions 全局建议库汇总（精度迭代看板） */
router.get('/suggestions', requireAuth, async (_req, res) => {
  const SUG_FILE = join(DATA_DIR, 'drawing-suggestions.json');
  try { res.json({ success: true, suggestions: JSON.parse(readFileSync(SUG_FILE, 'utf8')) }); }
  catch { res.json({ success: true, suggestions: [] }); }
});

export default router;
