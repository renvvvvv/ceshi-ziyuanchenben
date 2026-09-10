/**
 * 资源配置 · 外部人员页
 * 编辑 external 数组：外部人员（原工具固定四类专业工程师，可搜索兼容历史自定义值）、
 * 外部单位、总/踏勘/复测天数、单位与数量、备注；footer 汇总人数合计。
 */
import { Card, Space, Typography } from 'antd';
import { SolutionOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import type { RcStore } from '../store';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { num, uid } from '../types';

/**
 * 行类型：字面量别名（兼容 EditableTable 的 Record 约束）。
 * 基础字段与 RcExternal 完全一致；company 为外部单位补充说明字段（多余键随 JSON 原样存取，向后兼容）。
 */
type ExternalRow = {
  id: string | number;
  name: string;
  total: number;
  survey: number;
  retest: number;
  unit?: string;
  count?: number;
  remark?: string;
  company?: string;
};

/** 外部租赁人员名称固定四类（原工具 EXTERNAL_NAMES；旧数据自定义名称可经下拉搜索保留） */
const NAME_OPTIONS = ['电气测试工程师', '暖通测试工程师', '消防测试工程师', '弱电测试工程师'].map((v) => ({
  value: v,
  label: v,
}));

const columns: EditColumn<ExternalRow>[] = [
  { key: 'name', title: '外部人员', width: 170, type: 'select', options: NAME_OPTIONS },
  { key: 'company', title: '外部单位', width: 160, placeholder: '外部单位名称' },
  { key: 'total', title: '总天数', width: 90, type: 'number', align: 'center' },
  { key: 'survey', title: '踏勘天数', width: 95, type: 'number', align: 'center' },
  { key: 'retest', title: '复测天数', width: 95, type: 'number', align: 'center' },
  { key: 'unit', title: '单位', width: 70, placeholder: '人' },
  { key: 'count', title: '数量', width: 80, type: 'number', align: 'center' },
  { key: 'remark', title: '备注', width: 200, type: 'textarea', placeholder: '备注（可选）' },
];

export default function ExternalPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;

  const p = store.currentProject;
  if (!p) {
    return <Card><Typography.Text type="secondary">请先选择项目</Typography.Text></Card>;
  }

  const rows = p.external ?? [];
  const sumCount = rows.reduce((s, r) => s + num(r.count), 0); // 人数合计 = Σ 数量

  return (
    <Card
      size="small"
      title={
        <Space>
          <SolutionOutlined style={{ color: '#6366f1' }} />
          <b>外部人员</b>
          <span style={{ color: '#9d9ab8', fontSize: 12, fontWeight: 400 }}>
            外部租赁人员投入：单位、天数与人数
          </span>
        </Space>
      }
    >
      <EditableTable<ExternalRow>
        columns={columns}
        rows={rows}
        onChange={(next) => store.patchProject({ external: next })}
        newRow={() => ({ id: uid(), name: '电气测试工程师', total: 40, survey: 0, retest: 0, unit: '人', count: 1, remark: '' })}
        locked={locked}
        addLabel="添加外部人员"
        minWidth={980}
        footer={
          <Space size={18} wrap>
            <span>共 <b>{rows.length}</b> 类</span>
            <span>
              人数合计 <b style={{ color: '#6366f1', fontSize: 15 }}>{sumCount}</b> 人
            </span>
          </Space>
        }
      />
    </Card>
  );
}
