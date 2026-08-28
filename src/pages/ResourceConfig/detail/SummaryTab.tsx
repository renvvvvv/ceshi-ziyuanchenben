/**
 * 汇总报告 Tab（只读，canEdit 不影响展示）
 *
 * 1:1 复刻原工具 renderSummary（原 index.html L4331-4472）：
 * 资源库覆盖总览（L4342-4372）→ 项目信息 → 测试人员 → 岗位补贴（staffDaysByRole 联动）
 * → 假负载到场计划（自有/租赁分配）→ 仪器仪表配置 → 现场耗材 → 劳务人员使用天数。
 * 原工具为大 table 拼接，平台用区块卡片 + 小表格呈现，数据与分区一致。
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  calcLabor, calcLoadAllocation, calcInstrumentAllocation, calcLoadDays, parseDayRef,
  subsidyPostToRole, deriveRole,
  type ResourceConfigProject, type AssetLibItem, type LoadRow, type InstrumentRow,
  type PersonnelRow, type LaborRow,
} from '../../../types/resourceConfig';

export interface TabProps {
  data: ResourceConfigProject;
  assets: AssetLibItem[];
  canEdit: boolean;
  patch: (updates: Partial<ResourceConfigProject>) => void;
}

/** 原工具 num()：容错数值解析 */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? 0 : n;
};
/** 保留 1 位小数并去掉末尾 .0（原 fmtDays） */
const fmtDays = (v: number): string => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '');
/** 原工具 nowStr()：刷新时间戳（每次重算更新） */
const nowStr = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${p(d.getMinutes())}`;
};
/** 投入明细单人总人天 = total（缺失时回退 踏勘+复测+测试，原 staffTotal 口径） */
const staffTotalOf = (r: { total?: number; survey?: number; retest?: number; test?: number }): number =>
  num(r.total) || num(r.survey) + num(r.retest) + num(r.test);
/** 某角色所有人员的总投入天数之和（原 staffDaysByRole L2563-2568） */
const staffDaysByRole = (
  staff: Array<{ role?: string; post: string; total?: number; survey?: number; retest?: number; test?: number }>,
  role: string,
): number => {
  if (!role) return 0;
  const want = role.trim();
  return staff
    .filter((s) => (s.role || deriveRole(s.post)) === want)
    .reduce((sum, s) => sum + staffTotalOf(s), 0);
};

const BLUE = '#7cb8ff';
const GREEN = '#52c41a';
const WARN = '#faad14';

/** 区块卡片容器（CONVENTIONS 统一样式） */
function Section({ title, tag, extra, children }: { title: string; tag?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{title}</span>
        {tag && <Tag style={{ margin: 0 }}>{tag}</Tag>}
        <div style={{ flex: 1 }} />
        {extra && <span style={{ color: BLUE, fontWeight: 600, fontSize: 13 }}>{extra}</span>}
      </div>
      {children}
    </div>
  );
}

/** 键值项（原 kv()） */
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ flex: '1 1 170px', minWidth: 150 }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 2 }}>{k}</div>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)', wordBreak: 'break-all' }}>{v || '—'}</div>
    </div>
  );
}

/** 区块内小统计条 */
function MiniStats({ items }: { items: Array<{ label: string; value: string | number; color?: string }> }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {items.map((it, i) => (
        <div key={i} style={{ background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 8, padding: '4px 12px', fontSize: 12 }}>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>{it.label}</span>
          <b style={{ color: it.color || BLUE, fontSize: 14, marginLeft: 6 }}>{it.value}</b>
        </div>
      ))}
    </div>
  );
}

/** 页脚说明行 */
function Note({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return (
    <div style={{ marginTop: 6, fontSize: 12.5, color: warn ? WARN : 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
      {children}
    </div>
  );
}

// ============== 汇总表格的行视图类型 ==============

interface LoadView {
  id: string; typeDisp: string; count: number; ratio: number;
  own: number | null; rent: number | null; spec: string;
  arrive: number; start: number; end: number; leave: number; days: number;
}
interface InsView {
  id: string; name: string; demand: number; own: number; rent: number; days: number; remark: string;
}

export default function SummaryTab({ data: p, assets }: TabProps) {
  const S = useMemo(() => {
    // ---------- b) 人员合计 ----------
    const personnelRows = (p.personnel || []).filter((r) => r.post);
    const cntOf = (r: PersonnelRow) => num(r.count) || num(r.lead) + num(r.member);
    const planTotal = personnelRows.reduce((s, r) => s + cntOf(r), 0);
    const staffList = p.staff || [];
    const staffDaysTotal = staffList.reduce((s, r) => s + staffTotalOf(r), 0);

    // ---------- c) 岗位补贴 ----------
    const subsidyRows = (p.subsidy || []).filter((r) => r.post);
    const subsidyTotal = subsidyRows.reduce((s, r) => s + num(r.count), 0);

    // ---------- d) 假负载（自有优先分配，含备用台数） ----------
    const loads: LoadRow[] = p.loads || [];
    const loadAlloc = calcLoadAllocation(loads, assets);
    let loadOwn = 0, loadRent = 0, loadRentDays = 0;
    loads.forEach((r) => {
      const a = loadAlloc[r.id] || { own: 0, rent: 0 };
      loadOwn += a.own;
      loadRent += a.rent;
      loadRentDays += a.rent * calcLoadDays(r);
    });
    const totalLoads = loadOwn + loadRent;
    const loadViews: LoadView[] = loads
      .filter((r) => r.type)
      .map((r) => {
        const isWater = String(r.type).includes('去离子');
        const a = isWater ? { own: 0, rent: 0 } : (loadAlloc[r.id] || { own: 0, rent: 0 });
        return {
          id: r.id,
          typeDisp: r.type === '__RENT__' || r.type === '🛒 租赁' ? '租赁' : String(r.type),
          count: num(r.count), ratio: num(r.ratio),
          own: isWater ? null : a.own, rent: isWater ? null : a.rent,
          spec: r.spec || '',
          arrive: parseDayRef(r.arrive), start: parseDayRef(r.start),
          end: parseDayRef(r.end), leave: parseDayRef(r.leave),
          days: calcLoadDays(r),
        };
      });

    // ---------- e) 仪器仪表（名称可见行，索引对齐避免自有/租赁错位） ----------
    const visIns: InstrumentRow[] = (p.instruments || []).filter((r) => !r.hidden && r.name);
    const insAlloc = calcInstrumentAllocation(visIns, assets);
    const stockByName = new Map<string, number>();
    assets.filter((a) => a.cat === 'ins' && a.name).forEach((a) => {
      stockByName.set(a.name, (stockByName.get(a.name) || 0) + num(a.count));
    });
    const insViews: InsView[] = visIns.map((r) => {
      const a = insAlloc[r.id] || { own: 0, rent: 0 };
      return { id: r.id, name: r.name, demand: num(r.demand), own: a.own, rent: a.rent, days: num(r.days), remark: r.remark || '' };
    });
    const insReqT = insViews.reduce((s, r) => s + r.demand, 0);
    const insOwnT = insViews.reduce((s, r) => s + r.own, 0);
    const insRentT = insViews.reduce((s, r) => s + r.rent, 0);
    const insDaysT = insViews.reduce((s, r) => s + r.days, 0);
    const insRentDays = insViews.reduce((s, r) => s + r.rent * r.days, 0);
    const insMatched = visIns.reduce((s, r) => s + (stockByName.get(r.name) || 0), 0);

    // ---------- f) 劳务 ----------
    const laborRows: LaborRow[] = p.labor || [];
    const laborCalcs = laborRows.map((r) => calcLabor(r));
    const laborDays = laborCalcs.reduce((s, c) => s + c.manDays, 0);
    const laborWorkers = laborCalcs.reduce((s, c) => s + c.workers, 0);

    // ---------- g) 耗材 ----------
    const consRows = (p.consumables || []).filter((r) => r.name);

    // ---------- h) 资源库覆盖总览（原 L4342-4372） ----------
    let lFull = 0, lPart = 0, lOwnT = 0, lRentT = 0;
    loads.forEach((r) => {
      if (String(r.type).includes('去离子') || num(r.count) <= 0) return;
      const a = loadAlloc[r.id] || { own: 0, rent: 0 };
      if (a.own > 0 && a.rent <= 0) lFull++;
      else if (a.own > 0) { lPart++; lRentT += a.rent; }
      else lRentT += a.rent;
      lOwnT += a.own;
    });
    let iFull = 0, iPart = 0, iNeed = 0;
    visIns.forEach((r) => {
      const d = num(r.demand);
      if (d <= 0) return;
      const lib = stockByName.get(r.name) || 0;
      if (lib >= d) iFull++;
      else if (lib > 0) { iPart++; iNeed += d - lib; }
      else iNeed += d;
    });
    const needAll = lRentT + iNeed;
    const allCovered = needAll <= 0;
    const showCoverage = lFull + lPart > 0 || iFull + iPart > 0;

    return {
      personnelRows, cntOf, planTotal, staffDaysTotal,
      subsidyRows, subsidyTotal,
      loadViews, loadOwn, loadRent, loadRentDays, totalLoads,
      insViews, insReqT, insOwnT, insRentT, insDaysT, insRentDays, insMatched,
      laborRows, laborCalcs, laborDays, laborWorkers,
      consRows,
      lFull, lPart, lOwnT, lRentT, iFull, iPart, iNeed, needAll, allCovered, showCoverage,
      staffList,
    };
  }, [p, assets]);

  // ============== 各区块小表格列定义 ==============

  const personnelCols: ColumnsType<PersonnelRow> = [
    { title: '岗位', dataIndex: 'post', width: 120, render: (t: string) => <b style={{ color: 'rgba(255,255,255,0.85)' }}>{t}</b> },
    { title: '数量', key: 'count', width: 70, align: 'center', render: (_: unknown, r: PersonnelRow) => <b style={{ color: BLUE }}>{S.cntOf(r)}</b> },
    { title: '人员分工', dataIndex: 'division', render: (t: string) => <span style={{ whiteSpace: 'pre-line', fontSize: 12.5 }}>{t || ''}</span> },
    { title: '人员姓名', dataIndex: 'names', render: (t: string) => <span style={{ whiteSpace: 'pre-line', fontSize: 12.5 }}>{t || ''}</span> },
  ];

  const subsidyCols: ColumnsType<{ id: string; post: string; count: number; remark: string }> = [
    { title: '测试岗位', dataIndex: 'post', width: 130 },
    { title: '人数', dataIndex: 'count', width: 80, align: 'center' },
    {
      title: '投入明细天数', key: 'days', width: 110, align: 'center',
      render: (_: unknown, r: { post: string }) => (
        <b style={{ color: BLUE }}>{staffDaysByRole(S.staffList, subsidyPostToRole(r.post))}</b>
      ),
    },
    { title: '备注', dataIndex: 'remark' },
  ];

  const loadCols: ColumnsType<LoadView> = [
    { title: '类型', dataIndex: 'typeDisp', width: 110 },
    { title: '数量', dataIndex: 'count', width: 60, align: 'center' },
    { title: '自有', key: 'own', width: 60, align: 'center', render: (_: unknown, r: LoadView) => r.own == null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span> : <b style={{ color: GREEN }}>{r.own}</b> },
    { title: '需租赁', key: 'rent', width: 70, align: 'center', render: (_: unknown, r: LoadView) => r.rent == null ? <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span> : <b style={{ color: WARN }}>{r.rent}</b> },
    { title: '备用台数', dataIndex: 'ratio', width: 70, align: 'center' },
    { title: '规格', dataIndex: 'spec', width: 150, render: (t: string) => <span style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{t}</span> },
    { title: '到场(第X天)', dataIndex: 'arrive', width: 85, align: 'center' },
    { title: '开始(第X天)', dataIndex: 'start', width: 85, align: 'center' },
    { title: '结束(第X天)', dataIndex: 'end', width: 85, align: 'center' },
    { title: '离场(第X天)', dataIndex: 'leave', width: 85, align: 'center' },
    { title: '天数', dataIndex: 'days', width: 60, align: 'center' },
  ];

  const insCols: ColumnsType<InsView> = [
    { title: '测试工具', dataIndex: 'name', width: 160 },
    { title: '需求', dataIndex: 'demand', width: 60, align: 'center' },
    { title: '自有', dataIndex: 'own', width: 60, align: 'center', render: (t: number) => <b style={{ color: GREEN }}>{t}</b> },
    { title: '需租赁', dataIndex: 'rent', width: 70, align: 'center', render: (t: number) => <b style={{ color: WARN }}>{t}</b> },
    { title: '天数', dataIndex: 'days', width: 60, align: 'center' },
    { title: '备注', dataIndex: 'remark', render: (t: string) => t || '—' },
    {
      title: '覆盖状态', key: 'st', width: 100, align: 'center',
      render: (_: unknown, r: InsView) => r.demand > 0
        ? (r.rent > 0
          ? <Tag color="warning" style={{ margin: 0 }}>⚠️ 部分租赁</Tag>
          : <Tag color="success" style={{ margin: 0 }}>✅ 自有</Tag>)
        : '',
    },
  ];

  const laborCols: ColumnsType<LaborRow> = [
    { title: '工作内容', dataIndex: 'work', width: 140 },
    { title: '类型', dataIndex: 'type', width: 100 },
    {
      title: '核算模式', key: 'mode', width: 80, align: 'center',
      render: (_: unknown, r: LaborRow) => (r.mode === 'byman' ? '按人数' : r.mode === 'experience' ? '经验' : '强度'),
    },
    { title: '数量(台)', key: 'qty', width: 70, align: 'center', render: (_: unknown, r: LaborRow) => num(r.qty) },
    {
      title: '强度(台/人·天)', key: 'daily', width: 95, align: 'center',
      render: (_: unknown, r: LaborRow, i: number) => (r.mode === 'experience' ? '—' : fmtDays(S.laborCalcs[i].daily)),
    },
    { title: '使用天数(人天)', key: 'md', width: 95, align: 'center', render: (_: unknown, _r: LaborRow, i: number) => <b style={{ color: BLUE }}>{fmtDays(S.laborCalcs[i].manDays)}</b> },
    { title: '作业天数', dataIndex: 'days', width: 70, align: 'center' },
    { title: '需要人数', key: 'wk', width: 70, align: 'center', render: (_: unknown, _r: LaborRow, i: number) => S.laborCalcs[i].workers },
    { title: '备注', dataIndex: 'note' },
  ];

  const consCols: ColumnsType<{ id: string; name: string; count: number; unit: string; note: string }> = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '数量', dataIndex: 'count', width: 90, align: 'center' },
    { title: '单位', dataIndex: 'unit', width: 90 },
    { title: '说明', dataIndex: 'note' },
  ];

  const coverageCols: ColumnsType<{ key: string; cat: string; full: string; part: string; own: string; rent: string }> = [
    { title: '类别', dataIndex: 'cat', width: 110 },
    { title: '全满足（无需租赁）', dataIndex: 'full', width: 130, align: 'center', render: (t: string) => <b style={{ color: GREEN }}>{t}</b> },
    { title: '部分覆盖', dataIndex: 'part', width: 100, align: 'center', render: (t: string) => <b style={{ color: WARN }}>{t}</b> },
    { title: '自有(台)', dataIndex: 'own', width: 90, align: 'center' },
    { title: '需租赁(台)', dataIndex: 'rent', width: 100, align: 'center', render: (t: string) => <b style={{ color: WARN }}>{t}</b> },
  ];

  const libLoad = assets.filter((a) => a.cat === 'load' && num(a.count) > 0);
  const libIns = assets.filter((a) => a.cat === 'ins' && num(a.count) > 0);
  const mwText = p.mw !== '' && p.mw != null ? `${p.mw}` : '';

  return (
    <div>
      {/* 标题 + 实时同步标识（原 sum_title / sum_sync_badge） */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>
          {p.name}{mwText ? `（${mwText}MW）` : ''} · 资源配置汇总
        </div>
        <span style={{
          display: 'inline-block', marginTop: 6, fontSize: 12, padding: '4px 10px', borderRadius: 6,
          background: 'rgba(77,159,255,0.08)', border: '1px solid rgba(77,159,255,0.25)', color: 'rgba(255,255,255,0.55)',
        }}>
          🔄 数据已实时同步自各模块 · {nowStr()}
        </span>
      </div>

      {/* h) 资源库覆盖总览（原 lib-tip，置于最前） */}
      {S.showCoverage && (
        <div style={{
          background: S.allCovered ? 'rgba(82,196,26,0.07)' : 'rgba(250,173,20,0.07)',
          border: `1px solid ${S.allCovered ? 'rgba(82,196,26,0.3)' : 'rgba(250,173,20,0.35)'}`,
          borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'rgba(255,255,255,0.75)',
        }}>
          <b style={{ color: S.allCovered ? GREEN : WARN }}>{S.allCovered ? '✅ 资源库覆盖检查：' : '⚠️ 资源库覆盖检查：'}</b>
          {' '}假负载 <b>{S.lFull}</b> 项无需租赁（自有 {Math.round(S.lOwnT)} 台{S.lPart ? `，${S.lPart} 项部分覆盖` : ''}）
          · 仪器仪表 <b>{S.iFull}</b> 种无需租赁{S.iPart ? `，${S.iPart} 种部分覆盖` : ''}
          {S.allCovered
            ? (<>，<b>全部可用自有设备覆盖，无需租赁 🎉</b></>)
            : (<>，另有 <b>{S.needAll.toFixed(0)} 台需租赁</b></>)}
        </div>
      )}

      {/* a) 项目基本信息 */}
      <Section title="📋 项目信息">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
          <KV k="项目名称" v={p.name || ''} />
          <KV k="项目规模(MW)" v={mwText || '—'} />
          <KV k="项目地点" v={p.site || ''} />
          <KV k="测试经理" v={p.manager || ''} />
          <KV k="计划测试天数" v={`${num(p.testDays)} 天`} />
          <KV k="计划周期" v={`${p.startDate || '—'} ~ ${p.endDate || '—'}`} />
        </div>
      </Section>

      {/* b) 人员合计 */}
      <Section title="👥 测试人员" tag={`${S.personnelRows.length} 岗位`} extra={`${S.planTotal} 人`}>
        <MiniStats items={[
          { label: '岗位数', value: S.personnelRows.length },
          { label: '计划总人数', value: S.planTotal, color: GREEN },
          { label: '实际投入人数', value: S.staffList.length, color: GREEN },
          { label: '投入总人天', value: fmtDays(S.staffDaysTotal), color: BLUE },
        ]} />
        <Table<PersonnelRow> rowKey="id" size="small" columns={personnelCols} dataSource={S.personnelRows}
          pagination={false} className="rc-edit-table" scroll={{ x: 'max-content' }} />
      </Section>

      {/* c) 岗位补贴（人力成本预估，天数按角色联动投入明细） */}
      <Section title="💰 岗位补贴（人力成本预估）" tag={`${S.subsidyRows.length} 类`} extra={`补贴 ${S.subsidyTotal} 人`}>
        <Table columns={subsidyCols} dataSource={S.subsidyRows} rowKey="id" size="small" pagination={false}
          className="rc-edit-table" scroll={{ x: 'max-content' }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: 'rgba(30,58,95,0.35)' }}>
                <Table.Summary.Cell index={0}><span style={{ color: BLUE, fontWeight: 600 }}>合计</span></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center"><span style={{ color: BLUE, fontWeight: 600 }}>{S.subsidyTotal}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={2} />
                <Table.Summary.Cell index={3} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
        <Note>投入明细天数 = 该补贴岗位对应角色（测试经理/主测/测试工程师）在「投入明细」中的总人天，实时联动。</Note>
      </Section>

      {/* d) 假负载到场计划 */}
      <Section title="🗄️ 假负载到场计划" tag={`${S.loadViews.length} 类型`}
        extra={`${Math.round(S.totalLoads)} 台（含备用）· 自有 ${Math.round(S.loadOwn)} / 租赁 ${Math.round(S.loadRent)}`}>
        <MiniStats items={[
          { label: '类型数', value: S.loadViews.length },
          { label: '需求总量(台·含备用)', value: fmtDays(S.totalLoads) },
          { label: '自有', value: fmtDays(S.loadOwn), color: GREEN },
          { label: '需租赁', value: fmtDays(S.loadRent), color: WARN },
          { label: '租赁台·天', value: fmtDays(S.loadRentDays), color: WARN },
        ]} />
        <Table<LoadView> rowKey="id" size="small" columns={loadCols} dataSource={S.loadViews}
          pagination={false} className="rc-edit-table" scroll={{ x: 'max-content' }} />
        <Note warn>⏱ 租赁负载使用天数合计：<b>{Math.round(S.loadRentDays)} 天</b>（按「需租赁台数 × 天数」计算）</Note>
        {libLoad.length > 0 && (
          <Note>🏠 自有资源库（假负载）：{libLoad.map((a) => `${a.name} ${a.spec} × ${num(a.count)} 台`).join('，')}</Note>
        )}
      </Section>

      {/* e) 仪器仪表配置 */}
      <Section title="📟 仪器仪表配置" tag={`${S.insViews.length} 种`} extra={`租赁 ${S.insRentT} 台`}>
        <MiniStats items={[
          { label: '仪表种类', value: S.insViews.length },
          { label: '需求总数', value: S.insReqT },
          { label: '自有可覆盖', value: S.insOwnT, color: GREEN },
          { label: '需租赁', value: S.insRentT, color: WARN },
        ]} />
        <Table<InsView> rowKey="id" size="small" columns={insCols} dataSource={S.insViews}
          pagination={false} className="rc-edit-table" scroll={{ x: 'max-content' }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: 'rgba(30,58,95,0.35)' }}>
                <Table.Summary.Cell index={0}><span style={{ color: BLUE, fontWeight: 600 }}>合计</span></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center"><span style={{ color: BLUE, fontWeight: 600 }}>{S.insReqT}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center"><span style={{ color: BLUE, fontWeight: 600 }}>{S.insOwnT}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center"><span style={{ color: BLUE, fontWeight: 600 }}>{S.insRentT}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="center"><span style={{ color: BLUE, fontWeight: 600 }}>{S.insDaysT}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={5} />
                <Table.Summary.Cell index={6} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
        {libIns.length > 0 && (
          <Note>🏠 自有资源库（仪器仪表）可匹配 <b>{S.insMatched}</b> 台：{libIns.map((a) => `${a.name}${a.spec ? ` ${a.spec}` : ''} × ${num(a.count)} 台`).join('，')}</Note>
        )}
        {S.insRentT > 0 && (
          <Note warn>⏱ 租赁仪表使用天数合计：<b>{Math.round(S.insRentDays)} 天</b>（按「需租赁台数 × 天数」计算）</Note>
        )}
        <Note>📌 本板块数据实时取自「📟 仪器仪表」配置模块（名称来自🏠自有资源库，自有/租赁按需求自动判定）。</Note>
      </Section>

      {/* g) 现场耗材 */}
      <Section title="📦 现场耗材" extra={`${S.consRows.length} 类`}>
        <Table columns={consCols} dataSource={S.consRows} rowKey="id" size="small" pagination={false}
          className="rc-edit-table" scroll={{ x: 'max-content' }} />
      </Section>

      {/* f) 劳务人员使用天数 */}
      <Section title="👷 劳务人员使用天数" tag={`${S.laborRows.length} 项`}
        extra={`${fmtDays(S.laborDays)} 人天 · 每日 ${S.laborWorkers} 人`}>
        <Table<LaborRow> rowKey="id" size="small" columns={laborCols} dataSource={S.laborRows}
          pagination={false} className="rc-edit-table" scroll={{ x: 'max-content' }} />
      </Section>

      {/* h) 资源库覆盖总览（数据表） */}
      {S.showCoverage && (
        <Section title="🛡️ 资源库覆盖总览">
          <Table columns={coverageCols} rowKey="key" size="small" pagination={false} className="rc-edit-table"
            dataSource={[
              { key: 'load', cat: '假负载', full: `${S.lFull} 项`, part: `${S.lPart} 项`, own: `${Math.round(S.lOwnT)}`, rent: `${Math.round(S.lRentT)}` },
              { key: 'ins', cat: '仪器仪表', full: `${S.iFull} 种`, part: `${S.iPart} 种`, own: '—', rent: `${Math.round(S.iNeed)}` },
            ]}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: 'rgba(30,58,95,0.35)' }}>
                  <Table.Summary.Cell index={0}><span style={{ color: BLUE, fontWeight: 600 }}>合计需租赁</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} />
                  <Table.Summary.Cell index={2} />
                  <Table.Summary.Cell index={3} />
                  <Table.Summary.Cell index={4} align="center">
                    <span style={{ color: S.allCovered ? GREEN : WARN, fontWeight: 600 }}>
                      {S.allCovered ? '0（全部自有覆盖 🎉）' : `${S.needAll.toFixed(0)} 台`}
                    </span>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
          <Note>覆盖判定：假负载按类型/规格与资源库功率（KW）匹配、含备用台数；仪器仪表按名称精确匹配（同名库存累加）；「__RENT__ / 🛒 租赁」行与水负载（去离子）不参与自有分配。</Note>
        </Section>
      )}
    </div>
  );
}
