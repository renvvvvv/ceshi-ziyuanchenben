/**
 * 资源配置 · 人员组织页
 * 编辑 personnel 数组：岗位组、人数、编成说明、职责与人员名单；footer 汇总人数合计与总人数。
 * （原工具 renderPersonnel 语义；本页按平台规格编辑 count 单字段）
 */
import { Card, Space, Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import type { RcStore } from '../store';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { num, uid } from '../types';

/** 行类型：字面量别名（兼容 EditableTable 的 Record 约束），字段与 RcPersonnel 完全一致 */
type PersonnelRow = {
  id: string | number;
  post: string;
  count: number;
  duty?: string;
  division?: string;
  names?: string;
};

const columns: EditColumn<PersonnelRow>[] = [
  { key: 'post', title: '岗位组', width: 150, placeholder: '如：电气组' },
  { key: 'count', title: '人数', width: 90, type: 'number', align: 'center' },
  { key: 'division', title: '编成说明', width: 210, type: 'textarea', placeholder: '如：主测 1 人；组员 2 人' },
  { key: 'duty', title: '职责', width: 230, type: 'textarea', placeholder: '该岗位职责' },
  { key: 'names', title: '人员', width: 230, type: 'textarea', placeholder: '人员名单，顿号分隔' },
];

export default function PersonnelPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;

  const p = store.currentProject;
  if (!p) {
    return <Card><Typography.Text type="secondary">请先选择项目</Typography.Text></Card>;
  }

  const rows = p.personnel ?? [];
  const sumCount = rows.reduce((s, r) => s + num(r.count), 0); // 人数合计 = 各岗位组人数之和

  return (
    <Card
      size="small"
      title={
        <Space>
          <TeamOutlined style={{ color: '#6366f1' }} />
          <b>人员组织</b>
          <span style={{ color: '#9d9ab8', fontSize: 12, fontWeight: 400 }}>
            测试团队岗位编成、职责分工与人员名单
          </span>
        </Space>
      }
    >
      <EditableTable<PersonnelRow>
        columns={columns}
        rows={rows}
        onChange={(next) => store.patchProject({ personnel: next })}
        newRow={() => ({ id: uid(), post: '', count: 1, division: '', duty: '', names: '' })}
        locked={locked}
        addLabel="添加岗位组"
        minWidth={980}
        footer={
          <Space size={18} wrap>
            <span>岗位组 <b>{rows.length}</b> 个</span>
            <span>
              人数合计 <b style={{ color: '#6366f1', fontSize: 15 }}>{sumCount}</b> 人（总人数）
            </span>
            <span style={{ color: '#9d9ab8', fontSize: 12 }}>不含外部租赁人员</span>
          </Space>
        }
      />
    </Card>
  );
}
