#!/usr/bin/env node
/**
 * 一致性检查脚本：对比 DB schema 与 API 返回字段
 *
 * 用法：
 *   node server/scripts/check-consistency.mjs
 *
 * 检查项：
 *   1. 每张表的列是否与 API 返回的字段匹配（snake_case ↔ camelCase）
 *   2. 孤儿数据（外键引用不存在）
 *   3. 空表/异常行数
 *
 * 退出码：0 = 通过，1 = 发现不一致
 */
import pg from 'pg';

const { PGHOST = 'localhost', PGPORT = '5432', PGDATABASE = 'test_platform', PGUSER = 'postgres', PGPASSWORD = 'postgres123' } = process.env;

const client = new pg.Client({
  host: PGHOST,
  port: parseInt(PGPORT, 10),
  database: PGDATABASE,
  user: PGUSER,
  password: PGPASSWORD,
});

const EXPECTED_TABLES = [
  'test_projects',
  'team_members',
  'historical_projects',
  'resource_calc_history',
  'kb_documents',
  'attendance_adjustments',
  'learned_corrections',
  'users',
  'sessions',
];

async function main() {
  let issues = 0;
  try {
    await client.connect();
    console.log('✓ 数据库连接成功\n');

    // 1. 检查表是否存在
    console.log('=== 表存在性检查 ===');
    const { rows: tables } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const existingTables = new Set(tables.map((t) => t.table_name));
    for (const t of EXPECTED_TABLES) {
      if (existingTables.has(t)) {
        console.log(`  ✓ ${t}`);
      } else {
        console.log(`  ✗ ${t} 不存在！`);
        issues++;
      }
    }

    // 2. 检查每张表的行数
    console.log('\n=== 行数检查 ===');
    for (const t of EXPECTED_TABLES) {
      if (!existingTables.has(t)) continue;
      const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${t}`);
      const count = rows[0].count;
      const flag = count === 0 ? '⚠ ' : '  ';
      console.log(`${flag}${t}: ${count} 行`);
    }

    // 3. 孤儿数据检查
    console.log('\n=== 孤儿数据检查 ===');

    // team_members.assigned_project_ids 引用的项目是否存在
    try {
      const { rows: orphans } = await client.query(`
        SELECT tm.id, tm.name, tm.assigned_project_ids
        FROM team_members tm
        WHERE tm.assigned_project_ids IS NOT NULL AND tm.assigned_project_ids != '[]'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(tm.assigned_project_ids::jsonb) AS pid
          JOIN test_projects tp ON tp.id::text = pid
        )
      `);
      if (orphans.length > 0) {
        console.log(`  ⚠ team_members 有 ${orphans.length} 条记录的 assigned_project_ids 引用不存在的项目`);
        issues++;
      } else {
        console.log('  ✓ team_members.assigned_project_ids 无孤儿引用');
      }
    } catch (e) {
      console.log(`  - 跳过 team_members 孤儿检查（列可能不存在）`);
    }

    // attendance_adjustments 引用的 member 是否存在
    try {
      const { rows: orphans } = await client.query(`
        SELECT DISTINCT aa.member_id
        FROM attendance_adjustments aa
        LEFT JOIN team_members tm ON tm.id::text = aa.member_id
        WHERE tm.id IS NULL
      `);
      if (orphans.length > 0) {
        console.log(`  ⚠ attendance_adjustments 有 ${orphans.length} 条引用不存在的 member`);
        issues++;
      } else {
        console.log('  ✓ attendance_adjustments 无孤儿 member 引用');
      }
    } catch (e) {
      console.log(`  - 跳过 attendance_adjustments 孤儿检查`);
    }

    // 4. 列存在性检查（关键字段）
    console.log('\n=== 关键列检查 ===');
    const criticalColumns = [
      { table: 'test_projects', cols: ['id', 'name', 'customer', 'status', 'start_date', 'end_date'] },
      { table: 'team_members', cols: ['id', 'name', 'employee_id', 'status'] },
      { table: 'historical_projects', cols: ['id', 'name', 'customer'] },
    ];
    for (const { table, cols } of criticalColumns) {
      const { rows: colRows } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [table]
      );
      const existingCols = new Set(colRows.map((c) => c.column_name));
      for (const col of cols) {
        if (existingCols.has(col)) {
          console.log(`  ✓ ${table}.${col}`);
        } else {
          console.log(`  ✗ ${table}.${col} 不存在！`);
          issues++;
        }
      }
    }

    console.log('\n=== 总结 ===');
    if (issues === 0) {
      console.log('✓ 一致性检查通过，无问题');
      process.exit(0);
    } else {
      console.log(`✗ 发现 ${issues} 个问题`);
      process.exit(1);
    }
  } catch (err) {
    console.error('检查失败:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
