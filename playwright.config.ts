import { defineConfig } from '@playwright/test';
import { e2eBaseUrl, loadE2EEnv } from './e2e/env';

/**
 * E2E 回归测试套件
 * 被测地址与账号来自环境变量或仓库根目录的 .env.e2e（不提交），见 ./e2e/env.ts：
 *   E2E_BASE_URL                     不设时默认本地 http://localhost:3000；指向线上必须显式写明
 *   E2E_ADMIN_USER / E2E_ADMIN_PASS  管理员账号
 *   E2E_EDITOR_USER / E2E_EDITOR_PASS 编辑者账号
 * 原则：只读为主；写操作必须自清理（测试项目建完即删；故障快照受 50 份保留策略约束）
 * 运行：npx playwright test
 */
loadE2EEnv();

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 1,
  workers: 2,
  use: {
    baseURL: e2eBaseUrl(),
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
