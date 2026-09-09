/**
 * 假负载计划（移植自原工具 renderLoads / computeLoadAllocation）
 *  - 总需求 = 数量 + 备用台数（ratio 字段复用为「备用台数」）
 *  - 分配依据自有资源库：假负载（load）按规格功率 KW 匹配、PDU 按名称匹配
 *  - 「自有 / 需租赁」为只读核算列：资源库优先覆盖为自有，超出自动转租赁
 */
import { Card, Empty, Space } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { computeLoadAllocation } from '../calc';
import { num, uid } from '../types';
import type { RcLoad } from '../types';
import type { RcStore } from '../store';

const GRAY = '#9d9ab8';

export default function LoadsPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;
  const project = store.currentProject;

  if (!project) {
    return (
      <Card size="small">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择项目，再配置假负载计划" style={{ padding: 32 }} />
      </Card>
    );
  }

  const rows = project.loads || [];
  const alloc = computeLoadAllocation(rows, store.assets);
  const sumCount = rows.reduce((s, r) => s + num(r.count), 0);
  const sumOwn = alloc.reduce((s, a) => s + a.own, 0);
  const sumRent = alloc.reduce((s, a) => s + a.rent, 0);

  const columns: EditColumn<RcLoad>[] = [
    { key: 'type', title: '类型', width: 170, placeholder: '如 机架式假负载6KW / 🛒 租赁' },
    { key: 'spec', title: '规格', width: 130, placeholder: '如 6KW/台 带电源线' },
    { key: 'count', title: '数量', width: 90, type: 'number', align: 'right' },
    { key: 'ratio', title: '备用台数', width: 90, type: 'number', align: 'right' },
    {
      key: 'own', title: '自有/台', width: 84, readonly: true, align: 'right',
      render: (_v: unknown, _r: RcLoad, i: number): ReactNode => {
        const own = alloc[i]?.own ?? 0;
        return <span style={{ fontWeight: 600, color: own > 0 ? '#16a34a' : GRAY }}>{own}</span>;
      },
    },
    {
      key: 'rent', title: '需租赁/台', width: 94, readonly: true, align: 'right',
      render: (_v: unknown, _r: RcLoad, i: number): ReactNode => {
        const own = alloc[i]?.own ?? 0;
        const rent = alloc[i]?.rent ?? 0;
        // 0 灰色；部分租赁（有自有兜底）橙色；全部需租赁（最显著）红色
        const color = rent <= 0 ? GRAY : own > 0 ? '#d97706' : '#dc2626';
        return <span style={{ fontWeight: 600, color }}>{rent}</span>;
      },
    },
    { key: 'arrive', title: '到场日期', width: 100, type: 'date' },
    { key: 'start', title: '开始日期', width: 100, type: 'date' },
    { key: 'end', title: '结束日期', width: 100, type: 'date' },
    { key: 'leave', title: '撤场日期', width: 100, type: 'date' },
    { key: 'remark', title: '备注', width: 150 },
  ];

  const footer = (
    <Space size={18} wrap>
      <span style={{ fontWeight: 600 }}>合计</span>
      <span>数量 <b style={{ color: '#6366f1' }}>{sumCount}</b> 台</span>
      <span>自有 <b style={{ color: sumOwn > 0 ? '#16a34a' : GRAY }}>{sumOwn}</b> 台</span>
      <span>需租赁 <b style={{ color: sumRent > 0 ? '#dc2626' : GRAY }}>{sumRent}</b> 台</span>
    </Space>
  );

  return (
    <Card
      size="small"
      title={(
        <Space>
          <DatabaseOutlined style={{ color: '#6366f1' }} />
          <span>假负载计划</span>
          <span style={{ color: GRAY, fontSize: 12, fontWeight: 400 }}>总需求 = 数量 + 备用台数，资源库优先覆盖为自有，超出自动转租赁</span>
        </Space>
      )}
    >
      <div style={{ color: GRAY, fontSize: 12, marginBottom: 10 }}>
        分配依据自有资源库：假负载（load）按规格中的功率 KW 匹配、PDU 按名称匹配；「自有/需租赁」列为自动核算，无需手填。
      </div>
      <EditableTable<RcLoad>
        columns={columns}
        rows={rows}
        locked={locked}
        footer={footer}
        minWidth={1300}
        addLabel="添加负载"
        onChange={(next) => store.patchProject({ loads: next })}
        newRow={() => ({
          id: uid(), type: '', spec: '', count: 0, ratio: 0,
          arrive: '', start: '', end: '', leave: '', remark: '',
        })}
      />
    </Card>
  );
}
