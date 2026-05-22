import initSqlJs, { type Database as SqlJsDatabase, type QueryExecResult } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 编译后在 dist/src/ 运行，往上两级回到 /app，再加 data/
const DATA_DIR = join(__dirname, '..', '..', 'data');
const DB_PATH = join(DATA_DIR, 'platform.db');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ============ 轻量 wrapper（模拟 better-sqlite3 API） ============

interface Stmt {
  run: (...params: unknown[]) => { changes: number; lastInsertRowid: number };
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Record<string, unknown>[];
}

class DbWrapper {
  private db: SqlJsDatabase | null = null;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init() {
    const SQL = await initSqlJs();
    if (existsSync(DB_PATH)) {
      const buf = readFileSync(DB_PATH);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }
  }

  async ready(): Promise<void> { return this.initPromise; }

  private ensure() {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  exec(sql: string): void {
    this.ensure().exec(sql);
    this.save();
  }

  prepare(sql: string): Stmt {
    const d = this.ensure();
    return {
      run: (...params: unknown[]) => {
        let idx = 0;
        const filled = sql.replace(/\?/g, () => {
          const v = params[idx++];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        d.run(filled);
        const changes = d.getRowsModified();
        this.save();
        let lastInsertRowid = 0;
        try { const r = d.exec('SELECT last_insert_rowid() as id'); if (r.length > 0 && r[0].values.length > 0) lastInsertRowid = Number(r[0].values[0][0]) || 0; } catch {}
        return { changes, lastInsertRowid };
      },
      get: (...params: unknown[]) => {
        let idx = 0;
        const filled = sql.replace(/\?/g, () => {
          const v = params[idx++];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        const res = d.exec(filled);
        if (res.length > 0 && res[0].values.length > 0) {
          return rowToObj(res[0]);
        }
        return undefined;
      },
      all: (...params: unknown[]) => {
        let idx = 0;
        const filled = sql.replace(/\?/g, () => {
          const v = params[idx++];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        const res = d.exec(filled);
        if (res.length > 0 && res[0].values.length > 0) {
          return res[0].values.map(row => {
            const obj: Record<string, unknown> = {};
            res[0].columns.forEach((col: string, i: number) => { obj[col] = row[i]; });
            return obj;
          });
        }
        return [];
      },
    };
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buf = Buffer.from(data);
    writeFileSync(DB_PATH, buf);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

function rowToObj(result: QueryExecResult): Record<string, unknown> | undefined {
  if (result.values.length === 0) return undefined;
  const obj: Record<string, unknown> = {};
  result.columns.forEach((col: string, i: number) => { obj[col] = result.values[0][i]; });
  return obj;
}

const dbWrapper = new DbWrapper();

export async function initDatabase(): Promise<DbWrapper> {
  await dbWrapper.ready();
  const initSqlPath = join(__dirname, '..', '..', 'note', 'init.sql');
  if (existsSync(initSqlPath)) {
    const initSql = readFileSync(initSqlPath, 'utf-8');
    dbWrapper.exec(initSql);
    console.log('[DB] Schema initialized (sql.js)');
  }
  return dbWrapper;
}

export default dbWrapper;
