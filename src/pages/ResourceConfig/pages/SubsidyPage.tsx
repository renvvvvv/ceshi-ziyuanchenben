/**
 * 资源配置 · 岗位与补贴页
 * 编辑 subsidy 数组：岗位（原工具固定四类）/人数/天数/标准（元/天）/备注；
 * footer 用 calc.subsidyTotal 汇总补贴总额（人数 × 天数 × 标准），千元分隔 + " 元"。
 */
import { Card, Space, Typography } from 'antd';
import { MoneyCollectOutlined } from '@ant-design/icons';
import { useAuth } from '../../../store/AuthContext';
import type { RcStore } from '../store';
import EditableTable from '../components/EditableTable';
import type { EditColumn } from '../components/EditableTable';
import { num, uid } from '../types';
import { subsidyTotal } from '../calc';

/** 行类型：字面量别名（兼容 EditableTable 的 Record 约束），字段与 RcSubsidy 完全一致 */
type SubsidyRow = {
  id: string | number;
  post: string;
  count: number;
  days: number;
  rate: number;
  remark?: string;
};

/** 补贴岗位固定选项（原工具 SUBSIDY_POSTS；下拉可搜索/可清空，兼容历史自定义值） */
const POST_OPTIONS = ['测试经理', '主测岗位', '测试工程师', '实习生'].map((v) => ({ value: v, label: v }));

/** 千元分隔金额（最多保留 2 位小数） */
const fmtMoney = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

const columns: EditColumn<SubsidyRow>[] = [
  { key: 'post', title: '补贴岗位', width: 150, type: 'select', options: POST_OPTIONS },
  { key: 'count', title: '人数', width: 90, type: 'number', align: 'center' },
  { key: 'days', title: '天数', width: 90, type: 'number', align: 'center' },
  { key: 'rate', title: '标准（元/天）', width: 130, type: 'number', align: 'right' },
  { key: 'remark', title: '备注', width: 240, type: 'textarea', placeholder: '备注（可选）' },
];

export default function SubsidyPage({ store }: { store: RcStore }) {
  const { canEdit } = useAuth();
  const editable = canEdit('resourceConfig');
  const locked = !editable;

  const p = store.currentProject;
  if (!p) {
    return <Card><Typography.Text type="secondary">请先选择项目</Typography.Text></Card>;
  }

  const rows = p.subsidy ?? [];
  const sumCount = rows.reduce((s, r) => s + num(r.count), 0);
  const totalAmount = subsidyTotal(rows); // 补贴总额 = Σ 人数 × 天数 × 标准

  return (
    <Card
      size="small"
      title={
        <Space>
          <MoneyCollectOutlined style={{ color: '#6366f1' }} />
          <b>岗位与补贴</b>
          <span style={{ color: '#9d9ab8', fontSize: 12, fontWeight: 400 }}>
            岗位补贴测算：人数 × 天数 × 标准（元/天）
          </span>
        </Space>
      }
    >
      <EditableTable<SubsidyRow>
        columns={columns}
        rows={rows}
        onChange={(next) => store.patchProject({ subsidy: next })}
        newRow={() => ({ id: uid(), post: '测试经理', count: 1, days: 0, rate: 0, remark: '' })}
        locked={locked}
        addLabel="添加补贴岗位"
        minWidth={880}
        footer={
          <Space size={18} wrap>
            <span>人数合计 <b>{sumCount}</b> 人</span>
            <span>
              补贴总额 <b style={{ color: '#6366f1', fontSize: 15 }}>{fmtMoney(totalAmount)} 元</b>
            </span>
          </Space>
        }
      />
    </Card>
  );
}
