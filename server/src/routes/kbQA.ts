/**
 * 知识库 AI 问答路由
 *
 * 基于 datacenter-test-expert skill 的专业知识库（server/knowledge/references/），
 * 做 pgvector 向量检索 + GLM-5.2 多轮对话。
 *
 * 流程：
 *   1. 启动时加载 references/*.md → 智谱 embedding-3 生成向量 → 存入 knowledge_embeddings 表
 *   2. 用户提问 → embedding → pgvector 余弦相似度排序 → 取 top-3
 *   3. System prompt（人设 + 参考资料）+ 多轮对话历史 → 调 GLM-5.2 → 返回
 *   4. embedding 失败时降级到关键词匹配（extractKeywords + indexOf）
 */
import { Router } from 'express';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

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
 * 关键词匹配检索（降级方案）：按用户问题与知识块的关键词重合度排序，取 top-N
 */
function retrieveKeyword(question: string, topN: number = 3): KnowledgeChunk[] {
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

// ============== 向量检索（pgvector + 智谱 embedding-3）==============

/** 向量是否已初始化（DB 里已有知识块向量） */
let vectorReady = false;

/**
 * 调智谱 embedding-3 API 生成文本向量
 */
async function getEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error('ZHIPU_API_KEY 未设置');
  const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'embedding-3', input: text, dimensions: 1024 }),
  });
  if (!resp.ok) throw new Error(`embedding HTTP ${resp.status}`);
  const data: any = await resp.json();
  return data.data?.[0]?.embedding || [];
}

/**
 * 批量生成向量（每次最多 64 条）
 */
async function batchEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  const batchSize = 64;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) throw new Error('ZHIPU_API_KEY 未设置');
    const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'embedding-3', input: batch, dimensions: 1024 }),
    });
    if (!resp.ok) throw new Error(`batch embedding HTTP ${resp.status}`);
    const data: any = await resp.json();
    for (const item of data.data || []) {
      results.push(item.embedding);
    }
  }
  return results;
}

/**
 * 启动时：把知识块向量化存入 knowledge_embeddings 表（仅首次或内容变更时执行）
 */
async function initVectorIndex(): Promise<void> {
  try {
    // 检查 DB 里是否已有向量数据
    const rows = await db.allAsync('SELECT count(*) as cnt FROM knowledge_embeddings') as any[];
    const dbCount = Number(rows[0]?.cnt || 0);

    if (dbCount > 0 && dbCount >= knowledgeChunks.length) {
      // 已有足够数据，跳过（内容变更检测可后续用 hash 实现）
      console.log(`[KB-QA] 向量索引已就绪（${dbCount} 条向量）`);
      vectorReady = true;
      return;
    }

    // 需要生成向量
    console.log(`[KB-QA] 开始向量化 ${knowledgeChunks.length} 个知识块（智谱 embedding-3）...`);

    // 清空旧数据
    await db.runAsync('DELETE FROM knowledge_embeddings');

    // 批量生成 embedding
    const texts = knowledgeChunks.map(c => `${c.title}\n${c.content.slice(0, 1000)}`); // 截断防超 token
    const embeddings = await batchEmbeddings(texts);

    // 存入 DB（pgvector 接收字符串格式的向量 '[0.1,0.2,...]'）
    let inserted = 0;
    for (let i = 0; i < knowledgeChunks.length; i++) {
      const chunk = knowledgeChunks[i];
      const embedding = embeddings[i];
      if (!embedding || embedding.length === 0) continue;
      const id = `${chunk.file}-${i}`;
      const vecStr = `[${embedding.join(',')}]`;
      await db.runAsync(
        `INSERT INTO knowledge_embeddings (id, file, title, content, embedding) VALUES ($1, $2, $3, $4, $5::vector)`,
        id, chunk.file, chunk.title, chunk.content, vecStr,
      );
      inserted++;
    }

    console.log(`[KB-QA] 向量化完成，已存入 ${inserted} 条`);
    vectorReady = true;
  } catch (err: any) {
    console.warn('[KB-QA] 向量索引初始化失败，将降级到关键词检索:', err.message);
    vectorReady = false;
  }
}

/**
 * 向量检索：用 pgvector 余弦相似度找 top-N
 */
async function retrieveVector(question: string, topN: number = 3): Promise<KnowledgeChunk[]> {
  if (!vectorReady) return [];
  try {
    const queryEmbedding = await getEmbedding(question);
    if (queryEmbedding.length === 0) return [];
    const vecStr = `[${queryEmbedding.join(',')}]`;

    // pgvector 余弦距离排序（<=> 是余弦距离，越小越相似）
    const rows = await db.allAsync(
      `SELECT file, title, content, embedding <=> $1::vector AS distance
       FROM knowledge_embeddings
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vecStr, topN,
    ) as any[];

    return rows.map(r => ({
      file: r.file, title: r.title, content: r.content, keywords: [],
    }));
  } catch (err: any) {
    console.warn('[KB-QA] 向量检索失败，降级到关键词:', err.message);
    return [];
  }
}

/**
 * 统一检索入口：向量优先，降级到关键词
 */
async function retrieveKnowledge(question: string, topN: number = 3): Promise<KnowledgeChunk[]> {
  // 优先向量检索
  const vectorResults = await retrieveVector(question, topN);
  if (vectorResults.length > 0) {
    console.log(`[KB-QA] 向量检索命中 ${vectorResults.length} 条`);
    return vectorResults;
  }
  // 降级到关键词
  console.log('[KB-QA] 使用关键词检索（降级）');
  return retrieveKeyword(question, topN);
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
  const timeout = setTimeout(() => controller.abort(), 150000); // 150s 超时（思考max+联网搜索可能需要60-120s）

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
      throw new Error('AI 回答超时（150s，含思考+联网搜索），请稍后重试');
    }
    throw err;
  }
}

/**
 * 流式调用 GLM-5.2（stream=true，逐 chunk 回调）
 * onChunk: 每收到一段内容就回调（实时推送给前端）
 */
/** 问答模式：fast=5.3-Flash 秒级响应（常规查询），deep=GLM-5.2 深度思考（复杂分析） */
type QaMode = 'fast' | 'deep';

async function callGLMChatStream(
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  onChunk: (data: { content?: string; reasoning?: string; done?: boolean }) => void,
  mode: QaMode = 'deep',
): Promise<{ reasoning: string; webSearch: any[] | null; usage: { input: number; output: number } }> {
  const controller = new AbortController();
  // fast 模式通常 10s 内出全量结果，给 60s 余量；deep 含思考+联网搜索最长 150s
  const timeout = setTimeout(() => controller.abort(), mode === 'fast' ? 60000 : 150000);

  try {
    // 2026-08-27 起改走 Anthropic 兼容端点（智谱 Coding Plan 套餐通道）。
    // 标准 /paas/v4 端点下该套餐报 1113 余额不足；Anthropic 端点可用 glm-5.2 / glm-5.3-flash。
    const model = mode === 'fast' ? 'glm-5.3-flash' : 'glm-5.2';
    // fast 档：关闭思考（秒回的关键）+ 搜索限 2 次；deep 档：思考 + 搜索 5 次
    const thinking = mode === 'fast' ? { type: 'disabled' } : { type: 'enabled' };
    const searchUses = mode === 'fast' ? 2 : 5;
    const response = await fetch('https://open.bigmodel.cn/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        thinking,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: searchUses }],
        max_tokens: 8192,
        stream: true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${model} HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    // 逐行读取 SSE 流（Anthropic 事件格式）
    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法读取响应流');
    const decoder = new TextDecoder();
    let buffer = '';
    let fullReasoning = '';
    let webSearch: any[] | null = null;
    // 用量统计：message_start 带输入 token，message_delta 末次带累计输出 token
    let usageIn = 0;
    let usageOut = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行处理 SSE
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一行可能不完整，留到下次

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const evt: any = JSON.parse(jsonStr);

          if (evt.type === 'content_block_delta') {
            const delta = evt.delta || {};
            // 思考过程增量
            if (delta.type === 'thinking_delta' && delta.thinking) {
              fullReasoning += delta.thinking;
              onChunk({ reasoning: delta.thinking });
            }
            // 正文增量
            else if (delta.type === 'text_delta' && delta.text) {
              onChunk({ content: delta.text });
            }
          }
          // 联网搜索：服务端工具调用（web_search_prime / web_search 等）
          else if (evt.type === 'content_block_start' && evt.content_block?.type === 'server_tool_use') {
            const toolName = evt.content_block.name || '';
            if (toolName.includes('web_search')) {
              const q = evt.content_block.input?.search_query || '';
              webSearch = webSearch || [];
              webSearch.push({ title: q || '联网搜索', link: '', media: toolName });
            }
          }
          // 用量统计（Anthropic 事件格式）
          // 智谱端点：message_start 的 usage 恒为 0，真实的 input/output tokens
          // 都在末尾的 message_delta 里（output_tokens 为累计值，取最后一次即可）
          else if (evt.type === 'message_start' && evt.message?.usage?.input_tokens) {
            usageIn = evt.message.usage.input_tokens;
          } else if (evt.type === 'message_delta' && evt.usage) {
            if (evt.usage.output_tokens) usageOut = evt.usage.output_tokens;
            if (evt.usage.input_tokens) usageIn = evt.usage.input_tokens;
          }
          // 搜索结果块：尽力提取来源标题/链接
          else if (evt.type === 'content_block_start' && evt.content_block?.type === 'web_search_tool_result') {
            try {
              const raw = evt.content_block.content;
              const items = typeof raw === 'string' ? JSON.parse(raw) : raw;
              if (Array.isArray(items)) {
                webSearch = webSearch || [];
                for (const it of items.slice(0, 5)) {
                  const t = it?.title || it?.url || it?.link || '';
                  const l = it?.url || it?.link || '';
                  if (t || l) webSearch.push({ title: String(t), link: String(l), media: 'web' });
                }
              }
            } catch { /* 搜索结果格式异常时忽略，不影响正文 */ }
          }
        } catch {
          // JSON 解析失败（不完整的 chunk），跳过
        }
      }
    }

    onChunk({ done: true });
    return { reasoning: fullReasoning, webSearch, usage: { input: usageIn, output: usageOut } };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error('AI 回答超时（150s，含思考+联网搜索），请稍后重试');
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
    // 原子写：先写 .tmp 再 rename，避免进程崩溃时写一半损坏 JSON
    const dir = dirname(LEARNED_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = LEARNED_FILE + '.tmp';
    writeFileSync(tmp, JSON.stringify(learnedCache, null, 2), 'utf-8');
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

// ============== AI 用量配额（防过度消耗） ==============
// 口径（2026-08-31 与负责人确认）：每日 1.1 亿 token（≈1.2 万积分）为日额度，
// 每周 6 万积分为周硬限额；换算 1 积分 = 1.1亿 / 1.2万 ≈ 9166.67 token。
// 周期：日为自然日（0 点重置），周为自然周（周一 0 点重置，PG date_trunc('week')）。
const DAILY_TOKEN_LIMIT = Number(process.env.AI_DAILY_TOKEN_LIMIT || 110_000_000);
const WEEKLY_POINT_LIMIT = Number(process.env.AI_WEEKLY_POINT_LIMIT || 60_000);
const POINT_TOKENS = Number(process.env.AI_POINT_TOKENS || 9166.67);

function fmtTokens(n: number): string {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(Math.round(n));
}

async function ensureAiUsageTable(): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        id          SERIAL PRIMARY KEY,
        user_id     TEXT NOT NULL,
        username    TEXT NOT NULL,
        mode        TEXT NOT NULL DEFAULT 'deep',
        tokens_in   INTEGER NOT NULL DEFAULT 0,
        tokens_out  INTEGER NOT NULL DEFAULT 0,
        question    TEXT,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON ai_usage(user_id, created_at);
    `);
  } catch (e) {
    console.warn('[KB-QA] ai_usage 表初始化失败，用量统计/限额将不可用:', (e as Error).message);
  }
}

/** 汇总某账号用量：今日 token、本周 token（自然周周一起算）、今日提问次数 */
async function getUsageSummary(userId: string): Promise<{ todayTokens: number; weekTokens: number; todayCount: number }> {
  try {
    const row0 = await db.getAsync(
      `SELECT
         COALESCE(SUM(tokens_in + tokens_out) FILTER (WHERE created_at >= date_trunc('day', now())), 0)  AS today_tokens,
         COALESCE(SUM(tokens_in + tokens_out) FILTER (WHERE created_at >= date_trunc('week', now())), 0) AS week_tokens,
         COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today_count
       FROM ai_usage WHERE user_id = $1`, userId);
    const row: any = row0 || {};
    return {
      todayTokens: Number(row.today_tokens) || 0,
      weekTokens: Number(row.week_tokens) || 0,
      todayCount: Number(row.today_count) || 0,
    };
  } catch {
    // 表不存在等异常时放行（返回 0），不让统计故障阻断问答
    return { todayTokens: 0, weekTokens: 0, todayCount: 0 };
  }
}

function quotaPayload(s: { todayTokens: number; weekTokens: number; todayCount: number }) {
  return {
    todayTokens: s.todayTokens,
    todayLimitTokens: DAILY_TOKEN_LIMIT,
    todayCount: s.todayCount,
    weekTokens: s.weekTokens,
    weekPoints: Math.round((s.weekTokens / POINT_TOKENS) * 10) / 10,
    weekLimitPoints: WEEKLY_POINT_LIMIT,
    pointTokens: POINT_TOKENS,
  };
}

async function recordUsage(
  userId: string, username: string, mode: QaMode,
  usage: { input: number; output: number }, question: string,
): Promise<void> {
  try {
    await db.runAsync(
      `INSERT INTO ai_usage (user_id, username, mode, tokens_in, tokens_out, question)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      userId, username, mode, Math.round(usage.input), Math.round(usage.output), question.slice(0, 50),
    );
  } catch (e) {
    console.warn('[KB-QA] 用量记账失败（不影响回答）:', (e as Error).message);
  }
}

// ============== 路由 ==============

// 启动时加载知识库 + 向量索引 + 自学习库
loadKnowledge();
// 异步初始化向量索引（不阻塞启动，完成后 vectorReady=true）
initVectorIndex().catch(err => console.warn('[KB-QA] 向量索引初始化异常:', err.message));
// 用量表自检（幂等，老库无该表时自动建）
ensureAiUsageTable();
loadLearned();

/**
 * POST /api/kb/qa
 * 知识库 AI 问答（多轮对话）
 *
 * 请求体: {
 *   messages: [{role:'user'|'assistant', content:'...'}],  // 历史对话（不含当前问题）
 *   question: '当前问题',
 *   mode: 'fast' | 'deep'   // fast=GLM-5.3-Flash 秒级；deep=GLM-5.2 深度思考（默认）
 * }
 * 响应: SSE 流（sources → reasoning → content → done）
 */
router.post('/', requireAuth, async (req, res) => {
  const { messages: history = [], question, mode } = req.body || {};
  const qaMode: QaMode = mode === 'fast' ? 'fast' : 'deep';

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ success: false, message: '请输入问题' });
  }

  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（ZHIPU_API_KEY 未设置）' });
  }

  try {
    // 0. 用量限额检查：超限不发起 AI 调用（不产生消耗），直接以 SSE 返回提示
    const { userId, username } = (req as any).user || {};
    const usageBefore = await getUsageSummary(userId);
    const weekPointsBefore = usageBefore.weekTokens / POINT_TOKENS;
    if (usageBefore.todayTokens >= DAILY_TOKEN_LIMIT || weekPointsBefore >= WEEKLY_POINT_LIMIT) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      const which = usageBefore.todayTokens >= DAILY_TOKEN_LIMIT
        ? `今日 token 额度已用完（已用 ${fmtTokens(usageBefore.todayTokens)} / ${fmtTokens(DAILY_TOKEN_LIMIT)}），每日 0 点恢复`
        : `本周积分额度已用完（已用 ${Math.round(weekPointsBefore)} / ${WEEKLY_POINT_LIMIT} 积分），下周一 0 点恢复`;
      res.write(`data: ${JSON.stringify({
        type: 'content',
        text: `⏳ ${which}。为避免套餐额度过度消耗，本次 AI 调用未发起。如确有紧急需要，请联系管理员调整限额。`,
      })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', reasoning: null, webSearch: null })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'quota', quota: quotaPayload(usageBefore) })}\n\n`);
      res.end();
      return;
    }

    // 1. RAG 检索相关知识（向量优先，降级关键词）
    const relevant = await retrieveKnowledge(question, 3);
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
      '5. 涉及具体数值（温度、阈值、标准）时务必给出具体数字，不要含糊\n' +
      '6. 【故障分析模式】当用户描述故障现象（告警、跳闸、停机、宕机、超温、误报、烧毁、鼓包、分流不均、设备异常等）或要求排查/定位/根因分析时，切换为故障分析专家，严格按五步框架输出：①故障定性（专业/系统/等级）→②可能原因（按概率排序，每条给判断依据）→③排查步骤（先安全隔离，先易后难、先下后上，写明工具、测量位置、判断数值）→④处理方案（临时措施与根治措施分开）→⑤预防措施与测试验证建议。优先匹配参考资料中的故障案例库（fault-cases）同类案例，并用联网搜索补充最新同类案例交叉验证；不确定的环节明确说明需要什么数据进一步确认，严禁跳过排查直接下结论' +
      knowledgeContext + learnedContext;

    // 3. 构建对话消息（限制最近 10 轮防 token 爆炸）
    const recentHistory = (history as ChatMessage[])
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20); // 最近 20 条消息（约 10 轮）
    const messages: ChatMessage[] = [...recentHistory, { role: 'user', content: question }];

    // 4. 设置 SSE 响应头（流式输出）
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁止 nginx 缓冲（关键）
    res.flushHeaders?.();

    let streamEnded = false;
    const safeWrite = (payload: string): boolean => {
      if (streamEnded) return false;
      try {
        if (!res.writableEnded) {
          res.write(payload);
          return true;
        }
      } catch (e) {
        console.warn('[KB-QA] res.write 失败:', (e as Error).message);
      }
      return false;
    };
    const safeEnd = () => {
      if (streamEnded) return;
      streamEnded = true;
      try { if (!res.writableEnded) res.end(); } catch {}
    };

    // 先发送来源信息（前端立即展示知识来源）
    safeWrite(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);

    // 5. 流式调 GLM-5.2，逐 chunk 转发给前端
    let fullAnswer = '';
    try {
      // 注意：done 事件必须在 await 返回后再发，
      // 因为 reasoning/webSearch 来自返回值（回调中访问会触发 TDZ 错误）
      const { reasoning, webSearch, usage } = await callGLMChatStream(
        apiKey,
        systemPrompt,
        messages,
        (chunk) => {
          if (chunk.content) {
            fullAnswer += chunk.content;
            safeWrite(`data: ${JSON.stringify({ type: 'content', text: chunk.content })}\n\n`);
          } else if (chunk.reasoning) {
            safeWrite(`data: ${JSON.stringify({ type: 'reasoning', text: chunk.reasoning })}\n\n`);
          }
          // 注意：这里不再处理 chunk.done —— 改为 await 返回后统一处理
        },
        qaMode,
      );

      // 兜底：若 GLM 没产出 content（例如被内容安全拦截），给前端一个可见提示
      if (!fullAnswer.trim()) {
        safeWrite(`data: ${JSON.stringify({
          type: 'content',
          text: '抱歉，本次回答未能生成内容（模型未返回有效内容，可能被内容安全策略拦截），请稍后重试或换一种问法。',
        })}\n\n`);
      }

      // 解析联网搜索结果
      const searchResults = Array.isArray(webSearch)
        ? webSearch.slice(0, 5).map((s: any) => ({ title: s.title || '', link: s.link || s.url || '', media: s.media || '' }))
        : null;

      // 发送 done 事件（此时 reasoning/webSearch 已可用）
      safeWrite(`data: ${JSON.stringify({ type: 'done', reasoning, webSearch: searchResults })}\n\n`);

      // 用量记账 + 推送最新配额（前端刷新进度条）
      let usageFinal = usage;
      if (usageFinal.input + usageFinal.output === 0) {
        // API 未返回 usage 时按字符量估算（中文约 1.6 token/字）
        const inChars = systemPrompt.length + messages.reduce((a, m) => a + m.content.length, 0);
        usageFinal = { input: Math.ceil(inChars * 1.6), output: Math.ceil(fullAnswer.length * 1.6) };
      }
      await recordUsage(userId, username, qaMode, usageFinal, question);
      const usageAfter = await getUsageSummary(userId);
      safeWrite(`data: ${JSON.stringify({ type: 'quota', quota: quotaPayload(usageAfter) })}\n\n`);
      safeEnd();
    } catch (streamErr: any) {
      const errMsg = streamErr?.message || 'AI 流式回答失败';
      console.error('[KB-QA] 流式回答失败:', errMsg);
      // 头部已发送，只能通过 SSE error 事件通知前端，绝不能 res.json（会抛 ERR_HTTP_HEADERS_SENT）
      safeWrite(`data: ${JSON.stringify({
        type: 'error',
        message: errMsg,
        partial: fullAnswer, // 已收到的部分内容（可能为空）
      })}\n\n`);
      safeEnd();
    }
  } catch (err: any) {
    const errMsg = err?.message || 'AI 问答失败';
    console.error('[KB-QA] 问答失败（头部未发送）:', errMsg);
    // 只有在 SSE 头部尚未发送时才能走 JSON 错误响应
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: errMsg });
    } else {
      // 头部已发送，尝试通过 SSE 通知
      try {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
          res.end();
        }
      } catch {}
    }
  }
});

/**
 * GET /api/kb/qa/quota
 * 当前账号的 AI 用量与配额（前端进度条展示）
 */
router.get('/quota', requireAuth, async (req, res) => {
  try {
    const { userId } = (req as any).user || {};
    const s = await getUsageSummary(userId);
    res.json({ success: true, quota: quotaPayload(s) });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || '查询用量失败' });
  }
});

/**
 * GET /api/kb/qa/usage?days=30
 * 各账号 AI 用量汇总（仅管理者）
 */
router.get('/usage', requireAuth, requireRole(['管理者']), async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  try {
    const rows = await db.allAsync(
      `SELECT username,
              COUNT(*)                       AS total_count,
              COALESCE(SUM(tokens_in + tokens_out), 0) AS total_tokens,
              COALESCE(SUM(tokens_in + tokens_out) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today_tokens,
              COALESCE(SUM(tokens_in + tokens_out) FILTER (WHERE created_at >= date_trunc('week', now())), 0) AS week_tokens,
              COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today_count,
              MAX(created_at)                AS last_used_at
       FROM ai_usage
       WHERE created_at >= now() - ($1 || ' days')::interval
       GROUP BY username
       ORDER BY week_tokens DESC, total_tokens DESC`, String(days));
    const list = (rows as any[]).map((row: any) => ({
      username: row.username,
      todayTokens: Number(row.today_tokens) || 0,
      todayCount: Number(row.today_count) || 0,
      weekTokens: Number(row.week_tokens) || 0,
      weekPoints: Math.round(((Number(row.week_tokens) || 0) / POINT_TOKENS) * 10) / 10,
      totalTokens: Number(row.total_tokens) || 0,
      totalCount: Number(row.total_count) || 0,
      lastUsedAt: row.last_used_at,
    }));
    res.json({
      success: true,
      days,
      limits: { dailyTokenLimit: DAILY_TOKEN_LIMIT, weeklyPointLimit: WEEKLY_POINT_LIMIT, pointTokens: POINT_TOKENS },
      list,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || '查询用量统计失败' });
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
