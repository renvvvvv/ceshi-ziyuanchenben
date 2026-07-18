/**
 * Seed 脚本：把前端 mock 数据种入 PostgreSQL
 *
 * 数据源：backups/server-YYYY-MM-DD/frontend_mock_export.json
 *   - mockProjects: 13 个项目
 *   - mockHistoryProjects: 27 个历史项目
 *   - mockTeamMembers: 49 个人员
 *   - mockTestDocs: 4 个测试文档（暂不入库，无对应表）
 *
 * 用法：
 *   1. 把 backups/server-2026-07-18/frontend_mock_export.json 复制到 server/data/mock_export.json
 *   2. npx tsx server/scripts/seed-from-mock.ts
 *
 * 行为：
 *   - 重复执行是安全的（带去重：projects 按 (name, customer) 去重，members 按 employee_id 去重）
 *   - 启动时打印统计
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 路径：从 dist/scripts/seed-from-mock.js 跑到 /app/data/mock_export.json
//  - dist/scripts → ../data = dist/data (错)
//  - dist/scripts → ../../data = data (对，因为 Dockerfile COPY server/data ./data)
const SEED_FILE = path.resolve(__dirname, '../../data/mock_export.json');

interface MockProject {
  id: string;
  name: string;
  city?: string;
  customer: string;
  status: string;
  manager?: string;
  startDate?: string;
  endDate?: string;
  plannedDeliveryDate?: string;
  actualDeliveryDate?: string;
  itOutput?: number;
  plannedManpower?: number;
  businessType?: string;
  description?: string;
  updatedAt?: string;
  assignedMemberIds?: string[];
}

interface MockTeamMember {
  id: string;
  name: string;
  employeeId: string;
  status?: string;
  skills?: string[];
  currentProjects?: string[];
  projects?: string[];
  email?: string;
  phone?: string;
}

interface MockExport {
  mockProjects: MockProject[];
  mockHistoryProjects: MockProject[];
  mockTeamMembers: MockTeamMember[];
}

function safeStr(v: any, fallback: string = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function safeNum(v: any): number {
  if (v === null || v === undefined) return 0;
  return Number(v) || 0;
}

async function main() {
  if (!fs.existsSync(SEED_FILE)) {
    console.error(`[Seed] 找不到文件: ${SEED_FILE}`);
    console.error('[Seed] 请先把 backups/server-2026-07-18/frontend_mock_export.json 复制到 server/data/mock_export.json');
    process.exit(1);
  }

  console.log(`[Seed] 读取 ${SEED_FILE}...`);
  const data: MockExport = JSON.parse(fs.readFileSync(SEED_FILE, 'utf-8'));
  console.log(`[Seed] 数据规模:`);
  console.log(`  - Projects: ${data.mockProjects.length}`);
  console.log(`  - History:  ${data.mockHistoryProjects.length}`);
  console.log(`  - Members:  ${data.mockTeamMembers.length}`);

  await db.ready();

  // ===== 1. Team Members =====
  console.log('\n[Seed] 写入 team_members...');
  let memberInserted = 0;
  let memberSkipped = 0;
  for (const m of data.mockTeamMembers) {
    const exists = await db.getAsync(
      'SELECT id FROM team_members WHERE employee_id = $1',
      String(m.employeeId),
    );
    if (exists) {
      memberSkipped++;
      continue;
    }
    await db.runAsync(
      `INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      safeStr(m.name),
      safeStr(m.employeeId),
      safeStr(m.status, '在线'),
      JSON.stringify(m.skills || []),
      JSON.stringify(m.currentProjects || []),
      safeStr(m.email, ''),
      safeStr(m.phone, ''),
    );
    memberInserted++;
  }
  console.log(`  ✓ 插入 ${memberInserted} 个，跳过 ${memberSkipped} 个已存在`);

  // ===== 2. 建立 employee_id → id 映射 =====
  const allMembers = await db.allAsync('SELECT id, employee_id FROM team_members');
  const memberIdMap: Record<string, number> = {};
  for (const r of allMembers) {
    memberIdMap[String((r as any).employee_id)] = Number((r as any).id);
  }

  // ===== 3. Projects =====
  console.log('\n[Seed] 写入 test_projects...');
  let projInserted = 0;
  let projSkipped = 0;
  for (const p of data.mockProjects) {
    // 去重：按 (name, customer) 查重
    const exists = await db.getAsync(
      'SELECT id FROM test_projects WHERE name = $1 AND customer = $2',
      safeStr(p.name),
      safeStr(p.customer),
    );
    if (exists) {
      projSkipped++;
      continue;
    }

    // 处理 assignedMemberIds：把 employee_id 列表转为 DB id 列表
    let assignedDbIds: number[] = [];
    if (Array.isArray(p.assignedMemberIds)) {
      assignedDbIds = p.assignedMemberIds
        .map((eid) => memberIdMap[String(eid)])
        .filter((n) => Number.isFinite(n) && n > 0);
    }

    await db.runAsync(
      `INSERT INTO test_projects (
        name, customer, status, manager,
        start_date, end_date, it_output,
        business_type, description,
        planned_manpower, city, assigned_member_ids
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      safeStr(p.name),
      safeStr(p.customer),
      safeStr(p.status, '未开始'),
      safeStr(p.manager),
      safeStr(p.startDate, ''),
      safeStr(p.endDate, ''),
      safeNum(p.itOutput),
      safeStr(p.businessType, ''),
      safeStr(p.description, ''),
      safeNum(p.plannedManpower) || null,
      safeStr(p.city, ''),
      assignedDbIds.length > 0 ? JSON.stringify(assignedDbIds) : null,
    );
    projInserted++;
  }
  console.log(`  ✓ 插入 ${projInserted} 个，跳过 ${projSkipped} 个已存在`);

  // ===== 4. Historical Projects =====
  console.log('\n[Seed] 写入 historical_projects...');
  let histInserted = 0;
  let histSkipped = 0;
  for (const h of data.mockHistoryProjects) {
    const exists = await db.getAsync(
      'SELECT id FROM historical_projects WHERE name = $1 AND customer = $2',
      safeStr(h.name),
      safeStr(h.customer),
    );
    if (exists) {
      histSkipped++;
      continue;
    }
    await db.runAsync(
      `INSERT INTO historical_projects (name, it_output, start_date, end_date, customer, doc_link)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      safeStr(h.name),
      safeNum(h.itOutput),
      safeStr(h.startDate, ''),
      safeStr(h.endDate, ''),
      safeStr(h.customer, ''),
      null,
    );
    histInserted++;
  }
  console.log(`  ✓ 插入 ${histInserted} 个，跳过 ${histSkipped} 个已存在`);

  // ===== 5. 统计 =====
  console.log('\n[Seed] ===== 最终统计 =====');
  const counts = await db.allAsync(`
    SELECT
      (SELECT COUNT(*) FROM team_members) AS members,
      (SELECT COUNT(*) FROM test_projects) AS projects,
      (SELECT COUNT(*) FROM historical_projects) AS history
  `);
  console.log(JSON.stringify((counts as any[])[0], null, 2));

  console.log('\n[Seed] ✓ 完成');
  process.exit(0);
}

main().catch((err) => {
  console.error('[Seed] 失败:', err);
  process.exit(1);
});
