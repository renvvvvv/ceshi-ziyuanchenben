/**
 * 劳务人员使用天数 Tab
 *
 * 1:1 复刻原工具 renderLabor / bindLabor / autoFillLaborQty / resetLaborWorkers
 * （原 index.html L4114-4269）：三模式核算（强度驱动 / 按人数安排 / 自己凭经验判断），
 * auto 模式「需要人数」自动派生（未自定义时）或手填覆盖（标记自定义，可 ↺ 还原）。
 * 修改全部通过 props.patch 提交；派生 workers 按原公式同步写入。
 */
import { useMemo } from 'react';
import { Table, Button, Input, InputNumber, Select, Tag, Tooltip, Popconfirm, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined, UndoOutlined, ImportOutlined } from '@ant-design/icons';
import {
  calcLabor,
  type ResourceConfigProject, type AssetLibItem, type LaborRow, type LaborLoadType, type LaborMode,
} from '../../../types/resourceConfig';
import { useIsMobile } from '../../../hooks/useIsMobile';

export interface TabProps {
  data: ResourceConfigProject;
  assets: AssetLibItem[];
  canEdit: boolean;
  patch: (updates: Partial<ResourceConfigProject>) => void;
}

const { TextArea } = Input;

/** id 生成（CONVENTIONS 统一规则） */
const genId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 数值显示：保留 1 位小数并去掉末尾 .0（原 fmtDays） */
const fmtDays = (v: number): string => (Math.round(v * 10) / 10).toString().replace(/\.0$/, '');

/** 负载类型下拉（原 renderLabor L4165：带 emoji 的显示标签） */
const TYPE_OPTIONS: Array<{ value: LaborLoadType; label: string }> = [
  { value: '风冷', label: '❄️ 风冷负载' },
  { value: '液冷', label: '💧 液冷负载' },
  { value: '集中式假负载', label: '⚡ 集中式假负载' },
  { value: '其他', label: '其他' },
];

/** 核算模式下拉（值 auto/byman/experience，显示中文标签，原 L4167-4171） */
const MODE_OPTIONS: Array<{ value: LaborMode; label: string }> = [
  { value: 'auto', label: '强度驱动(现状)' },
  { value: 'byman', label: '按人数安排' },
  { value: 'experience', label: '自己凭经验判断' },
];

/** 归一化核算模式（calcLabor 同款判定） */
const normMode = (m: string | undefined): LaborMode =>
  m === 'byman' ? 'byman' : m === 'experience' ? 'experience' : 'auto';

/** auto 且未自定义时，把派生「需要人数」同步写入行数据（视图与入库口径一致） */
function withDerived(r: LaborRow): LaborRow {
  const c = calcLabor(r);
  if (c.mode === 'auto' && !r.workersCustom) return { ...r, workers: c.workers };
  return r;
}

export default function LaborTab({ data, canEdit, patch }: TabProps) {
  const rows: LaborRow[] = data.labor || [];
  const isMobile = useIsMobile();

  /** 每行核算结果（依赖 rows 引用变化重算） */
  const calcs = useMemo(() => rows.map((r) => calcLabor(r)), [rows]);
  const sumManDays = calcs.reduce((s, c) => s + c.manDays, 0);
  const sumWorkers = calcs.reduce((s, c) => s + c.workers, 0);
  const autoCount = calcs.filter((c) => c.mode === 'auto').length;

  /** 整表提交 */
  const commit = (next: LaborRow[]) => patch({ labor: next });

  const update = (id: string, partial: Partial<LaborRow>) => {
    commit(rows.map((r) => (r.id === id ? withDerived({ ...r, ...partial }) : r)));
  };

  /**
   * 数字字段编辑（原 bindLabor input 分支 L4217-4248）：
   * - qty/daily/days：直接写值，auto 未自定义时派生 workers 同步
   * - workers：auto（非 byman/experience）下手填 → 标记 workersCustom（仅影响用工合计，不改使用天数）
   */
  const setNum = (id: string, key: 'qty' | 'daily' | 'days' | 'workers', v: number | null) => {
    const val = v ?? 0;
    commit(rows.map((r) => {
      if (r.id !== id) return r;
      let next: LaborRow;
      if (key === 'workers') next = { ...r, workers: val };
      else if (key === 'daily') next = { ...r, daily: val };
      else if (key === 'days') next = { ...r, days: val };
      else next = { ...r, qty: val };
      if (key === 'workers' && next.mode !== 'byman' && next.mode !== 'experience') {
        next = { ...next, workersCustom: true };
      }
      return withDerived(next);
    }));
  };

  /** 核算模式切换（原 bindLabor change 分支 L4256：仅改 mode，其余字段全部保留后整表重渲） */
  const setMode = (id: string, mode: LaborMode) => {
    commit(rows.map((r) => (r.id === id ? withDerived({ ...r, mode }) : r)));
  };

  /** 强度驱动下取消自定义人数，还原为自动核算（原 resetLaborWorkers L4197-4202） */
  const resetWorkers = (id: string) => {
    commit(rows.map((r) => (r.id === id ? withDerived({ ...r, workersCustom: false, workers: 0 }) : r)));
  };

  /** 添加作业（原 addLaborRow L4187-4191 默认值，注意 daily 默认 50） */
  const addRow = () => {
    commit([...rows, {
      id: genId(), work: '', type: '风冷', qty: 0, daily: 50, days: 1,
      workers: 0, mode: 'auto', workersCustom: false, note: '',
    }]);
  };

  const delRow = (id: string) => {
    commit(rows.filter((r) => r.id !== id));
  };

  /** 从假负载计划按类型自动带出总台数（原 autoFillLaborQty L4203-4212） */
  const autoFillQty = () => {
    const loads = data.loads || [];
    commit(rows.map((r) => {
      const kw = r.type === '风冷' ? '风冷' : r.type === '液冷' ? '液冷' : '集中式';
      return withDerived({
        ...r,
        qty: loads
          .filter((l) => String(l.type || '').includes(kw))
          .reduce((s, l) => s + (Number(l.count) || 0), 0),
      });
    }));
    message.success('已按假负载计划自动带出数量');
  };

  const columns: ColumnsType<LaborRow> = [
    {
      title: '#', key: '__idx', width: 40, align: 'center',
      render: (_: unknown, _r: LaborRow, i: number) => (
        <span style={{ color: '#9d9ab8', fontSize: 11 }}>{i + 1}</span>
      ),
    },
    {
      title: '工作内容', dataIndex: 'work', width: 150,
      render: (_: unknown, r: LaborRow) => (
        <Input size="small" className="rc-cell-input" value={r.work ?? ''} disabled={!canEdit}
          placeholder="如：假负载搬运上架" onChange={(e) => update(r.id, { work: e.target.value })} />
      ),
    },
    {
      title: '负载类型', dataIndex: 'type', width: 110,
      render: (_: unknown, r: LaborRow) => (
        <Select size="small" style={{ width: '100%' }} value={r.type || '风冷'} disabled={!canEdit}
          options={TYPE_OPTIONS} onChange={(v) => update(r.id, { type: v as LaborLoadType })} />
      ),
    },
    {
      title: '核算模式', dataIndex: 'mode', width: 125,
      render: (_: unknown, r: LaborRow) => (
        <Select size="small" style={{ width: '100%' }} value={normMode(r.mode)} disabled={!canEdit}
          options={MODE_OPTIONS} onChange={(v) => setMode(r.id, v as LaborMode)} />
      ),
    },
    {
      title: '作业数量(台)', dataIndex: 'qty', width: 90, align: 'center',
      render: (_: unknown, r: LaborRow) => (
        <InputNumber size="small" className="rc-cell-input" min={0} value={Number(r.qty) || 0}
          disabled={!canEdit} style={{ width: '100%' }} onChange={(v) => setNum(r.id, 'qty', v)} />
      ),
    },
    {
      title: '每人每天台数', dataIndex: 'daily', width: 100, align: 'center',
      render: (_: unknown, r: LaborRow, i: number) => {
        const c = calcs[i];
        if (c.mode === 'auto') {
          // 仅强度驱动可编辑
          return (
            <InputNumber size="small" className="rc-cell-input" min={0} value={Number(r.daily) || 0}
              disabled={!canEdit} style={{ width: '100%' }} onChange={(v) => setNum(r.id, 'daily', v)} />
          );
        }
        if (c.mode === 'byman') {
          // 反推参考值：作业数量 ÷ 人天（灰显只读，原 L4152）
          return (
            <Tooltip title="反推：作业数量 ÷ 人天（=人数×作业天数），仅作效率参考">
              <span style={{ color: '#6b6892' }}>{fmtDays(c.daily)}</span>
            </Tooltip>
          );
        }
        // 凭经验：不涉及强度计算（原 L4154）
        return (
          <Tooltip title="凭经验直接填人数，不涉及强度计算">
            <span style={{ color: '#6b6892' }}>—</span>
          </Tooltip>
        );
      },
    },
    {
      title: '使用天数(人天)', key: '__md', width: 95, align: 'center',
      render: (_: unknown, _r: LaborRow, i: number) => (
        <Tooltip title="使用天数(人天)：强度驱动=数量÷强度；按人数=人数×作业天数">
          <span style={{ color: '#6366f1', fontWeight: 600 }}>{fmtDays(calcs[i].manDays)}</span>
        </Tooltip>
      ),
    },
    {
      title: '作业天数', dataIndex: 'days', width: 85, align: 'center',
      render: (_: unknown, r: LaborRow) => (
        <InputNumber size="small" className="rc-cell-input" min={1} value={Number(r.days) || 0}
          disabled={!canEdit} style={{ width: '100%' }} onChange={(v) => setNum(r.id, 'days', v)} />
      ),
    },
    {
      title: <span>需要人数<span style={{ fontWeight: 400, color: '#6b6892', fontSize: 11 }}>（强度驱动可自定义 ↺）</span></span>,
      dataIndex: 'workers', width: 140, align: 'center',
      render: (_: unknown, r: LaborRow, i: number) => {
        const c = calcs[i];
        if (c.mode !== 'auto') {
          // byman / experience：人数由用户填写
          return (
            <InputNumber size="small" className="rc-cell-input" min={0} value={c.workers}
              disabled={!canEdit} style={{ width: '100%' }} onChange={(v) => setNum(r.id, 'workers', v)} />
          );
        }
        // auto：未自定义时显示派生值（绿），手填后标记自定义并可还原（原 L4156-4160）
        const derived = !r.workersCustom;
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <Tooltip title="强度驱动下可直接覆盖需要人数（自动值作参考），点 ↺ 还原">
              <InputNumber size="small" className={derived ? 'rc-labor-wk-auto' : undefined}
                min={0} value={c.workers} disabled={!canEdit} style={{ width: 64 }}
                onChange={(v) => setNum(r.id, 'workers', v)} />
            </Tooltip>
            <Tooltip title="还原为自动核算人数">
              <Button type="text" size="small" icon={<UndoOutlined />} disabled={!r.workersCustom || !canEdit}
                onClick={() => resetWorkers(r.id)} style={{ width: 24, minWidth: 24, height: 22 }} />
            </Tooltip>
            {r.workersCustom && (
              <Tooltip title="已自定义人数">
                <span style={{ fontSize: 11, lineHeight: '18px', color: '#d97706', background: 'rgba(217,119,6,0.08)',
                  border: '1px solid rgba(217,119,6,0.4)', borderRadius: 4, padding: '0 4px', whiteSpace: 'nowrap' }}>
                  ✎ 自定义
                </span>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: '备注', dataIndex: 'note',
      render: (_: unknown, r: LaborRow) => (
        <TextArea size="small" className="rc-cell-input" autoSize={{ minRows: 1, maxRows: 4 }}
          value={r.note ?? ''} disabled={!canEdit} placeholder="备注（可选）"
          onChange={(e) => update(r.id, { note: e.target.value })} />
      ),
    },
    {
      title: '', key: '__op', width: 44, align: 'center',
      render: (_: unknown, r: LaborRow) => (
        <Popconfirm title="删除该作业？" onConfirm={() => delRow(r.id)} okText="删除" cancelText="取消"
          okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={!canEdit} style={{ width: 30 }} />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      {/* auto 模式派生人数绿色显示（InputNumber 内层 input 需 CSS 覆盖） */}
      <style>{`
        .rc-labor-wk-auto .ant-input-number-input {
          color: #16a34a !important;
          font-weight: 600 !important;
        }
      `}</style>

      {/* 页头统计卡：劳务人天合计 / 劳务人数合计 / 工作项数 / 强度驱动项数 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        {([
          { label: '👷 劳务人天合计（Σ 各作业使用人天）', value: fmtDays(sumManDays), color: '#6366f1' },
          { label: '🧑‍🤝‍🧑 每日用工合计（Σ各作业需要人数）', value: sumWorkers, color: '#16a34a' },
          { label: '工作项数', value: rows.length, color: '#6366f1' },
          { label: '强度驱动项数', value: autoCount, color: '#6366f1' },
        ] as Array<{ label: string; value: string | number; color: string }>).map((c, i) => (
          <div key={i} style={{
            background: 'linear-gradient(135deg,#f6f5fc,#f1f0fe)',
            border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, padding: '12px 16px',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#6b6892', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* 模式说明（原页头 hint L932，扩为三模式） */}
      <div style={{
        fontSize: 12, color: '#6b6892', lineHeight: 1.8,
        background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)',
        borderRadius: 10, padding: '8px 12px', marginBottom: 14,
      }}>
        📐 <b style={{ color: '#46436a' }}>三种核算模式（每行可切换）：</b><br />
        ① <b>强度驱动（现状）</b>：填【作业数量 + 每人每天台数 + 作业天数】→ 使用天数(人天)=数量÷强度、需要人数=人天÷作业天数（向上取整），未自定义时人数实时联动；<br />
        ② <b>按人数安排</b>：填【作业数量 + 需要人数 + 作业天数】→ 使用天数(人天)=人数×作业天数，强度反推显示仅作效率参考；<br />
        ③ <b>自己凭经验判断</b>：直接填需要人数，不带入任何公式（强度列显示 —，人天=人数×作业天数仅用于汇总）。强度驱动下「需要人数」也可手动覆盖，点 ↺ 一键还原。
      </div>

      {/* 明细表 */}
      <div style={{ background: '#f6f5fc', border: '1px solid #e9e7f4', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, flexWrap: isMobile ? 'wrap' : 'nowrap', rowGap: isMobile ? 6 : undefined }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1e1b2e' }}>👷 劳务作业用工明细</span>
          <Tag style={{ margin: '0 0 0 8px' }}>{rows.length} 项</Tag>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <>
              <Button size="small" icon={<ImportOutlined />} onClick={autoFillQty}
                disabled={rows.length === 0} style={{ marginRight: 8 }}>
                从假负载带出数量
              </Button>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addRow}>添加作业</Button>
            </>
          )}
        </div>
        <Table<LaborRow> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={false}
          className="rc-edit-table" scroll={{ x: 'max-content' }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row style={{ background: '#f1f0fe' }}>
                <Table.Summary.Cell index={0} />
                <Table.Summary.Cell index={1} colSpan={5} align="right">
                  <span style={{ color: '#6366f1', fontWeight: 600, fontSize: 12 }}>合计（{rows.length} 项作业）</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="center">
                  <span style={{ color: '#6366f1', fontWeight: 600 }}>{fmtDays(sumManDays)}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={7} />
                <Table.Summary.Cell index={8} align="center">
                  <span style={{ color: '#6366f1', fontWeight: 600 }}>{sumWorkers}</span>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={9} />
                <Table.Summary.Cell index={10} />
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
        <div style={{ marginTop: 6, fontSize: 12, color: '#9d9ab8' }}>
          「从假负载带出数量」：按每行负载类型（风冷 / 液冷 / 集中式）汇总假负载计划的数量列，自动填入作业数量。
        </div>
      </div>
    </div>
  );
}
