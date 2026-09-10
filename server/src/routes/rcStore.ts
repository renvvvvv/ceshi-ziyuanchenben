/**
 * 资源配置 · 新版键值存储路由（收编自独立资源配置工具的后端）
 *
 * 前端为 public/rc/index.html 单文件工作台（localStorage + 云端双写），
 * 本路由提供其云端通道（同款 8 键白名单），并挂接旧 rc_* 四表的一次性
 * 自动迁移：首次 GET 时若 store 为空且旧表有数据，则完成迁移后返回。
 *
 *   GET  /api/rc/store        读取全部键值（登录即可）
 *   POST /api/rc/store/bulk   批量写入（管理者/编辑者）
 */
import { Router, Request, Response } from 'express';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();

/** 锁键：密码不下发、不随 bulk 写入（防他端旧值回滚锁状态），走专用 lock/unlock 接口 */
const LOCK_KEYS = new Set([
  'testAssetsLibLock_v1',
  'deptLibLock_v1',
  'testDeliveredLock_v1',
  'testDeliveredEditPw_v1',
]);
const STORE_KEYS = new Set([
  'testProjectConfig_v1',
  'testAssetsLib_v1',
  'testAssetsLibLock_v1',
  'deptMembersLib_v1',
  'deptLibLock_v1',
  'testDeliveredProjects_v1',
  'testDeliveredLock_v1',
  'testDeliveredEditPw_v1',
]);

async function ensureTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS rc_store (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      version    INT NOT NULL DEFAULT 1
    );
  `);
  // 旧表幂等升级：补 version 列（乐观锁），失败仅告警不阻断读
  try { await db.exec(`ALTER TABLE rc_store ADD COLUMN IF NOT EXISTS version INT DEFAULT 1`); }
  catch (e: any) { console.warn('[rcStore] version 列升级失败:', e?.message); }
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** 旧 rc_projects / rc_delivered 行 → 新工具项目对象 */
function legacyRowToProject(row: Record<string, any>): Record<string, any> {
  const data = (row.data && typeof row.data === 'object') ? row.data : {};
  return {
    id: str(row.id),
    name: str(row.name),
    mw: (str(row.mw) !== '' ? row.mw : (data.mw ?? '')),
    site: str(row.site),
    manager: str(row.manager),
    testDays: num(row.test_days ?? data.testDays ?? 40),
    startDate: str(row.start_date ?? data.startDate),
    endDate: str(row.end_date ?? data.endDate),
    remark: str(row.remark),
    // 旧 data JSONB 里的 9 个模块数组 + cert 原样带过来（同宗字段，名称一致）
    personnel: data.personnel ?? [],
    staff: data.staff ?? [],
    subsidy: data.subsidy ?? [],
    external: data.external ?? [],
    loads: data.loads ?? [],
    instruments: data.instruments ?? [],
    consumables: data.consumables ?? [],
    labor: data.labor ?? [],
    safety: data.safety ?? [],
    ...(data.cert ? { cert: data.cert } : {}),
  };
}

/** 一次性迁移：旧 rc_* 四表 → 新 8 键格式（store 为空且旧表有数据时执行） */
async function migrateFromLegacy() {
  const existing = await db.allAsync(
    `SELECT key FROM rc_store WHERE key IN ('testProjectConfig_v1','testAssetsLib_v1','deptMembersLib_v1','testDeliveredProjects_v1')`
  ) as any[];
  if (existing.length > 0) return;   // 已迁移过（幂等）

  const [projects, assets, members, delivered] = await Promise.all([
    db.allAsync(`SELECT * FROM rc_projects ORDER BY created_at ASC`) as Promise<any[]>,
    db.allAsync(`SELECT * FROM rc_assets ORDER BY id ASC`) as Promise<any[]>,
    db.allAsync(`SELECT * FROM rc_dept_members ORDER BY id ASC`) as Promise<any[]>,
    db.allAsync(`SELECT * FROM rc_delivered ORDER BY saved_at ASC`) as Promise<any[]>,
  ]);
  if (!projects.length && !assets.length && !members.length && !delivered.length) return;  // 旧库也无数据（仅存已交付的老账号也要迁移）

  const map: Record<string, unknown> = {};

  // ① 在测项目 → {projects: {id: proj}, currentId}
  const projObj: Record<string, any> = {};
  for (const row of projects) {
    const p = legacyRowToProject(row);
    projObj[p.id] = p;
  }
  if (projects.length) {
    map.testProjectConfig_v1 = { projects: projObj, currentId: str(projects[projects.length - 1].id) }; // 最近创建的项目作为默认当前
  }

  // ② 自有资源库 → 裸数组 [{cat,name,spec,count,note}]
  if (assets.length) {
    map.testAssetsLib_v1 = assets.map(a => ({
      cat: str(a.cat), name: str(a.name), spec: str(a.spec),
      count: num(a.count), note: str(a.note),
    }));
  }

  // ③ 部门人员库 → {members:[{id,name,level,post,company,phone,skill,note}]}
  if (members.length) {
    map.deptMembersLib_v1 = {
      members: members.map(m => ({
        id: str(m.id), name: str(m.name), level: str(m.level), post: str(m.post),
        company: str(m.company), phone: str(m.phone), skill: str(m.skill), note: str(m.note),
      })),
    };
  }

  // ④ 已交付存档 → 裸数组（snapshot 为完整项目快照）
  if (delivered.length) {
    map.testDeliveredProjects_v1 = delivered.map(d => {
      const snap = (d.snapshot && typeof d.snapshot === 'object') ? d.snapshot : {};
      const base = (snap as any).id ? (snap as any) : legacyRowToProject({ ...d, data: snap });
      return {
        ...base,
        id: str(d.id),
        savedAt: str(d.saved_at || ''),
        name: str(d.name || base.name),
      };
    });
  }

  const entries = Object.entries(map);
  if (!entries.length) return;
  for (const [k, v] of entries) {
    await db.runAsync(
      `INSERT INTO rc_store (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO NOTHING`,
      k, JSON.stringify(v)
    );
  }
  console.log(`[rcStore] 旧数据迁移完成：${entries.map(e => `${e[0]}(${Array.isArray(e[1]) ? (e[1] as any[]).length : Object.keys((e[1] as any).projects || (e[1] as any).members || {}).length})`).join(' ')}`);
}

/** GET /api/rc/store —— 前端 cloudPull 入口（含首访自动迁移） */
router.get('/store', requireAuth, async (_req, res) => {
  try {
    await ensureTable();
    await migrateFromLegacy();
    const rows = await db.allAsync(
      `SELECT key, value, version FROM rc_store WHERE key NOT LIKE '\\_%'`
    ) as any[];
    const out: Record<string, unknown> = {};
    const versions: Record<string, number> = {};
    for (const r of rows) {
      if (!STORE_KEYS.has(r.key)) continue;
      // 锁键脱敏：密码只进不出（锁定/解锁走专用接口做服务端校验）
      if (LOCK_KEYS.has(r.key)) {
        const lk = (r.value && typeof r.value === 'object') ? { ...(r.value as object) } : {};
        out[r.key] = { locked: !!(lk as any).locked, password: '' };
      } else {
        out[r.key] = r.value;
      }
      versions[r.key] = r.version ?? 1;
    }
    out._versions = versions;
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/rc/store/bulk —— 前端 cloudPush 入口（事务整包覆盖） */
router.post('/store/bulk', requireAuth, requireRole(['管理者', '编辑者']), async (req, res) => {
  const map = (req.body || {}) as Record<string, unknown>;
  const keys = Object.keys(map);
  if (!keys.length) { res.json({ ok: true, saved: 0 }); return; }
  const bad = keys.filter(k => !STORE_KEYS.has(k) && !k.startsWith('_')); // _baseVersion 为协议字段
  if (bad.length) { res.status(400).json({ error: 'unknown keys: ' + bad.join(', ') }); return; }
  try {
    await ensureTable();
    // 锁键拒写入 bulk：锁状态由专用 lock/unlock 接口管理，防他端旧值把锁回滚（P2-7）
    const lockSkipped = keys.filter(k => LOCK_KEYS.has(k));
    const dataKeys = keys.filter(k => !LOCK_KEYS.has(k) && !k.startsWith('_'));
    // 空覆盖防护（P0）：提交值为空集而云端同键有实质数据时拒绝该键——
    // 拦截"本地为空 + 全量推送"把云端清空的数据丢失路径；正常清空需求联系管理员处理
    const measure = (k: string, v: unknown): number => {
      try {
        if (k === 'testProjectConfig_v1') return Object.keys((v as any)?.projects || {}).length;
        if (k === 'deptMembersLib_v1') return ((v as any)?.members || []).length;
        return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0);
      } catch { return 0; }
    };
    const rows = await db.allAsync(
      `SELECT key, value, version FROM rc_store WHERE key = ANY($1::text[])`, dataKeys
    ) as any[];
    const baseVersions = (req.body || {})._baseVersion as Record<string, number> | undefined;
    const blocked: string[] = [];
    const allowed = dataKeys.filter(k => {
      const cur = rows.find(r => r.key === k);
      if (!cur) return true;
      if (measure(k, map[k]) === 0 && measure(k, cur.value) > 0) { blocked.push(k); return false; }
      return true;
    });
    if (blocked.length && !allowed.length) {
      res.status(409).json({ error: '拒绝空覆盖（云端该键有数据而提交为空）：' + blocked.join(', '), blocked });
      return;
    }
    // 乐观锁条件写：带基线版本且云端版本已前进（他人先推过）→ 拒写该键计入 conflicts，
    // 客户端收到后重拉合并再推，消除多端 last-write-wins 静默覆盖
    const conflicts: string[] = [];
    const writables = allowed.filter(k => {
      const cur = rows.find(r => r.key === k);
      const base = baseVersions?.[k];
      if (cur && typeof base === 'number' && (cur.version ?? 1) !== base) { conflicts.push(k); return false; }
      return true;
    });
    const newVersions: Record<string, number> = {};
    for (const k of writables) {
      const cur = rows.find(r => r.key === k);
      await db.runAsync(
        `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1`,
        k, JSON.stringify(map[k])
      );
      newVersions[k] = (cur?.version ?? 0) + 1;
    }
    res.json({
      ok: true, saved: writables.length,
      conflicts: conflicts.length ? conflicts : undefined,
      skipped: lockSkipped.length ? lockSkipped : undefined,
      _versions: newVersions,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** POST /api/rc/store/lock —— 锁定（密码只在服务端存储，GET 永不下发） */
router.post('/store/lock', requireAuth, requireRole(['管理者', '编辑者']), async (req, res) => {
  const key = String(req.body?.key || '');
  const password = String(req.body?.password || '');
  if (!LOCK_KEYS.has(key)) { res.status(400).json({ error: '非法锁键' }); return; }
  if (password.length < 4) { res.status(400).json({ error: '密码至少 4 位' }); return; }
  try {
    await ensureTable();
    await db.runAsync(
      `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1`,
      key, JSON.stringify({ locked: true, password })
    );
    res.json({ ok: true, locked: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** POST /api/rc/store/unlock —— 解锁（服务端比对密码；云端未设密码则直接解锁） */
router.post('/store/unlock', requireAuth, requireRole(['管理者', '编辑者']), async (req, res) => {
  const key = String(req.body?.key || '');
  const password = String(req.body?.password || '').trim();
  if (!LOCK_KEYS.has(key)) { res.status(400).json({ error: '非法锁键' }); return; }
  try {
    await ensureTable();
    const rows = await db.allAsync(`SELECT value FROM rc_store WHERE key = $1`, key) as any[];
    const cur = rows[0]?.value;
    const curPw = cur && typeof cur === 'object' ? String((cur as any).password || '') : '';
    if (curPw && password !== curPw) { res.status(401).json({ error: '密码错误' }); return; }
    await db.runAsync(
      `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1`,
      key, JSON.stringify({ locked: false, password: curPw })
    );
    res.json({ ok: true, locked: false });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
