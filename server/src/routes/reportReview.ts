import { Router } from 'express';
import { TERMINOLOGY, buildTerminologyPrompt, FEW_SHOT_EXAMPLES } from './terminology.js';
import { buildLearnedPrompt, addCorrection, loadCorrections, getKnownOriginals } from './learnedCorrections.js';

const router = Router();

/**
 * POST /api/report-review
 * 接收文本，调 MINIMAX AI 审核错别字，返回结构化结果
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

const SYSTEM_PROMPT = `你是智航万恒测试验证管理平台的【专业错别字审核助手】。你的唯一职责是找出用户提供的测试报告/技术文档/验收文档中的错别字。

【输出严格格式】
必须且只能返回如下 JSON：
{
  "errors": [
    { "original": "错字原文", "suggestion": "正确写法", "context": "包含该错字的上下文片段（不超过 30 字）" }
  ]
}
如果没有错别字，返回 {"errors":[]}。除 JSON 外不允许输出任何字符、解释或 Markdown。

【审核范围 — 必须全部识别】
1. 同音错字：例如 "发电机组" 写成 "发电动机组"、"功率因数" 写成 "功率因素"
2. 形近错字：例如 "配电柜" 写成 "配电拒"、"板换" 写成 "扳换"
3. 多字/少字：例如 "已经配置" 写成 "以配置"、"气体灭火" 写成 "气体灭火车"
4. 标点错误：句末标点缺失、中英文标点混用（如中文句子里出现全角逗号位置用了英文逗号）
5. 数字与单位之间缺空格：例如 "100MW" 应写为 "100 MW"；"25℃" 应写为 "25 ℃"
6. 行业术语别名：例如 "柴发机租" 应改为 "柴油发电机组"、"发电源" 应改为 "发电机"
7. 错别成语：例如 "再接再厉" 写成 "再接再历"

【注意事项】
- "original" 必须是文本中【逐字】能找到的字串（含标点）
- "suggestion" 必须是规范的替换写法
- "context" 必须包含 original 的整段上下文，长度不超过 30 字
- 同一错字只返回一次
- 没有错别字时一定返回 {"errors":[]}
`;

router.post('/', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, message: '缺少待审核文本' });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（MINIMAX_API_KEY 未设置）' });
  }

  try {
    const aiErrors = await callAiReview(apiKey, text);
    // 与词典/学习库做兜底匹配，避免 AI 漏检
    const ruleErrors = ruleBasedDetect(text);
    // 合并去重（同 original 时保留 AI 优先级更高的 suggestion）
    const merged = mergeAndDedup(aiErrors, ruleErrors);
    res.json({
      success: true,
      errors: merged.map((e, i) => ({ id: i + 1, ...e })),
      stats: {
        aiErrors: aiErrors.length,
        ruleErrors: ruleErrors.length,
        merged: merged.length,
        learnedLibrarySize: Object.keys(loadCorrections()).length,
      },
    });
  } catch (err: any) {
    console.error('[ReportReview] 审核失败:', err.message || err);
    res.status(500).json({ success: false, message: 'AI 审核失败，请稍后重试' });
  }
});

/**
 * POST /api/report-review/learn
 * 前端用户在 UI 上点击"采纳"时调用 — 触发自我学习
 * body: { original: string, suggestion: string }
 */
router.post('/learn', (req, res) => {
  const { original, suggestion } = req.body || {};
  if (!original || !suggestion) {
    return res.status(400).json({ success: false, message: 'original / suggestion 必填' });
  }
  const updated = addCorrection(original, suggestion, 'user');
  res.json({ success: true, correction: updated });
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
 * 调 MINIMAX AI；带超时、超长分段、Few-shot
 */
async function callAiReview(apiKey: string, text: string): Promise<Array<{original: string; suggestion: string; context: string}>> {
  // 长文档分段（按段落切，每段 ≤ 3500 字）
  const chunks = splitText(text, 3500);
  const tasks = chunks.map((chunk) => callMiniMaxOnce(apiKey, chunk));
  const results = await Promise.all(tasks);
  // 合并所有段结果
  return results.flat();
}

async function callMiniMaxOnce(
  apiKey: string,
  text: string,
): Promise<Array<{original: string; suggestion: string; context: string}>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  // 拼装 system prompt：基础 + 术语词典 + 学习库 + Few-shot
  const terminology = buildTerminologyPrompt();
  const learned = buildLearnedPrompt();
  const fewshot = FEW_SHOT_EXAMPLES
    .map((e, i) => `【示例 ${i + 1}】\n输入：${e.input}\n输出：${JSON.stringify(e.output)}`)
    .join('\n\n');

  const systemContent = [
    SYSTEM_PROMPT,
    terminology ? '\n\n' + terminology : '',
    learned ? '\n\n' + learned : '',
    '\n\n【Few-shot 学习样例】\n' + fewshot,
  ].join('');

  try {
    const response = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // abab6.5g 比 abab6.5s-chat 能力强很多
        model: 'abab6.5g-chat',
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.05,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ReportReview] MINIMAX API error:', response.status, errText.slice(0, 500));
      return [];
    }

    const data: any = await response.json();
    const content: string = data.choices?.[0]?.message?.content || '{"errors":[]}';
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.warn('[ReportReview] AI 返回非 JSON:', content.slice(0, 300));
      return [];
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
      console.warn('[ReportReview] AI 超时');
    } else {
      console.error('[ReportReview] AI 调用异常:', err.message);
    }
    return [];
  }
}

/**
 * 词典兜底：用术语词典和学习库直接匹配文本，确保 AI 漏网也被抓到
 */
function ruleBasedDetect(text: string): Array<{original: string; suggestion: string; context: string}> {
  const out: Array<{original: string; suggestion: string; context: string}> = [];
  const seen = new Set<string>();

  const checkAndPush = (original: string, suggestion: string, idx: number) => {
    const key = original + '|' + suggestion;
    if (seen.has(key)) return;
    seen.add(key);
    const ctx = text.substring(Math.max(0, idx - 15), Math.min(text.length, idx + original.length + 15)).replace(/\s+/g, ' ');
    out.push({ original, suggestion, context: ctx });
  };

  // 1) 术语词典
  for (const t of TERMINOLOGY) {
    for (const alias of t.aliases) {
      if (alias === t.canonical || !alias) continue;
      let from = 0;
      while (true) {
        const i = text.indexOf(alias, from);
        if (i < 0) break;
        checkAndPush(alias, t.canonical, i);
        from = i + alias.length;
      }
    }
  }

  // 2) 学习纠错库
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
