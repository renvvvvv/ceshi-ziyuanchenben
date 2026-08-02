/**
 * 知识库 AI 问答路由
 *
 * 基于 datacenter-test-expert skill 的专业知识库（server/knowledge/references/），
 * 做轻量 RAG 检索 + MiniMax-M3 多轮对话。
 *
 * 流程：
 *   1. 启动时加载 references/*.md，按 ## 标题切成知识块，构建关键词索引
 *   2. 用户提问 → 关键词命中数排序 → 取 top-3 知识块作为参考资料
 *   3. System prompt（人设 + 参考资料）+ 多轮对话历史 → 调 MiniMax → 返回
 */
import { Router } from 'express';
import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from './auth.js';

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
// knowledge 目录定位：
//   生产（Docker）：__dirname = /app/dist/src/routes → 上溯到 /app/knowledge
//   开发（tsx）：__dirname = server/src/routes → 上溯到 server/knowledge
// 两种场景都是从 routes 上溯 3 层到项目根，再进 knowledge
const KNOWLEDGE_PATH = join(__dirname, '..', '..', '..', 'knowledge');

// ============== 知识库加载与索引 ==============

interface KnowledgeChunk {
  file: string;        // 来源文件名（如 "on-site-troubleshooting.md"）
  title: string;       // 章节标题（## 那行）
  content: string;     // 章节正文
  keywords: string[];  // 从标题和正文提取的关键词
}

let knowledgeChunks: KnowledgeChunk[] = [];
let personaPrompt: string = '';

/**
 * 加载知识库：读取 SKILL.md（人设）+ references/*.md（按 ## 切块）
 * 在模块首次 import 时执行一次，后续复用内存索引。
 */
function loadKnowledge(): void {
  try {
    // 1. 加载人设 prompt（SKILL.md 去掉 frontmatter）
    const skillPath = join(KNOWLEDGE_PATH, 'SKILL.md');
    const skillRaw = readFileSync(skillPath, 'utf-8');
    personaPrompt = skillRaw.replace(/^---[\s\S]*?---/, '').trim();
    console.log('[KB-QA] 已加载人设 prompt:', personaPrompt.length, '字符');
  } catch (e) {
    console.warn('[KB-QA] 加载 SKILL.md 失败，使用默认人设:', (e as Error).message);
    personaPrompt = '你是一位数据中心测试领域的资深工程师，请用专业、简洁的中文回答问题。';
  }

  try {
    const refsDir = join(KNOWLEDGE_PATH, 'references');
    const files = readdirSync(refsDir).filter(f => f.endsWith('.md') && !f.startsWith('._'));
    const chunks: KnowledgeChunk[] = [];

    for (const file of files) {
      const raw = readFileSync(join(refsDir, file), 'utf-8');
      // 按 ## 切块（保留一级 # 作为文件级标题）
      const sections = raw.split(/^## /m);
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        if (!section) continue;
        // 第一段可能是文件标题（# xxx）或前言，也作为一个 chunk
        const firstLine = section.split('\n')[0].replace(/^#+\s*/, '').trim();
        if (!firstLine) continue;
        chunks.push({
          file: file.replace('.md', ''),
          title: firstLine,
          content: section,
          keywords: extractKeywords(section),
        });
      }
    }
    knowledgeChunks = chunks;
    console.log(`[KB-QA] 已加载知识库：${files.length} 个文件，切分为 ${chunks.length} 个知识块`);
  } catch (e) {
    console.warn('[KB-QA] 加载 references 失败，问答将仅依赖模型自身知识:', (e as Error).message);
    knowledgeChunks = [];
  }
}

/**
 * 从文本提取关键词：中文双字/三字/四字词 + 英文单词
 * 简单分词：按非字母数字汉字字符分割，过滤停用词和过短词
 */
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '及', '等', '为', '对', '由', '从', '到', '向',
  '一个', '可以', '应该', '必须', '建议', '如下', '以下', '上述', '如图', '参见', '参考',
  '使用', '进行', '通过', '根据', '按照', '依据', '关于', '对于', '如果', '因此', '所以',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or',
]);

function extractKeywords(text: string): string[] {
  const keywords = new Set<string>();
  // 英文/数字词（2字符以上）
  const enWords = text.match(/[A-Za-z]{2,}[A-Za-z0-9-]*/g) || [];
  for (const w of enWords) {
    if (!STOP_WORDS.has(w.toLowerCase()) && w.length >= 2) keywords.add(w.toLowerCase());
  }
  // 中文 2-4 字词（简单滑动窗口，取常见术语长度）
  const chinese = text.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of chinese) {
    // 2字词
    for (let i = 0; i + 2 <= seg.length; i++) {
      const w = seg.slice(i, i + 2);
      if (!STOP_WORDS.has(w)) keywords.add(w);
    }
    // 3字词
    for (let i = 0; i + 3 <= seg.length; i++) {
      const w = seg.slice(i, i + 3);
      if (!STOP_WORDS.has(w)) keywords.add(w);
    }
    // 4字词
    for (let i = 0; i + 4 <= seg.length; i++) {
      const w = seg.slice(i, i + 4);
      keywords.add(w);
    }
  }
  return Array.from(keywords);
}

/**
 * RAG 检索：按用户问题与知识块的关键词重合度排序，取 top-N
 */
function retrieveKnowledge(question: string, topN: number = 3): KnowledgeChunk[] {
  if (knowledgeChunks.length === 0) return [];
  const questionKeywords = new Set(extractKeywords(question));
  if (questionKeywords.size === 0) return [];

  const scored = knowledgeChunks.map(chunk => {
    let score = 0;
    for (const kw of chunk.keywords) {
      if (questionKeywords.has(kw)) score += 1;
    }
    return { chunk, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map(s => s.chunk);
}

// ============== GLM-5.2 调用（思考强度高 + 联网搜索）==============

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface GLMResponse {
  content: string;
  reasoning?: string;       // 思考过程
  webSearch?: any[];        // 联网搜索结果
}

/**
 * 调 GLM-5.2 多轮对话
 *   - thinking: enabled（开启思考）
 *   - reasoning_effort: max（思考强度：高）
 *   - tools: web_search（联网搜索，获取最新信息）
 */
async function callGLMChat(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<GLMResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90s 超时（思考+搜索较慢）

  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'glm-5.2',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        thinking: { type: 'enabled' },      // 开启思考模式
        reasoning_effort: 'max',            // 思考强度：高
        tools: [                            // 联网搜索工具
          {
            type: 'web_search',
            web_search: {
              enable: true,
              search_engine: 'search_pro',
              search_result: true,
              count: 5,
            },
          },
        ],
        temperature: 1.0,   // GLM-5.2 思考模式建议 1.0
        max_tokens: 8192,
        stream: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GLM-5.2 HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data: any = await response.json();
    const msg = data.choices?.[0]?.message || {};
    const content: string = msg.content || '';
    const reasoning: string = msg.reasoning_content || '';  // 思考过程
    const webSearch = msg.web_search || data.web_search || null;

    return { content, reasoning, webSearch };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('AI 回答超时（90s，含思考+联网搜索），请稍后重试');
    }
    throw err;
  }
}

// ============== 自学习库（用户纠错入库）==============

interface LearnedEntry {
  question: string;      // 原始问题
  answer: string;        // 补充/纠正后的答案
  source: string;        // 来源（用户名）
  count: number;         // 引用次数
  createdAt: string;
}

const LEARNED_FILE = join(__dirname, '..', '..', '..', 'data', 'learned-kb.json');
let learnedCache: Record<string, LearnedEntry> = {};

function loadLearned(): void {
  try {
    const raw = readFileSync(LEARNED_FILE, 'utf-8');
    learnedCache = JSON.parse(raw);
    console.log(`[KB-QA] 已加载自学习库：${Object.keys(learnedCache).length} 条`);
  } catch {
    learnedCache = {};
    console.log('[KB-QA] 自学习库为空（首次使用）');
  }
}

function saveLearned(): void {
  try {
    const { mkdirSync, writeFileSync: wf, renameSync, existsSync } = require('fs');
    const { dirname } = require('path');
    // 原子写：先写 .tmp 再 rename，避免进程崩溃时写一半损坏 JSON
    const dir = dirname(LEARNED_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = LEARNED_FILE + '.tmp';
    wf(tmp, JSON.stringify(learnedCache, null, 2), 'utf-8');
    renameSync(tmp, LEARNED_FILE);
  } catch (e) {
    console.warn('[KB-QA] 保存自学习库失败:', (e as Error).message);
  }
}

/**
 * 构建自学习库 prompt 注入：把与当前问题最相关的纠错条目注入 system prompt
 */
function buildLearnedPrompt(question: string): string {
  const entries = Object.values(learnedCache);
  if (entries.length === 0) return '';
  const qKws = new Set(extractKeywords(question));
  const relevant = entries
    .map(e => ({ e, score: extractKeywords(e.question + e.answer).filter(k => qKws.has(k)).length }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (relevant.length === 0) return '';
  return '\n\n【历史用户补充知识】\n以下是之前用户对类似问题的补充/纠正，请参考：\n' +
    relevant.map(x => `Q: ${x.e.question}\nA: ${x.e.answer}`).join('\n\n');
}

// ============== 路由 ==============

// 启动时加载知识库 + 自学习库
loadKnowledge();
loadLearned();

/**
 * POST /api/kb/qa
 * 知识库 AI 问答（多轮对话）
 *
 * 请求体: {
 *   messages: [{role:'user'|'assistant', content:'...'}],  // 历史对话（不含当前问题）
 *   question: '当前问题'
 * }
 * 响应: { success:true, answer:'...', sources:[{title, file}] }
 */
router.post('/', requireAuth, async (req, res) => {
  const { messages: history = [], question } = req.body || {};

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ success: false, message: '请输入问题' });
  }

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（ZHIPU_API_KEY 未设置）' });
  }

  try {
    // 1. RAG 检索相关知识
    const relevant = retrieveKnowledge(question, 3);
    const sources = relevant.map(c => ({ title: c.title, file: c.file }));

    // 2. 拼装 system prompt：人设 + 检索到的知识 + 自学习库
    const knowledgeContext = relevant.length > 0
      ? '\n\n【参考资料】\n以下是与用户问题相关的专业知识，请优先依据这些内容回答：\n\n' +
        relevant.map((c, i) => `--- 参考资料 ${i + 1}：${c.title}（来源：${c.file}）---\n${c.content}`).join('\n\n')
      : '';
    const learnedContext = buildLearnedPrompt(question);
    const systemPrompt = personaPrompt +
      '\n\n你是「智航万恒测试验证管理平台」内嵌的知识库问答助手。' +
      '你的知识库内置了三大厂（阿里巴巴/腾讯/字节跳动）的数据中心测试验收标准，以及它们与国标 GB50174-2017、GB50462-2024 的对应关系。\n' +
      '回答要求：\n' +
      '1. 用专业、简洁、落地的中文，像机房现场跟同事说话一样\n' +
      '2. 涉及具体测试指标时，【先给国标基准（标注条款号）】→【再给厂商差异（阿里/腾讯/字节谁更严）】→【标注来源】\n' +
      '3. 如果参考资料中有厂商标准，务必引用具体数值并说明与国标的差异（更严/一致/更宽）\n' +
      '4. 如果参考资料中没有相关内容，你可以联网搜索获取最新信息，或基于你的专业知识回答，但要说明来源\n' +
      '5. 涉及具体数值（温度、阈值、标准）时务必给出具体数字，不要含糊' +
      knowledgeContext + learnedContext;

    // 3. 构建对话消息（限制最近 10 轮防 token 爆炸）
    const recentHistory = (history as ChatMessage[])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20); // 最近 20 条消息（约 10 轮）
    const messages: ChatMessage[] = [...recentHistory, { role: 'user', content: question }];

    // 4. 调 GLM-5.2（思考强度高 + 联网搜索）
    const { content: answer, reasoning, webSearch } = await callGLMChat(apiKey, systemPrompt, messages);

    if (!answer || answer.trim().length === 0) {
      return res.json({
        success: true,
        answer: '抱歉，我暂时无法回答这个问题，请尝试换一种问法。',
        reasoning: '',
        sources,
        webSearch: null,
      });
    }

    // 5. 解析搜索结果摘要（取标题+链接）
    const searchResults = Array.isArray(webSearch)
      ? webSearch.slice(0, 5).map((s: any) => ({ title: s.title || '', link: s.link || s.url || '', media: s.media || '' }))
      : null;

    res.json({
      success: true,
      answer: answer.trim(),
      reasoning: reasoning || '',           // 思考过程
      sources,                              // RAG 知识来源
      webSearch: searchResults,             // 联网搜索来源
    });
  } catch (err: any) {
    const errMsg = err?.message || 'AI 问答失败';
    console.error('[KB-QA] 问答失败:', errMsg);
    res.status(500).json({ success: false, message: errMsg });
  }
});

/**
 * POST /api/kb/qa/learn
 * 用户纠错/补充入库（自学习）
 *
 * 请求体: { question: '原始问题', answer: '补充或纠正后的答案' }
 * 响应: { success:true, learned: { question, answer } }
 */
router.post('/learn', requireAuth, (req, res) => {
  const { question, answer } = req.body || {};
  if (!question || !answer || typeof question !== 'string' || typeof answer !== 'string') {
    return res.status(400).json({ success: false, message: '需要 question 和 answer 字段' });
  }
  if (question.trim().length < 2 || answer.trim().length < 2) {
    return res.status(400).json({ success: false, message: '问题和答案至少 2 个字符' });
  }

  // 以问题为 key 去重，相同问题覆盖更新（count 累加）
  const key = question.trim().slice(0, 200);
  const existing = learnedCache[key];
  learnedCache[key] = {
    question: question.trim(),
    answer: answer.trim(),
    source: (req as any).user?.username || 'unknown',
    count: (existing?.count || 0) + 1,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  saveLearned();
  console.log(`[KB-QA] 用户 ${(req as any).user?.username || '?' } 补充知识：${key.slice(0, 40)}...`);
  res.json({ success: true, learned: { question: key, answer: answer.trim() } });
});

/**
 * GET /api/kb/qa/learned
 * 查看自学习库
 */
router.get('/learned', requireAuth, (_req, res) => {
  const list = Object.values(learnedCache).sort((a, b) => b.count - a.count);
  res.json({ success: true, count: list.length, data: list });
});

export default router;
