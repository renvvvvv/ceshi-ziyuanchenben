/**
 * 劳务人员（移植自原工具 renderLabor / laborCalc）
 *  - 每行「核算方式」三选一：auto=强度驱动 / byman=按人数安排 / experience=凭经验
 *  - 「人数」「人天」为只读核算列，统一走 calc.laborCalc：
 *      auto：人天 = 工程量 ÷ 人效，人数 = 人天 ÷ 作业天数（四舍五入）
 *      byman / experience：人数由手动填写，人天 = 人数 × 作业天数
 *  - footer：合计人天（口径同 deliveredSummary 的 laborDays）
 */
import { Card, Empty, InputNumber, Space } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { laborCalc } from '../calc';
import { num, uid } from '../types';
import type { RcLabor } from '../types';
import type { RcStore } from '../store';

const GRAY = '#9d9ab8';

const LABOR_TYPES = ['风冷', '液冷', '集中式假负载', '其他'];
const TYPE_OPTIONS = LABOR_TYPES.map(t => ({ value: t, label: t }));
const MODE_OPTIONS = [
  { value: 'auto', label: '强度驱动' },
  { value: 'byman', label: '按人数安排' },
  { value: 'experience', label: '凭经验' },
];

/** 行类型扩展：mode/workers 参与核算并随行落库（同原工具），manDays 仅作只读列列键、不落库 */
type LaborRow = RcLabor & { mode?: string; workers?: number; manDays?: number };

/** 人天显示：保留 1 位小数去尾零 */
const fmtD = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

export default function LaborPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;
  const project = store.currentProject;

  if (!project) {
    return (
      <Card size="small">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择项目，再配置劳务人员" style={{ padding: 32 }} />
      </Card>
    );
  }

  const rows = project.labor || [];
  const sumManDays = rows.reduce((s, r) => s + laborCalc(r).manDays, 0);
  const sumWorkers = rows.reduce((s, r) => s + laborCalc(r).workers, 0);

  const columns: EditColumn<LaborRow>[] = [
    { key: 'work', title: '工作内容', width: 180, placeholder: '如 负载搬运/接线' },
    { key: 'type', title: '类型', width: 120, type: 'select', options: TYPE_OPTIONS },
    { key: 'mode', title: '核算方式', width: 120, type: 'select', options: MODE_OPTIONS },
    { key: 'qty', title: '工程量', width: 90, type: 'number', align: 'right' },
    { key: 'daily', title: '人效（强度/天）', width: 110, type: 'number', align: 'right' },
    { key: 'days', title: '作业天数', width: 90, type: 'number', align: 'right' },
    {
      key: 'manDays', title: '人天', width: 80, readonly: true, align: 'right',
      render: (_v: unknown, row: LaborRow): ReactNode => (
        <span style={{ fontWeight: 600, color: '#6366f1' }} title="使用天数(人天)：强度驱动=工程量÷人效；按人数/凭经验=人数×作业天数">
          {fmtD(laborCalc(row).manDays)}
        </span>
      ),
    },
    {
      key: 'workers', title: '人数', width: 120, readonly: true, align: 'right',
      render: (_v: unknown, row: LaborRow): ReactNode => {
        const mode = row.mode === 'byman' || row.mode === 'experience' ? row.mode : 'auto';
        const c = laborCalc(row);
        if (mode === 'auto') {
          return (
            <span style={{ fontWeight: 600, color: '#16a34a' }} title="自动核算：人数 = (工程量 ÷ 人效) ÷ 作业天数，四舍五入">
              {c.workers}
            </span>
          );
        }
        if (locked) return <span style={{ fontWeight: 600 }}>{c.workers}</span>;
        // byman / experience：人数由手动填写，人天 = 人数 × 作业天数
        return (
          <InputNumber
            size="small" min={0} precision={0} value={num(row.workers)}
            placeholder="填写人数" style={{ width: '100%' }}
            onChange={v => store.patchProject({ labor: rows.map(r => (r === row ? { ...r, workers: v ?? 0 } : r)) })}
          />
        );
      },
    },
    { key: 'note', title: '备注', width: 150, placeholder: '备注（可选）' },
  ];

  const footer = (
    <Space size={18} wrap>
      <span style={{ fontWeight: 600 }}>合计（{rows.length} 项作业）</span>
      <span>人天 <b style={{ color: '#6366f1' }}>{fmtD(sumManDays)}</b></span>
      <span>人数 <b style={{ color: '#16a34a' }}>{sumWorkers}</b></span>
    </Space>
  );

  return (
    <Card
      size="small"
      title={(
        <Space>
          <TeamOutlined style={{ color: '#6366f1' }} />
          <span>劳务人员</span>
          <span style={{ color: GRAY, fontSize: 12, fontWeight: 400 }}>「人数」「人天」由核算方式自动给出，无需手算</span>
        </Space>
      )}
    >
      <div style={{ color: GRAY, fontSize: 12, marginBottom: 10 }}>
        核算方式（每行可选）：强度驱动 = 人天 取 工程量÷人效、人数 取 人天÷作业天数；按人数安排 / 凭经验 = 手动填人数，人天 = 人数 × 作业天数。
      </div>
      <EditableTable<LaborRow>
        columns={columns}
        rows={rows}
        locked={locked}
        footer={footer}
        minWidth={1200}
        addLabel="添加作业"
        onChange={(next) => store.patchProject({ labor: next })}
        newRow={() => ({ id: uid(), work: '', type: '风冷', mode: 'auto', qty: 0, daily: 50, days: 1, workers: 0, note: '' })}
      />
    </Card>
  );
}
