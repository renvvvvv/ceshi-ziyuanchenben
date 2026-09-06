import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        // API_PROXY_TARGET=http://49.232.147.149 可让本地前端直连生产后端试用
        target: process.env.API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        // Vite 的 http-proxy 超时控制在 proxyTimeout（毫秒），不是 timeout
        // GLM-5.2 审核长文档可能需要 30-60s，给 120s 余量
        proxyTimeout: 120000,
        timeout: 120000,
      },
    },
  },
});
