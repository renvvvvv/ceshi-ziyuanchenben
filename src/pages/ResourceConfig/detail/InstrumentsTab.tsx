/**
 * 仪器仪表 Tab（1:1 复刻原工具 renderInstruments / autoAssignInstruments / insBadge，
 * index.html L3655-3887 / L4008-4062）
 *  - 测试工具下拉来自🏠自有资源库（cat=ins，同名库存累加显示），也支持自由输入
 *  - 按名称精确匹配资源库：自有优先、超出自动转为租赁（每行独立判定）
 *  - 「⚡ 按资源库分配」把分配结果写入行的 own/rent 字段落库
 *  - hidden=true 的行不显示、不计入统计（数据保留，可恢复）
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { AutoComplete, Button, Input, InputNumber, Popconfirm, Switch, Table, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined, ThunderboltOutlined, EyeOutlined } from '@ant-design/icons';
import {
  calcInstrumentAllocation,
  type AssetLibItem, type InstrumentRow, type ResourceConfigProject,
} from '../../../types/resourceConfig';
import { useIsMobile } from '../../../hooks/useIsMobile';

const { TextArea } = Input;

interface TabProps {
  data: ResourceConfigProject;
  assets: AssetLibItem[];
  canEdit: boolean;
  patch: (updates: Partial<ResourceConfigProject>) => void;
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ============== 统一样式（CONVENTIONS.md） ==============

/** 行内徽章（原 .badge b-ok/b-warn/b-rent/b-miss，深色主题适配） */
function badgeStyle(kind: 'ok' | 'warn' | 'rent' | 'miss'): CSSProperties {
  const color: Record<typeof kind, CSSProperties> = {
    ok: { background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.45)', color: '#16a34a' },
    warn: { background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.45)', color: '#d97706' },
    rent: { background: 'rgba(220,38,38,0.10)', border: '1px solid rgba(220,38,38,0.40)', color: '#dc2626' },
    miss: { background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.45)', color: '#a855f7' },
  };
  return {
    display: 'inline-block', fontSize: 10.5, lineHeight: 1.5, padding: '1px 7px',
    borderRadius: 9, marginTop: 3, whiteSpace: 'nowrap', ...color[kind],
  };
}

/** 库存覆盖提示条（原 .lib-tip / .lib-tip.warn / .lib-tip.gray） */
function LibTip({ kind, children }: { kind: 'ok' | 'warn' | 'gray'; children: React.ReactNode }) {
  const style: Record<typeof kind, CSSProperties> = {
    ok: { background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.35)', color: '#16a34a' },
    warn: { background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.35)', color: '#d97706' },
    gray: { background: '#f8f7fd', border: '1px solid #d9d5f0', color: '#6b6892' },
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

// ============== 主组件 ==============

export default function InstrumentsTab({ data, assets, canEdit, patch }: TabProps) {
  const instruments = data.instruments || [];
  const libToast = useLibToast();
  const isMobile = useIsMobile();

  // 行数据 ref：避免事件闭包拿到旧行数组
  const rowsRef = useRef(instruments);
  useEffect(() => { rowsRef.current = instruments; }, [instruments]);

  /** 可见行（原 visInstruments：hidden 不显示、不计数） */
  const visible = useMemo(() => instruments.filter((r) => !r.hidden), [instruments]);

  /** 资源库仪表库存：按名称精确匹配、同名累加（原 computeInsAllocation 的 stockByName） */
  const stockByName = useMemo(() => {
    const map = new Map<string, number>();
    assets.filter((a) => a.cat === 'ins').forEach((a) => {
      const k = a.name || '';
      if (!k) return;
      map.set(k, (map.get(k) || 0) + (a.count || 0));
    });
    return map;
  }, [assets]);

  /** 平台同步版分配算法（原 computeInsAllocation L2911-2927）：own=min(需求,库), rent=需求-own */
  const insAlloc = useMemo(() => calcInstrumentAllocation(instruments, assets), [instruments, assets]);

  /** 每行 lib / found（徽章分支需要，分配算法只返回 own/rent） */
  const visInfo = useMemo(() => visible.map((r) => {
    const d = Math.max(0, r.demand || 0);
    const name = r.name || '';
    if (d <= 0 || !name) return { lib: 0, found: false };
    return { lib: stockByName.get(name) || 0, found: stockByName.has(name) };
  }), [visible, stockByName]);

  /** 统计（原 renderInstruments L3662-3671 口径） */
  const stats = useMemo(() => {
    let req = 0, own = 0, rent = 0, libMatched = 0, fullRows = 0, partRows = 0;
    visible.forEach((r, i) => {
      const d = Math.max(0, r.demand || 0);
      const a = insAlloc[r.id] || { own: 0, rent: 0 };
      req += d; own += a.own; rent += a.rent;
      libMatched += visInfo[i]?.lib || 0;
      if (d > 0) {
        const lib = visInfo[i]?.lib || 0;
        if (lib >= d) fullRows++;
        else if (lib > 0) partRows++;
      }
    });
    return { req, own, rent, libMatched, fullRows, partRows, hiddenCount: instruments.length - visible.length };
  }, [visible, insAlloc, visInfo, instruments.length]);

  /** 名称下拉候选（原 insLibSelectOptions L2929-2943：名称来自资源库，库存累加显示） */
  const nameOptions = useMemo(() => {
    if (stockByName.size === 0) return [];
    return [...stockByName.entries()].map(([name, c]) => ({
      value: name,
      label: `${name} ${c > 0 ? `（自有 ${c} 台）` : '（库内 0 台 · 需租赁）'}`,
    }));
  }, [stockByName]);

  // ---------- 行操作（全部走 patch） ----------

  const addRow = () => {
    patch({
      instruments: [...rowsRef.current, { id: genId(), name: '', demand: 0, own: 0, rent: 0, days: 40, remark: '', hidden: false }],
    });
  };

  const delRow = (id: string) => patch({ instruments: rowsRef.current.filter((r) => r.id !== id) });

  const setName = (id: string, v: string) => {
    patch({ instruments: rowsRef.current.map((r) => (r.id === id ? { ...r, name: v } : r)) });
  };

  /** 名称从候选中选中（原 change 事件 L4018 + toast L4022-4023，仅提示；数据写入统一走 setName 保证顺序无关） */
  const nameSelected = (id: string, v: string) => {
    const row = rowsRef.current.find((r) => r.id === id);
    const d = Math.max(0, row?.demand || 0);
    if (row && d > 0 && v) {
      const lib = stockByName.get(v) || 0;
      if (lib >= d) libToast(`「${v}」🏠资源库内自有 ${lib} 台，无需租赁`);
      else if (lib > 0) libToast(`「${v}」🏠资源库内仅 ${lib} 台，不足 ${d - lib} 台需租赁`, 'warn');
    }
  };

  /** 需求数量（原 input 事件 L4019-4024：改需求即时提示库存匹配情况） */
  const setDemand = (id: string, v: number) => {
    patch({ instruments: rowsRef.current.map((r) => (r.id === id ? { ...r, demand: v } : r)) });
    const row = rowsRef.current.find((r) => r.id === id);
    if (row && row.name && v > 0) {
      const lib = stockByName.get(row.name) || 0;
      if (lib >= v) libToast(`「${row.name}」🏠资源库内自有 ${lib} 台，无需租赁`);
      else if (lib > 0) libToast(`「${row.name}」🏠资源库内仅 ${lib} 台，不足 ${v - lib} 台需租赁`, 'warn');
    }
  };

  const setField = (id: string, f: 'days' | 'remark', v: number | string) => {
    patch({ instruments: rowsRef.current.map((r) => (r.id === id ? { ...r, [f]: v } : r)) });
  };

  const setHidden = (id: string, hidden: boolean) => {
    patch({ instruments: rowsRef.current.map((r) => (r.id === id ? { ...r, hidden } : r)) });
  };

  /** 显示全部隐藏行（原 showAllInstruments） */
  const showAll = () => {
    const n = rowsRef.current.filter((r) => r.hidden).length;
    patch({ instruments: rowsRef.current.map((r) => ({ ...r, hidden: false })) });
    if (n > 0) libToast(`已恢复显示 ${n} 项仪表`);
  };

  /**
   * ⚡ 按资源库分配（原 autoAssignInstruments L3874-3887）：
   * 把实时分配结果写入行的 own/rent 字段落库 + 分配汇总提示
   */
  const autoAssign = () => {
    let matched = 0;
    const next = rowsRef.current.map((r) => {
      if (r.hidden) return r;
      const d = Math.max(0, r.demand || 0);
      // 原算法（computeInsAllocation L2920）：未填名称的行直接 own=0 / rent=0，不把需求写成租赁落数据
      const own = r.name ? Math.min(d, stockByName.get(r.name) || 0) : 0;
      const rent = r.name ? d - own : 0;
      matched += own;
      return { ...r, own, rent };
    });
    patch({ instruments: next });
    if (matched > 0) libToast(`已按资源库分配：自有 ${matched} 台，超出部分自动转为租赁`);
    else libToast('资源库中暂无匹配仪器，全部按需租赁', 'warn');
  };

  /** 行内徽章（原 insBadge L3031-3038 四分支） */
  const renderBadge = (r: InstrumentRow, idx: number) => {
    const d = Math.max(0, r.demand || 0);
    if (d <= 0) return null;
    const lib = visInfo[idx]?.lib || 0;
    const found = visInfo[idx]?.found ?? false;
    if (lib >= d) return <div><span style={badgeStyle('ok')}>✅ 库内自有 {lib} 台 无需租赁</span></div>;
    if (lib > 0) return <div><span style={badgeStyle('warn')}>⚠️ 库内部分自有 {lib} 台 · 需租 {d - lib} 台</span></div>;
    if (!found) return <div><span style={badgeStyle('miss')}>❌ 资源库无此仪表 · 建议添加</span></div>;
    return <div><span style={badgeStyle('rent')}>🛒 库内有此表但数量为0 · 需租赁 {d} 台</span></div>;
  };

  const columns: ColumnsType<InstrumentRow> = [
    { title: '#', key: 'idx', width: 36, align: 'center', fixed: 'left' as const,
      render: (_v, _r, i) => <span style={{ color: '#9d9ab8', fontSize: 11 }}>{i + 1}</span> },
    {
      title: '测试工具',
      dataIndex: 'name', width: 240,
      render: (_v, r) => {
        const idx = visible.findIndex((x) => x.id === r.id);
        return (
          <div>
            {canEdit ? (
              <AutoComplete
                value={r.name}
                options={nameOptions}
                onChange={(v) => setName(r.id, v)}
                onSelect={(v) => nameSelected(r.id, String(v))}
                filterOption={(iv, opt) => String(opt?.value ?? '').toLowerCase().includes(String(iv).toLowerCase())}
                placeholder={nameOptions.length ? '选择或输入仪表名称' : '（资源库暂无仪器仪表，可自由输入）'}
                size="small" style={{ width: '100%' }}
              />
            ) : (r.name || '-')}
            {renderBadge(r, idx)}
          </div>
        );
      },
    },
    { title: '需求', dataIndex: 'demand', width: 76, align: 'center',
      render: (_v, r) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={r.demand} className="rc-cell-input"
            onChange={(v) => setDemand(r.id, typeof v === 'number' ? v : 0)} style={{ width: '100%' }} />
        : (r.demand ?? 0) },
    { title: '自有', key: 'own', width: 62, align: 'center',
      render: (_v, r) => <span style={{ fontWeight: 600, color: '#16a34a' }}>{Math.round((insAlloc[r.id] || { own: 0 }).own * 10) / 10}</span> },
    { title: '需租赁', key: 'rent', width: 66, align: 'center',
      render: (_v, r) => <span style={{ fontWeight: 600, color: '#d97706' }}>{Math.round((insAlloc[r.id] || { rent: 0 }).rent * 10) / 10}</span> },
    { title: '天数', dataIndex: 'days', width: 70, align: 'center',
      render: (_v, r) => canEdit
        ? <InputNumber size="small" min={1} precision={0} value={r.days ?? 40} className="rc-cell-input"
            onChange={(v) => setField(r.id, 'days', typeof v === 'number' ? v : 1)} style={{ width: '100%' }} />
        : (r.days ?? '-') },
    { title: '隐藏', dataIndex: 'hidden', width: 54, align: 'center',
      render: (_v, r) => <Switch size="small" checked={!!r.hidden} disabled={!canEdit} onChange={(v) => setHidden(r.id, v)} /> },
    { title: '备注', dataIndex: 'remark', width: 180,
      render: (_v, r) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={r.remark ?? ''} placeholder="备注（可选）"
            onChange={(e) => setField(r.id, 'remark', e.target.value)} className="rc-cell-input" />
        : (r.remark || '-') },
    ...(canEdit ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_v: unknown, r: InstrumentRow) => (
        <Popconfirm title="删除此行仪表？" onConfirm={() => delRow(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  const sumColor: CSSProperties = { color: '#6366f1', fontWeight: 600 };

  return (
    <div>
      {/* 页头 4 统计卡 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: '仪表种类', value: visible.length, color: '#6366f1' },
          { label: '需求总数', value: stats.req, color: '#6366f1' },
          { label: '自有可覆盖', value: stats.own, color: '#16a34a' },
          { label: '需租赁', value: stats.rent, color: '#d97706' },
        ].map((c, i) => (
          <div key={i} style={{ background: 'linear-gradient(135deg,#f6f5fc,#f1f0fe)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#6b6892', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* 库存覆盖提示（原 ins_lib_tip 三分支 L3715-3727） */}
      {stats.fullRows > 0 && stats.partRows === 0 && stats.rent <= 0 ? (
        <LibTip kind="ok">✅ <b>提示：</b>以下 <b>{stats.fullRows}</b> 种仪器在🏠自有资源库内数量充足，<b>无需租赁</b></LibTip>
      ) : stats.fullRows > 0 || stats.partRows > 0 ? (
        <LibTip kind="warn">⚠️ <b>提示：</b>资源库可全覆盖 {stats.fullRows} 种（{stats.libMatched} 台）、部分覆盖 {stats.partRows} 种，另有 <b>{Math.round(stats.rent * 10) / 10} 台需租赁</b></LibTip>
      ) : (
        <LibTip kind="gray">🔍 资源库暂无匹配仪器，可到「🏠 自有资源库」添加自有仪器（按名称自动匹配，无需租赁）</LibTip>
      )}

      {/* 隐藏行横幅（原 ins_hidden_banner L3728-3738） */}
      {stats.hiddenCount > 0 && (
        <LibTip kind="warn">
          🙈 已隐藏 <b>{stats.hiddenCount}</b> 项仪表（数据已保留，不计入统计与导出）。{' '}
          <Button size="small" icon={<EyeOutlined />} onClick={showAll} style={{ marginLeft: 8 }}>👁 显示全部</Button>
        </LibTip>
      )}

      {/* 表格卡片 */}
      <div style={{ background: '#f6f5fc', border: '1px solid #e9e7f4', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1e1b2e' }}>📟 工具仪表清单</span>
          <span style={{ fontSize: 12, color: '#6b6892' }}>
            {stats.libMatched > 0
              ? '🏠 已按「需求 vs 资源库自有数量」自动分配：自有优先、超出自动转为租赁'
              : '资源库暂无匹配仪器，已按需求自动算租赁；去🏠自有资源库添加仪器后可自动匹配'}
          </span>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <>
              <Button size="small" icon={<ThunderboltOutlined />} onClick={autoAssign}>⚡ 按资源库分配</Button>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addRow}>＋ 添加仪表</Button>
            </>
          )}
        </div>
        <Table<InstrumentRow>
          rowKey="id" size="small" columns={columns} dataSource={visible} pagination={false}
          className="rc-edit-table" scroll={{ x: 'max-content' }}
          locale={{ emptyText: (
            <div style={{ padding: '28px 0', textAlign: 'center', color: '#6b6892' }}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>📟</div>
              还没有仪表配置<br />点上方「<b>＋ 添加仪表</b>」开始配置
            </div>
          ) }}
          summary={() => (visible.length > 0 ? (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#f1f0fe' }}>
                <Table.Summary.Cell index={0} />
                <Table.Summary.Cell index={1}><span style={sumColor}>合计</span></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="center"><span style={sumColor}>{stats.req}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="center"><span style={{ ...sumColor, color: '#16a34a' }}>{Math.round(stats.own * 10) / 10}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={4} align="center"><span style={{ ...sumColor, color: '#d97706' }}>{Math.round(stats.rent * 10) / 10}</span></Table.Summary.Cell>
                <Table.Summary.Cell index={5} />
                <Table.Summary.Cell index={6} />
                <Table.Summary.Cell index={7} />
                {canEdit ? <Table.Summary.Cell index={8} /> : null}
              </Table.Summary.Row>
            </Table.Summary>
          ) : null)}
        />
        <div style={{ color: '#6b6892', fontSize: 12, lineHeight: 1.7, marginTop: 8 }}>
          新增行后在「测试工具」下拉中选择仪器仪表（名称来自🏠自有资源库，同名库存自动累加，也可自由输入）；「⚡ 按资源库分配」会把实时分配结果写入各行的自有/需租赁字段。
        </div>
      </div>
    </div>
  );
}
