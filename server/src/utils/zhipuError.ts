/**
 * 智谱上游出错时给用户看的一句话
 *
 * 背景：智谱 key 是 Coding Plan 套餐，两个通道计费不同：
 *   - 通用端点 /api/paas/v4：只扣账户的按量付费余额，不认套餐（余额为零时一律 HTTP 429 + 错误码 1113）；
 *   - 套餐端点 /api/coding/paas/v4（OpenAI 兼容）与 /api/anthropic（问答在用）：走套餐额度。
 * 2026-11-23 余额被实验耗尽后，报告审核 / 图纸复核 / 故障日志解析全部 1113，遂由通用端点改接套餐端点。
 * 仍只能走通用端点的是 embedding-3（套餐不含，kbQA 已做关键词降级）。
 * 套餐端点有并发上限：2026-11-23 实测 6 路并发流即触发一次 HTTP 429 + 错误码 1302（账户速率限制）。
 */

/** 报告审核 / 图纸复核 / 故障日志解析共用的对话地址（Coding Plan 的 OpenAI 兼容端点） */
export const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/coding/paas/v4/chat/completions';

/** 把智谱的非 2xx 响应翻译成一句话；不认识的错误保留状态码与报文片段，方便排查 */
export function describeZhipuError(status: number, body: string): string {
  let code = '';
  let message = '';
  try {
    const err = JSON.parse(body)?.error;
    code = String(err?.code ?? '');
    message = String(err?.message ?? '');
  } catch { /* 非 JSON 报文 */ }
  if (code === '1113') return '智谱账户余额不足（错误码 1113），请联系管理员充值后重试';
  if (status === 429) return `智谱接口限流（429${code ? `，错误码 ${code}` : ''}），请稍后重试`;
  if (status === 401 || status === 403) return '智谱接口鉴权失败，请联系管理员检查 API Key';
  return `智谱 HTTP ${status}: ${(message || body).slice(0, 200)}`;
}
