/**
 * 历史项目字段回填脚本（2026-07-19）
 * 背景：historical_projects 表 schema 设计时漏了 city/manager/planned_manpower/business_type 等字段
 *       但前端 History 页面一直显示这些列，导致全部显示 "-"
 * 修复：
 *   1. init.sql 加 ALTER TABLE 兼容升级
 *   2. 前端 dbRowToHistoryProject / historyProjectToDbBody 补全字段映射
 *   3. 后端 POST/PUT /api/projects/history 端点补全字段
 *   4. 本脚本：从 src/data/mock.ts 读取 27 个历史项目，按 name 匹配 UPDATE 到 DB
 *
 * 用法：node scripts/backfill-history-fields.mjs
 *   - 自动读 DB 连接从 .env
 *   - 用 name 匹配（DB 已有 27 条历史项目，name 一致）
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

// 读 DB 配置
const envContent = readFileSync(join(projectRoot, '.env'), 'utf-8');
const env = Object.fromEntries(
  envContent.split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [k, ...v] = l.split('=');
      return [k.trim(), v.join('=').trim()];
    })
);

// 解析前端 mockHistoryProjects（手动提取，不用 ts 编译）
const mockTs = readFileSync(join(projectRoot, 'src', 'data', 'mock.ts'), 'utf-8');
const blockMatch = mockTs.match(/export const mockHistoryProjects: HistoricalProject\[\] = (\[[\s\S]*?\n\]);/);
if (!blockMatch) {
  console.error('❌ 无法从 mock.ts 提取 mockHistoryProjects');
  process.exit(1);
}

// 简单转换 TS 对象字面量为 JSON
const tsBlock = blockMatch[1]
  .replace(/'/g, '"')                  // 单引号 → 双引号
  .replace(/,\s*\n\s*}/g, '\n}')       // 移除尾随逗号
  .replace(/,\s*\n\s*]/g, '\n]');      // 移除数组尾随逗号

let mockData;
try {
  mockData = JSON.parse(tsBlock);
} catch (err) {
  console.error('❌ 解析 mock 数据失败：', err.message);
  console.error('前 500 字符：', tsBlock.slice(0, 500));
  process.exit(1);
}

console.log(`📋 从 mock.ts 读取到 ${mockData.length} 个历史项目`);

// 连接 DB
const client = new pg.Client({
  host: env.DB_HOST || 'localhost',
  port: parseInt(env.DB_PORT || '5432', 10),
  database: env.DB_NAME || 'test_platform',
  user: env.DB_USER || 'postgres',
  password: env.DB_PASSWORD || '',
});
await client.connect();

let updated = 0;
let notFound = 0;
let noMatch = [];

try {
  for (const m of mockData) {
    // 按 name + customer 匹配（避免误匹配）
    const r = await client.query(
      `UPDATE historical_projects
         SET city = $1, manager = $2,
             planned_delivery_date = $3, actual_delivery_date = $4,
             planned_manpower = $5, business_type = $6,
             description = $7
       WHERE name = $8 AND customer = $9
       RETURNING id`,
      m.city || null,
      m.manager || null,
      m.plannedDeliveryDate || null,
      m.actualDeliveryDate || null,
      m.plannedManpower || null,
      m.businessType || null,
      m.description || null,
      m.name,
      m.customer,
    );
    if (r.rowCount === 0) {
      notFound += 1;
      noMatch.push(`${m.name} (${m.customer})`);
    } else {
      updated += 1;
    }
  }
} finally {
  await client.end();
}

console.log(`\n✅ 回填完成：`);
console.log(`   - 更新成功：${updated} 条`);
console.log(`   - 未匹配（DB 中无对应 name+customer）：${notFound} 条`);
if (noMatch.length > 0) {
  console.log(`\n未匹配列表：`);
  noMatch.forEach((n) => console.log(`   - ${n}`));
}
process.exit(0);