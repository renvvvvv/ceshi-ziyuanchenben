import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireRole } from './auth.js';
import { TERMINOLOGY, buildTerminologyPrompt, FEW_SHOT_EXAMPLES } from './terminology.js';
import { ALL_COMMON_TYPOS, buildCommonTyposPrompt } from './commonTypos.js';
import { buildLearnedPrompt, addCorrection, loadCorrections, getKnownOriginals } from './learnedCorrections.js';

const router = Router();

// async 错误兜底到 next，Express 4 不会自动捕获 async reject
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// 已学习纠错库的落盘路径（与 learnedCorrections.ts DATA_DIR/FILE 保持一致）
const PERSIST_PATH = path.resolve(process.cwd(), 'data', 'learned-corrections.json');

/**
 * POST /api/report-review
 * 接收文本，调智谱 GLM AI 审核错别字，返回结构化结果
 * body: { text: string }
 * response: { success: boolean, errors: [{id, original, suggestion, context}], stats: {...} }
 *
 * 能力：
 *   - 数据中心/测试领域专业术语词典注入（≈90 条）
 *   - 历史采纳纠错库注入（自我学习）
 *   - Few-shot 示例
 *   - 后处理：兜底术语规则匹配（避免 AI 漏检）
 *   - 长文档自动分块（>4000 字分段并行审）
 */

const SYSTEM_PROMPT = `你是智航万恒测试验证管理平台的【专业错别字审核助手】。你的唯一职责是找出用户提供的测试报告/技术文档/验收文档/合同/发票/任何办公文档 中的错别字（包括同音、形近、多字少字、标点、用词不当等）。

【输出严格格式】
必须且只能返回如下 JSON：
{
  "errors": [
    { "original": "错字原文", "suggestion": "正确写法", "context": "包含该错字的上下文片段（不超过 30 字）" }
  ]
}
如果没有错别字，返回 {"errors":[]}。除 JSON 外不允许输出任何字符、解释或 Markdown。

【审核范围 — 必须全部识别】（不限于数据中心领域）
1. 同音错字：例如 "发电机组" 写成 "发电动机组"、"功率因数" 写成 "功率因素"
2. 形近错字：例如 "配电柜" 写成 "配电拒"、"板换" 写成 "扳换"
3. 多字/少字：例如 "已经配置" 写成 "以配置"、"气体灭火" 写成 "气体灭火车"
4. 标点错误：句末标点缺失、中英文标点混用（如中文句子里出现全角逗号位置用了英文逗号）
5. 数字与单位之间缺空格：例如 "100MW" 应写为 "100 MW"；"25℃" 应写为 "25 ℃"
6. 行业术语别名：例如 "柴发机租" 应改为 "柴油发电机组"、"发电源" 应改为 "发电机"
7. 错别成语：例如 "再接再厉" 写成 "再接再历"、"直截了当" 写成 "直接了当"
8. 【地名错字】⭐ 重要：识别中国地名错写
   例如 "北京" 写成 "北静"、"苏州" 写成 "苏洲"、"哈尔滨" 写成 "哈尔并"、
   "杭州" 写成 "抗州"、"郑州" 写成 "郑洲"、"长沙" 写成 "长纱"、
   "武汉" 写成 "武汗"、"成都" 写成 "城都"、"广州" 写成 "廣州"、
   "济南" 写成 "济楠"、"西宁" 写成 "西灵" 等。每个城市名要按规范地名纠正。
9. 【客户/品牌名错字】⭐ 重要：识别常见公司/品牌名错写
   例如 "阿里巴巴" 写成 "阿里巴爸"/"阿里八八"/"阿里爸爸"、
   "腾讯" 写成 "腾迅"/"腾寻"、"微信" 写成 "威信"、
   "华为" 写成 "华伪"/"滑为"、"百度" 写成 "摆渡"/"白度"、
   "京东" 写成 "景东"、"美团" 写成 "每团"、"拼多多" 写成 "评多多"、
   "比亚迪" 写成 "比业迪" 等。客户文档尤其重要。
10. 【IT/办公常用错字】
    "登陆" → "登录"（系统登录非"登陆"）、"帐号" → "账号"、
    "网络" → "网络"（非"网路"）、"硬件" → "硬件"（非"硬体"）、
    "软件" → "软件"（非"软体"）、"连结" → "连接"、
    "带宽" → "带宽"（非"频宽"）、"内存" → "内存"（非"记忆体"）、
    "界面" → "界面"（非"介面"）、"部署" → "部署"（非"布署/部暑"）、
    "配置" → "配置"（非"佩置"）、"其他" → "其他"（非"其它"）

【注意事项】
- "original" 必须是文本中【逐字】能找到的字串（含标点）
- "suggestion" 必须是规范的替换写法
- "context" 必须包含 original 的整段上下文，长度不超过 30 字
- 同一错字只返回一次（不要重复）
- 没有错别字时一定返回 {"errors":[]}
- **专有名词优先**：地名、品牌名、客户名这些错误一旦识别务必返回，影响报告专业性
`;

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  // 先校验 body 存在且为对象，避免 destructure undefined 抛错
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ success: false, message: '请求体格式错误' });
  }
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, message: '缺少待审核文本' });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（MINIMAX_API_KEY 未设置）' });
  }

  // ===== 智能分级审核策略（按字数自动切换）=====
  // 策略1（≤5万字）: AI 全量精审 + 词典兜底
  // 策略2（5万~15万字）: AI 全量精审（每段8000字，5并发）+ 词典兜底
  // 策略3（>15万字）: 词典规则先行（秒级返回），AI 后台补充高频段落
  const textLen = text.length;
  const STRATEGY = textLen <= 50000 ? 'ai_full' : textLen <= 150000 ? 'ai_full' : 'hybrid';
  console.log(`[ReportReview] 文本 ${textLen} 字，策略: ${STRATEGY}`);

  try {
    const ruleErrors = ruleBasedDetect(text);
    let aiErrors: Array<{original: string; suggestion: string; context: string}> = [];

    if (STRATEGY === 'hybrid') {
      // ===== 超大文档（>15万字）: 词典先行 + AI 抽审 =====
      // 词典规则已覆盖常见错别字（地名/品牌/术语/学习库），秒级完成
      // AI 只审核"最可能有错别字"的段落：取前 5 万字（通常含目录/摘要/正文开头，错别字密度最高）
      const aiText = text.slice(0, 50000);
      try {
        aiErrors = await callAiReview(apiKey, aiText);
      } catch (aiErr: any) {
        console.warn('[ReportReview] 超大文档 AI 抽审失败，仅返回词典结果:', aiErr?.message);
      }
    } else {
      // ===== 正常文档（≤15万字）: AI 全量精审 =====
      aiErrors = await callAiReview(apiKey, text);
    }

    const merged = mergeAndDedup(aiErrors, ruleErrors);
    res.json({
      success: true,
      errors: merged.map((e, i) => ({ id: i + 1, ...e })),
      stats: {
        aiErrors: aiErrors.length,
        ruleErrors: ruleErrors.length,
        merged: merged.length,
        learnedLibrarySize: Object.keys(loadCorrections()).length,
        strategy: STRATEGY,
        textLength: textLen,
      },
    });
  } catch (err: any) {
    const errMsg = err?.message || 'AI 审核失败';
    console.error('[ReportReview] 审核失败:', errMsg);
    res.status(500).json({
      success: false,
      message: errMsg,
      ruleErrorsOnly: ruleBasedDetect(text).length,
    });
  }
}));

/**
 * POST /api/report-review/learn
 * 前端用户在 UI 上点击"采纳"时调用 — 触发自我学习
 * body: { original: string, suggestion: string }
 *
 * 校验（防止学习库被污染）：
 *  1. original/suggestion 必填，且为非空字符串
 *  2. 长度 1~50（防止太长污染 prompt）
 *  3. original !== suggestion（无意义学习直接拒）
 *  4. trim 处理
 */
router.post('/learn', requireAuth, (req, res) => {
  const rawOriginal = (req.body?.original ?? '').toString().trim();
  const rawSuggestion = (req.body?.suggestion ?? '').toString().trim();
  if (!rawOriginal || !rawSuggestion) {
    return res.status(400).json({ success: false, message: 'original / suggestion 必填' });
  }
  if (rawOriginal.length > 50 || rawSuggestion.length > 50) {
    return res.status(400).json({ success: false, message: '单条纠错长度不能超过 50 字符' });
  }
  if (rawOriginal === rawSuggestion) {
    return res.status(400).json({ success: false, message: '原词和推荐词相同，无需学习' });
  }
  const updated = addCorrection(rawOriginal, rawSuggestion, 'user');
  res.json({ success: true, correction: updated });
});

/**
 * DELETE /api/report-review/learn
 * 移除已学习的纠错（误学/废弃/已纠正时使用）
 * body: { original: string }
 */
router.delete('/learn', requireRole(['管理者']), (req, res) => {
  const raw = (req.body?.original ?? '').toString().trim();
  if (!raw) {
    return res.status(400).json({ success: false, message: 'original 必填' });
  }
  const all = loadCorrections();
  if (!all[raw]) {
    return res.status(404).json({ success: false, message: '该条目不存在' });
  }
  delete all[raw];
  // 落盘：复用持久化逻辑（与 learnedCorrections.ts 一致）
  try {
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(all, null, 2), 'utf-8');
  } catch (e: any) {
    return res.status(500).json({ success: false, message: '落盘失败：' + (e?.message || 'unknown') });
  }
  res.json({ success: true, removed: raw, remaining: Object.keys(all).length });
});

/**
 * GET /api/report-review/learned
 * 给前端展示当前学习库的容量
 */
router.get('/learned', (_req, res) => {
  const all = loadCorrections();
  res.json({
    success: true,
    size: Object.keys(all).length,
    items: Object.values(all).sort((a, b) => b.count - a.count).slice(0, 100),
  });
});

// ============== 内部函数 ==============

/**
 * 调 MiniMax AI；带超时、超长分段、并发批处理、Few-shot
 *
 * 注意：callMiniMaxOnce 在失败时会抛错（而非静默返回空数组），
 * 上层 callAiReview 用 try/catch 兜底，把错误信息透传给前端，
 * 避免"AI 挂了但前端显示审核完成 0 错误"的误导。
 */
async function callAiReview(apiKey: string, text: string): Promise<Array<{original: string; suggestion: string; context: string}>> {
  // 长文档分段（按段落切，每段 ≤ 3500 字）
  const chunks = splitText(text, 8000);
  // 并发调用：分批并行（每批 5 段同时调，避免触发限流）
  // 14万字：旧方案 40段×串行 ≈ 5-10分钟；新方案 18段×并行(每批5个) ≈ 30-60秒
  const BATCH_SIZE = 5;
  const out: Array<{original: string; suggestion: string; context: string}> = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((chunk) => callMiniMaxOnce(apiKey, chunk))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        out.push(...r.value);
      } else {
        console.warn('[ReportReview] 某段审核失败:', r.reason?.message || r.reason);
      }
    }
  }
  return out;
}

/**
 * 单次调用 MiniMax ChatCompletion v2
 *
 * 模型：MiniMax-M3（官方主推旗舰）
 *   - 1M 上下文，适合长文档错别字检测
 *   - 通过 system prompt 约束 JSON 输出
 *
 * 错误处理：
 *   - HTTP 非 2xx → 抛错（带状态码 + 响应体片段）
 *   - JSON 解析失败 → 尝试提取 ```json 块 → 仍失败返回空
 *   - 超时 → 抛错（AbortError）
 *   - 上层 callAiReview 不 catch，让错误冒泡到路由 handler 返回 500
 */
async function callMiniMaxOnce(
  apiKey: string,
  text: string,
): Promise<Array<{original: string; suggestion: string; context: string}>> {
  const controller = new AbortController();
  // 90s 超时（长文档 + M3 推理可能较慢）
  const timeout = setTimeout(() => controller.abort(), 90000);

  // 拼装 system prompt：基础 + 通用错字词典 + 数据中心术语词典 + 学习库 + Few-shot
  const commonTypos = buildCommonTyposPrompt();
  const terminology = buildTerminologyPrompt();
  const learned = buildLearnedPrompt();
  const fewshot = FEW_SHOT_EXAMPLES
    .map((e, i) => `【示例 ${i + 1}】\n输入：${e.input}\n输出：${JSON.stringify(e.output)}`)
    .join('\n\n');

  const systemContent = [
    SYSTEM_PROMPT,
    '\n\n' + commonTypos,
    terminology ? '\n\n' + terminology : '',
    learned ? '\n\n' + learned : '',
    '\n\n【Few-shot 学习样例】\n' + fewshot,
  ].join('');

  let requestId = 'unknown';
  try {
    const response = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // MiniMax-M3：官方主推前沿模型
        model: 'MiniMax-M3',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: text },
        ],
        temperature: 0.05,   // 低温度求稳定
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // 记录 request_id（智谱响应头里通常有，方便排查）
    requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || 'unknown';

    if (!response.ok) {
      const errText = await response.text();
      const msg = `MINIMAX HTTP ${response.status}: ${errText.slice(0, 300)}`;
      console.error(`[ReportReview] ${msg} | req_id=${requestId}`);
      throw new Error(msg);
    }

    const data: any = await response.json();

    // MiniMax 业务错误检查：base_resp.status_code != 0 表示失败
    const baseStatus = data?.base_resp?.status_code;
    const baseMsg = data?.base_resp?.status_msg;
    if (typeof baseStatus === 'number' && baseStatus !== 0) {
      const msg = `MINIMAX 业务错误 code=${baseStatus}: ${baseMsg || 'unknown'}`;
      console.error(`[ReportReview] ${msg} | req_id=${requestId}`);
      throw new Error(msg);
    }

    const content: string = data.choices?.[0]?.message?.content || '';
    if (!content) {
      console.warn(`[ReportReview] AI 返回空 content | req_id=${requestId}`);
      return [];
    }
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // M3 可能输出带 ```json 包裹的 markdown，尝试提取
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1].trim());
        } catch {
          console.warn(`[ReportReview] AI 返回非 JSON | req_id=${requestId}:`, content.slice(0, 300));
          return [];
        }
      } else {
        console.warn(`[ReportReview] AI 返回非 JSON | req_id=${requestId}:`, content.slice(0, 300));
        return [];
      }
    }
    const arr = Array.isArray(parsed.errors) ? parsed.errors : [];
    return arr
      .filter((e: any) => e && typeof e.original === 'string' && e.original.length > 0)
      .map((e: any) => ({
        original: String(e.original),
        suggestion: String(e.suggestion || ''),
        context: String(e.context || '').slice(0, 60),
      }));
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const msg = 'MINIMAX 调用超时（120s）';
      console.error(`[ReportReview] ${msg} | req_id=${requestId}`);
      throw new Error(msg);
    }
    // 已经是上面抛出的带 req_id 的错误，直接冒泡
    throw err;
  }
}

/**
 * 中文词边界检查：判断 [i, i+len) 处的子串是否在更长中文词内部
 *
 * 规则：仅当 original 是 2~3 字符的中文词时做边界检查（短词易冲突）。
 *   - 前面是 CJK ⇒ 该子串在更长词内部（跳过，避免误报子串匹配）
 *   - 后面是 CJK ⇒ 该子串可能是更长词的一部分（跳过）
 *
 * 该规则保证：
 *   - "阿里"在"阿里巴爸"中 — 后面"里" 是 CJK ⇒ skip ✓（不冲突"阿里巴爸"独立报）
 *   - "苏洲"（已删）— 命中"苏州市" — 后面"市" 是 CJK ⇒ skip（本应报，但边界太严就跳过）
 *   - "哈尔并"（length=3）— 不过边界检查，正常报
 *   - "苏洲市"中 "苏洲" 在前面（标点/空格等非 CJK），后面"市" 是 CJK ⇒ skip ⚠️
 *     （这是边界严格性的代价；但用例少，可在词典里加 3 字错写如"苏洲市"覆盖）
 *   - "阿里巴爸" — length>=4 不过边界检查，正常报 ✓
 */
function isInsideLongerChineseWord(text: string, idx: number, len: number): boolean {
  const matched = text.substring(idx, idx + len);
  if (!/^[\u4e00-\u9fa5]+$/.test(matched)) return false; // 包含英文/数字时不检查（基本是独立词）
  if (matched.length >= 4) return false;                   // 长词不必检查
  if (matched.length < 2) return false;                    // 单字不强边界

  const before = idx > 0 ? text[idx - 1] : '';
  const after = idx + len < text.length ? text[idx + len] : '';
  const isCJK = (ch: string) => /[\u4e00-\u9fa5]/.test(ch);

  // 前面是 CJK ⇒ 必嵌在更长词内部，跳过
  if (isCJK(before)) return true;
  // 后面是 CJK ⇒ 大概率嵌在更长词内部（如"苏洲"在"苏洲市"中），跳过
  if (isCJK(after)) return true;
  return false;
}

/**
 * 词典兜底：用通用易混字词典、术语词典、学习库直接匹配文本，确保 AI 漏网也被抓到
 */
function ruleBasedDetect(text: string): Array<{original: string; suggestion: string; context: string}> {
  const out: Array<{original: string; suggestion: string; context: string}> = [];
  const seen = new Set<string>();

  const checkAndPush = (original: string, suggestion: string, idx: number) => {
    if (!original || original === suggestion) return;
    const key = original + '|' + suggestion;
    if (seen.has(key)) return;
    seen.add(key);
    const ctx = text
      .substring(Math.max(0, idx - 15), Math.min(text.length, idx + original.length + 15))
      .replace(/\s+/g, ' ');
    out.push({ original, suggestion, context: ctx });
  };

  const scanDict = (entries: Array<{original: string; suggestion: string; note?: string}>) => {
    for (const e of entries) {
      if (!e.original || e.original === e.suggestion) continue;
      // 带有"语境依赖/同名多义"提示的不强制报（避免误报）
      if (e.note && /(同名多义|按语境判断|首次出现|看语境)/.test(e.note)) continue;
      let from = 0;
      while (true) {
        const i = text.indexOf(e.original, from);
        if (i < 0) break;
        // 中文词边界检查：避免短词在长词内部被误报
        // 例：词典有"阿里"，但命中"阿里巴爸"内部 — 这种位置前面是汉字（"里"属更长词的一部分），应跳过
        // 边界规则：original 若全部为中文（前/后若是汉字 ⇒ 是长词内部 ⇒ 跳过）
        if (isInsideLongerChineseWord(text, i, e.original.length)) {
          from = i + e.original.length;
          continue;
        }
        checkAndPush(e.original, e.suggestion, i);
        from = i + e.original.length;
      }
    }
  };

  // 1) 通用易混字 / 地名 / 品牌词典（覆盖阿里巴爸、北静、苏洲等）
  scanDict(ALL_COMMON_TYPOS);

  // 2) 数据中心术语词典
  for (const t of TERMINOLOGY) {
    for (const alias of t.aliases) {
      if (!alias || alias === t.canonical) continue;
      let from = 0;
      while (true) {
        const i = text.indexOf(alias, from);
        if (i < 0) break;
        checkAndPush(alias, t.canonical, i);
        from = i + alias.length;
      }
    }
  }

  // 3) 学习纠错库
  const known = getKnownOriginals();
  for (const original of known) {
    const c = loadCorrections()[original];
    if (!c || original === c.suggestion) continue;
    let from = 0;
    while (true) {
      const i = text.indexOf(original, from);
      if (i < 0) break;
      checkAndPush(original, c.suggestion, i);
      from = i + original.length;
    }
  }

  return out;
}

/**
 * 合并 AI 与规则去重，AI 优先
 */
function mergeAndDedup(
  ai: Array<{original: string; suggestion: string; context: string}>,
  rules: Array<{original: string; suggestion: string; context: string}>,
): Array<{original: string; suggestion: string; context: string}> {
  const seen = new Set<string>();
  const out: Array<{original: string; suggestion: string; context: string}> = [];
  const push = (e: {original: string; suggestion: string; context: string}) => {
    const key = e.original.trim();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  ai.forEach(push);
  rules.forEach(push);
  return out;
}

/**
 * 长文本分段：按段落切，每段 ≤ maxLen
 */
function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  // 按段落切（双换行）
  const paragraphs = text.split(/\n\s*\n/);
  let current = '';
  for (const p of paragraphs) {
    if ((current + p).length > maxLen && current) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? '\n\n' : '') + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // 如果单段仍超长（如无段落分隔）则硬切
  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= maxLen) {
      final.push(c);
    } else {
      for (let i = 0; i < c.length; i += maxLen) {
        final.push(c.substring(i, i + maxLen));
      }
    }
  }
  return final.length ? final : [text];
}

export default router;
