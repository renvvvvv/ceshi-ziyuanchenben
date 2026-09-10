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
import { createHash, randomBytes } from 'crypto';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

const router = Router();

/** 锁键：密码不下发、不随 bulk 写入（防他端旧值回滚锁状态），走专用 lock/unlock 接口 */
/** 数据键 → 配对锁键：bulk 写数据前检查锁状态（服务端锁强制） */
const LOCK_PAIR: Record<string, string> = {
  'testAssetsLib_v1': 'testAssetsLibLock_v1',
  'deptMembersLib_v1': 'deptLibLock_v1',
  'testDeliveredProjects_v1': 'testDeliveredLock_v1',
};
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
        // 兼容旧工具裸字符串格式（testDeliveredEditPw_v1）：脱敏为空串而非注入对象结构
        if (r.value && typeof r.value !== 'object') { out[r.key] = ''; }
        else {
          const lk = (r.value && typeof r.value === 'object') ? { ...(r.value as object) } : {};
          out[r.key] = { locked: !!(lk as any).locked, password: '' };
        }
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
      `SELECT key, value, version FROM rc_store WHERE key = ANY($1::text[])`,
      [...dataKeys, ...Object.values(LOCK_PAIR)]
    ) as any[];
    // 服务端锁强制：数据键配对的锁若 locked=true，拒写该键（锁不再只是 UI 建议）
    const lockedBlocked = dataKeys.filter(k => {
      const lk = LOCK_PAIR[k];
      if (!lk) return false;
      const cur = rows.find(r => r.key === lk);
      return !!(cur && (cur.value as any)?.locked);
    });
    const baseVersions = (req.body || {})._baseVersion as Record<string, number> | undefined;
    const blocked: string[] = [...lockedBlocked];
    const allowed = dataKeys.filter(k => {
      if (lockedBlocked.includes(k)) return false;
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
    // 原子 CAS：UPSERT 携带版本条件（读-判-写三步非原子在并发窗口仍会 last-write-wins，
    // WHERE rc_store.version = $base 由数据库保证原子性），0 行受影响即并发冲突
    const newVersions: Record<string, number> = {};
    for (const k of writables) {
      const cur = rows.find(r => r.key === k);
      const base = cur ? (baseVersions?.[k] ?? (cur.version ?? 1)) : undefined;
      if (cur && typeof base === 'number') {
        const r = await db.runAsync(
          `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1
           WHERE rc_store.version = $3`,
          k, JSON.stringify(map[k]), base
        );
        if (!r || !r.changes) { conflicts.push(k); continue; }
        newVersions[k] = base + 1;
      } else {
        await db.runAsync(
          `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1`,
          k, JSON.stringify(map[k])
        );
        newVersions[k] = (cur?.version ?? 0) + 1;
      }
    }
    // blocked（空覆盖防护拦截）必须回传：前端要提示用户云端保留了数据（曾静默丢弃致"删除复活"错觉）
    res.json({
      ok: true, saved: Object.keys(newVersions).length,
      conflicts: conflicts.length ? conflicts : undefined,
      blocked: blocked.length ? blocked : undefined,
      skipped: lockSkipped.length ? lockSkipped : undefined,
      _versions: newVersions,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** 密码哈希存储：sha256(盐+密码)；兼容存量明文（校验成功即自动升级为哈希） */
function hashPw(pw: string): string {
  const salt = randomBytes(8).toString('hex');
  return `s1$${salt}$${createHash('sha256').update(salt + pw).digest('hex')}`;
}
function verifyPw(pw: string, stored: string): boolean {
  if (!stored) return true; // 未设密码
  if (stored.startsWith('s1$')) {
    const [, salt, hex] = stored.split('$');
    return createHash('sha256').update(salt + pw).digest('hex') === hex;
  }
  return pw === stored; // 存量明文（校验通过后调用方应升级）
}
function isLocked(v: unknown): boolean {
  return !!(v && typeof v === 'object' && (v as any).locked);
}

/** POST /api/rc/store/lock —— 锁定（密码哈希入库，GET 永不下发；已锁定的键改密需旧密码或管理者） */
router.post('/store/lock', requireAuth, requireRole(['管理者', '编辑者']), async (req, res) => {
  const key = String(req.body?.key || '');
  const password = String(req.body?.password || '');
  if (!LOCK_KEYS.has(key)) { res.status(400).json({ error: '非法锁键' }); return; }
  if (password.length < 4) { res.status(400).json({ error: '密码至少 4 位' }); return; }
  try {
    await ensureTable();
    const rows = await db.allAsync(`SELECT value FROM rc_store WHERE key = $1`, key) as any[];
    const cur = rows[0]?.value;
    if (isLocked(cur)) {
      // 防劫持：他人已锁定的键，改密需提供原密码（管理者豁免）
      const oldPw = String((cur as any)?.password || '');
      const oldOk = verifyPw(String(req.body?.oldPassword || ''), oldPw);
      const isAdmin = (req as any).user?.role === '管理者';
      if (!oldOk && !isAdmin) { res.status(401).json({ error: '该库已被他人锁定，需原密码或管理员方可重设' }); return; }
    }
    await db.runAsync(
      `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1`,
      key, JSON.stringify({ locked: true, password: hashPw(password) })
    );
    res.json({ ok: true, locked: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

/** POST /api/rc/store/unlock —— 解锁（服务端比对哈希；未设密码直接解锁；存量明文校验通过自动升级） */
router.post('/store/unlock', requireAuth, requireRole(['管理者', '编辑者']), async (req, res) => {
  const key = String(req.body?.key || '');
  const password = String(req.body?.password || '').trim();
  if (!LOCK_KEYS.has(key)) { res.status(400).json({ error: '非法锁键' }); return; }
  try {
    await ensureTable();
    const rows = await db.allAsync(`SELECT value FROM rc_store WHERE key = $1`, key) as any[];
    const cur = rows[0]?.value;
    const curPw = cur && typeof cur === 'object' ? String((cur as any).password || '') : String(cur ?? '');
    if (curPw && !verifyPw(password, curPw)) { res.status(401).json({ error: '密码错误' }); return; }
    // 存量明文校验通过 → 升级为哈希存储
    const keep = curPw && !curPw.startsWith('s1$') ? hashPw(curPw) : curPw;
    await db.runAsync(
      `INSERT INTO rc_store (key, value, updated_at, version) VALUES ($1, $2::jsonb, now(), 1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), version = rc_store.version + 1`,
      key, JSON.stringify({ locked: false, password: keep })
    );
    res.json({ ok: true, locked: false });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
