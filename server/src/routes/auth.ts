import { Router } from 'express';

const router = Router();

// 飞书应用配置
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_aac2dd6c68385cca';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'ydpeT1McFwNhjlI3nfX8TWSChvOg81bC';
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

// 角色映射表（飞书 union_id → 平台角色）
// 默认新用户为「阅读者」，可在此表或数据库中配置
const FEISHU_ROLE_MAP: Record<string, '管理者' | '编辑者' | '阅读者'> = {
  // 可按需添加飞书用户的 union_id 或 user_id 映射
};

/**
 * 获取 app_access_token
 */
async function getAppAccessToken(): Promise<string> {
  const res = await fetch(`${FEISHU_BASE}/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });
  const data = await res.json() as any;
  if (data.code !== 0) {
    throw new Error(`获取 app_access_token 失败: ${data.msg}`);
  }
  return data.app_access_token;
}

/**
 * 用 code 换取 user_access_token
 */
async function getUserAccessToken(code: string): Promise<any> {
  const appAccessToken = await getAppAccessToken();
  const res = await fetch(`${FEISHU_BASE}/authen/v1/oidc/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });
  const data = await res.json() as any;
  if (data.code !== 0) {
    throw new Error(`获取 user_access_token 失败: ${data.msg}`);
  }
  return data.data;
}

/**
 * 获取用户信息
 */
async function getUserInfo(userAccessToken: string): Promise<any> {
  const res = await fetch(`${FEISHU_BASE}/authen/v1/user_info`, {
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
    },
  });
  const data = await res.json() as any;
  if (data.code !== 0) {
    throw new Error(`获取用户信息失败: ${data.msg}`);
  }
  return data.data;
}

/**
 * GET /api/auth/feishu/login
 * 返回飞书 OAuth 授权 URL
 */
router.get('/feishu/login', (req, res) => {
  const redirectUri = req.query.redirect_uri as string || `${req.headers.origin || ''}/login`;
  const state = Math.random().toString(36).slice(2);
  const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${FEISHU_APP_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.json({ authUrl, state });
});

/**
 * POST /api/auth/feishu/callback
 * 用 code 换取用户信息
 */
router.post('/feishu/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, message: '缺少 code 参数' });
    }

    const tokenData = await getUserAccessToken(code);
    const userInfo = await getUserInfo(tokenData.access_token);

    const unionId = userInfo.union_id;
    const name = userInfo.name || userInfo.en_name || '飞书用户';
    const role = FEISHU_ROLE_MAP[unionId] || '阅读者';

    return res.json({
      success: true,
      user: {
        id: `feishu_${unionId}`,
        username: unionId,
        name,
        role,
        avatar: userInfo.avatar_url,
      },
    });
  } catch (err: any) {
    console.error('[Feishu Auth]', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
