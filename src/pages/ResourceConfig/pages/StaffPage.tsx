/**
 * 资源配置 · 测试人员页（投入明细）
 * 编辑 staff 数组：姓名/公司/职级(T3-T7)/岗位 + 踏勘/复测/测试天数；
 * 「投入总天数」= 踏勘 + 复测 + 测试（calc.staffTotal 自动核算，只读列加粗紫色显示）；
 * 回写时同步自愈 r.total，footer 汇总总人数与总人天（口径同原工具 renderStaff）。
 */
import { Card, Space, Typography } from 'antd';
import { UserSwitchOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import type { RcStore } from '../store';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { num, uid } from '../types';
import { staffTotal } from '../calc';

/** 行类型：字面量别名（兼容 EditableTable 的 Record 约束），字段与 RcStaff 完全一致 */
type StaffRow = {
  id: string | number;
  name: string;
  company: string;
  level: string;
  post: string;
  total: number;
  survey: number;
  retest: number;
  test: number;
};

/** 职级选项：内部 T 体系（展示对应 P 职级，与部门库双轨规则一致） */
const LEVEL_OPTIONS = ['T3', 'T4', 'T5', 'T6', 'T7'].map((v) => ({
  value: v,
  label: `${v}（P${v.slice(1)}）`,
}));

const columns: EditColumn<StaffRow>[] = [
  { key: 'name', title: '姓名', width: 110, placeholder: '姓名/待定' },
  { key: 'company', title: '公司/部门', width: 150, placeholder: '所属公司' },
  { key: 'level', title: '职级', width: 115, type: 'select', options: LEVEL_OPTIONS, align: 'center' },
  { key: 'post', title: '岗位', width: 110, placeholder: '如：经理/电气' },
  { key: 'survey', title: '踏勘天数', width: 95, type: 'number', align: 'center' },
  { key: 'retest', title: '复测天数', width: 95, type: 'number', align: 'center' },
  { key: 'test', title: '测试天数', width: 95, type: 'number', align: 'center' },
  {
    key: 'total',
    title: '投入总天数',
    width: 110,
    readonly: true, // 自动核算列：踏勘 + 复测 + 测试
    align: 'center',
    render: (_v, r) => <b style={{ color: '#6366f1' }}>{staffTotal(r)}</b>,
  },
];

export default function StaffPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;

  const p = store.currentProject;
  if (!p) {
    return <Card><Typography.Text type="secondary">请先选择项目</Typography.Text></Card>;
  }

  const rows = p.staff;
  const sumSurvey = rows.reduce((s, r) => s + num(r.survey), 0);
  const sumRetest = rows.reduce((s, r) => s + num(r.retest), 0);
  const sumTest = rows.reduce((s, r) => s + num(r.test), 0);
  const totalDays = rows.reduce((s, r) => s + staffTotal(r), 0); // 总人天

  return (
    <Card
      size="small"
      title={
        <Space>
          <UserSwitchOutlined style={{ color: '#6366f1' }} />
          <b>测试人员</b>
          <span style={{ color: '#9d9ab8', fontSize: 12, fontWeight: 400 }}>
            投入明细：总天数 = 踏勘 + 复测 + 测试（自动核算）
          </span>
        </Space>
      }
    >
      <EditableTable<StaffRow>
        columns={columns}
        rows={rows}
        onChange={(next) =>
          // 同步自愈 total 字段（口径同原工具：自动核算结果写回数据）
          store.patchProject({ staff: next.map((r) => ({ ...r, total: staffTotal(r) })) })
        }
        newRow={() => ({ id: uid(), name: '', company: '', level: 'T5', post: '', total: 40, survey: 0, retest: 0, test: 40 })}
        locked={locked}
        addLabel="添加人员"
        minWidth={1000}
        footer={
          <Space size={18} wrap>
            <span>总人数 <b>{rows.length}</b> 人</span>
            <span>踏勘 <b>{sumSurvey}</b> 天</span>
            <span>复测 <b>{sumRetest}</b> 天</span>
            <span>测试 <b>{sumTest}</b> 天</span>
            <span>
              总人天 <b style={{ color: '#6366f1', fontSize: 15 }}>{totalDays}</b>
            </span>
          </Space>
        }
      />
    </Card>
  );
}
