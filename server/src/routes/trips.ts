import { Router, Request, Response, NextFunction } from 'express';
import db from '../database.js';
import { requireAuth, requireRole } from './auth.js';

/**
 * 出差概览：人员考勤页的“出差概览”页签。
 *
 * 数据来源是值班补贴台账（出差登记），由 tools/trip_stats 管线解析后通过 POST /import 导入，平台自己不算台账。
 * 这里的统计算法和台账 Excel《出差时长与项目间休息天数统计》是同一套，两边数字一致：
 *   · 出差段   ：台账里一行“到岗日期–离岗日期”。
 *   · 连续出差 ：后一段开始日 ≤ 前一段结束日 + 1 天（重叠或次日接上）的，合并成一次。
 *   · 休息     ：相邻两次连续出差之间，休息天数 = 后一次开始日 − 前一次结束日 − 1（≥ 1 天才算），日历天数，含周末。
 *   · 年度出差天数 = 1–4 月期登记天数 + 有日期部分的日历天数（同一天只算一次）+ 非测试出差天数（没有日期）。
 *     4 月 19 日之前的有日期天数默认已经含在 4 月期登记数里，不重复计；只有 4 月期一天都没登记的人才照日历计。
 */

const router = Router();

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ---------- 日期工具：一律按 UTC 零点算天数，不受服务器时区影响 ----------
const DAY_MS = 86400000;
const toUtc = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
/** b − a，单位：天 */
const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
/** 含头含尾的天数 */
const spanDays = (a: string, b: string) => diffDays(a, b) + 1;
const addDays = (ymd: string, n: number) => fromUtc(toUtc(ymd) + n * DAY_MS);
const monthEnd = (ymd: string) => {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  return `${m === 12 ? y + 1 : y}-${m === 12 ? '01' : String(m + 1).padStart(2, '0')}-01`;
};
const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUtc(v));
/** 北京时间的今天（服务器容器多半是 UTC，直接取日期在后半夜会差一天） */
const todayCst = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// ---------- 表结构（和 init.sql 里的同名建表语句保持一致；这里再写一遍是为了老库没跑过新 init.sql 也能用） ----------
const TRIP_DDL = `
CREATE TABLE IF NOT EXISTS trip_segments (
    id            SERIAL PRIMARY KEY,
    year          INTEGER NOT NULL,
    member_id     INTEGER,
    member_name   TEXT    NOT NULL,
    project_name  TEXT    NOT NULL,
    position      TEXT,
    start_date    TEXT    NOT NULL,
    end_date      TEXT    NOT NULL,
    reg_days      INTEGER,
    period        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(year, member_name, project_name, start_date, end_date, period)
);
CREATE INDEX IF NOT EXISTS idx_trip_segments_year ON trip_segments(year, member_name);
CREATE TABLE IF NOT EXISTS trip_cycle_days (
    id            SERIAL PRIMARY KEY,
    year          INTEGER NOT NULL,
    member_id     INTEGER,
    member_name   TEXT    NOT NULL,
    cycle         INTEGER NOT NULL,
    reg_days      INTEGER NOT NULL DEFAULT 0,
    nontest_days  INTEGER NOT NULL DEFAULT 0,
    UNIQUE(year, member_name, cycle)
);
CREATE TABLE IF NOT EXISTS trip_meta (
    year         INTEGER PRIMARY KEY,
    as_of        TEXT,
    imported_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    excluded     TEXT NOT NULL DEFAULT '[]'
);
`;

let tablesReady: Promise<void> | null = null;
function ensureTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = db.exec(TRIP_DDL).catch((err: unknown) => {
      tablesReady = null;
      throw err;
    });
  }
  return tablesReady;
}

// ---------- 类型 ----------
interface SegRow { year: number; member_id: number | null; member_name: string; project_name: string; position: string | null; start_date: string; end_date: string; reg_days: number | null; period: number | null }
interface CycleRow { member_name: string; cycle: number; reg_days: number | string | null; nontest_days: number | string | null }
interface MemberRow { id: number | string; name: string; employee_id: string | null; title: string | null; status: string | null }

export interface TripSegment { s: string; e: string; days: number; reg: number | null; project: string; position: string | null }
export interface TripRest { s: string; e: string; days: number; prev: string; next: string; same: boolean }
export interface TripPerson {
  key: string; memberId: number | null; name: string; employeeId: string | null; title: string | null; status: string | null;
  segs: TripSegment[]; rests: TripRest[]; nBlock: number; monthly: number[]; annualDays: number;
  restDays: number; restMax: number; restMaxStart: string | null; restMaxEnd: string | null;
  firstStart: string | null; lastEnd: string | null; curRest: number;
}
export interface TripMonth { month: number; kind: 'cycle' | 'dated'; personDays: number; people: number; byProject: { project: string; days: number }[] }
export interface TripOverview {
  year: number; cut: string; today: string;
  range: { start: string; end: string } | null;
  months: TripMonth[];
  projects: { name: string; days: number; people: number }[];
  people: TripPerson[];
}

const byNameThenStart = (a: SegRow, b: SegRow) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date);

/** 纯计算：输入三类原始行，输出整份概览。单独导出是为了能脱离数据库做核对。 */
export function buildOverview(rawSegs: SegRow[], rawCycles: CycleRow[], memberRows: MemberRow[], year: number, today: string): TripOverview {
  const CUT = `${year}-04-19`;           // 1–4 月期台账只有汇总数，大约到每月 18 日；有日期的登记从 4 月 15 日起
  const CUT_PREV = addDays(CUT, -1);

  const segByName = new Map<string, SegRow[]>();
  for (const r of rawSegs) {
    const n = String(r.member_name).trim();
    if (!segByName.has(n)) segByName.set(n, []);
    segByName.get(n)!.push(r);
  }
  const cycByName = new Map<string, Map<number, CycleRow>>();
  for (const c of rawCycles) {
    const n = String(c.member_name).trim();
    if (!cycByName.has(n)) cycByName.set(n, new Map());
    cycByName.get(n)!.set(Number(c.cycle), c);
  }
  const memberByName = new Map<string, MemberRow>();
  for (const m of memberRows) memberByName.set(String(m.name).trim(), m);

  const names = Array.from(new Set([...segByName.keys(), ...cycByName.keys()])).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  const people: TripPerson[] = [];
  const monthProject: Map<string, number>[] = Array.from({ length: 12 }, () => new Map());
  let rangeStart: string | null = null;
  let rangeEnd: string | null = null;

  for (const name of names) {
    const rows = (segByName.get(name) ?? []).slice().sort(byNameThenStart);
    // 连续出差：首尾相接、次日接上或日期重叠的出差段并成一块
    const blocks: { s: string; e: string; rows: SegRow[] }[] = [];
    for (const r of rows) {
      const last = blocks[blocks.length - 1];
      if (last && diffDays(last.e, r.start_date) <= 1) {
        if (diffDays(last.e, r.end_date) > 0) last.e = r.end_date;      // 后一段结束得更晚，就延长到它的结束日
        last.rows.push(r);
      } else {
        blocks.push({ s: r.start_date, e: r.end_date, rows: [r] });
      }
      if (!rangeStart || r.start_date < rangeStart) rangeStart = r.start_date;
      if (!rangeEnd || r.end_date > rangeEnd) rangeEnd = r.end_date;
    }

    const cyc = cycByName.get(name) ?? new Map<number, CycleRow>();
    const reg = (c: number) => Number(cyc.get(c)?.reg_days ?? 0) || 0;
    const nontest = (c: number) => Number(cyc.get(c)?.nontest_days ?? 0) || 0;
    const reg4 = reg(4);

    // 每月出差人天：1–3 月用考勤期登记数；4 月 = 4 月期登记数 + 4/19 起的日历天数；5 月起 = 当月日历天数 + 当期非测试出差
    const monthly = new Array<number>(12).fill(0);
    for (let c = 1; c <= 3; c++) monthly[c - 1] = reg(c) + nontest(c);
    for (const b of blocks) {
      if (b.s < CUT) {
        const preEnd = b.e < CUT ? b.e : CUT_PREV;
        const pre = spanDays(b.s, preEnd);
        if (reg4 === 0) monthly[3] += pre;       // 4 月期一天都没登记的人，没有可含的对象，照日历计
      }
      if (b.e >= CUT) {
        let cur = b.s > CUT ? b.s : CUT;
        while (cur <= b.e) {
          const me = monthEnd(cur);
          const end = b.e < me ? b.e : addDays(me, -1);                // me 是下个月 1 号，本月只算到前一天
          monthly[Number(cur.slice(5, 7)) - 1] += spanDays(cur, end);
          cur = addDays(end, 1);
        }
      }
    }
    for (let c = 5; c <= 12; c++) monthly[c - 1] += nontest(c);
    monthly[3] += reg4;

    // 每月按项目归集的人天（同一个人同一天只算一次，归到先登记的那一段）
    const seen = new Set<string>();
    for (const r of rows) {
      let cur = r.start_date < CUT ? CUT : r.start_date;
      while (cur <= r.end_date) {
        if (!seen.has(cur)) {
          seen.add(cur);
          const mp = monthProject[Number(cur.slice(5, 7)) - 1];
          mp.set(r.project_name, (mp.get(r.project_name) ?? 0) + 1);
        }
        cur = addDays(cur, 1);
      }
    }

    // 休息：相邻两次连续出差之间
    const rests: TripRest[] = [];
    for (let i = 0; i + 1 < blocks.length; i++) {
      const a = blocks[i];
      const b = blocks[i + 1];
      const days = diffDays(a.e, b.s) - 1;
      if (days < 1) continue;
      const prevRow = a.rows.slice().sort((x, y) => y.end_date.localeCompare(x.end_date) || x.start_date.localeCompare(y.start_date))[0];
      const nextRow = b.rows.slice().sort((x, y) => x.start_date.localeCompare(y.start_date) || x.end_date.localeCompare(y.end_date))[0];
      rests.push({ s: addDays(a.e, 1), e: addDays(b.s, -1), days, prev: prevRow.project_name, next: nextRow.project_name, same: prevRow.project_name === nextRow.project_name });
    }
    const restMaxRow = rests.reduce<TripRest | null>((m, r) => (!m || r.days > m.days ? r : m), null);
    const firstStart = blocks[0]?.s ?? null;
    const lastEnd = blocks[blocks.length - 1]?.e ?? null;
    const member = memberByName.get(name);

    people.push({
      key: name, memberId: member ? Number(member.id) : null, name,
      employeeId: member?.employee_id ?? null, title: member?.title ?? null, status: member?.status ?? null,
      segs: rows.map((r) => ({ s: r.start_date, e: r.end_date, days: spanDays(r.start_date, r.end_date), reg: r.reg_days == null ? null : Number(r.reg_days), project: r.project_name, position: r.position })),
      rests, nBlock: blocks.length, monthly,
      annualDays: monthly.reduce((s, v) => s + v, 0),
      restDays: rests.reduce((s, r) => s + r.days, 0),
      restMax: restMaxRow?.days ?? 0, restMaxStart: restMaxRow?.s ?? null, restMaxEnd: restMaxRow?.e ?? null,
      firstStart, lastEnd,
      curRest: lastEnd && diffDays(lastEnd, today) > 0 ? diffDays(lastEnd, today) : 0,
    });
  }

  const months: TripMonth[] = monthProject.map((mp, i) => {
    const personDays = people.reduce((s, p) => s + (p.monthly[i] ?? 0), 0);
    return {
      month: i + 1, kind: i + 1 <= 3 ? 'cycle' : 'dated', personDays,
      people: people.filter((p) => (p.monthly[i] ?? 0) > 0).length,
      byProject: Array.from(mp, ([project, days]) => ({ project, days })).sort((a, b) => b.days - a.days),
    };
  });
  const projectTotals = new Map<string, { days: number; people: Set<string> }>();
  for (const p of people) {
    const seenProj = new Set<string>();
    for (const s of p.segs) {
      if (s.e < CUT) continue;
      const cur = projectTotals.get(s.project) ?? { days: 0, people: new Set<string>() };
      cur.days += spanDays(s.s > CUT ? s.s : CUT, s.e);
      seenProj.add(s.project);
      projectTotals.set(s.project, cur);
    }
    for (const proj of seenProj) projectTotals.get(proj)!.people.add(p.name);
  }
  const projects = Array.from(projectTotals, ([name, v]) => ({ name, days: v.days, people: v.people.size })).sort((a, b) => b.days - a.days);

  return { year, cut: CUT, today, range: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null, months, projects, people };
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * GET /api/trips/overview?year=2026
 * 整份概览：每人一段（出差段、休息、月度人天）、每月人天与项目构成、项目清单。
 */
router.get('/overview', requireAuth, asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || Number(todayCst().slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: 'year 不合法' });
    return;
  }
  await ensureTables();
  const [rawSegs, rawCycles, memberRows, meta] = await Promise.all([
    db.allAsync('SELECT year, member_id, member_name, project_name, position, start_date, end_date, reg_days, period FROM trip_segments WHERE year = ?', year),
    db.allAsync('SELECT member_name, cycle, reg_days, nontest_days FROM trip_cycle_days WHERE year = ?', year),
    db.allAsync('SELECT id, name, employee_id, title, status FROM team_members'),
    db.getAsync('SELECT as_of, imported_at, excluded FROM trip_meta WHERE year = ?', year),
  ]);
  res.json({
    success: true,
    data: buildOverview(rawSegs as unknown as SegRow[], rawCycles as unknown as CycleRow[], memberRows as unknown as MemberRow[], year, todayCst()),
    meta: meta
      ? { asOf: meta.as_of, importedAt: meta.imported_at, excluded: parseJsonArray(meta.excluded), segments: rawSegs.length, cycles: rawCycles.length }
      : null,
  });
}));

/**
 * POST /api/trips/import   （仅管理者）
 * 整年替换：body = { year, asOf, excluded: [姓名…], segments: [{name, project, position?, start, end, regDays?, period?}],
 *                    cycles: [{name, cycle, regDays, nontestDays?}] }
 * 全部校验通过后在一个事务里替换，任何一步失败都回滚，不留半截数据。
 */
router.post('/import', requireAuth, requireRole(['管理者']), asyncHandler(async (req, res) => {
  const { year, asOf, segments, cycles, excluded } = req.body ?? {};
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) {
    res.status(400).json({ error: 'year 必填，如 2026' });
    return;
  }
  if (!Array.isArray(segments) || !Array.isArray(cycles)) {
    res.status(400).json({ error: 'segments 和 cycles 必须是数组' });
    return;
  }
  const members = await db.allAsync('SELECT id, name FROM team_members');
  const idByName = new Map(members.map((m) => [String(m.name).trim(), m.id == null ? null : Number(m.id)]));

  const seen = new Set<string>();
  const segRows: unknown[][] = [];
  for (const [i, s] of segments.entries()) {
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    const project = typeof s?.project === 'string' ? s.project.trim() : '';
    if (!name || !project || !isYmd(s?.start) || !isYmd(s?.end)) {
      res.status(400).json({ error: `segments[${i}] 缺少姓名、项目或起止日期（应为 YYYY-MM-DD）` });
      return;
    }
    if (diffDays(s.start, s.end) < 0) {
      res.status(400).json({ error: `segments[${i}] 结束日期早于开始日期：${name} ${s.start}~${s.end}` });
      return;
    }
    const period = Number(s.period);
    const key = [name, project, s.start, s.end, Number.isInteger(period) && period > 0 ? period : 0].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    segRows.push([y, idByName.get(name) ?? null, name, project, s.position ? String(s.position).slice(0, 50) : null, s.start, s.end,
      Number.isFinite(Number(s.regDays)) ? Math.round(Number(s.regDays)) : null, Number.isInteger(period) && period > 0 ? period : 0]);
  }
  seen.clear();
  const cycRows: unknown[][] = [];
  for (const [i, c] of cycles.entries()) {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    const cycle = Number(c?.cycle);
    const regDays = Number(c?.regDays ?? 0);
    const nontestDays = Number(c?.nontestDays ?? 0);
    if (!name || !Number.isInteger(cycle) || cycle < 1 || cycle > 12 || !Number.isFinite(regDays) || regDays < 0 || !Number.isFinite(nontestDays) || nontestDays < 0) {
      res.status(400).json({ error: `cycles[${i}] 不合法：需要姓名、1–12 的考勤期、非负的天数` });
      return;
    }
    const key = `${name}|${cycle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cycRows.push([y, idByName.get(name) ?? null, name, cycle, Math.round(regDays), Math.round(nontestDays)]);
  }
  const excludedList = Array.isArray(excluded) ? excluded.slice(0, 500).map(String) : [];

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM trip_segments WHERE year = $1', [y]);
    await client.query('DELETE FROM trip_cycle_days WHERE year = $1', [y]);
    for (const r of segRows) {
      await client.query(
        'INSERT INTO trip_segments (year, member_id, member_name, project_name, position, start_date, end_date, reg_days, period) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',
        r);
    }
    for (const r of cycRows) {
      await client.query(
        'INSERT INTO trip_cycle_days (year, member_id, member_name, cycle, reg_days, nontest_days) VALUES ($1,$2,$3,$4,$5,$6) '
        + 'ON CONFLICT (year, member_name, cycle) DO UPDATE SET member_id = EXCLUDED.member_id, reg_days = EXCLUDED.reg_days, nontest_days = EXCLUDED.nontest_days',
        r);
    }
    await client.query(
      'INSERT INTO trip_meta (year, as_of, imported_at, excluded) VALUES ($1,$2,NOW(),$3) '
      + 'ON CONFLICT (year) DO UPDATE SET as_of = EXCLUDED.as_of, imported_at = NOW(), excluded = EXCLUDED.excluded',
      [y, isYmd(asOf) ? asOf : null, JSON.stringify(excludedList)]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const names = new Set<string>([...segRows.map((r) => String(r[2])), ...cycRows.map((r) => String(r[2]))]);
  res.json({
    success: true,
    data: {
      year: y, segments: segRows.length, cycles: cycRows.length, people: names.size,
      unmatched: Array.from(names).filter((n) => !idByName.has(n)),
    },
  });
}));

export default router;
