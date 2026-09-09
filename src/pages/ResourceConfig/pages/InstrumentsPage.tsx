/**
 * 仪器仪表（移植自原工具 renderInstruments / computeInsAllocation / autoAssignInstruments）
 *  - 名称精确匹配资源库 cat==='ins' 仪器仪表：自有 = min(需求, 库存)，超出自动转租赁
 *  - 「库存 / 自有 / 需租赁」为只读核算列
 *  - 「按资源库自动分配」：把当前核算结果写回各行 own/rent 落库（原 autoAssignInstruments）
 */
import { Button, Card, Empty, message, Space, Tooltip } from 'antd';
import { DashboardOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { computeInsAllocation } from '../calc';
import { num, uid } from '../types';
import type { RcInstrument } from '../types';
import type { RcStore } from '../store';

const GRAY = '#9d9ab8';

/** 行类型扩展：lib 仅作「库存」只读列的列键，由核算结果渲染，不落库 */
type InsRow = RcInstrument & { lib?: number };

export default function InstrumentsPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;
  const project = store.currentProject;

  if (!project) {
    return (
      <Card size="small">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择项目，再配置仪器仪表" style={{ padding: 32 }} />
      </Card>
    );
  }

  const rows = project.instruments || [];
  const alloc = computeInsAllocation(rows, store.assets);

  // 资源库仪器仪表：按名称去重、库存累计（下拉选项，label 带库存数）
  const stockByName = new Map<string, number>();
  store.assets.filter(a => a.cat === 'ins' && a.name).forEach(a => {
    stockByName.set(a.name, (stockByName.get(a.name) || 0) + num(a.count));
  });
  const nameOptions = [...stockByName.entries()].map(([name, cnt]) => ({
    value: name,
    label: `${name}（自有 ${cnt} 台）`,
  }));

  const sumDemand = rows.reduce((s, r) => s + num(r.demand), 0);
  const sumOwn = alloc.reduce((s, a) => s + a.own, 0);
  const sumRent = alloc.reduce((s, a) => s + a.rent, 0);

  /** 按资源库自动分配（原 autoAssignInstruments）：核算 own/rent 写回行并保存 */
  const autoAssign = () => {
    store.patchProject({
      instruments: rows.map((r, i) => ({ ...r, own: alloc[i]?.own ?? 0, rent: alloc[i]?.rent ?? 0 })),
    });
    const matched = alloc.reduce((s, a) => s + a.own, 0);
    if (matched > 0) message.success(`已按资源库自动分配：匹配自有 ${matched} 台，超出部分自动转为租赁`);
    else message.warning('资源库中暂无匹配仪器，全部按需租赁');
  };

  const columns: EditColumn<InsRow>[] = [
    {
      key: 'name', title: '测试工具', width: 220, type: 'select', options: nameOptions,
      placeholder: nameOptions.length ? '— 请选择仪表 —' : '资源库暂无仪器仪表',
    },
    { key: 'demand', title: '需求台数', width: 90, type: 'number', align: 'right' },
    {
      key: 'lib', title: '库存', width: 74, readonly: true, align: 'right',
      render: (_v: unknown, _r: InsRow, i: number): ReactNode => {
        const a = alloc[i];
        const found = a?.found ?? false;
        return (
          <span
            style={{ fontWeight: 600, color: found ? '#6366f1' : GRAY }}
            title={found ? '资源库该名称库存合计' : '资源库暂无此仪表'}
          >
            {found ? a?.lib ?? 0 : '—'}
          </span>
        );
      },
    },
    {
      key: 'own', title: '自有', width: 70, readonly: true, align: 'right',
      render: (_v: unknown, _r: InsRow, i: number): ReactNode => {
        const own = alloc[i]?.own ?? 0;
        return <span style={{ fontWeight: 600, color: own > 0 ? '#16a34a' : GRAY }}>{own}</span>;
      },
    },
    {
      key: 'rent', title: '需租赁', width: 80, readonly: true, align: 'right',
      render: (_v: unknown, _r: InsRow, i: number): ReactNode => {
        const own = alloc[i]?.own ?? 0;
        const rent = alloc[i]?.rent ?? 0;
        const color = rent <= 0 ? GRAY : own > 0 ? '#d97706' : '#dc2626';
        return <span style={{ fontWeight: 600, color }}>{rent}</span>;
      },
    },
    { key: 'days', title: '使用天数', width: 90, type: 'number', align: 'right' },
    { key: 'remark', title: '备注', width: 150 },
  ];

  const footer = (
    <Space size={18} wrap>
      <span style={{ fontWeight: 600 }}>合计</span>
      <span>需求 <b style={{ color: '#6366f1' }}>{sumDemand}</b> 台</span>
      <span>自有 <b style={{ color: sumOwn > 0 ? '#16a34a' : GRAY }}>{sumOwn}</b> 台</span>
      <span>需租赁 <b style={{ color: sumRent > 0 ? '#dc2626' : GRAY }}>{sumRent}</b> 台</span>
    </Space>
  );

  return (
    <Card
      size="small"
      title={(
        <Space>
          <DashboardOutlined style={{ color: '#6366f1' }} />
          <span>仪器仪表</span>
          <span style={{ color: GRAY, fontSize: 12, fontWeight: 400 }}>名称精确匹配资源库：自有优先，超出库存自动转为租赁</span>
        </Space>
      )}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <span style={{ color: GRAY, fontSize: 12 }}>
          名称选项来自自有资源库「仪器仪表」分类（同名库存累计）；「库存/自有/需租赁」为自动核算列，无需手填。
        </span>
        <Tooltip title={editable ? '把当前核算结果（自有/需租赁）写回各行并保存' : '只读模式不可操作'}>
          <span>
            <Button size="small" type="primary" icon={<ThunderboltOutlined />} disabled={!editable} onClick={autoAssign}>
              按资源库自动分配
            </Button>
          </span>
        </Tooltip>
      </div>
      <EditableTable<InsRow>
        columns={columns}
        rows={rows}
        locked={locked}
        footer={footer}
        minWidth={980}
        addLabel="添加仪表"
        onChange={(next) => store.patchProject({ instruments: next })}
        newRow={() => ({ id: uid(), name: '', demand: 0, days: 0, remark: '' })}
      />
    </Card>
  );
}
