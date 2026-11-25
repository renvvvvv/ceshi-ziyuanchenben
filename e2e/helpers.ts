import { test as base, expect, type Page } from '@playwright/test';
import { e2eAdmin, loadE2EEnv } from './env';

// 用例文件在独立的工作进程里执行：这里也读一次 .env.e2e（幂等），不依赖配置进程
loadE2EEnv();

/**
 * 登录辅助：走 API 登录（绕开 UI 登录页的折叠面板交互），
 * cookie 会随 context 自动带到后续页面请求。
 * 账号来自环境变量 / .env.e2e，见 ./env.ts。
 */
export const TEST_ADMIN = e2eAdmin();

export async function apiLogin(page: Page) {
  const r = await page.request.post('/api/auth/login', { data: TEST_ADMIN });
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  expect(d.success).toBeTruthy();
  return d;
}

/** 展开管理员登录表单并 UI 登录（用于登录流程本身的测试） */
export async function uiLogin(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByText('管理员账号登录').click();
  await page.getByPlaceholder(/用户名|账号/).fill(username);
  await page.getByPlaceholder(/密码/).fill(password);
  await page.getByRole('button', { name: /登录|登 录/ }).click();
}

export const test = base.extend({});
export { expect };
