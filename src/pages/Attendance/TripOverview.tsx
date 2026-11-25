import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Alert, Button, Empty, Input, Segmented, Select, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { tripsApi, type TripOverviewData, type TripOverviewMeta, type TripPerson } from '../../api';

// ============================================================
// 人员考勤 · 出差概览
// 数据来自值班补贴台账（出差登记），由台账解析管线导入，平台只读；统计算法和台账 Excel 是同一套。
// ============================================================

const DAY_MS = 86400000;
const LABEL_W = 176;     // 甘特图左侧姓名列宽
const ROW_H = 26;
const HEAD_H = 46;
const toUtc = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => fromUtc(toUtc(ymd) + n * DAY_MS);
/** b − a，单位：天（按 UTC 零点算，不受时区影响） */
const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const ymOf = (ymd: string) => ymd.slice(0, 7);
/** 某个月（YYYY-MM）的最后一天 */
const monthEnd = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return addDays(`${m === 12 ? y + 1 : y}-${m === 12 ? '01' : String(m + 1).padStart(2, '0')}-01`, -1);
};

const CARD = { background: '#fff', border: '1px solid #e9e7f4', borderRadius: 12, padding: 14 };
const CARD_HEAD: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 };
const NUM: CSSProperties = { fontVariantNumeric: 'tabular-nums' };
const REST_BG = 'rgba(217,119,6,0.16)';
const CUR_BG = 'rgba(217,119,6,0.07)';

interface Tip { x: number; y: number; title: string; lines: string[] }

function TripOverview() {
  const [data, setData] = useState<TripOverviewData | null>(null);
  const [meta, setMeta] = useState<TripOverviewMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');                                   // 姓名搜索
  const [proj, setProj] = useState<string[]>([]);                   // 项目筛选：选中的项目正常显示，其他段变淡
  const [win, setWin] = useState<{ s: string; e: string; label: string } | null>(null);   // 甘特图只看的时间段；null = 全部
  const [zoom, setZoom] = useState(0);                              // 每天几个像素；0 = 适应宽度
  const [sort, setSort] = useState<'days' | 'rest' | 'name'>('days');
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(1200);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await tripsApi.overview();
      setData(r.data ?? null);
      setMeta(r.meta ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // 量一下甘特图容器的宽度（“适应宽度”要用）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, [data]);

  // 项目配色：按投入人天从多到少，用黄金角把色相错开，顺序稳定、彼此分得开
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    (data?.projects ?? []).forEach((p, i) => m.set(p.name, `hsl(${Math.round((i * 137.508 + 205) % 360)},62%,50%)`));
    return m;
  }, [data]);

  const today = data?.today ?? dayjs().format('YYYY-MM-DD');
  const kw = q.trim();
  const people = useMemo(() => {
    if (!data) return [];
    return data.people
      .filter((p) => !kw || p.name.includes(kw))
      .sort((a, b) => (sort === 'days' ? b.annualDays - a.annualDays : sort === 'rest' ? b.curRest - a.curRest : a.name.localeCompare(b.name, 'zh-Hans-CN')));
  }, [data, kw, sort]);

  // 甘特图的时间窗和每天像素
  const range = data?.range ?? null;
  const winStart = win?.s ?? range?.start ?? today;
  const winEnd = win?.e ?? range?.end ?? today;
  const days = useMemo(() => {
    const out: string[] = [];
    for (let c = winStart; c <= winEnd && out.length < 800; c = addDays(c, 1)) out.push(c);
    return out;
  }, [winStart, winEnd]);
  const dayW = zoom > 0 ? zoom : Math.max(3, Math.floor((wrapW - LABEL_W - 2) / Math.max(1, days.length)));
  const trackW = days.length * dayW;
  const monthCells = useMemo(() => {
    const out: { ym: string; n: number }[] = [];
    for (const d of days) {
      const last = out[out.length - 1];
      if (last && last.ym === ymOf(d)) last.n += 1;
      else out.push({ ym: ymOf(d), n: 1 });
    }
    return out;
  }, [days]);
  const weekendIdx = useMemo(() => days.map((d, i) => ([0, 6].includes(dayjs(d).day()) ? i : -1)).filter((i) => i >= 0), [days]);
  const todayIdx = today >= winStart && today <= winEnd ? diffDays(winStart, today) : -1;

  const curMonth = Number(today.slice(5, 7));
  const thisMonth = data?.months.find((m) => m.month === curMonth);
  const kpis = data ? [
    { label: '统计人数', value: `${data.people.length} 人`, color: '#6366f1' },
    { label: `${data.year} 年出差人天`, value: data.people.reduce((s, p) => s + p.annualDays, 0).toLocaleString(), color: '#1e1b2e' },
    { label: `本月（${curMonth} 月）出差人天`, value: (thisMonth?.personDays ?? 0).toLocaleString(), color: '#16a34a' },
    { label: '当前在出差', value: `${data.people.filter((p) => p.lastEnd && p.lastEnd >= today).length} 人`, color: '#0891b2' },
    { label: '当前已休息 ≥ 30 天', value: `${data.people.filter((p) => p.curRest >= 30).length} 人`, color: '#d97706' },
  ] : [];

  // 每月人力投入
  const months = (data?.months ?? []).filter((m) => m.personDays > 0);
  const maxPd = Math.max(1, ...months.map((m) => m.personDays));
  const pickMonth = (m: number) => {
    const ym = `${data!.year}-${String(m).padStart(2, '0')}`;
    setWin(win?.label === `${m}月` ? null : { s: `${ym}-01`, e: monthEnd(ym), label: `${m}月` });
  };

  const restColumns: ColumnsType<TripPerson['rests'][number]> = [
    { title: '休息期间', key: 'range', width: 200, render: (_, r) => <span style={NUM}>{r.s} ~ {r.e}</span> },
    { title: '天数', dataIndex: 'days', key: 'days', width: 80, align: 'right', render: (v: number) => <span style={{ ...NUM, fontWeight: 600, color: v >= 15 ? '#d97706' : '#1e1b2e' }}>{v}</span> },
    { title: '上一次出差', dataIndex: 'prev', key: 'prev' },
    { title: '下一次出差', dataIndex: 'next', key: 'next' },
  ];
  const columns: ColumnsType<TripPerson> = [
    { title: '姓名', dataIndex: 'name', key: 'name', width: 150,
      render: (v: string, r) => (<div><div style={{ fontWeight: 600, color: '#1e1b2e' }}>{v}</div>{r.title && <div style={{ fontSize: 11, color: '#8a87a3' }}>{r.title}</div>}</div>) },
    { title: '年度出差(天)', dataIndex: 'annualDays', key: 'annualDays', align: 'right', sorter: (a, b) => a.annualDays - b.annualDays, defaultSortOrder: 'descend', render: (v: number) => <span style={{ ...NUM, fontWeight: 600 }}>{v}</span> },
    { title: '连续出差', key: 'nBlock', align: 'right', sorter: (a, b) => a.nBlock - b.nBlock, render: (_, r) => <span style={NUM}>{r.nBlock} 次</span> },
    { title: '休息次数', key: 'nRest', align: 'right', sorter: (a, b) => a.rests.length - b.rests.length, render: (_, r) => <span style={NUM}>{r.rests.length}</span> },
    { title: '休息总天数', dataIndex: 'restDays', key: 'restDays', align: 'right', sorter: (a, b) => a.restDays - b.restDays, render: (v: number) => <span style={{ ...NUM, fontWeight: 600 }}>{v}</span> },
    { title: '最长一次休息', key: 'restMax', sorter: (a, b) => a.restMax - b.restMax,
      render: (_, r) => (r.restMax > 0 ? <span style={NUM}>{r.restMax} 天<span style={{ color: '#8a87a3' }}>（{md(r.restMaxStart!)}~{md(r.restMaxEnd!)}）</span></span> : <span style={{ color: '#c4c1d6' }}>—</span>) },
    { title: '当前已休息', key: 'curRest', align: 'right', sorter: (a, b) => a.curRest - b.curRest,
      render: (_, r) => (r.lastEnd && r.lastEnd >= today
        ? <Tag color="blue" style={{ margin: 0 }}>出差中</Tag>
        : <span style={{ ...NUM, fontWeight: r.curRest >= 30 ? 700 : 400, color: r.curRest >= 30 ? '#d97706' : '#1e1b2e' }}>{r.curRest} 天</span>) },
    { title: '有日期的出差范围', key: 'span', render: (_, r) => <span style={{ ...NUM, color: '#6b6892', whiteSpace: 'nowrap' }}>{r.firstStart ? `${r.firstStart} ~ ${r.lastEnd}` : '—'}</span> },
  ];

  if (error && !data) {
    return <Alert type="error" showIcon message="出差概览加载失败" description={error} action={<Button size="small" onClick={load}>重试</Button>} />;
  }
  if (!data) return null;
  if (data.people.length === 0) {
    return <Empty description={<span>还没有导入出差登记数据。<br />台账解析完成后，由管理者通过导入接口写入。</span>} />;
  }

  const importedAt = meta?.importedAt ? dayjs(meta.importedAt).format('YYYY-MM-DD HH:mm') : '—';
  const topProjects = data.projects.slice(0, 14);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message={`数据来自值班补贴台账：登记至 ${range?.end ?? '—'}，导入于 ${importedAt}`}
        description={
          <span style={{ fontSize: 12 }}>
            1–4 月期的台账只有汇总天数、没有日期，所以甘特图从 {range?.start ?? '—'} 开始；每月人力投入里 1–3 月用的是考勤期登记数。
            休息天数是相邻两次连续出差之间的日历天数（含周末）；“当前已休息”算到今天（{today}，含当天）。
            {meta?.excluded?.length ? ` 已按要求剔除：${meta.excluded.join('、')}。` : ''}
          </span>
        }
      />

      {/* 指标卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        {kpis.map((c) => (
          <div key={c.label} style={{ background: '#f8f7fd', border: '1px solid #e9e7f4', borderRadius: 12, padding: '14px 18px' }}>
            <div style={{ color: '#6b6892', fontSize: 12, marginBottom: 6 }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: 24, fontWeight: 500, ...NUM }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* 每月人力投入 */}
      <section style={CARD}>
        <div style={CARD_HEAD}>
          <span style={{ fontWeight: 600, color: '#1e1b2e' }}>每月人力投入</span>
          <span style={{ color: '#8a87a3', fontSize: 12 }}>按项目着色；点某个月，下面的甘特图只看那个月</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 10, fontSize: 12, color: '#46436a' }}>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#c7c3e6', marginRight: 4 }} />登记数（无项目明细）</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, overflowX: 'auto', padding: '4px 2px 0' }}>
          {months.map((m) => {
            const on = win?.label === `${m.month}月`;
            const detail = m.byProject.reduce((s, x) => s + x.days, 0);
            const restDays = Math.max(0, m.personDays - detail);
            return (
              <div
                key={m.month}
                data-tm-col={m.month}
                onClick={() => pickMonth(m.month)}
                onMouseMove={(e) => setTip({
                  x: e.clientX, y: e.clientY, title: `${data.year} 年 ${m.month} 月${m.kind === 'cycle' ? '期' : ''}`,
                  lines: [`出差 ${m.personDays} 人天 · ${m.people} 人`,
                    m.kind === 'cycle' ? '台账只有汇总天数，没有日期和项目明细' : m.byProject.slice(0, 4).map((x) => `${x.project}：${x.days} 人天`).join('；')],
                })}
                onMouseLeave={() => setTip(null)}
                style={{ flex: '1 1 0', minWidth: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', borderRadius: 8, padding: '4px 2px',
                  background: on ? '#eef2ff' : 'transparent', outline: on ? '1px solid #c7d2fe' : 'none' }}
              >
                <div style={{ fontSize: 12, color: '#46436a', marginBottom: 4, ...NUM }}>{m.personDays}</div>
                <div style={{ width: 56, height: Math.max(6, Math.round(140 * m.personDays / maxPd)), display: 'flex', flexDirection: 'column-reverse', borderRadius: '6px 6px 2px 2px', overflow: 'hidden', background: '#f6f5fc' }}>
                  {m.kind === 'cycle' ? (
                    <i style={{ height: '100%', background: '#c7c3e6' }} />
                  ) : (
                    <>
                      {m.byProject.map((x) => <i key={x.project} style={{ height: `${(x.days / m.personDays) * 100}%`, background: colors.get(x.project) }} />)}
                      {restDays > 0 && <i style={{ height: `${(restDays / m.personDays) * 100}%`, background: '#c7c3e6' }} />}
                    </>
                  )}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e1b2e', marginTop: 6 }}>{m.month} 月{m.kind === 'cycle' ? '期' : ''}</div>
                <div style={{ fontSize: 11.5, color: '#8a87a3' }}>{m.people} 人</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 出差甘特图 */}
      <section style={CARD}>
        <div style={CARD_HEAD}>
          <span style={{ fontWeight: 600, color: '#1e1b2e' }}>出差甘特图</span>
          <span style={{ color: '#8a87a3', fontSize: 12 }}>色条是出差段，按项目着色；浅橙色是休息；红线是今天</span>
          <Space wrap size={8} style={{ marginLeft: 'auto' }}>
            <Input allowClear prefix={<SearchOutlined style={{ color: '#a3a0b8' }} />} placeholder="搜索姓名" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 150 }} />
            <Select
              mode="multiple" allowClear maxTagCount="responsive" placeholder="按项目看" value={proj} onChange={setProj}
              options={data.projects.map((p) => ({ value: p.name, label: `${p.name}（${p.days} 人天）` }))} style={{ minWidth: 230, maxWidth: 420 }}
            />
            <Segmented value={zoom} onChange={(v) => setZoom(Number(v))} options={[{ label: '适应宽度', value: 0 }, { label: '放大', value: 8 }, { label: '再放大', value: 14 }]} />
            <Select value={sort} onChange={setSort} style={{ width: 150 }}
              options={[{ value: 'days', label: '按年度出差天数' }, { value: 'rest', label: '按当前已休息' }, { value: 'name', label: '按姓名' }]} />
            {win && <Tag closable onClose={() => setWin(null)}>只看 {win.label}</Tag>}
          </Space>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: '#46436a', marginBottom: 8 }}>
          {topProjects.map((p) => (
            <span key={p.name}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: colors.get(p.name), marginRight: 4 }} />{p.name}</span>
          ))}
          {data.projects.length > topProjects.length && <Tooltip title={data.projects.slice(topProjects.length).map((p) => `${p.name}（${p.days}）`).join('、')}>
            <span style={{ color: '#8a87a3', cursor: 'help' }}>其他 {data.projects.length - topProjects.length} 个项目…</span></Tooltip>}
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: REST_BG, border: '1px solid rgba(217,119,6,0.3)', marginRight: 4 }} />休息</span>
          <span><i style={{ display: 'inline-block', width: 0, height: 12, borderLeft: '2px solid #dc2626', marginRight: 4 }} />今天</span>
        </div>
        <div
          ref={wrapRef}
          onMouseLeave={() => { setHoverName(null); setTip(null); }}
          style={{ overflow: 'auto', maxHeight: 640, border: '1px solid #e9e7f4', borderRadius: 8, position: 'relative', background: '#fff' }}
        >
          <div style={{ width: LABEL_W + trackW, position: 'relative' }}>
            {/* 表头：月份 + 当月人天；左上角“人员”在横竖滚动时都固定 */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 5, height: HEAD_H, background: '#faf9fe', borderBottom: '1px solid #e9e6f5' }}>
              <div style={{ width: LABEL_W, flex: 'none', position: 'sticky', left: 0, zIndex: 6, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, color: '#6b6892', background: '#faf9fe', borderRight: '1px solid #e9e6f5' }}>
                人员（{people.length}）
              </div>
              {monthCells.map((c) => {
                const m = data.months[Number(c.ym.slice(5, 7)) - 1];
                return (
                  <div key={c.ym} style={{ width: c.n * dayW, flex: 'none', height: HEAD_H, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', borderRight: '1px solid #e9e6f5', overflow: 'hidden' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e1b2e', lineHeight: 1.2 }}>{Number(c.ym.slice(5, 7))} 月</div>
                    {dayW * c.n >= 44 && <div style={{ fontSize: 11, color: '#8a87a3', lineHeight: 1.3, whiteSpace: 'nowrap' }}>{m?.personDays ?? 0} 人天</div>}
                  </div>
                );
              })}
            </div>
            {people.map((p, idx) => {
              const dim = hoverName !== null && hoverName !== p.key;
              const on = hoverName === p.key;
              // 画一条：超出时间窗的部分裁掉，所以条不会溢出到姓名列里
              const bar = (s0: string, e0: string, bg: string, t: Tip['title'], lines: string[], dashed = false, faded = false) => {
                const s = s0 < winStart ? winStart : s0;
                const e = e0 > winEnd ? winEnd : e0;
                if (s > e) return null;
                const n = diffDays(s, e) + 1;
                return (
                  <i
                    key={`${p.key}-${s0}-${e0}-${t}`}
                    data-tg-bar={dashed ? 'cur' : bg === REST_BG ? 'rest' : 'trip'}
                    onMouseMove={(ev) => setTip({ x: ev.clientX, y: ev.clientY, title: t, lines })}
                    onMouseLeave={() => setTip(null)}
                    style={{
                      position: 'absolute', left: diffDays(winStart, s) * dayW, top: 6, height: 14, width: Math.max(1.5, n * dayW - (dayW >= 5 ? 1 : 0)),
                      borderRadius: 3, background: bg, zIndex: 1, boxSizing: 'border-box',
                      opacity: dim ? 0.22 : faded ? 0.18 : 1,
                      outline: dashed ? '1px dashed rgba(217,119,6,0.7)' : 'none', outlineOffset: -1,
                    }}
                  />
                );
              };
              return (
                <div key={p.key} data-tg-row={p.key} style={{ display: 'flex', height: ROW_H }} onMouseEnter={() => setHoverName(p.key)}>
                  <div style={{ width: LABEL_W, flex: 'none', position: 'sticky', left: 0, zIndex: 3, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px 0 12px',
                    borderRight: '1px solid #e9e6f5', background: on ? '#f3f1fd' : idx % 2 ? '#fcfbfe' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1e1b2e' }}>{p.name}</span>
                    {p.title && <span style={{ fontSize: 11, color: '#8a87a3', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</span>}
                  </div>
                  <div style={{ width: trackW, flex: 'none', position: 'relative' }}>
                    {dayW >= 5 && weekendIdx.map((i) => <i key={`we${i}`} style={{ position: 'absolute', left: i * dayW, top: 0, bottom: 0, width: dayW, background: 'rgba(107,104,146,0.055)' }} />)}
                    {todayIdx >= 0 && <i style={{ position: 'absolute', left: todayIdx * dayW, top: 0, bottom: 0, width: 0, borderLeft: '2px solid #dc2626', zIndex: 2 }} />}
                    {p.rests.map((r) => bar(r.s, r.e, REST_BG, `${p.name} · 休息 ${r.days} 天`, [`${r.s} ~ ${r.e}`, `${r.prev} → ${r.next}`]))}
                    {p.curRest > 0 && p.lastEnd && bar(addDays(p.lastEnd, 1), today, CUR_BG, `${p.name} · 当前已休息 ${p.curRest} 天`,
                      [`${addDays(p.lastEnd, 1)} ~ ${today}（含今天，之后的出差还没登记）`], true)}
                    {p.segs.map((s) => bar(s.s, s.e, colors.get(s.project) ?? '#9d9ab8', `${p.name} · ${s.project}`,
                      [`${s.s} ~ ${s.e}（${s.days} 天）`, s.position ? `岗位：${s.position}` : '', s.reg != null && s.reg !== s.days ? `原表登记 ${s.reg} 天` : ''].filter(Boolean),
                      false, proj.length > 0 && !proj.includes(s.project)))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {people.length === 0 && <div style={{ textAlign: 'center', color: '#8a87a3', padding: 24, fontSize: 12 }}>没有姓名匹配“{kw}”的人员</div>}
      </section>

      {/* 每人的出差与休息统计 */}
      <section style={{ ...CARD, padding: 0 }}>
        <div style={{ ...CARD_HEAD, padding: '14px 14px 0', marginBottom: 4 }}>
          <span style={{ fontWeight: 600, color: '#1e1b2e' }}>每人出差与休息</span>
          <span style={{ color: '#8a87a3', fontSize: 12 }}>点行首的箭头展开每一次休息</span>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load} style={{ marginLeft: 'auto' }}>刷新</Button>
        </div>
        <Table<TripPerson>
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={people}
          pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: [15, 30, 69], showTotal: (t) => `共 ${t} 人` }}
          expandable={{
            rowExpandable: (r) => r.rests.length > 0,
            expandedRowRender: (r) => (
              <Table size="small" rowKey={(x) => `${x.s}${x.e}`} columns={restColumns} dataSource={r.rests} pagination={false}
                style={{ background: '#faf9fe', borderRadius: 8 }} />
            ),
          }}
          summary={() => (
            <Table.Summary>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><span style={{ fontWeight: 600, color: '#6366f1' }}>合计（{data.people.length} 人）</span></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><span style={{ fontWeight: 600, color: '#6366f1', ...NUM }}>{data.people.reduce((s, p) => s + p.annualDays, 0).toLocaleString()}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right"><span style={{ color: '#6366f1', ...NUM }}>{data.people.reduce((s, p) => s + p.nBlock, 0)} 次</span></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right"><span style={{ color: '#6366f1', ...NUM }}>{data.people.reduce((s, p) => s + p.rests.length, 0)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="right"><span style={{ fontWeight: 600, color: '#6366f1', ...NUM }}>{data.people.reduce((s, p) => s + p.restDays, 0).toLocaleString()}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={5} /><Table.Summary.Cell index={6} /><Table.Summary.Cell index={7} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      </section>

      {tip && (
        <div style={{ position: 'fixed', left: Math.min(tip.x + 14, window.innerWidth - 300), top: tip.y + 14, zIndex: 2000, pointerEvents: 'none',
          background: '#1e1b2e', color: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: 12, lineHeight: 1.6, maxWidth: 280, boxShadow: '0 8px 24px -8px rgba(30,27,46,.5)' }}>
          <b style={{ display: 'block', fontSize: 12.5 }}>{tip.title}</b>
          {tip.lines.map((l, i) => <div key={i} style={{ color: '#d6d2e4' }}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

export default TripOverview;
