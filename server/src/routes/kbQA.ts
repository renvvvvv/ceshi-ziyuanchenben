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
import { readFileSync, readdirSync } from 'fs';
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

// ============== MiniMax 调用 ==============

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 调 MiniMax-M3 多轮对话
 * 复用 reportReview 的调用模式，独立实现避免耦合
 */
async function callMiniMaxChat(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s 超时

  try {
    const response = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.map(m => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.3,   // 对话场景稍高，给一点发散
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`MiniMax HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await response.json();
    const baseStatus = data?.base_resp?.status_code;
    if (typeof baseStatus === 'number' && baseStatus !== 0) {
      throw new Error(`MiniMax 业务错误 code=${baseStatus}: ${data.base_resp?.status_msg || 'unknown'}`);
    }

    const content: string = data.choices?.[0]?.message?.content || '';
    return content;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('AI 回答超时（60s），请稍后重试');
    }
    throw err;
  }
}

// ============== 路由 ==============

// 启动时加载知识库
loadKnowledge();

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

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（MINIMAX_API_KEY 未设置）' });
  }

  try {
    // 1. RAG 检索相关知识
    const relevant = retrieveKnowledge(question, 3);
    const sources = relevant.map(c => ({ title: c.title, file: c.file }));

    // 2. 拼装 system prompt：人设 + 检索到的知识
    const knowledgeContext = relevant.length > 0
      ? '\n\n【参考资料】\n以下是与用户问题相关的专业知识，请优先依据这些内容回答：\n\n' +
        relevant.map((c, i) => `--- 参考资料 ${i + 1}：${c.title}（来源：${c.file}）---\n${c.content}`).join('\n\n')
      : '';
    const systemPrompt = personaPrompt +
      '\n\n你是「智航万恒测试验证管理平台」内嵌的知识库问答助手。' +
      '回答要求：用专业、简洁、落地的中文，像机房现场跟同事说话一样。' +
      '如果参考资料中没有相关内容，基于你的专业知识回答，但要说明"这部分不在内置知识库中"。' +
      '涉及具体数值（温度、阈值、标准）时务必给出具体数字。' +
      knowledgeContext;

    // 3. 构建对话消息（限制最近 10 轮防 token 爆炸）
    const recentHistory = (history as ChatMessage[])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20); // 最近 20 条消息（约 10 轮）
    const messages: ChatMessage[] = [...recentHistory, { role: 'user', content: question }];

    // 4. 调 MiniMax
    const answer = await callMiniMaxChat(apiKey, systemPrompt, messages);

    if (!answer || answer.trim().length === 0) {
      return res.json({
        success: true,
        answer: '抱歉，我暂时无法回答这个问题，请尝试换一种问法。',
        sources,
      });
    }

    res.json({ success: true, answer: answer.trim(), sources });
  } catch (err: any) {
    const errMsg = err?.message || 'AI 问答失败';
    console.error('[KB-QA] 问答失败:', errMsg);
    res.status(500).json({ success: false, message: errMsg });
  }
});

export default router;
