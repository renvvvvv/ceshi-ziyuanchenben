/**
 * 测试人员 Tab —— 复刻原工具「测试人员」页（index.html L2465-2764）
 *  - 人员岗位配置（renderPersonnel + ensurePersonnelLM + bindPersonnel）
 *  - 岗位配置 vs 实际投入 比对卡（renderPersonnelCompare + staffCountByRole）
 *  - 人力成本明细（renderStaff / renderStaffMerged / toggleStaffMerge / staffTotal）
 */
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Table, Button, Input, InputNumber, Select, Tag, Popconfirm, Segmented } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  deriveRole, STAFF_LEVELS, levelDisplay, STAFF_POSTS,
  type ResourceConfigProject, type AssetLibItem,
  type PersonnelRow, type StaffRow, type StaffLevel,
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
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};
const CARD_TITLE: CSSProperties = { fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.9)' };
const CARD_SUB: CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginLeft: 8 };
const SUMMARY_BG: CSSProperties = { background: 'rgba(30,58,95,0.35)' };
const SUMMARY_TEXT: CSSProperties = { color: '#7cb8ff', fontWeight: 600, fontSize: 12 };
const NUM_COLOR = '#7cb8ff';
/** 派生总天数胶囊（对应原工具 td.auto-total：软底/主色/加粗，后缀"天"） */
const AUTO_PILL: CSSProperties = {
  display: 'inline-block', minWidth: 48, padding: '2px 8px', borderRadius: 8,
  background: 'rgba(77,159,255,0.12)', color: NUM_COLOR, fontWeight: 700, fontSize: 12.5,
};

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

/**
 * 投入明细中某岗位、某角色的实际人数（原 staffCountByRole L2539）：
 * 岗位按 精确/包含 模糊匹配（a===b || a.includes(b) || b.includes(a），角色按 (role||deriveRole(post)) 匹配
 */
function staffCountByRole(p: ResourceConfigProject, post: string, role?: string): number {
  if (!post) return 0;
  const b = String(post).trim().toLowerCase();
  const want = role || deriveRole(post);
  return (p.staff || []).filter((s) => {
    if (!s.post) return false;
    const a = String(s.post).trim().toLowerCase();
    const match = a === b || a.includes(b) || b.includes(a);
    return match && effectiveRole(s) === want;
  }).length;
}

/** 从「人员分工」文本解析「主测X人；组员Y人」（原 parseLeadMember L2500） */
function parseLeadMember(div: string): { lead: number; member: number } {
  const s = String(div || '');
  const lm = /主测\s*(\d+)\s*人/.exec(s);
  const mm = /组员\s*(\d+)\s*人/.exec(s);
  return { lead: lm ? num(lm[1]) : 0, member: mm ? num(mm[1]) : 0 };
}

/** 下拉选项：固定列表 + 兜底保留存量自定义值（原 roleOptions/postOptions/lvlTOptions 行为） */
function withExtra(base: string[], current?: string | null): string[] {
  const v = String(current ?? '').trim();
  return v && !base.includes(v) ? [...base, v] : base;
}

/** 角色下拉（原 ROLES = 主测/测试工程师/经理，派生兜底组员） */
const ROLE_OPTIONS = ['主测', '测试工程师', '经理', '组员'];

/** 差值着色：0 灰 / +N 绿 / -N 橙（原 renderPersonnelCompare 的 delta L2584） */
function Delta({ d }: { d: number }) {
  const color = d === 0 ? 'rgba(255,255,255,0.35)' : d > 0 ? '#52c41a' : '#faad14';
  return <span style={{ color, fontWeight: 600 }}>{d === 0 ? '0' : d > 0 ? `+${d}` : `${d}`}</span>;
}

/** 比对卡行 */
interface CompareRow {
  key: string;
  post: string;
  pl: number;   // 计划主测
  pm: number;   // 计划组员
  al: number;   // 实际主测（投入明细统计）
  am: number;   // 实际组员（投入明细统计）
}

/** 合并视图分组：同等级 + 同岗位 + 同投入天数（原 renderStaffMerged L2678） */
interface MergedGroup {
  key: string;
  level: string;
  post: string;
  total: number;
  count: number;
  manDays: number;
  names: string[];
}

// ============== 组件 ==============

export default function PersonnelTab({ data, canEdit, patch }: TabProps) {
  /** 投入明细展示模式：false=逐人明细；true=按「等级+岗位+投入天数」合并（原 staffMerged 开关） */
  const [staffMerged, setStaffMerged] = useState(false);

  /* ---------- a) 人员岗位配置（原 renderPersonnel L2465） ---------- */
  /**
   * ensurePersonnelLM 的视图层归一（L2491）：
   * lead/member 均缺失时从「人员分工」文本解析，单缺补 0；count = 主测 + 组员（派生）。
   * 编辑时以归一后的行作为 patch 基底（自愈旧数据，与原工具 render 时回写一致）。
   */
  const personnel = useMemo(() => (data.personnel || []).map((r) => {
    let lead: number | null = r.lead == null ? null : num(r.lead);
    let member: number | null = r.member == null ? null : num(r.member);
    if (lead == null && member == null) {
      const m = parseLeadMember(r.division);
      lead = m.lead;
      member = m.member;
    }
    const l = lead ?? 0;
    const mb = member ?? 0;
    return { ...r, lead: l, member: mb, count: l + mb };
  }), [data.personnel]);

  const sumLead = personnel.reduce((s, r) => s + r.lead, 0);
  const sumMember = personnel.reduce((s, r) => s + r.member, 0);
  const totalCount = personnel.reduce((s, r) => s + r.count, 0);

  const patchPersonnel = (id: string, field: string, v: string | number) => {
    patch({
      personnel: personnel.map((r) => {
        if (r.id !== id) return r;
        const next: Record<string, any> = { ...r };
        if (field === 'lead' || field === 'member') {
          next[field] = num(v);
          next.count = num(next.lead) + num(next.member);   // 派生值同步写（原 bindPersonnel L2613）
        } else {
          next[field] = v;
        }
        return next as PersonnelRow;
      }),
    });
  };

  const addPersonnelRow = () => {
    patch({
      personnel: [...personnel, { id: genId(), post: '', count: 0, lead: 0, member: 0, duty: '', division: '', names: '待定' }],
    });
  };

  const personnelColumns: ColumnsType<PersonnelRow> = [
    { title: '#', key: 'idx', width: 40, align: 'center',
      render: (_: unknown, __: PersonnelRow, i: number) => <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{i + 1}</span> },
    { title: '岗位', dataIndex: 'post', width: 150,
      render: (t: string, r: PersonnelRow) => canEdit
        ? <Input size="small" className="rc-cell-input" value={t ?? ''} onChange={(e) => patchPersonnel(r.id, 'post', e.target.value)} />
        : (t || '-') },
    { title: '主测数量', dataIndex: 'lead', width: 90, align: 'center',
      render: (t: number, r: PersonnelRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchPersonnel(r.id, 'lead', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : t },
    { title: '组员数量', dataIndex: 'member', width: 90, align: 'center',
      render: (t: number, r: PersonnelRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchPersonnel(r.id, 'member', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : t },
    { title: '数量(合计)', dataIndex: 'count', width: 90, align: 'center',
      render: (t: number) => <span style={{ fontWeight: 700, color: NUM_COLOR }}>{t}</span> },
    { title: '人员职责', dataIndex: 'duty',
      render: (t: string, r: PersonnelRow) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} className="rc-cell-input" value={t ?? ''} onChange={(e) => patchPersonnel(r.id, 'duty', e.target.value)} />
        : (t || '-') },
    { title: '人员分工', dataIndex: 'division',
      render: (t: string, r: PersonnelRow) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} className="rc-cell-input" value={t ?? ''} onChange={(e) => patchPersonnel(r.id, 'division', e.target.value)} />
        : (t || '-') },
    { title: '人员姓名', dataIndex: 'names',
      render: (t: string, r: PersonnelRow) => canEdit
        ? <TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} className="rc-cell-input" value={t ?? ''} onChange={(e) => patchPersonnel(r.id, 'names', e.target.value)} />
        : (t || '-') },
    ...(canEdit ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_: unknown, r: PersonnelRow) => (
        <Popconfirm title="删除该岗位行？" onConfirm={() => patch({ personnel: personnel.filter((x) => x.id !== r.id) })}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  const personnelSummary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={SUMMARY_BG}>
        <Table.Summary.Cell index={0} />
        <Table.Summary.Cell index={1}><span style={SUMMARY_TEXT}>小计</span></Table.Summary.Cell>
        <Table.Summary.Cell index={2} align="center"><span style={SUMMARY_TEXT}>{sumLead}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={3} align="center"><span style={SUMMARY_TEXT}>{sumMember}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={4} align="center"><span style={SUMMARY_TEXT}>{totalCount}</span></Table.Summary.Cell>
        {Array.from({ length: canEdit ? 4 : 3 }, (_, i) => <Table.Summary.Cell key={i} index={5 + i} />)}
      </Table.Summary.Row>
    </Table.Summary>
  );

  /* ---------- b) 岗位配置 vs 实际投入 比对（原 renderPersonnelCompare L2575） ---------- */
  /** 实际主测/组员从 staff 按 (role||deriveRole(post)) 统计；仅统计岗位非空的配置行 */
  const compareRows = useMemo(() => personnel.filter((r) => r.post).map((r) => {
    const pl = r.lead;
    const pm = r.member;
    const al = staffCountByRole(data, r.post, '主测');
    const am = staffCountByRole(data, r.post, '组员');
    return { key: r.id, post: r.post, pl, pm, al, am } satisfies CompareRow;
  }), [personnel, data]);

  const cmpTotals = compareRows.reduce((a, r) => ({
    pL: a.pL + r.pl, pM: a.pM + r.pm, aL: a.aL + r.al, aM: a.aM + r.am,
  }), { pL: 0, pM: 0, aL: 0, aM: 0 });

  const compareColumns: ColumnsType<CompareRow> = [
    { title: '岗位', dataIndex: 'post', width: 150, render: (t: string) => <span style={{ fontWeight: 500 }}>{t}</span> },
    { title: '计划主测', dataIndex: 'pl', width: 90, align: 'center' },
    { title: '计划组员', dataIndex: 'pm', width: 90, align: 'center' },
    { title: '实际主测', dataIndex: 'al', width: 90, align: 'center' },
    { title: '实际组员', dataIndex: 'am', width: 90, align: 'center' },
    { title: '主测差值', key: 'dL', width: 90, align: 'center', render: (_: unknown, r: CompareRow) => <Delta d={r.al - r.pl} /> },
    { title: '组员差值', key: 'dM', width: 90, align: 'center', render: (_: unknown, r: CompareRow) => <Delta d={r.am - r.pm} /> },
  ];

  /** 合计行仅在存在岗位行时显示（原 L2589） */
  const compareSummary = () => (compareRows.length > 0 ? (
    <Table.Summary fixed>
      <Table.Summary.Row style={SUMMARY_BG}>
        <Table.Summary.Cell index={0}><span style={SUMMARY_TEXT}>合计</span></Table.Summary.Cell>
        <Table.Summary.Cell index={1} align="center"><span style={SUMMARY_TEXT}>{cmpTotals.pL}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={2} align="center"><span style={SUMMARY_TEXT}>{cmpTotals.pM}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={3} align="center"><span style={SUMMARY_TEXT}>{cmpTotals.aL}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={4} align="center"><span style={SUMMARY_TEXT}>{cmpTotals.aM}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={5} align="center"><Delta d={cmpTotals.aL - cmpTotals.pL} /></Table.Summary.Cell>
        <Table.Summary.Cell index={6} align="center"><Delta d={cmpTotals.aM - cmpTotals.pM} /></Table.Summary.Cell>
      </Table.Summary.Row>
    </Table.Summary>
  ) : null);

  /* ---------- c) 人力成本明细（原 renderStaff L2640 / renderStaffMerged L2678） ---------- */
  const staff = data.staff || [];

  const patchStaff = (id: string, field: string, v: string | number) => {
    patch({
      staff: staff.map((r) => {
        if (r.id !== id) return r;
        const next: Record<string, any> = { ...r };
        if (field === 'survey' || field === 'retest' || field === 'test') {
          next[field] = num(v);
          // 自动连锁：任一投入分项变化 → 总天数 = 踏勘+复测+测试（原 bindStaff L2738）
          next.total = num(next.survey) + num(next.retest) + num(next.test);
        } else if (field === 'post') {
          next.post = v;
          next.role = deriveRole(String(v));   // 岗位变更 → 角色按岗位重派生（原 bindStaff change L2757）
        } else {
          next[field] = v;
        }
        return next as StaffRow;
      }),
    });
  };

  const addStaffRow = () => {
    patch({
      staff: [...staff, { id: genId(), name: '', company: '', level: 'T5', post: '', role: '主测', total: 40, survey: 0, retest: 0, test: 40 }],
    });
  };

  const sumSurvey = staff.reduce((s, r) => s + num(r.survey), 0);
  const sumRetest = staff.reduce((s, r) => s + num(r.retest), 0);
  const sumTest = staff.reduce((s, r) => s + num(r.test), 0);
  const sumDays = sumSurvey + sumRetest + sumTest;

  const staffColumns: ColumnsType<StaffRow> = [
    { title: '#', key: 'idx', width: 40, align: 'center',
      render: (_: unknown, __: StaffRow, i: number) => <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{i + 1}</span> },
    { title: '姓名', dataIndex: 'name', width: 110,
      render: (t: string, r: StaffRow) => canEdit
        ? <Input size="small" className="rc-cell-input" value={t ?? ''} onChange={(e) => patchStaff(r.id, 'name', e.target.value)} />
        : (t || '-') },
    { title: '公司/部门', dataIndex: 'company', width: 140,
      render: (t: string, r: StaffRow) => canEdit
        ? <Input size="small" className="rc-cell-input" value={t ?? ''} onChange={(e) => patchStaff(r.id, 'company', e.target.value)} />
        : (t || '-') },
    { title: '职级', dataIndex: 'level', width: 80, align: 'center',
      render: (t: string, r: StaffRow) => canEdit
        ? <Select size="small" style={{ width: 72 }} value={t || undefined} placeholder="职级"
            options={withExtra(STAFF_LEVELS, t).map((l) => ({ value: l, label: levelDisplay(l as StaffLevel) }))}
            onChange={(v) => patchStaff(r.id, 'level', v)} />
        : (t ? levelDisplay(t as StaffLevel) : '—') },
    { title: '测试岗位', dataIndex: 'post', width: 110,
      render: (t: string, r: StaffRow) => canEdit
        ? <Select size="small" style={{ width: '100%' }} value={t || undefined} placeholder="选择岗位"
            options={withExtra(STAFF_POSTS, t).map((p) => ({ value: p, label: p }))}
            onChange={(v) => patchStaff(r.id, 'post', v ?? '')} />
        : (t || '-') },
    { title: '角色', dataIndex: 'role', width: 110,
      render: (_: unknown, r: StaffRow) => canEdit
        ? <Select size="small" style={{ width: '100%' }} value={effectiveRole(r)}
            options={withExtra(ROLE_OPTIONS, effectiveRole(r)).map((o) => ({ value: o, label: o }))}
            onChange={(v) => patchStaff(r.id, 'role', v ?? '')} />
        : effectiveRole(r) },
    { title: '前期踏勘', dataIndex: 'survey', width: 90, align: 'center',
      render: (t: number, r: StaffRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchStaff(r.id, 'survey', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '复测天数', dataIndex: 'retest', width: 90, align: 'center',
      render: (t: number, r: StaffRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchStaff(r.id, 'retest', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '测试天数', dataIndex: 'test', width: 90, align: 'center',
      render: (t: number, r: StaffRow) => canEdit
        ? <InputNumber size="small" min={0} precision={0} value={t} onChange={(v) => patchStaff(r.id, 'test', v ?? 0)} style={{ width: '100%' }} className="rc-cell-input" />
        : num(t) },
    { title: '投入总天数', key: 'total', width: 100, align: 'center',
      render: (_: unknown, r: StaffRow) => (
        <span style={AUTO_PILL} title="自动核算：前期踏勘+复测天数+测试天数">{staffTotal(r)} 天</span>
      ) },
    ...(canEdit ? [{
      title: '', key: 'op', width: 44, align: 'center' as const,
      render: (_: unknown, r: StaffRow) => (
        <Popconfirm title="删除该人员行？" onConfirm={() => patch({ staff: staff.filter((x) => x.id !== r.id) })}
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
          <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 30 }} />
        </Popconfirm>
      ),
    }] : []),
  ];

  const staffSummary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={SUMMARY_BG}>
        <Table.Summary.Cell index={0} />
        <Table.Summary.Cell index={1} colSpan={5}><span style={SUMMARY_TEXT}>合计（{staff.length} 人）</span></Table.Summary.Cell>
        <Table.Summary.Cell index={6} align="center"><span style={SUMMARY_TEXT}>{sumSurvey}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={7} align="center"><span style={SUMMARY_TEXT}>{sumRetest}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={8} align="center"><span style={SUMMARY_TEXT}>{sumTest}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={9} align="center"><span style={SUMMARY_TEXT}>{sumDays}</span></Table.Summary.Cell>
        {canEdit ? <Table.Summary.Cell index={10} /> : null}
      </Table.Summary.Row>
    </Table.Summary>
  );

  /** 合并视图：同等级 + 同岗位 + 同投入天数 的人合并为一行（人数汇总） */
  const mergedGroups = useMemo(() => {
    const groups: MergedGroup[] = [];
    const idx = new Map<string, MergedGroup>();
    staff.forEach((r) => {
      const total = staffTotal(r);
      const key = `${r.level || ''}||${r.post || ''}||${total}`;
      let g = idx.get(key);
      if (!g) {
        g = { key, level: r.level || '', post: r.post || '', total, count: 0, manDays: 0, names: [] };
        idx.set(key, g);
        groups.push(g);
      }
      g.count++;
      g.manDays += total;
      if (r.name && r.name !== '待定') g.names.push(r.name);
    });
    return groups;
  }, [staff]);

  const mergedTotalPeople = mergedGroups.reduce((s, g) => s + g.count, 0);
  const mergedTotalManDays = mergedGroups.reduce((s, g) => s + g.manDays, 0);

  const mergedColumns: ColumnsType<MergedGroup> = [
    { title: '#', key: 'idx', width: 40, align: 'center',
      render: (_: unknown, __: MergedGroup, i: number) => <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{i + 1}</span> },
    { title: '等级', dataIndex: 'level', width: 80, align: 'center',
      render: (t: string) => (t ? <span style={{ fontWeight: 600 }}>{levelDisplay(t as StaffLevel)}</span> : '—') },
    { title: '岗位', dataIndex: 'post', width: 120, render: (t: string) => t || '—' },
    { title: '投入天数', dataIndex: 'total', width: 90, align: 'center',
      render: (t: number) => <span style={{ color: NUM_COLOR, fontWeight: 600 }}>{t}</span> },
    { title: '人数', dataIndex: 'count', width: 90, align: 'center',
      render: (t: number) => <span style={{ fontWeight: 700, color: NUM_COLOR }}>{t} 人</span> },
    { title: '成员', dataIndex: 'names',
      render: (t: string[]) => (
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>
          成员：{t.length ? t.join('、') : '（未命名）'}
        </span>
      ) },
  ];

  const mergedSummary = () => (
    <Table.Summary fixed>
      <Table.Summary.Row style={SUMMARY_BG}>
        <Table.Summary.Cell index={0} />
        <Table.Summary.Cell index={1} colSpan={2}><span style={SUMMARY_TEXT}>合并后共 {mergedGroups.length} 组 / {mergedTotalPeople} 人</span></Table.Summary.Cell>
        <Table.Summary.Cell index={3} align="center"><span style={SUMMARY_TEXT}>{mergedTotalManDays}</span></Table.Summary.Cell>
        <Table.Summary.Cell index={4} colSpan={2} />
      </Table.Summary.Row>
    </Table.Summary>
  );

  const staffEmpty = '📭 暂无人员，点击右上角「添加人员」添加';

  // ============== 渲染 ==============

  return (
    <div>
      {/* a) 人员岗位配置 */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={CARD_TITLE}>👥 人员岗位配置</span>
          <Tag style={{ margin: '0 0 0 8px' }}>{personnel.length} 个岗位</Tag>
          <span style={CARD_SUB}>岗位合计人数自动统计</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontWeight: 700, color: NUM_COLOR, fontSize: 14, marginRight: 8 }}>
            合计 {totalCount} 人{totalCount > 0 ? '' : '（不含外包）'}
          </span>
          {canEdit && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addPersonnelRow}>添加岗位</Button>}
        </div>
        <Table<PersonnelRow> rowKey="id" size="small" className="rc-edit-table" columns={personnelColumns}
          dataSource={personnel} pagination={false} summary={personnelSummary} scroll={{ x: 'max-content' }} />
      </div>

      {/* b) 岗位配置 vs 实际投入 比对 */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={CARD_TITLE}>📊 岗位配置 vs 实际投入 比对</span>
          <span style={CARD_SUB}>按岗位对比「计划主测/组员」与「投入明细实际主测/组员」，差异绿=超 / 橙=缺</span>
        </div>
        <Table<CompareRow> rowKey="key" size="small" className="rc-edit-table" columns={compareColumns}
          dataSource={compareRows} pagination={false} summary={compareSummary} scroll={{ x: 'max-content' }}
          locale={{ emptyText: '暂无比对行（在上方表格填写岗位名称后自动比对）' }} />
      </div>

      {/* c) 人力成本明细 */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span style={CARD_TITLE}>🧾 人力成本明细</span>
          <Tag style={{ margin: '0 0 0 8px' }}>{staff.length} 人</Tag>
          <span style={CARD_SUB}>支持按岗位逐人填写职级与天数</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginRight: 10 }}>
            将同等级、同岗位、同投入天数的人合并为一行
          </span>
          <Segmented size="small" value={staffMerged ? 'merged' : 'detail'}
            onChange={(v) => setStaffMerged(v === 'merged')}
            options={[{ label: '逐人明细', value: 'detail' }, { label: '按等级岗位合并', value: 'merged' }]} />
          {canEdit && (
            <Button size="small" type="primary" icon={<PlusOutlined />} style={{ marginLeft: 10 }} onClick={addStaffRow}>
              添加人员
            </Button>
          )}
        </div>
        {staffMerged ? (
          <Table<MergedGroup> rowKey="key" size="small" className="rc-edit-table" columns={mergedColumns}
            dataSource={mergedGroups} pagination={false} summary={mergedSummary} scroll={{ x: 'max-content' }}
            locale={{ emptyText: staffEmpty }} />
        ) : (
          <Table<StaffRow> rowKey="id" size="small" className="rc-edit-table" columns={staffColumns}
            dataSource={staff} pagination={false} summary={staffSummary} scroll={{ x: 'max-content' }}
            locale={{ emptyText: staffEmpty }} />
        )}
      </div>
    </div>
  );
}
