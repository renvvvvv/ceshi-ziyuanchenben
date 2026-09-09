/**
 * 现场耗材（移植自原工具 renderConsumables）
 *  - 列：名称 / 数量 / 单位（常用单位下拉）/ 说明
 *  - footer：分类数（有名称的行数）与数量合计（口径同 deliveredSummary 的 consCat 与 Σcount）
 */
import { Card, Empty, Space } from 'antd';
import { ToolOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { num, uid } from '../types';
import type { RcConsumable } from '../types';
import type { RcStore } from '../store';

const GRAY = '#9d9ab8';
const UNITS = ['个', '台', '卷', '箱', '瓶', '套', '米'];
const UNIT_OPTIONS = UNITS.map(u => ({ value: u, label: u }));

export default function ConsumablesPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;
  const project = store.currentProject;

  if (!project) {
    return (
      <Card size="small">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择项目，再配置现场耗材" style={{ padding: 32 }} />
      </Card>
    );
  }

  const rows = project.consumables || [];
  const catCount = rows.filter(r => r.name).length;
  const sumCount = rows.reduce((s, r) => s + num(r.count), 0);

  const columns: EditColumn<RcConsumable>[] = [
    { key: 'name', title: '名称', width: 220, placeholder: '如 标签纸 / 扎带 / 记号笔' },
    { key: 'count', title: '数量', width: 100, type: 'number', align: 'right' },
    { key: 'unit', title: '单位', width: 110, type: 'select', options: UNIT_OPTIONS },
    { key: 'note', title: '说明', width: 240, placeholder: '说明（可选）' },
  ];

  const footer = (
    <Space size={18} wrap>
      <span style={{ fontWeight: 600 }}>合计</span>
      <span><b style={{ color: '#6366f1' }}>{catCount}</b> 类</span>
      <span>数量 <b style={{ color: '#16a34a' }}>{sumCount}</b></span>
    </Space>
  );

  return (
    <Card
      size="small"
      title={(
        <Space>
          <ToolOutlined style={{ color: '#6366f1' }} />
          <span>现场耗材</span>
          <span style={{ color: GRAY, fontSize: 12, fontWeight: 400 }}>测试现场易耗品清单，按类目登记数量与单位</span>
        </Space>
      )}
    >
      <EditableTable<RcConsumable>
        columns={columns}
        rows={rows}
        locked={locked}
        footer={footer}
        minWidth={820}
        addLabel="添加耗材"
        onChange={(next) => store.patchProject({ consumables: next })}
        newRow={() => ({ id: uid(), name: '', count: 0, unit: '个', note: '' })}
      />
    </Card>
  );
}
