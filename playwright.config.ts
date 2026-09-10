import { defineConfig } from '@playwright/test';

/**
 * E2E 回归测试套件
 * 目标：生产环境 http://49.232.147.149
 * 原则：只读为主；写操作必须自清理（测试项目建完即删；故障快照受 50 份保留策略约束）
 * 运行：npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 1,
  workers: 2,
  use: {
    baseURL: 'http://49.232.147.149',
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
