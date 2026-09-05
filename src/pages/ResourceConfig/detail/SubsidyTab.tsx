/**
 * 岗位与补贴 Tab —— 复刻原工具「岗位与补贴」页（index.html L2764-2877）
 *  - 岗位补贴（renderSubsidy + bindSubsidy：测试岗位→角色联动人数/天数提示）
 *  - 一键同步人数（syncSubsidyFromStaff：补贴人数 = 同角色投入行数）
 *  - 外部租赁人员（renderExternal + bindExternal）
 */
import type { CSSProperties } from 'react';
import { Table, Button, Input, InputNumber, Select, Tag, Popconfirm, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  subsidyPostToRole, deriveRole, SUBSIDY_POSTS,
  type ResourceConfigProject, type AssetLibItem,
  type SubsidyRow, type ExternalRow, type StaffRow,
} from '../../../types/resourceConfig';

const { TextArea } = Input;

interface TabProps {
  data: ResourceConfigProject;
  assets: AssetLibItem[];
  canEdit: boolean;
  patch: (updates: Partial<ResourceConfigProject>) => void;
}

// ============== 统一样式（CONVENTIONS.md） ==============

const CARD: CSSProperties = {
  background: '#f6f5fc',
  border: '1px solid #e9e7f4',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const CARD_TITLE: CSSProperties = { fontSize: 14, fontWeight: 600, color: '#1e1b2e' };
const CARD_SUB: CSSProperties = { fontSize: 12, color: '#6b6892', marginLeft: 8 };
const SUMMARY_BG: CSSProperties = { background: '#f1f0fe' };
const SUMMARY_TEXT: CSSProperties = { color: '#6366f1', fontWeight: 600, fontSize: 12 };
const NUM_COLOR = '#6366f1';
/** 联动提示：浅色小字（原 .link-hint，带 🔗/📅 图标） */
const LINK_HINT: CSSProperties = { fontSize: 11, color: '#6b6892', marginTop: 2, lineHeight: '16px' };

// ============== 工具函数（逻辑照抄原工具） ==============

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

const genId = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 投入总天数 = 踏勘 + 复测 + 测试（原 staffTotal L2633） */
const staffTotal = (r: StaffRow): number => num(r.survey) + num(r.retest) + num(r.test);

/** 角色判定：无显式 role 时按岗位名推断（原 s.role||deriveRole(s.post)） */
const effectiveRole = (r: StaffRow): string => String(r.role || deriveRole(r.post));

/** 投入明细中某「角色」的实际人数（原 staffCountByRoleOnly L2570，用于补贴按角色联动） */
function staffCountByRoleOnly(p: ResourceConfigProject, role: string): number {
  if (!role) return 0;
  const want = String(role).trim();
  return (p.staff || []).filter((s) => effectiveRole(s) === want).length;
}

/**
 * 投入明细中某「角色」的累计投入天数（原 staffDaysByRole L2563）：
 * Σ num(total || 踏勘+复测+测试)（随投入分项天数变化联动）
 */
function staffDaysByRole(p: ResourceConfigProject, role: string): number {
  if (!role) return 0;
  const want = String(role).trim();
  return (p.staff || []).filter((s) => effectiveRole(s) === want)
    .reduce((sum, s) => sum + num(s.total || staffTotal(s)), 0);
}

/** 下拉选项：固定三类 + 兜底保留存量自定义值（原 subsidyPostOptions L2526） */
function withExtra(base: string[], current?: string | null): string[] {
  const v = String(current ?? '').trim();
  return v && !base.includes(v) ? [...base, v] : base;
}

// ============== 组件 ==============

export default function SubsidyTab({ data, canEdit, patch }: TabProps) {
  const staff = data.staff || [];
  const subsidy = data.subsidy || [];
  const external = data.external || [];

  /* 页头统计（原 st_man_days / st_subsidy_count / st_ext_count） */
  const manDays = staff.reduce((s, r) => s + staffTotal(r), 0);
  const subsidyCount = subsidy.reduce((s, r) => s + num(r.count), 0);

  /* ---------- a) 岗位补贴（原 renderSubsidy L2764） ---------- */
  const patchSubsidy = (id: string, field: 'post' | 'count' | 'remark', v: string | number) => {
    patch({
      subsidy: subsidy.map((r) => {
        if (r.id !== id) return r;
        const next: Record<string, any> = { ...r };
        next[field] = field === 'count' ? num(v) : v;
        return next as SubsidyRow;
      }),
    });
  };

  /** 一键同步人数：每行补贴人数 = 投入明细同角色行数（原 syncSubsidyFromStaff L2790） */
  const syncFromStaff = () => {
    let synced = 0;
    patch({
      subsidy: subsidy.map((r) => {
        if (!r.post) return r;
        synced++;
        return { ...r, count: staffCountByRoleOnly(data, subsidyPostToRole(r.post)) };
      }),
    });
    message.success(`已按角色同步 ${synced} 行补贴人数为投入明细实际人数`);
  };

  const addSubsidyRow = () => {
    patch({ subsidy: [...subsidy, { id: genId(), post: '测试经理', count: 1, remark: '' }] });
  };

  /**
   * 每行的联动值：补贴测试岗位 → 投入明细「角色」，按角色汇总人数与累计投入天数
   * （岗位切换时随 patch 重渲染实时刷新，对应原 bindSubsidy 的 change 联动）
   */
  const renderSubsidyColumns: ColumnsType<SubsidyRow> = [
    { title: '#', key: 'idx', width: 40, align: 'center',
      render: (_: unknown, __: SubsidyRow, i: number) => <span style={{ color: '#9d9ab8', fontSize: 11 }}>{i + 1}</span> },
    { title: '测试岗位', dataIndex: 'post', width: 170,
      render: (t: string, r: SubsidyRow) => canEdit
        ? <Select size="small" style={{ width: '100%' }} value={t || undefined} placeholder="选择测试岗位"
            options={withExtra(SUBSIDY_POSTS, t).map((p) => ({ value: p, label: p }))}
            onChange={(v) => patchSubsidy(r.id, 'post', v ?? '')} />
        : (t || '-') },
    { title: '人数', dataIndex: 'count', width: 120,
      render: (t: number, r: SubsidyRow) => {
        const role = r.post ? subsidyPostToRole(r.post) : '';
        const linked = r.post ? staffCountByRoleOnly(data, role) : null;
        return (
          <div>
            {canEdit ? (
              <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchSubsidy(r.id, 'count', v ?? 0)}
                style={{ width: '100%' }} className="rc-cell-input" />
            ) : (
              <span>{t}</span>
            )}
            {linked != null && (
              <div style={LINK_HINT} title={`取自「测试人员投入明细」角色=${role} 的实际人数`}>🔗 投入明细 {linked} 人</div>
            )}
          </div>
        );
      } },
    { title: '关联天数', key: 'linkdays', width: 130,
      render: (_: unknown, r: SubsidyRow) => {
        const role = r.post ? subsidyPostToRole(r.post) : '';
        const linkDays = r.post ? staffDaysByRole(data, role) : 0;
        return (
          <div>
            <span style={{ fontWeight: 600, color: NUM_COLOR }}>{linkDays}</span>
            {linkDays > 0 && (
              <div style={LINK_HINT} title={`取自「测试人员投入明细」角色=${role} 的累计投入天数（踏勘+复测+测试）`}>
                📅 明细 {linkDays} 天
              </div>
            )}
          </div>
        );
      } },
    { title: '备注', dataIndex: 'remark',
      render: (t: string, r: SubsidyRow) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 3 }} className="rc-cell-input" value={t ?? ''}
            placeholder="备注（可选）" onChange={(e) => patchSubsidy(r.id, 'remark', e.target.value)} />
        : (t || '-') },
    ...(canEdit ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_: unknown, r: SubsidyRow) => (
        <Popconfirm title="删除该补贴行？" onConfirm={() => patch({ subsidy: subsidy.filter((x) => x.id !== r.id) })}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  const subsidySummary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={SUMMARY_BG}>
        <Table.Summary.Cell index={0} />
        <Table.Summary.Cell index={1}><span style={SUMMARY_TEXT}>合计</span></Table.Summary.Cell>
        <Table.Summary.Cell index={2} align="center"><span style={SUMMARY_TEXT}>{subsidyCount}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={3} />
        <Table.Summary.Cell index={4} />
        {canEdit ? <Table.Summary.Cell index={5} /> : null}
      </Table.Summary.Row>
    </Table.Summary>
  );

  /* ---------- b) 外部租赁人员（原 renderExternal L2841） ---------- */
  const patchExternal = (id: string, field: string, v: string | number) => {
    patch({
      external: external.map((r) => {
        if (r.id !== id) return r;
        const next: Record<string, any> = { ...r };
        next[field] = ['total', 'survey', 'retest', 'count'].includes(field) ? num(v) : v;
        return next as ExternalRow;
      }),
    });
  };

  const addExternalRow = () => {
    patch({ external: [...external, { id: genId(), name: '', total: 40, survey: 3, retest: 2, unit: '人', count: 1, remark: '' }] });
  };

  const sumExtTotal = external.reduce((s, r) => s + num(r.total), 0);
  const sumExtSurvey = external.reduce((s, r) => s + num(r.survey), 0);
  const sumExtRetest = external.reduce((s, r) => s + num(r.retest), 0);
  const sumExtCount = external.reduce((s, r) => s + num(r.count), 0);

  const externalColumns: ColumnsType<ExternalRow> = [
    { title: '#', key: 'idx', width: 40, align: 'center',
      render: (_: unknown, __: ExternalRow, i: number) => <span style={{ color: '#9d9ab8', fontSize: 11 }}>{i + 1}</span> },
    { title: '名称', dataIndex: 'name', width: 160,
      render: (t: string, r: ExternalRow) => canEdit
        ? <Input size="small" className="rc-cell-input" value={t ?? ''} onChange={(e) => patchExternal(r.id, 'name', e.target.value)} />
        : (t || '-') },
    { title: '需求总天数', dataIndex: 'total', width: 100, align: 'center',
      render: (t: number, r: ExternalRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchExternal(r.id, 'total', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '工勘天数', dataIndex: 'survey', width: 100, align: 'center',
      render: (t: number, r: ExternalRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchExternal(r.id, 'survey', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '复测天数', dataIndex: 'retest', width: 100, align: 'center',
      render: (t: number, r: ExternalRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchExternal(r.id, 'retest', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '单位', dataIndex: 'unit', width: 80,
      render: (t: string, r: ExternalRow) => canEdit
        ? <Input size="small" className="rc-cell-input" value={t ?? ''} onChange={(e) => patchExternal(r.id, 'unit', e.target.value)} />
        : (t || '-') },
    { title: '数量', dataIndex: 'count', width: 90, align: 'center',
      render: (t: number, r: ExternalRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchExternal(r.id, 'count', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '备注', dataIndex: 'remark',
      render: (t: string, r: ExternalRow) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 3 }} className="rc-cell-input" value={t ?? ''}
            placeholder="备注（可选）" onChange={(e) => patchExternal(r.id, 'remark', e.target.value)} />
        : (t || '-') },
    ...(canEdit ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_: unknown, r: ExternalRow) => (
        <Popconfirm title="删除该人员行？" onConfirm={() => patch({ external: external.filter((x) => x.id !== r.id) })}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  const externalSummary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={SUMMARY_BG}>
        <Table.Summary.Cell index={0} />
        <Table.Summary.Cell index={1}><span style={SUMMARY_TEXT}>小计</span></Table.Summary.Cell>
        <Table.Summary.Cell index={2} align="center"><span style={SUMMARY_TEXT}>{sumExtTotal}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={3} align="center"><span style={SUMMARY_TEXT}>{sumExtSurvey}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={4} align="center"><span style={SUMMARY_TEXT}>{sumExtRetest}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={5} />
        <Table.Summary.Cell index={6} align="center"><span style={SUMMARY_TEXT}>{sumExtCount}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={7} />
        {canEdit ? <Table.Summary.Cell index={8} /> : null}
      </Table.Summary.Row>
    </Table.Summary>
  );

  // ============== 渲染 ==============

  return (
    <div>
      {/* 页头统计卡（原 stat-row：投入总人天 / 补贴总人数 / 外部租赁人员） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        {[
          { label: '👥 投入总人天', value: manDays, sub: 'Σ(投入天数 × 人数)' },
          { label: '💵 补贴总人数', value: subsidyCount, sub: 'Σ 各岗位补贴人数' },
          { label: '🧑‍💼 外部租赁人员', value: external.length, sub: '类目数量' },
        ].map((c) => (
          <div key={c.label} style={{
            background: 'linear-gradient(135deg,#f6f5fc,#f1f0fe)',
            border: '1px solid rgba(99,102,241,0.18)',
            borderRadius: 10, padding: '12px 16px',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: NUM_COLOR }}>{c.value}</div>
            <div style={{ fontSize: 12, color: '#6b6892', marginTop: 4 }}>{c.label}</div>
            <div style={{ fontSize: 11.5, color: '#9d9ab8', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* a) 岗位补贴 */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={CARD_TITLE}>💰 岗位补贴</span>
          <Tag style={{ margin: '0 0 0 8px' }}>{subsidy.length} 项</Tag>
          <span style={CARD_SUB}>按岗位设置补贴人数（用于人力成本预估）</span>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <>
              <Button size="small" style={{ marginRight: 8 }} onClick={syncFromStaff} title="将每行「人数」按岗位同步为投入明细实际人数">
                🔗 同步人数
              </Button>
              <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addSubsidyRow}>添加岗位</Button>
            </>
          )}
        </div>
        <Table<SubsidyRow> rowKey="id" size="small" className="rc-edit-table" columns={renderSubsidyColumns}
          dataSource={subsidy} pagination={false} summary={subsidySummary} scroll={{ x: 'max-content' }}
          locale={{ emptyText: '📭 暂无补贴岗位，点击「添加岗位」新增' }} />
      </div>

      {/* b) 外部租赁人员 */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={CARD_TITLE}>🧑‍💼 外部租赁人员</span>
          <Tag style={{ margin: '0 0 0 8px' }}>{external.length} 项</Tag>
          <span style={CARD_SUB}>外包/外部测试人员需求</span>
          <div style={{ flex: 1 }} />
          {canEdit && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addExternalRow}>添加人员</Button>}
        </div>
        <Table<ExternalRow> rowKey="id" size="small" className="rc-edit-table" columns={externalColumns}
          dataSource={external} pagination={false} summary={externalSummary} scroll={{ x: 'max-content' }}
          locale={{ emptyText: '📭 暂无外部人员，点击「添加人员」新增' }} />
      </div>
    </div>
  );
}
