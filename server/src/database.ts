import pg, { type Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// PostgreSQL 连接配置
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'test_platform',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20, // 连接池最大连接数
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let pool: Pool | null = null;

// ============ 兼容旧 API 的 wrapper（模拟 better-sqlite3 接口） ============

interface Stmt {
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

class PgDbWrapper {
  private pool: Pool;

  constructor() {
    this.pool = new pg.Pool(DB_CONFIG);
    // 测试连接
    this.pool.on('error', (err: Error) => {
      console.error('[DB] Unexpected error on idle client', err);
    });
  }

  async ready(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('[DB] PostgreSQL connected successfully');
    } finally {
      client.release();
    }
  }

  /** 执行多条 SQL（用于初始化） */
  async exec(sql: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  /** 准备语句 — 将 ? 占位符转换为 $1, $2... 格式 */
  prepare(sql: string): Stmt {
    // 转换 ? 占位符为 PostgreSQL 的 $N 格式
    let paramIdx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIdx}`);

    return {
      run: (...params: unknown[]) => {
        // 同步执行（PostgreSQL 是异步的，这里用 sync hack）
        // 注意：在 Node.js 中无法真正同步执行 PG 查询
        // 这里通过 cache + 同步返回结果的方式模拟
        // 实际使用时需要调用 async 版本
        throw new Error('[DB] run() is async in PostgreSQL, use runAsync() instead');
      },
      get: (...params: unknown[]) => {
        throw new Error('[DB] get() is async in PostgreSQL, use getAsync() instead');
      },
      all: (...params: unknown[]) => {
        throw new Error('[DB] all() is async in PostgreSQL, use allAsync() instead');
      },
    };
  }

  /** 异步 run */
  async runAsync(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
    let paramIdx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIdx}`);
    const result = await this.pool.query(pgSql, params as never[]);
    return {
      changes: result.rowCount || 0,
      lastInsertRowid: result.rows[0]?.id ? Number(result.rows[0].id) : 0,
    };
  }

  /** 异步 get */
  async getAsync(sql: string, ...params: unknown[]): Promise<Record<string, unknown> | undefined> {
    let paramIdx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIdx}`);
    const result = await this.pool.query(pgSql, params as never[]);
    return result.rows[0];
  }

  /** 异步 all */
  async allAsync(sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> {
    let paramIdx = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++paramIdx}`);
    const result = await this.pool.query(pgSql, params as never[]);
    return result.rows;
  }

  /** 获取连接池 */
  getPool(): Pool {
    return this.pool;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

const dbWrapper = new PgDbWrapper();

export async function initDatabase(): Promise<PgDbWrapper> {
  try {
    await dbWrapper.ready();
  } catch (err: any) {
    console.warn('[DB] PostgreSQL connection failed:', err.message || err);
    console.warn('[DB] Running in fallback mode (no database persistence)');
    return dbWrapper;
  }

  // 查找 init.sql
  try {
    const possiblePaths = [
      join(__dirname, '..', '..', 'scripts', 'init.sql'),
      join(__dirname, '..', '..', '..', 'scripts', 'init.sql'),
    ];
    const initSqlPath = possiblePaths.find(p => existsSync(p));
    if (initSqlPath) {
      const initSql = readFileSync(initSqlPath, 'utf-8');
      await dbWrapper.exec(initSql);
      console.log('[DB] Schema initialized (PostgreSQL)');
    }
  } catch (err: any) {
    console.warn('[DB] Failed to init schema:', err.message || err);
  }
  return dbWrapper;
}

export default dbWrapper;
