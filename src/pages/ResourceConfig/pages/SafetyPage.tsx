/**
 * 劳保用品（移植自原工具 renderSafety）
 *  - 列：名称 / 数量 / 单位（常用单位下拉）/ 备注
 *  - footer：数量合计（Σcount）
 */
import { Card, Empty, Space } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { num, uid } from '../types';
import type { RcSafety } from '../types';
import type { RcStore } from '../store';

const GRAY = '#9d9ab8';
const UNITS = ['个', '台', '卷', '箱', '瓶', '套', '米'];
const UNIT_OPTIONS = UNITS.map(u => ({ value: u, label: u }));

export default function SafetyPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;
  const project = store.currentProject;

  if (!project) {
    return (
      <Card size="small">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="请先选择项目，再配置劳保用品" style={{ padding: 32 }} />
      </Card>
    );
  }

  const rows = project.safety || [];
  const sumCount = rows.reduce((s, r) => s + num(r.count), 0);

  const columns: EditColumn<RcSafety>[] = [
    { key: 'name', title: '名称', width: 220, placeholder: '如 安全帽 / 绝缘手套 / 反光背心' },
    { key: 'count', title: '数量', width: 100, type: 'number', align: 'right' },
    { key: 'unit', title: '单位', width: 110, type: 'select', options: UNIT_OPTIONS },
    { key: 'note', title: '备注', width: 240, placeholder: '备注（可选）' },
  ];

  const footer = (
    <Space size={18} wrap>
      <span style={{ fontWeight: 600 }}>合计数量</span>
      <b style={{ color: '#6366f1' }}>{sumCount}</b>
    </Space>
  );

  return (
    <Card
      size="small"
      title={(
        <Space>
          <SafetyCertificateOutlined style={{ color: '#6366f1' }} />
          <span>劳保用品</span>
          <span style={{ color: GRAY, fontSize: 12, fontWeight: 400 }}>现场安全防护用品清单，按人数与周期备量</span>
        </Space>
      )}
    >
      <EditableTable<RcSafety>
        columns={columns}
        rows={rows}
        locked={locked}
        footer={footer}
        minWidth={820}
        addLabel="添加劳保用品"
        onChange={(next) => store.patchProject({ safety: next })}
        newRow={() => ({ id: uid(), name: '', count: 0, unit: '个', note: '' })}
      />
    </Card>
  );
}
