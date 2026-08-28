/**
 * 假负载计划 Tab（1:1 复刻原工具 renderLoads / bindLoads，index.html L3496-3653）
 *  - 总需求 = 数量 + 备用台数，资源库（load 按 KW / pdu 按名称）优先覆盖为自有，超出自动转租赁
 *  - 类型支持自由输入 + 资源库候选（名称+规格，显示库存）+「🛒 租赁」
 *  - 到场/开始/结束/离场填「第几天」，天数 = 离场 − 开始使用 自动算
 *  - 类型含「去离子」= 水负载不参与分配；含「租赁」= 纯租赁行不参与库存匹配
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { AutoComplete, Button, Input, InputNumber, Popconfirm, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  calcLoadAllocation, calcLoadDays, parseDayRef,
  type AssetLibItem, type LoadRow, type ResourceConfigProject,
} from '../../../types/resourceConfig';

const { TextArea } = Input;

/** 数值显示：最多 1 位小数去尾零（备用台数 0.1 等浮点相加会出现多位小数） */
function fmt1(v: number): number | string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? r : r.toFixed(1);
}

interface TabProps {
  data: ResourceConfigProject;
  assets: AssetLibItem[];
  canEdit: boolean;
  patch: (updates: Partial<ResourceConfigProject>) => void;
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 水负载：类型含「去离子」，不参与分配 */
const isWaterRow = (r: LoadRow) => (r.type || '').includes('去离子');
/** 纯租赁类型判定（字符串级）：__RENT__ / 🛒 前缀 / 含「租赁」 */
const isRentType = (t: string) => t === '__RENT__' || t.startsWith('🛒') || t.includes('租赁');
/** 纯租赁行：类型含「租赁」（含原工具的 __RENT__ / 🛒 前缀），不参与库存匹配 */
const isRentRow = (r: LoadRow) => isRentType(r.type || '');

/**
 * 自有/需租赁分配（基于平台 calcLoadAllocation，原 computeLoadAllocation L2885-2908）：
 * 在共享算法之上补齐原工具「🛒 租赁」语义并按本模块约定扩展到「类型含租赁」——
 * 此类行不消耗库存，直接 own=0 / rent=总需求。
 */
function computeLoadAlloc(loads: LoadRow[], assets: AssetLibItem[]): Record<string, { own: number; rent: number }> {
  const effective = loads.filter((r) => !isRentRow(r));
  const base = calcLoadAllocation(effective, assets);
  const out: Record<string, { own: number; rent: number }> = {};
  for (const r of loads) {
    if (isWaterRow(r)) { out[r.id] = { own: 0, rent: 0 }; continue; }               // 水负载不参与分配
    if (isRentRow(r)) {                                                             // 纯租赁行不参与库存匹配
      out[r.id] = { own: 0, rent: Math.max(0, r.count) + Math.max(0, r.ratio) };
      continue;
    }
    out[r.id] = base[r.id] || { own: 0, rent: 0 };
  }
  return out;
}

// ============== 统一样式（CONVENTIONS.md） ==============

/** 行内徽章（原 .badge b-ok/b-warn/b-rent/b-miss，深色主题适配） */
function badgeStyle(kind: 'ok' | 'warn' | 'rent' | 'miss' | 'water'): CSSProperties {
  const color: Record<typeof kind, CSSProperties> = {
    ok: { background: 'rgba(82,196,26,0.12)', border: '1px solid rgba(82,196,26,0.45)', color: '#95de64' },
    warn: { background: 'rgba(250,173,20,0.12)', border: '1px solid rgba(250,173,20,0.45)', color: '#ffc53d' },
    rent: { background: 'rgba(255,77,79,0.10)', border: '1px solid rgba(255,77,79,0.40)', color: '#ff7875' },
    miss: { background: 'rgba(114,46,209,0.12)', border: '1px solid rgba(114,46,209,0.45)', color: '#b37feb' },
    water: { background: 'rgba(77,159,255,0.10)', border: '1px solid rgba(77,159,255,0.35)', color: '#7cb8ff' },
  };
  return {
    display: 'inline-block', fontSize: 10.5, lineHeight: 1.5, padding: '1px 7px',
    borderRadius: 9, marginTop: 3, whiteSpace: 'nowrap', ...color[kind],
  };
}

/** 库存覆盖提示条（原 .lib-tip / .lib-tip.warn / .lib-tip.gray） */
function LibTip({ kind, children }: { kind: 'ok' | 'warn' | 'gray'; children: React.ReactNode }) {
  const style: Record<typeof kind, CSSProperties> = {
    ok: { background: 'rgba(82,196,26,0.08)', border: '1px solid rgba(82,196,26,0.35)', color: '#95de64' },
    warn: { background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.35)', color: '#ffc53d' },
    gray: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)' },
  };
  return <div style={{ marginBottom: 12, padding: '9px 14px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.6, ...style[kind] }}>{children}</div>;
}

/** 库存提示 toast（原 libToast L1526-1536：2.5s 内相同消息去重，同 key 原地更新不堆叠） */
function useLibToast() {
  const lastRef = useRef('');
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => { if (timerRef.current != null) window.clearTimeout(timerRef.current); }, []);
  return useCallback((msg: string, type: 'ok' | 'warn' = 'ok') => {
    if (lastRef.current === msg) return;
    lastRef.current = msg;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { lastRef.current = ''; }, 2500);
    message.open({ key: 'rc-lib-toast', type: type === 'warn' ? 'warning' : 'success', content: msg });
  }, []);
}

// ============== 步进器（原 stepCell + initStepHold L1660-1680） ==============
// 点击单次加减；按住「− / ＋」500ms 后每 120ms 连发一次

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  disabled?: boolean;
}

function Stepper({ value, onChange, min = 0, disabled }: StepperProps) {
  const latestRef = useRef(value);
  useEffect(() => { latestRef.current = value; }, [value]);
  const holdTimer = useRef<number | null>(null);
  const holdInterval = useRef<number | null>(null);
  const stop = useCallback(() => {
    if (holdTimer.current != null) { window.clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (holdInterval.current != null) { window.clearInterval(holdInterval.current); holdInterval.current = null; }
  }, []);
  useEffect(() => stop, [stop]);
  const clamp = (v: number) => Math.max(min, Math.round(v || 0));
  const step = (d: number) => onChange(clamp((latestRef.current || 0) + d));
  const begin = (d: number) => {
    if (disabled) return;
    stop();
    step(d); // 立即响应第一次点击
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(() => step(d), 120); // 按住 500ms 后每 120ms 连发
    }, 500);
  };
  const btnStyle: CSSProperties = {
    width: 24, height: 24, border: 'none', background: 'rgba(255,255,255,0.06)',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 15, lineHeight: '24px', color: 'rgba(255,255,255,0.65)',
    userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none', padding: 0,
  };
  return (
    <div
      className="rc-stepper"
      title="点击单次加减，按住不放可连续不停地加减"
      style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, overflow: 'hidden', background: 'rgba(255,255,255,0.02)' }}
    >
      <button type="button" aria-label="减少" tabIndex={-1} disabled={disabled}
        onMouseDown={() => begin(-1)} onMouseUp={stop} onMouseLeave={stop}
        style={{ ...btnStyle, borderRight: '1px solid rgba(255,255,255,0.12)' }}>−</button>
      <InputNumber
        size="small" min={min} precision={0} value={value} disabled={disabled} controls={false}
        onChange={(v) => onChange(clamp(typeof v === 'number' ? v : min))}
        className="rc-step-input rc-cell-input" style={{ width: 46 }} />
      <button type="button" aria-label="增加" tabIndex={-1} disabled={disabled}
        onMouseDown={() => begin(1)} onMouseUp={stop} onMouseLeave={stop}
        style={{ ...btnStyle, borderLeft: '1px solid rgba(255,255,255,0.12)' }}>+</button>
    </div>
  );
}

// ============== 主组件 ==============

export default function LoadsTab({ data, assets, canEdit, patch }: TabProps) {
  const loads = data.loads || [];
  const libToast = useLibToast();

  // 行数据 ref：长按连发时避免闭包拿到旧行数组
  const loadsRef = useRef(loads);
  useEffect(() => { loadsRef.current = loads; }, [loads]);

  /** 自有/租赁分配（原 computeLoadAllocation） */
  const alloc = useMemo(() => computeLoadAlloc(loads, assets), [loads, assets]);

  /** 类型候选（原 loadTypeList 同步 L3580-3592）：load/pdu 的「名称 规格（自有 N 台）」+ 🛒 租赁 */
  const typeOptions = useMemo(() => {
    const map = new Map<string, number>();
    assets.filter((a) => (a.cat === 'load' || a.cat === 'pdu') && (a.name || a.spec)).forEach((a) => {
      const k = ((a.name || '') + (a.spec ? ` ${a.spec}` : '')).trim();
      map.set(k, (map.get(k) || 0) + (a.count || 0));
    });
    return [
      ...[...map.entries()].map(([k, c]) => ({ value: k, label: `${k}（自有 ${c} 台）` })),
      { value: '🛒 租赁', label: '🛒 租赁（库内无此设备）' },
    ];
  }, [assets]);

  /** 页头统计（原 renderLoads L3509-3523 口径：水负载行不计入） */
  const stats = useMemo(() => {
    let needTotal = 0, ownTotal = 0, rentTotal = 0, rentDays = 0, spareTotal = 0, fullRows = 0, partRows = 0;
    for (const r of loads) {
      if (isWaterRow(r) || !(r.count > 0)) continue;
      const a = alloc[r.id] || { own: 0, rent: 0 };
      needTotal += a.own + a.rent;
      ownTotal += a.own;
      rentTotal += a.rent;
      spareTotal += Math.max(0, r.ratio);
      rentDays += a.rent * calcLoadDays(r);
      if (a.rent <= 0) fullRows++;
      else if (a.own > 0) partRows++;
    }
    return { needTotal, ownTotal, rentTotal, rentDays, spareTotal, fullRows, partRows };
  }, [loads, alloc]);

  // ---------- 行操作（全部走 patch） ----------

  const addRow = () => {
    patch({
      loads: [...loadsRef.current, {
        id: genId(), type: '', count: 0, ratio: 0, spec: '',
        arrive: '', start: '', end: '', leave: '', days: 0,
        cycleMode: 'date', relStart: 0, relEnd: 0, remark: '', note: '',
      }],
    });
  };

  const delRow = (id: string) => patch({ loads: loadsRef.current.filter((r) => r.id !== id) });

  /** 文本字段写值；类型命中资源库「名称+规格」且规格为空时自动带出规格（原 change 事件 L3641-3642） */
  const setText = (id: string, f: 'type' | 'spec' | 'remark', v: string) => {
    const hit = f === 'type'
      ? assets.find((a) => (a.cat === 'load' || a.cat === 'pdu') && `${(a.name || '')} ${(a.spec || '')}`.trim() === v.trim())
      : undefined;
    patch({
      loads: loadsRef.current.map((r) => {
        if (r.id !== id) return r;
        const nr = { ...r, [f]: v };
        if (hit && !nr.spec) nr.spec = hit.spec || '';
        return nr;
      }),
    });
  };

  /** 数量 / 备用台数步进（原 input 事件：写值 + 三分支库存提示 L3619-3624） */
  const setNum = (id: string, f: 'count' | 'ratio', v: number) => {
    const next = loadsRef.current.map((r) => (r.id === id ? { ...r, [f]: v } : r));
    patch({ loads: next });
    const row = next.find((r) => r.id === id);
    if (row && row.count > 0 && !isWaterRow(row) && !isRentRow(row)) {
      const a = computeLoadAlloc(next, assets)[id] || { own: 0, rent: 0 };
      if (a.own > 0 && a.rent <= 0) libToast(`「${row.type || '该负载'}」资源库自有 ${a.own} 台，无需租赁`);
      else if (a.own > 0 && a.rent > 0) libToast(`「${row.type || '该负载'}」资源库自有 ${a.own} 台，不足 ${fmt1(a.rent)} 台需租赁`, 'warn');
      else libToast(`「${row.type || '该负载'}」资源库无匹配，全部 ${fmt1(a.rent)} 台需租赁`, 'warn');
    }
  };

  /** 类型从候选中选中（原 change 事件 L3644-3650，仅提示；数据写入统一走 setText 保证顺序无关） */
  const typeSelected = (id: string, v: string) => {
    const row = loadsRef.current.find((r) => r.id === id);
    if (!row || !(row.count > 0)) return;
    if ((v || '').includes('去离子')) return;
    if (isRentType(v)) {
      libToast(`「租赁」该负载共 ${Math.max(0, row.count) + Math.max(0, row.ratio)} 台需租赁`, 'warn');
      return;
    }
    const a = computeLoadAlloc(loadsRef.current.map((r) => (r.id === id ? { ...r, type: v } : r)), assets)[id] || { own: 0, rent: 0 };
    if (a.own > 0 && a.rent <= 0) libToast(`「${v}」资源库自有 ${a.own} 台，无需租赁`);
    else if (a.own > 0 && a.rent > 0) libToast(`「${v}」资源库自有 ${a.own} 台，不足 ${fmt1(a.rent)} 台需租赁`, 'warn');
    else libToast(`「${v}」资源库无匹配，全部 ${fmt1(a.rent)} 台需租赁`, 'warn');
  };

  /** 四个「第几天」（原 L3633-3638）：start/leave 变更时同步 days = 离场 − 开始 */
  const setDay = (id: string, f: 'arrive' | 'start' | 'end' | 'leave', v: number) => {
    patch({
      loads: loadsRef.current.map((r) => {
        if (r.id !== id) return r;
        const nr: LoadRow = { ...r, [f]: v };
        const sN = parseDayRef(nr.start), lvN = parseDayRef(nr.leave);
        nr.days = sN > 0 && lvN > 0 ? Math.max(0, lvN - sN) : 0;
        return nr;
      }),
    });
  };

  /** 行内徽章（原 L3524-3531 badge + 水负载提示） */
  const renderBadge = (r: LoadRow) => {
    if (isWaterRow(r)) return <div><span style={badgeStyle('water')}>💧 水负载，不参与分配</span></div>;
    if (!(r.count > 0)) return null;
    const a = alloc[r.id] || { own: 0, rent: 0 };
    if (a.own > 0 && a.rent <= 0) return <div><span style={badgeStyle('ok')}>✅ 自有覆盖 无需租赁</span></div>;
    if (a.own > 0 && a.rent > 0) return <div><span style={badgeStyle('warn')}>⚠️ 部分自有 · 需租 {Math.round(a.rent * 10) / 10} 台</span></div>;
    return <div><span style={badgeStyle('rent')}>🛒 需租赁 {Math.round(a.rent * 10) / 10} 台</span></div>;
  };

  /** 周期单元格：四个「第几天」（原 L3533-3536，彩色 day-tag） */
  const renderPeriod = (r: LoadRow) => {
    const items: Array<[string, 'arrive' | 'start' | 'end' | 'leave', string]> = [
      ['到场', 'arrive', '#6366f1'], ['开始使用', 'start', '#16a34a'], ['结束使用', 'end', '#ea580c'], ['离场', 'leave', '#dc2626'],
    ];
    return (
      <div>
        {items.map(([label, f, bg]) => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <span style={{ background: bg, color: '#fff', minWidth: 48, textAlign: 'center', flex: 'none', fontSize: 11, borderRadius: 3, padding: '1px 0' }}>{label}</span>
            <InputNumber
              size="small" min={1} max={70} precision={0} disabled={!canEdit}
              value={parseDayRef(r[f]) || null} placeholder="第?天"
              onChange={(v) => setDay(r.id, f, typeof v === 'number' ? v : 0)}
              className="rc-cell-input" style={{ flex: 1, minWidth: 0, width: 56 }} />
          </div>
        ))}
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>填写第几天 · 天数 = 离场 − 开始使用 自动算</div>
      </div>
    );
  };

  const columns: ColumnsType<LoadRow> = [
    { title: '#', key: 'idx', width: 36, align: 'center', fixed: 'left' as const,
      render: (_v, _r, i) => <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{i + 1}</span> },
    {
      title: <div>假负载类型<div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>可输入库中无的类型</div></div>,
      dataIndex: 'type', width: 200,
      render: (_v, r) => (
        <div>
          {canEdit ? (
            <AutoComplete
              value={r.type === '__RENT__' ? '🛒 租赁' : r.type}
              options={typeOptions}
              onChange={(v) => setText(r.id, 'type', v)}
              onSelect={(v) => typeSelected(r.id, String(v))}
              filterOption={(iv, opt) => String(opt?.value ?? '').toLowerCase().includes(String(iv).toLowerCase())}
              placeholder="输入或选类型" size="small" style={{ width: '100%' }}
            />
          ) : (
            <span>{(r.type === '__RENT__' ? '🛒 租赁' : r.type) || '-'}</span>
          )}
          {renderBadge(r)}
        </div>
      ),
    },
    { title: '数量', dataIndex: 'count', width: 118, align: 'center',
      render: (_v, r) => <Stepper value={Math.max(0, r.count || 0)} min={0} disabled={!canEdit} onChange={(v) => setNum(r.id, 'count', v)} /> },
    { title: '备用台数', dataIndex: 'ratio', width: 118, align: 'center',
      render: (_v, r) => <Stepper value={Math.max(0, r.ratio || 0)} min={0} disabled={!canEdit} onChange={(v) => setNum(r.id, 'ratio', v)} /> },
    { title: '规格', dataIndex: 'spec', width: 150,
      render: (_v, r) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={r.spec ?? ''} placeholder="6KW/台 带电源线"
            onChange={(e) => setText(r.id, 'spec', e.target.value)} className="rc-cell-input" />
        : (r.spec || '-') },
    { title: <div>到场 / 开始 / 结束 / 离场<div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>第几天（1-70）</div></div>,
      key: 'period', width: 150, render: (_v, r) => renderPeriod(r) },
    { title: <div>天数<div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>自动算</div></div>,
      key: 'days', width: 56, align: 'center',
      render: (_v, r) => <span style={{ fontWeight: 600 }} title="离场 − 开始使用 自动计算">{calcLoadDays(r)}</span> },
    { title: '自有', key: 'own', width: 56, align: 'center',
      render: (_v, r) => {
        if (isWaterRow(r)) return <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>;
        const a = alloc[r.id] || { own: 0, rent: 0 };
        return <span style={{ fontWeight: 600, color: '#52c41a' }}>{fmt1(a.own)}</span>;
      } },
    { title: '需租赁', key: 'rent', width: 62, align: 'center',
      render: (_v, r) => {
        if (isWaterRow(r)) return <span style={{ color: 'rgba(255,255,255,0.35)' }}>—</span>;
        const a = alloc[r.id] || { own: 0, rent: 0 };
        return <span style={{ fontWeight: 600, color: '#faad14' }}>{fmt1(a.rent)}</span>;
      } },
    { title: '备注', dataIndex: 'remark', width: 170,
      render: (_v, r) => (
        <div>
          {canEdit
            ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={r.remark ?? ''} placeholder="备注（可选）"
                onChange={(e) => setText(r.id, 'remark', e.target.value)} className="rc-cell-input" />
            : (r.remark || '-')}
          {r.note ? <div style={{ color: '#faad14', fontSize: 11, marginTop: 3 }}>📌 {r.note}</div> : null}
        </div>
      ) },
    ...(canEdit ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_v: unknown, r: LoadRow) => (
        <Popconfirm title="删除此行？" onConfirm={() => delRow(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  const sumColor: CSSProperties = { color: '#7cb8ff', fontWeight: 600 };

  return (
    <div>
      <style>{`
        .rc-stepper .rc-step-input.ant-input-number,
        .rc-stepper .rc-step-input.ant-input-number .ant-input-number-input {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: rgba(255,255,255,0.88) !important;
        }
        .rc-stepper .rc-step-input .ant-input-number-input {
          text-align: center;
          padding: 0 2px;
          height: 24px;
          font-size: 12.5px;
        }
        .rc-stepper button:hover { background: rgba(77,159,255,0.18) !important; color: #7cb8ff !important; }
        .rc-stepper button:active { background: rgba(77,159,255,0.3) !important; }
      `}</style>

      {/* 页头 5 统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: '负载类型数', value: loads.length, color: '#7cb8ff' },
          { label: '需求总量(台)', value: stats.needTotal.toFixed(0), color: '#7cb8ff' },
          { label: '自有可覆盖', value: stats.ownTotal.toFixed(0), color: '#52c41a' },
          { label: '需租赁', value: stats.rentTotal.toFixed(0), color: '#faad14' },
          { label: '租赁台·天 (Σ需租×天数)', value: stats.rentDays.toFixed(0), color: '#faad14' },
        ].map((c, i) => (
          <div key={i} style={{ background: 'linear-gradient(135deg, rgba(30,58,95,0.45), rgba(30,58,95,0.2))', border: '1px solid rgba(77,159,255,0.18)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* 库存覆盖提示（原 load_lib_tip 三分支 L3567-3579） */}
      {stats.fullRows > 0 && stats.partRows === 0 && stats.rentTotal <= 0 ? (
        <LibTip kind="ok">✅ <b>提示：</b>资源库自有设备已完全覆盖 <b>{stats.fullRows}</b> 项假负载需求（共 {stats.ownTotal.toFixed(0)} 台），<b>无需租赁</b></LibTip>
      ) : stats.fullRows > 0 || stats.partRows > 0 || stats.rentTotal > 0 ? (
        <LibTip kind="warn">⚠️ <b>提示：</b>自有覆盖 {stats.fullRows} 项（{stats.ownTotal.toFixed(0)} 台），部分覆盖 {stats.partRows} 项，另有 <b>{stats.rentTotal.toFixed(0)} 台需租赁</b>（超出资源库的部分）</LibTip>
      ) : (
        <LibTip kind="gray">🔍 资源库暂无匹配的假负载资产，全部按需租赁处理</LibTip>
      )}

      {/* 表格卡片 */}
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>🗄️ 假负载到场计划表</span>
          <span style={{ margin: '0 0 0 8px', fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>总需求 = 数量 + 备用台数，资源库优先覆盖为自有，超出部分自动转为需租赁</span>
          <div style={{ flex: 1 }} />
          {canEdit && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addRow}>＋ 添加负载</Button>}
        </div>
        <Table<LoadRow>
          rowKey="id" size="small" columns={columns} dataSource={loads} pagination={false}
          className="rc-edit-table" scroll={{ x: 'max-content' }}
          locale={{ emptyText: (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>🗄️</div>
              还没有假负载配置<br />点上方「<b>＋ 添加负载</b>」开始配置
            </div>
          ) }}
          summary={() => (loads.length > 0 ? (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: 'rgba(30,58,95,0.35)' }}>
                <Table.Summary.Cell index={0} />
                <Table.Summary.Cell index={1}><span style={sumColor}>合计</span></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center"><span style={sumColor} title="总需求 = Σ(数量+备用台数)">{stats.needTotal.toFixed(0)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center"><span style={sumColor}>{stats.spareTotal.toFixed(0)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={4} />
                <Table.Summary.Cell index={5} />
                <Table.Summary.Cell index={6} />
                <Table.Summary.Cell index={7} align="center"><span style={{ ...sumColor, color: '#52c41a' }}>{stats.ownTotal.toFixed(0)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={8} align="center"><span style={{ ...sumColor, color: '#faad14' }}>{stats.rentTotal.toFixed(0)}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={9} />
                <Table.Summary.Cell index={10} />
              </Table.Summary.Row>
            </Table.Summary>
          ) : null)}
        />
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>
          ⚠️ <b>假负载类型</b>支持手动输入：可直接键入资源库里没有的类型（如「XX 品牌 800KW」），下拉中也有🏠资源库已有项与「🛒 租赁」供快速选择；填写规格（含 KW）可自动匹配自有资源，否则整行按租赁处理（自有=0）。<b>到场 / 开始使用 / 结束使用 / 离场</b>四列填写<b>第几天</b>（不用写具体日期），其中<b>天数 = 离场 − 开始使用 自动计算</b>。备用台数手动填写整数（如填 10 表示额外备用 10 台），总需求 = 数量 + 备用台数，资源库优先覆盖为自有，超出自动转租赁。
        </div>
      </div>
    </div>
  );
}
