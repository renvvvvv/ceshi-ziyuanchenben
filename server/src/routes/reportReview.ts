import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from './auth.js';
import { TERMINOLOGY, buildTerminologyPrompt, FEW_SHOT_EXAMPLES } from './terminology.js';
import { ALL_COMMON_TYPOS, buildCommonTyposPrompt } from './commonTypos.js';
import { buildLearnedPrompt, addCorrection, loadCorrections, getKnownOriginals, persistCorrections } from './learnedCorrections.js';
import { describeZhipuError, ZHIPU_CHAT_URL } from '../utils/zhipuError.js';

const router = Router();

// async 错误兜底到 next，Express 4 不会自动捕获 async reject
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };


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

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（ZHIPU_API_KEY 未设置）' });
  }

  // ===== 智能分级审核策略（按字数自动切换）=====
  // 策略 ai_full（≤3万字）: AI 全量精审（每段8000字，5并发）+ 词典兜底
  // 策略 hybrid（>3万字）:  词典规则全量秒级扫描 + AI 抽审前 3 万字（目录/摘要/正文开头，错字密度最高）
  //   说明：长文档（如14万字）若全量走 AI，分段过多、单段易触发模型内容安全软拦截
  //   返回空 content，且 19 段串行批处理总耗时超过前端超时。改用 hybrid：词典保证
  //   300+ 类已知错字（地名/品牌/术语/学习库）秒级必抓，AI 补充前 3 万字精审。
  const textLen = text.length;
  const STRATEGY = textLen <= 30000 ? 'ai_full' : 'hybrid';
  // 长文档只让 AI 审前 3 万字（分段过多，既慢又容易被内容安全软拦截），其余靠词典全量扫描
  const AI_TEXT_LIMIT = 30000;
  console.log(`[ReportReview] 文本 ${textLen} 字，策略: ${STRATEGY}`);

  try {
    const correctionsMap = loadCorrections(); // 请求级一次加载（此前每 known original 各读一次盘）
    const ruleErrors = ruleBasedDetect(text, correctionsMap);
    let aiErrors: Array<{original: string; suggestion: string; context: string}> = [];
    let aiFailReason = ''; // AI 一段都没审成的原因：要带给前端明示，否则用户以为 AI 审过
    let aiPartial: { failed: number; total: number; reasons: string[] } | undefined;

    try {
      // 两种策略同一个口径：ai_full 审全文；hybrid 只审前 3 万字，其余靠词典全量扫描
      const aiText = STRATEGY === 'hybrid' ? text.slice(0, AI_TEXT_LIMIT) : text;
      const run = await callAiReview(apiKey, aiText);
      aiErrors = run.items;
      if (run.total > 0 && run.failed === run.total) {
        aiFailReason = (run.reasons[0] || 'AI 服务异常').slice(0, 160);
        console.warn('[ReportReview] AI 全部段失败，仅返回词典结果:', aiFailReason, '| 文档', textLen, '字');
      } else if (run.failed > 0) {
        // 部分段没审成：这些段落可能有错别字没被查出来，必须告诉用户，不能报“审核完成”
        aiPartial = { failed: run.failed, total: run.total, reasons: run.reasons };
        console.warn(`[ReportReview] AI 有 ${run.failed}/${run.total} 段未完成:`, run.reasons.join(' | '));
      }
    } catch (aiErr: any) {
      aiFailReason = String(aiErr?.message || 'AI 服务异常').slice(0, 160);
      console.warn('[ReportReview] AI 审核失败，仅返回词典结果:', aiErr?.message, '| 文档', textLen, '字');
    }

    const merged = mergeAndDedup(aiErrors, ruleErrors);
    res.json({
      success: true,
      errors: merged.map((e, i) => ({ id: i + 1, ...e })),
      stats: {
        aiErrors: aiErrors.length,
        ruleErrors: ruleErrors.length,
        merged: merged.length,
        learnedLibrarySize: Object.keys(correctionsMap).length,
        strategy: STRATEGY,
        textLength: textLen,
        ...(aiFailReason ? { aiFailed: true, aiFailReason } : {}),
        ...(aiPartial ? { aiPartial } : {}),
      },
    });
  } catch (err: any) {
    const errMsg = err?.message || 'AI 审核失败';
    console.error('[ReportReview] 审核失败:', errMsg);
    res.status(500).json({
      success: false,
      message: errMsg,
      // ruleErrors 定义在 try 内，catch 分支不可见：去掉该字段（原实现此处会重跑全文检测）
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
// 学习库会注入所有用户的审核提示词，属于共享数据：只有管理者和编辑者能写（删除仍然只限管理者）
router.post('/learn', requireAuth, requireRole(['管理者', '编辑者']), (req, res) => {
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
  if (!updated) {
    return res.status(400).json({ success: false, message: 'original 不能用作学习条目' });
  }
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
  if (!Object.hasOwn(all, raw)) {
    return res.status(404).json({ success: false, message: '该条目不存在' });
  }
  delete all[raw];
  // 落盘：统一走 learnedCorrections 的原子写（临时文件 + 改名）
  try {
    persistCorrections(all);
  } catch (e: any) {
    return res.status(500).json({ success: false, message: '落盘失败：' + (e?.message || 'unknown') });
  }
  res.json({ success: true, removed: raw, remaining: Object.keys(all).length });
});

/**
 * GET /api/report-review/learned
 * 给前端展示当前学习库的容量
 */
router.get('/learned', requireAuth, (_req, res) => {
  const all = loadCorrections();
  res.json({
    success: true,
    size: Object.keys(all).length,
    items: Object.values(all).sort((a, b) => b.count - a.count).slice(0, 100),
  });
});

// ============== 内部函数 ==============

type TypoItem = { original: string; suggestion: string; context: string };

/** 一次 AI 审核的结果：items 是审成的段里查到的错别字；failed 是没审成的段数（超时/限流/空输出/截断） */
interface AiReviewRun { items: TypoItem[]; total: number; failed: number; reasons: string[] }

/**
 * 调智谱 GLM；带超时、超长分段、并发批处理、Few-shot
 *
 * 按段记录成败：某一段失败不等于“这一段没有错别字”。这里不因为个别段失败而抛错，
 * 而是把失败段数交给路由层如实返回（全部失败 → aiFailed；部分失败 → aiPartial）。
 */
async function callAiReview(apiKey: string, text: string): Promise<AiReviewRun> {
  // 长文档分段（按段落切，每段 ≤ 8000 字）
  const chunks = splitText(text, 8000);
  // 分批并行。每批 3 段：套餐端点并发上限低（实测 6 路即触发 1302 限流），还要给别人同时审核留余量
  const BATCH_SIZE = 3;
  const out: TypoItem[] = [];
  const reasons: string[] = [];
  let failed = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    let results = await Promise.allSettled(
      batch.map((chunk) => callZhipuOnce(apiKey, chunk))
    );
    // 被限流的段等一下重试一次（套餐端点限流是短时的；不重试的话这段的错别字会静默漏掉）
    const limited = results
      .map((r, k) => (r.status === 'rejected' && /限流/.test(String(r.reason?.message || r.reason)) ? k : -1))
      .filter(k => k >= 0);
    if (limited.length) {
      await new Promise(r => setTimeout(r, 4000));
      const again = await Promise.allSettled(limited.map(k => callZhipuOnce(apiKey, batch[k])));
      again.forEach((r, j) => { results[limited[j]] = r; });
    }
    for (const r of results) {
      if (r.status === 'fulfilled') {
        out.push(...r.value);
      } else {
        failed++;
        const why = String(r.reason?.message || r.reason || '未知错误');
        console.warn('[ReportReview] 某段审核失败:', why);
        if (reasons.length < 3) reasons.push(why);
      }
    }
  }
  return { items: out, total: chunks.length, failed, reasons };
}

// 模型与思考强度可用环境变量覆盖（换配置不必重新构建镜像）；默认值见下方选型说明
const REPORT_MODEL = process.env.REPORT_REVIEW_MODEL || 'glm-5.2';
const REPORT_EFFORT = process.env.REPORT_REVIEW_EFFORT || 'low';

/**
 * 单次调用智谱 ChatCompletion（Coding Plan 的 OpenAI 兼容端点，与故障日志解析/图纸复核同一通道）
 *
 * 模型：glm-5.2 思考模式、强度 low。选型为实测结果（两套各含 24 处错别字的样本）：
 *   套餐通道（2026-11-24，经平台串行）：glm-5.2 low 11/11 次 24/24 检出，1100 字 9-15s、
 *     8000 字单段 12-13s、2.9 万字 24-26s；同通道 glm-5.3 high 短样本 82s、2.9 万字 129-179s，
 *     并出现过 90s 超时（同一档位下套餐通道的思考量约为通用端点的 3 倍、出字速度约六成）
 *   通用端点（2026-11-23）：glm-5.3 high 11/11 次正确、4 段并发整批 9s；glm-5.2 low 12/12 次正确；
 *     glm-5.3 low 在 8000 字长段约 2/3 概率漏 1 处；glm-5.3-flash：稳定漏检 1 处
 *   - 通过 system prompt 约束 JSON 输出
 *
 * 错误处理：
 *   - HTTP 非 2xx → 抛错（带状态码 + 响应体片段）；智谱出错时以非 2xx 返回 {error:{code,message}}
 *   - JSON 解析失败 → 尝试提取 ```json 块 → 仍失败返回空
 *   - 超时 → 抛错（AbortError）
 *   - 上层 callAiReview 不 catch，让错误冒泡到路由 handler 返回 500
 */
async function callZhipuOnce(
  apiKey: string,
  text: string,
): Promise<Array<{original: string; suggestion: string; context: string}>> {
  const controller = new AbortController();
  // 90s 超时（长文档 + 思考模式可能较慢）。定时器在 finally 里清：要一直覆盖到响应体读完
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
    const response = await fetch(ZHIPU_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: REPORT_MODEL,
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: text },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: REPORT_EFFORT,  // glm-5.3 不支持 medium；glm-5.3 的 low 在 8000 字长段上会漏检（见上方选型说明）
        max_tokens: 8192,
      }),
      signal: controller.signal,
    });

    // 记录 request_id（智谱响应头里通常有，方便排查）
    requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || 'unknown';

    if (!response.ok) {
      const errText = await response.text();
      const msg = describeZhipuError(response.status, errText);
      console.error(`[ReportReview] ${msg} | req_id=${requestId}`);
      throw new Error(msg);
    }

    const data: any = await response.json();
    // 智谱的业务错误（余额不足 1113 / 限流 429 等）都走非 2xx 状态码，上面的 !response.ok 已覆盖

    const choice = data.choices?.[0];
    const content: string = choice?.message?.content || '';
    // 下面三种都不是“这段没有错别字”，而是“这段没审成”，一律抛错交给上层按失败段计数
    if (choice?.finish_reason === 'length') {
      console.warn(`[ReportReview] AI 输出被截断（finish_reason=length） | req_id=${requestId}`);
      throw new Error('AI 输出因长度上限被截断，该段结果不完整');
    }
    if (!content) {
      console.warn(`[ReportReview] AI 返回空 content | req_id=${requestId}`);
      throw new Error('AI 返回了空内容（可能被内容安全策略拦截）');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      // 模型可能输出带 ```json 包裹的 markdown，或在 JSON 前后带一句说明：取首个 { 到末个 } 再试
      const stripped = content.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
      const a = stripped.indexOf('{'), b = stripped.lastIndexOf('}');
      const candidate = a >= 0 && b > a ? stripped.slice(a, b + 1) : '';
      try {
        parsed = JSON.parse(candidate);
      } catch {
        console.warn(`[ReportReview] AI 返回非 JSON | req_id=${requestId}:`, content.slice(0, 300));
        throw new Error('AI 返回的内容不是规定的 JSON 格式');
      }
    }
    const arr = Array.isArray(parsed.errors) ? parsed.errors : [];
    return arr
      // 原文与建议相同的不算纠错（模型偶尔把正确的词也列一条，如「记入→记入（正确）」）
      .filter((e: any) => e && typeof e.original === 'string' && e.original.length > 0
        && String(e.original).trim() !== String(e.suggestion ?? '').trim())
      .map((e: any) => ({
        original: String(e.original),
        suggestion: String(e.suggestion || ''),
        context: String(e.context || '').slice(0, 60),
      }));
  } catch (err: any) {
    if (err.name === 'AbortError') {
      const msg = '智谱调用超时（90s）';
      console.error(`[ReportReview] ${msg} | req_id=${requestId}`);
      throw new Error(msg);
    }
    // 已经是上面抛出的带 req_id 的错误，直接冒泡
    throw err;
  } finally {
    clearTimeout(timeout);
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
function ruleBasedDetect(text: string, preloaded?: Record<string, {suggestion: string}>): Array<{original: string; suggestion: string; context: string}> {
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
    const c = (preloaded ?? loadCorrections())[original];
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
