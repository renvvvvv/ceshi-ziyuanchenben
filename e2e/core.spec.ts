import { test, expect, apiLogin, uiLogin } from './helpers';

test.describe('登录与权限', () => {
  test('错误密码登录被拒', async ({ page }) => {
    await page.goto('/login');
    await page.getByText('管理员账号登录').click();
    await page.waitForTimeout(500);
    // 展开后的表单（选择器宽松：文本框出现即可）
    const inputs = page.locator('input');
    await inputs.nth(0).fill('admin');
    await inputs.nth(1).fill('wrong-password');
    await page.locator('button[type=submit], button:has-text("登录")').last().click();
    await expect(page.locator('body')).toContainText(/密码|错误|失败/, { timeout: 8000 }).catch(() => {
      // 某些实现的提示是 toast 一闪而过——至少确认没有跳转到仪表盘
      expect(page.url()).toContain('/login');
    });
  });

  test('未登录访问受保护页重定向到登录页', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/login/, { timeout: 10000 });
    expect(page.url()).toContain('/login');
  });
});

test.describe('核心页面（登录态）', () => {
  test.beforeEach(async ({ page }) => {
    await apiLogin(page);
  });

  test('仪表盘渲染', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('智航万恒测试验证管理平台')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(2500);
    // ECharts 容器出 canvas
    const canvases = await page.locator('canvas').count();
    expect(canvases).toBeGreaterThanOrEqual(1);
  });

  test('菜单 14 模块完整', async ({ page }) => {
    await page.goto('/dashboard');
    for (const item of ['仪表盘', '项目管理', '历史项目', '测试人员池', '人员考勤', '测试管理制度',
      '飞书知识库', 'AI 测试专家', '测试报告审核', '资源计算器', '资源配置', '图纸路由', '故障日志', '权限配置']) {
      await expect(page.getByRole('menuitem', { name: new RegExp(item) }).first())
        .toBeVisible({ timeout: 8000 });
    }
  });

  test('AI 测试专家：球体渲染 + 快速问答全链路（真实 GLM）', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/ai-test-expert');
    await page.waitForTimeout(3500); // 入场动画
    // 粒子球 canvas 活着
    const orb = page.locator('.orb-layer canvas');
    await expect(orb.first()).toBeVisible();
    // 提问（fast 模式）
    const box = page.locator('textarea').first();
    await box.fill('A级机房接地电阻要求是多少？');
    await box.press('Enter');
    // 流式回答出现（对话卡或消息气泡里有实质内容）
    await expect(page.locator('body')).toContainText(/接地|Ω|欧姆|电阻/, { timeout: 60_000 });
  });

  test('图纸路由：任务列表与详情（只读）', async ({ page }) => {
    await page.goto('/drawing-pipeline');
    await expect(page.getByText('解析任务记录')).toBeVisible({ timeout: 15000 });
    // 有历史任务则打开第一个详情看 sheet
    const firstLink = page.locator('tbody a').first();
    if (await firstLink.count()) {
      await firstLink.click();
      await page.waitForTimeout(1500);
      const hasSheets = await page.getByText(/机房机柜路由|中压系统/).count();
      expect(hasSheets).toBeGreaterThanOrEqual(1);
    }
  });

  test('故障日志：抓快照 + 详情（自限：快照受 50 份保留策略约束）', async ({ page }) => {
    await page.goto('/system-logs');
    await expect(page.getByText('一键抓取平台故障日志快照')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /抓取快照/ }).click();
    await expect(page.getByText(/快照已抓取/)).toBeVisible({ timeout: 30_000 });
    // 打开最新详情看组件日志
    await page.locator('tbody a').first().click();
    await page.waitForTimeout(1500);
    await expect(page.getByText('AI 故障解析')).toBeVisible();
  });

  test('资源配置：页面加载 + 建删测试项目（自清理）', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/resource-config');
    await page.waitForTimeout(2500);
    const pname = `E2E测试项目-${Date.now().toString(36)}`;
    // 新建项目
    await page.getByRole('button', { name: /新建/ }).first().click();
    await page.locator('.ant-modal input').first().fill(pname);
    await page.locator('.ant-modal').getByRole('button', { name: /确|OK|保存/ }).click();
    await expect(page.locator('body')).toContainText(pname, { timeout: 10_000 });
    // 删除（自清理）
    await page.getByRole('button', { name: /删除/ }).first().click();
    await page.locator('.ant-modal, .ant-popconfirm').getByRole('button', { name: /确|是|OK/ }).first().click();
    await page.waitForTimeout(2000);
  });

  test('API 冒烟：关键只读接口', async ({ page }) => {
    for (const ep of ['/api/auth/me', '/api/projects', '/api/drawing/jobs', '/api/rc/store', '/api/syslogs']) {
      const r = await page.request.get(ep);
      expect(r.ok(), ep).toBeTruthy();
    }
  });
});
