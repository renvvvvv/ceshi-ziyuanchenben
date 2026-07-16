import { Router } from 'express';

const router = Router();

/**
 * POST /api/report-review
 * 接收文本，调 MINIMAX AI 审核错别字，返回结构化结果
 * body: { text: string }
 * response: { success: boolean, errors: [{original, suggestion, context}] }
 */
router.post('/', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ success: false, message: '缺少待审核文本' });
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'AI 服务未配置（MINIMAX_API_KEY 未设置）' });
  }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'abab6.5s-chat',
          messages: [
            {
              role: 'system',
              content: '你是专业的中文错别字审核助手。仔细审核用户提供的测试报告文本，找出所有错别字（包括同音错字、形近错字、多字少字、标点错误）。返回严格的JSON格式：{"errors":[{"original":"错误原文","suggestion":"正确写法","context":"包含错误的上下文片段（20字以内）"}]}。如果没有错别字，返回{"errors":[]}。只返回JSON，不要任何其他内容。',
            },
            { role: 'user', content: text },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error('[ReportReview] MINIMAX API error:', response.status, errText);
      return res.status(502).json({ success: false, message: `AI 服务返回错误 ${response.status}` });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"errors":[]}';

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = { errors: [] };
    }

    const errors = Array.isArray(result.errors) ? result.errors : [];
    res.json({
      success: true,
      errors: errors.map((e: { original?: string; suggestion?: string; context?: string }, i: number) => ({
        id: i + 1,
        original: e.original || '',
        suggestion: e.suggestion || '',
        context: e.context || '',
      })),
    });
  } catch (err) {
    console.error('[ReportReview] 审核失败:', err);
    res.status(500).json({ success: false, message: 'AI 审核失败，请检查网络或稍后重试' });
  }
});

export default router;
