import { useState, useMemo, useEffect } from 'react';
import { Table, Select, DatePicker, Button, Modal, Tag, Empty, Radio, message, InputNumber, Form, Tabs, Input, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, EyeOutlined, CalendarOutlined, PrinterOutlined, FolderOutlined, UserOutlined, EditOutlined, ThunderboltOutlined, ToolOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import { useData } from '../../store/DataContext';
import type { TeamMember, Project, HistoricalProject } from '../../types';

// ============================================================
// 岗位配置
// ============================================================
const POSITION_MAP: Record<string, string> = {
  '1021839': '项目主测', '1021793': '项目经理', '1021334': '助理测试工程师', '1021619': '测试工程师',
  '1021844': '助理测试工程师', '1021333': '测试工程师', '1021363': '助理测试工程师', '1021352': '项目主测',
  '1021351': '测试工程师', '1021362': '助理测试工程师', '1021357': '测试工程师', '1021807': '项目经理',
};
const POSITION_STYLES: Record<string, { bg: string; color: string }> = {
  助理测试工程师: { bg: 'rgba(77,159,255,0.1)', color: '#4d9fff' },
  测试工程师: { bg: 'rgba(0,240,255,0.08)', color: '#00f0ff' },
  项目主测: { bg: 'rgba(82,196,26,0.1)', color: '#52c41a' },
  项目经理: { bg: 'rgba(255,77,79,0.1)', color: '#ff4d4f' },
};

interface AttendanceRow {
  key: string; memberId: string; memberName: string; position: string;
  projectName: string; projectStart: string; projectEnd: string;
  projectTotalDays: number; onDutyDays: number; leaveDays: number; attendDays: number; rate: number;
}
interface AttendanceNode extends AttendanceRow { children?: AttendanceRow[]; }
type CycleType = 'month' | 'cycle19';

function daysBetween(s: string, e: string) {
  if (!s || !e) return 0;
  return dayjs(e).diff(dayjs(s), 'day') + 1;
}
function overlapDays(s1: string, e1: string, s2: string, e2: string) {
  const s = dayjs(s1).isAfter(s2) ? s1 : s2;
  const e = dayjs(e1).isBefore(e2) ? e1 : e2;
  if (dayjs(s).isAfter(e)) return 0;
  return daysBetween(s, e);
}
function dutyRange(pStart: string, pEnd: string, cStart: string, cEnd: string, today: string) {
  const s = dayjs(pStart).isAfter(cStart) ? pStart : cStart;
  let e = dayjs(pEnd).isBefore(cEnd) ? pEnd : cEnd;
  if (dayjs(e).isAfter(today)) e = today;
  if (dayjs(s).isAfter(e)) return null;
  return { start: s, end: e };
}

function Attendance() {
  const { teamMembers, projects, historyProjects, attendanceAdjustments, setAttendanceAdjustments, updateTeamMember } = useData();
  const [monthFilter, setMonthFilter] = useState(() => {
    // 反推今天属于哪个"19日~次月18日"的考勤周期
    // 周期定义：[上月19日, 本月18日]，monthFilter 应为"本月"（cycleEnd 所在月）
    // 公式：把今天往前推 18 天，再加 1 月再取月初
    // 验证：
    //   - 6.18 → 5.31 → +1月 → 6.30 → startOf=6.1 → cycleEnd=6.18 ✓
    //   - 6.19 → 6.01 → +1月 → 7.01 → startOf=7.1 → cycleEnd=7.18 ✓
    //   - 7.05 → 6.17 → +1月 → 7.17 → startOf=7.1 → cycleEnd=7.18 ✓
    //   - 7.20 → 7.02 → +1月 → 8.02 → startOf=8.1 → cycleEnd=8.18 ✓
    //   - 8.05 → 7.18 → +1月 → 8.18 → startOf=8.1 → cycleEnd=8.18 ✓
    //   - 8.19 → 8.01 → +1月 → 9.01 → startOf=9.1 → cycleEnd=9.18 ✓
    return dayjs().subtract(18, 'day').add(1, 'month').startOf('month');
  });
  const [cycleType, setCycleType] = useState<CycleType>('cycle19');
  const [memberFilter, setMemberFilter] = useState('全部');
  const [projectFilter, setProjectFilter] = useState('全部');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm] = Form.useForm();
  const [manualMember, setManualMember] = useState<string | undefined>();
  const [manualProject, setManualProject] = useState<string | undefined>();

  // 批量人工校准状态
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchTab, setBatchTab] = useState<'attendance' | 'position'>('attendance');
  // 批量考勤：每行 [memberId, projectName] → { onDutyDays, leaveDays }
  const [batchAdj, setBatchAdj] = useState<Record<string, { onDutyDays?: number; leaveDays?: number }>>({});
  // 批量岗位：每行 memberId → position
  const [batchPos, setBatchPos] = useState<Record<string, string>>({});

  const { cycleStart, cycleEnd, cycleLabel } = useMemo(() => {
    if (cycleType === 'cycle19') {
      const s = monthFilter.subtract(1, 'month').date(19);
      const e = monthFilter.date(18);
      return {
        cycleStart: s.format('YYYY-MM-DD'),
        cycleEnd: e.format('YYYY-MM-DD'),
        cycleLabel: `${s.format('YYYY.MM.DD')} - ${e.format('MM.DD')} 考勤周期`,
      };
    }
    const s = monthFilter.startOf('month');
    const e = monthFilter.endOf('month');
    return {
      cycleStart: s.format('YYYY-MM-DD'),
      cycleEnd: e.format('YYYY-MM-DD'),
      cycleLabel: `${monthFilter.format('YYYY年M月')}（自然月）`,
    };
  }, [monthFilter, cycleType]);

  const memberOptions = useMemo(() => ['全部', ...teamMembers.map((m) => m.name)], [teamMembers]);
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    // 1. 进行中的项目
    projects.forEach((p) => { if (p.name) set.add(p.name); });
    // 2. 历史项目（已完成）
    historyProjects.forEach((p) => { if (p.name) set.add(p.name); });
    // 3. 人员当前/即将参与的项目（兜底，确保不遗漏）
    teamMembers.forEach((m) => {
      [...(m.projects || []), ...(m.upcomingProjects || [])].forEach((p) => { if (p.projectName) set.add(p.projectName); });
    });
    return ['全部', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'))];
  }, [projects, historyProjects, teamMembers]);

  // 人员 - 项目选项（人工校准用）
  const manualMemberProjects = useMemo(() => {
    if (!manualMember) return [];
    const m = teamMembers.find((x) => x.id === manualMember);
    if (!m) return [];
    const set = new Set<string>();
    [...(m.projects || []), ...(m.upcomingProjects || [])].forEach((p) => set.add(p.projectName));
    return Array.from(set);
  }, [manualMember, teamMembers]);

  // 打开人工校准时自动填入当前计算值
  const openManualAdjust = () => {
    manualForm.resetFields();
    setManualMember(undefined);
    setManualProject(undefined);
    setManualOpen(true);
  };

  // 选中人员时自动填入建议值
  const handleMemberChange = (mid: string) => {
    setManualMember(mid);
    setManualProject(undefined);
    const m = teamMembers.find((x) => x.id === mid);
    if (!m) return;
    const today = dayjs().format('YYYY-MM-DD');
    const all = [...(m.projects || []), ...(m.upcomingProjects || [])];
    const first = all[0];
    if (first && first.startDate && first.endDate) {
      setManualProject(first.projectName);
      const duty = dutyRange(first.startDate, first.endDate, cycleStart, cycleEnd, today);
      let leaveDays = 0;
      if (duty && m.leaveStartDate && m.leaveEndDate) {
        leaveDays = overlapDays(m.leaveStartDate, m.leaveEndDate, duty.start, duty.end);
      }
      manualForm.setFieldsValue({ projectStart: dayjs(first.startDate), projectEnd: dayjs(first.endDate), leaveDays });
    } else {
      manualForm.setFieldsValue({ projectStart: undefined, projectEnd: undefined, leaveDays: 0 });
    }
  };

  // 选中项目时自动填入建议值
  const handleProjectChange = (pname: string) => {
    setManualProject(pname);
    if (!manualMember) return;
    const m = teamMembers.find((x) => x.id === manualMember);
    if (!m) return;
    const today = dayjs().format('YYYY-MM-DD');
    const all = [...(m.projects || []), ...(m.upcomingProjects || [])];
    const p = all.find((x) => x.projectName === pname);
    if (p) {
      const duty = dutyRange(p.startDate, p.endDate, cycleStart, cycleEnd, today);
      let leaveDays = 0;
      if (duty && m.leaveStartDate && m.leaveEndDate) {
        leaveDays = overlapDays(m.leaveStartDate, m.leaveEndDate, duty.start, duty.end);
      }
      // p.startDate/endDate 可能为 undefined，用 ?? 兜底
      manualForm.setFieldsValue({
        projectStart: p.startDate ? dayjs(p.startDate) : undefined,
        projectEnd: p.endDate ? dayjs(p.endDate) : undefined,
        leaveDays,
      });
    }
  };

  // 保存人工校准
  const handleManualSave = async () => {
    try {
      const values = await manualForm.validateFields();
      const key = `${values.memberId}-${values.projectName}-${cycleStart}`;
        setAttendanceAdjustments((prev) => ({
          ...prev,
          [key]: {
            projectStart: values.projectStart.format('YYYY-MM-DD'),
            projectEnd: values.projectEnd.format('YYYY-MM-DD'),
            leaveDays: values.leaveDays,
          },
        }));
      message.success(`已保存人工校准：${teamMembers.find((m) => m.id === values.memberId)?.name} · ${values.projectName}`);
      setManualOpen(false);
    } catch {}
  };

  // 打开批量人工校准（用当前 filteredRows 初始化编辑状态）
  const openBatchAdjust = () => {
    const initAdj: Record<string, { onDutyDays?: number; leaveDays?: number }> = {};
    filteredRows.forEach((r) => {
      initAdj[`${r.memberId}|${r.projectName}`] = { onDutyDays: r.onDutyDays, leaveDays: r.leaveDays };
    });
    setBatchAdj(initAdj);
    const initPos: Record<string, string> = {};
    teamMembers.forEach((m) => {
      initPos[m.id] = m.position || POSITION_MAP[m.id] || '测试工程师';
    });
    setBatchPos(initPos);
    setBatchTab('attendance');
    setBatchOpen(true);
  };

  // 保存批量校准（优化：先组装再一次性 setState，避免循环里 N 次重渲染）
  const handleBatchSave = () => {
    let adjCount = 0;
    let posCount = 0;

    // 预建查找 Map，O(n²) → O(n)
    const rowMap = new Map<string, AttendanceRow>();
    filteredRows.forEach((r) => { rowMap.set(`${r.memberId}|${r.projectName}`, r); });

    // 1) 组装批量考勤变更
    const adjUpdates: Record<string, { projectStart: string; projectEnd: string; leaveDays: number }> = {};
    Object.entries(batchAdj).forEach(([compositeKey, v]) => {
      const sepIdx = compositeKey.indexOf('|');
      if (sepIdx < 0) return;
      const memberId = compositeKey.slice(0, sepIdx);
      const projectName = compositeKey.slice(sepIdx + 1);
      const original = rowMap.get(compositeKey);
      if (!original) return;
      const onDutyChanged = v.onDutyDays !== undefined && v.onDutyDays !== original.onDutyDays;
      const leaveChanged = v.leaveDays !== undefined && v.leaveDays !== original.leaveDays;
      if (!onDutyChanged && !leaveChanged) return;

      const adjKey = `${memberId}-${projectName}-${cycleStart}`;
      const existing = attendanceAdjustments[adjKey];
      adjUpdates[adjKey] = {
        projectStart: existing?.projectStart ?? original.projectStart,
        projectEnd: existing?.projectEnd ?? original.projectEnd,
        leaveDays: v.leaveDays ?? existing?.leaveDays ?? original.leaveDays,
      };
      adjCount++;
    });

    // 一次性写入考勤变更（替代循环里 N 次 setAttendanceAdjustments）
    if (adjCount > 0) {
      setAttendanceAdjustments((prev) => ({ ...prev, ...adjUpdates }));
    }

    // 2) 批量岗位变更（收集后逐个调 updateTeamMember，但因岗位变更通常很少）
    Object.entries(batchPos).forEach(([memberId, newPos]) => {
      const m = teamMembers.find((x) => x.id === memberId);
      if (!m) return;
      const current = m.position || POSITION_MAP[memberId] || '测试工程师';
      if (newPos !== current) {
        updateTeamMember(memberId, { position: newPos });
        posCount++;
      }
    });

    if (adjCount === 0 && posCount === 0) {
      message.info('未检测到修改');
    } else {
      message.success(`批量校准完成：考勤 ${adjCount} 项，岗位 ${posCount} 项`);
    }
    setBatchOpen(false);
  };

  // 计算全部考勤行（人员级）+ 应用人工校准
  const allRows = useMemo<AttendanceRow[]>(() => {
    const today = dayjs().format('YYYY-MM-DD');
    if (dayjs(cycleStart).isAfter(today)) return [];

    const result: AttendanceRow[] = [];
    teamMembers.forEach((m) => {
      const memberPosition = m.position || POSITION_MAP[m.id] || '测试工程师';
      for (const p of m.projects || []) {
        // 缺日期的条目算出的应出勤/项目总天数不可靠（dayjs('') 无效、dayjs(undefined)=当下），
        // 跳过统计；有该周期的人工校准（补录了起止日期）则照常参与
        const adjKeyPre = `${m.id}-${p.projectName}-${cycleStart}`;
        const hasAdjDates = attendanceAdjustments[adjKeyPre]?.projectStart && attendanceAdjustments[adjKeyPre]?.projectEnd;
        if (!hasAdjDates && (!p.startDate || !p.endDate)) continue;
        // 应用人工校准（覆盖项目时间、请假天数、项目级岗位、实际出勤）
        const key = `${m.id}-${p.projectName}-${cycleStart}`;
        const adj = attendanceAdjustments[key];
        const projStart = adj?.projectStart ?? p.startDate;
        const projEnd = adj?.projectEnd ?? p.endDate;
        const duty = dutyRange(projStart, projEnd, cycleStart, cycleEnd, today);
        if (!duty) continue;
        const onDutyDays = daysBetween(duty.start, duty.end);
        let baseLeave = 0;
        if (m.leaveStartDate && m.leaveEndDate) {
          baseLeave = overlapDays(m.leaveStartDate, m.leaveEndDate, duty.start, duty.end);
        }
        const leaveDays = adj?.leaveDays ?? baseLeave;
        // 项目级岗位优先：adj.position > 人员全局 position
        const position = adj?.position || memberPosition;
        // 实际出勤：有录入值用录入值，否则按 onDuty-leave 推算
        const attendDays = adj?.attendDays != null ? Math.min(adj.attendDays, onDutyDays) : Math.max(onDutyDays - leaveDays, 0);
        const rate = onDutyDays > 0 ? attendDays / onDutyDays : 0;

        result.push({
          key: `${m.id}-${p.projectName}`,
          memberId: m.id, memberName: m.name, position,
          projectName: p.projectName, projectStart: projStart, projectEnd: projEnd,
          projectTotalDays: daysBetween(projStart, projEnd),
          onDutyDays, leaveDays, attendDays, rate,
          // 标记是否被人工校准 / 录入
          ...(adj ? { _adjusted: true } : {}),
          ...(adj?.attendDays != null ? { _entered: true } : {}),
        } as AttendanceRow & { _adjusted?: boolean; _entered?: boolean });
      }
    });
    return result;
  }, [teamMembers, cycleStart, cycleEnd, attendanceAdjustments]);

  const filteredRows = useMemo(
    () => allRows.filter((r) => (memberFilter === '全部' || r.memberName === memberFilter) && (projectFilter === '全部' || r.projectName === projectFilter)),
    [allRows, memberFilter, projectFilter],
  );

  const treeData = useMemo<AttendanceNode[]>(() => {
    const groups: Record<string, AttendanceRow[]> = {};
    [...filteredRows].sort((a, b) => a.projectName.localeCompare(b.projectName)).forEach((r) => {
      (groups[r.projectName] = groups[r.projectName] || []).push(r);
    });
    return Object.entries(groups).map(([projectName, rows]) => {
      const totalOnDuty = rows.reduce((s, r) => s + r.onDutyDays, 0);
      const totalAttend = rows.reduce((s, r) => s + r.attendDays, 0);
      const totalLeave = rows.reduce((s, r) => s + r.leaveDays, 0);
      return {
        key: `project-${projectName}`, memberId: '', memberName: projectName,
        position: `${rows.length} 人参与${rows.some((r: any) => r._adjusted) ? ' · 已人工校准' : ''}`,
        projectName, projectStart: rows[0]?.projectStart || '', projectEnd: rows[0]?.projectEnd || '',
        projectTotalDays: rows[0]?.projectTotalDays || 0,
        onDutyDays: totalOnDuty, leaveDays: totalLeave, attendDays: totalAttend,
        rate: totalOnDuty > 0 ? totalAttend / totalOnDuty : 0,
        children: rows,
      } as AttendanceNode;
    });
  }, [filteredRows]);

  const kpi = useMemo(() => {
    const memberSet = new Set(filteredRows.map((r) => r.memberId));
    const totalOnDuty = filteredRows.reduce((s, r) => s + r.onDutyDays, 0);
    const totalAttend = filteredRows.reduce((s, r) => s + r.attendDays, 0);
    const totalLeave = filteredRows.reduce((s, r) => s + r.leaveDays, 0);
    return {
      memberCount: memberSet.size,
      totalOnDuty, totalAttend, totalLeave,
      avgRate: totalOnDuty > 0 ? totalAttend / totalOnDuty : 0,
    };
  }, [filteredRows]);

  const adjustedCount = useMemo(() => {
    return filteredRows.filter((r: any) => r._adjusted).length;
  }, [filteredRows]);

  const handleExport = () => {
    if (filteredRows.length === 0) {
      Modal.warning({ title: '无数据', content: '当前筛选条件下没有考勤数据可导出' });
      return;
    }
    const exportData: Record<string, unknown>[] = [];
    const groups: Record<string, AttendanceRow[]> = {};
    [...filteredRows].sort((a, b) => a.projectName.localeCompare(b.projectName)).forEach((r) => {
      (groups[r.projectName] = groups[r.projectName] || []).push(r);
    });
    Object.entries(groups).forEach(([projectName, rows]) => {
      const pTotal = rows[0].projectTotalDays;
      const gOnDuty = rows.reduce((s, r) => s + r.onDutyDays, 0);
      const gAttend = rows.reduce((s, r) => s + r.attendDays, 0);
      const gLeave = rows.reduce((s, r) => s + r.leaveDays, 0);
      exportData.push({
        人员: `【${projectName}】`,
        岗位: `${rows.length} 人`,
        项目周期: `${rows[0].projectStart} ~ ${rows[0].projectEnd}`,
        项目总天数: pTotal,
        应出勤天: gOnDuty, 实际出勤天: gAttend, 请假天: gLeave,
        出勤率: `${gOnDuty > 0 ? ((gAttend / gOnDuty) * 100).toFixed(1) : '0'}%`,
      });
      rows.forEach((r: any) => {
        exportData.push({
          人员: `  ${r.memberName}${r._adjusted ? '（已校准）' : ''}`,
          岗位: r.position,
          项目周期: `${r.projectStart} ~ ${r.projectEnd}`,
          项目总天数: r.projectTotalDays,
          应出勤天: r.onDutyDays, 实际出勤天: r.attendDays, 请假天: r.leaveDays,
          出勤率: `${(r.rate * 100).toFixed(1)}%`,
        });
      });
    });
    exportData.push({
      人员: '总计', 岗位: `${kpi.memberCount} 人`, 项目周期: '', 项目总天数: '',
      应出勤天: kpi.totalOnDuty, 实际出勤天: kpi.totalAttend, 请假天: kpi.totalLeave,
      出勤率: `${(kpi.avgRate * 100).toFixed(1)}%`,
    });
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '考勤统计');
    XLSX.writeFile(wb, `人员考勤_${cycleLabel.replace(/[\s()（）]/g, '')}.xlsx`);
  };

  const columns: ColumnsType<AttendanceNode> = [
    { title: '名称', dataIndex: 'memberName', width: 140, fixed: 'left',
      render: (v: string, record) => {
        if (record.children) {
          return <span style={{ color: '#4d9fff', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FolderOutlined style={{ color: '#4d9fff' }} />{v}
          </span>;
        }
        const adjusted = (record as any)._adjusted;
        return <span style={{ color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserOutlined style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }} />
          {v}
          {adjusted && <Tag style={{ background: 'rgba(250,173,20,0.15)', color: '#faad14', border: 'none', fontSize: 10, marginLeft: 4, padding: '0 4px' }}>已校准</Tag>}
        </span>;
      }
    },
    { title: '岗位', dataIndex: 'position', width: 130,
      render: (v: string, record) => {
        if (record.children) return <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{v}</span>;
        const style = POSITION_STYLES[v] || POSITION_STYLES['测试工程师'];
        return <Tag style={{ background: style.bg, color: style.color, border: 'none', fontSize: 11 }}>{v}</Tag>;
      }
    },
    { title: '项目周期', width: 180,
      render: (_: unknown, r: AttendanceNode) => <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{r.projectStart} ~ {r.projectEnd}</span>
    },
    { title: '项目总天数', dataIndex: 'projectTotalDays', width: 100, align: 'center',
      render: (v: number, record) => <span style={{ color: record.children ? '#4d9fff' : 'rgba(255,255,255,0.7)', fontWeight: record.children ? 500 : 400 }}>{v}</span>
    },
    { title: '应出勤(天)', dataIndex: 'onDutyDays', width: 100, align: 'center',
      sorter: (a, b) => a.onDutyDays - b.onDutyDays,
      render: (v: number, record) => <span style={{ color: record.children ? '#4d9fff' : 'rgba(255,255,255,0.85)', fontWeight: record.children ? 500 : 400 }}>{v}</span>
    },
    { title: '实际出勤(天)', dataIndex: 'attendDays', width: 110, align: 'center',
      sorter: (a, b) => a.attendDays - b.attendDays,
      render: (v: number) => <span style={{ color: '#52c41a', fontWeight: 500 }}>{v}</span>
    },
    { title: '请假(天)', dataIndex: 'leaveDays', width: 90, align: 'center',
      sorter: (a, b) => a.leaveDays - b.leaveDays,
      render: (v: number) => v > 0
        ? <Tag style={{ background: 'rgba(250,173,20,0.1)', color: '#faad14', border: '1px solid rgba(250,173,20,0.3)' }}>{v}</Tag>
        : <span style={{ color: 'rgba(255,255,255,0.3)' }}>0</span>
    },
    { title: '出勤率', dataIndex: 'rate', width: 110, align: 'center',
      sorter: (a, b) => a.rate - b.rate,
      render: (v: number, record) => {
        if (record.children) {
          const pct = (v * 100).toFixed(1) + '%';
          const color = v >= 0.95 ? '#52c41a' : v >= 0.9 ? '#faad14' : '#ff4d4f';
          return <span style={{ color, fontWeight: 600 }}>{pct}</span>;
        }
        const pct = (v * 100).toFixed(1);
        const color = v >= 0.95 ? '#52c41a' : v >= 0.9 ? '#faad14' : '#ff4d4f';
        // 背景色条：按出勤率比例填充
        return (
          <div style={{ position: 'relative', width: 70, height: 22, margin: '0 auto', borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(v * 100, 100)}%`, background: v >= 0.95 ? 'rgba(82,196,26,0.25)' : v >= 0.9 ? 'rgba(250,173,20,0.25)' : 'rgba(255,77,79,0.25)', transition: 'width 0.3s' }} />
            <span style={{ position: 'relative', color, fontSize: 12, fontWeight: 600, lineHeight: '22px' }}>{pct}%</span>
          </div>
        );
      }
    },
  ];

  const kpiCards = [
    { label: '参与考勤人数', value: kpi.memberCount, color: '#4d9fff' },
    { label: '总应出勤(人天)', value: kpi.totalOnDuty, color: 'rgba(255,255,255,0.9)' },
    { label: '总实际出勤(人天)', value: kpi.totalAttend, color: '#52c41a' },
    { label: '总请假(天)', value: kpi.totalLeave, color: '#faad14' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarOutlined style={{ color: '#4d9fff' }} />
            人员考勤
          </h3>
          <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            当前周期：{cycleLabel} · 按项目分组 · 应出勤=项目周期∩考勤周期（含周末）{adjustedCount > 0 ? ` · 已校准 ${adjustedCount} 项` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button icon={<EditOutlined />} onClick={openManualAdjust}
            style={{ background: 'rgba(250,173,20,0.1)', border: '1px solid rgba(250,173,20,0.4)', color: '#faad14', borderRadius: 8 }}>
            人工校准
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={openBatchAdjust}
            style={{ background: 'rgba(82,196,26,0.1)', border: '1px solid rgba(82,196,26,0.4)', color: '#52c41a', borderRadius: 8 }}>
            批量人工校准
          </Button>
          <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}
            style={{ background: 'rgba(77,159,255,0.1)', border: '1px solid rgba(77,159,255,0.3)', color: '#7cb8ff', borderRadius: 8 }}>预览</Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}
            style={{ background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none', borderRadius: 8, fontWeight: 500 }}>一键导出 Excel</Button>
        </div>
      </div>

      <Tabs
        defaultActiveKey="statistics"
        items={[
          {
            key: 'statistics',
            label: <span><CalendarOutlined /> 考勤统计</span>,
            children: <StatisticsView
              cycleType={cycleType} setCycleType={setCycleType}
              monthFilter={monthFilter} setMonthFilter={setMonthFilter}
              projectFilter={projectFilter} setProjectFilter={setProjectFilter}
              memberFilter={memberFilter} setMemberFilter={setMemberFilter}
              cycleLabel={cycleLabel} cycleStart={cycleStart}
              projectOptions={projectOptions} memberOptions={memberOptions}
              kpiCards={kpiCards} columns={columns} treeData={treeData}
              filteredRows={filteredRows} kpi={kpi}
            />,
          },
          {
            key: 'entry',
            label: <span><EditOutlined /> 项目考勤录入</span>,
            children: <ProjectEntryView
              teamMembers={teamMembers}
              projects={projects}
              historyProjects={historyProjects}
              attendanceAdjustments={attendanceAdjustments}
              setAttendanceAdjustments={setAttendanceAdjustments}
              cycleType={cycleType} setCycleType={setCycleType}
              monthFilter={monthFilter} setMonthFilter={setMonthFilter}
              cycleStart={cycleStart} cycleEnd={cycleEnd} cycleLabel={cycleLabel}
              projectOptions={projectOptions}
            />,
          },
        ]}
      />

      {/* 预览弹窗 */}
      <Modal title={`考勤预览 - ${cycleLabel}`} open={previewOpen} onCancel={() => setPreviewOpen(false)} width={1000}
        footer={[<Button key="close" onClick={() => setPreviewOpen(false)}>关闭</Button>, <Button key="print" icon={<PrinterOutlined />} onClick={() => window.print()} type="primary">打印</Button>]}
      >
        <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
          {filteredRows.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>暂无数据</div> : (
            Object.entries(
              [...filteredRows].sort((a, b) => a.projectName.localeCompare(b.projectName)).reduce<Record<string, AttendanceRow[]>>((acc, r) => { (acc[r.projectName] = acc[r.projectName] || []).push(r); return acc; }, {}),
            ).map(([projectName, rows]) => (
              <div key={projectName} style={{ marginBottom: 16 }}>
                <div style={{ padding: '8px 12px', background: 'rgba(77,159,255,0.06)', borderRadius: 6, marginBottom: 4, color: '#4d9fff', fontWeight: 500, fontSize: 13 }}>
                  {projectName}（{rows.length} 人 · 项目总周期 {rows[0].projectTotalDays} 天）
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ padding: '6px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>人员</th>
                      <th style={{ padding: '6px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>岗位</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>应出勤</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>实际</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>请假</th>
                      <th style={{ padding: '6px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontWeight: 400 }}>出勤率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.9)' }}>{r.memberName}</td>
                        <td style={{ padding: '6px 8px', color: (POSITION_STYLES[r.position] || {}).color || 'rgba(255,255,255,0.6)' }}>{r.position}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.85)' }}>{r.onDutyDays}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: '#52c41a' }}>{r.attendDays}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: r.leaveDays > 0 ? '#faad14' : 'rgba(255,255,255,0.3)' }}>{r.leaveDays}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'center', color: r.rate >= 0.95 ? '#52c41a' : r.rate >= 0.9 ? '#faad14' : '#ff4d4f' }}>{(r.rate * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* 人工校准 Modal */}
      <Modal title="人工校准考勤数据" open={manualOpen}
        onCancel={() => { setManualOpen(false); manualForm.resetFields(); setManualMember(undefined); setManualProject(undefined); }}
        onOk={handleManualSave}
        okText="保存校准" cancelText="取消" width={520}
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #faad14, #ffc53d)', border: 'none' } }}
      >
        <div style={{ background: 'rgba(250,173,20,0.06)', border: '1px solid rgba(250,173,20,0.15)', borderRadius: 6, padding: '8px 12px', marginBottom: 16, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
        手动指定某人员在某项目本周期内的应出勤/请假天数，会覆盖自动计算结果。保存后该人员在表中显示「已校准」标签。
        </div>
        <Form form={manualForm} layout="vertical">
          <Form.Item name="memberId" label="选择人员" rules={[{ required: true, message: '请选择人员' }]}>
            <Select placeholder="请选择人员" showSearch optionFilterProp="label"
              onChange={handleMemberChange}
              options={teamMembers.map((m) => ({ value: m.id, label: `${m.name}（${POSITION_MAP[m.id] || '测试工程师'}）` }))}
            />
          </Form.Item>
          <Form.Item name="projectName" label="选择项目" rules={[{ required: true, message: '请选择项目' }]}>
            <Select placeholder={manualMember ? '搜索或选择项目' : '请先选择人员'} disabled={!manualMember}
              onChange={handleProjectChange}
              showSearch optionFilterProp="label"
              options={manualMemberProjects.map((p) => ({ value: p, label: p }))}
            />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <Form.Item name="projectStart" label="项目开始时间" rules={[{ required: true, message: '请选择开始时间' }]} style={{ flex: 1 }}>
                <DatePicker style={{ width: '100%' }} placeholder="选择开始时间" />
              </Form.Item>
              <Form.Item name="projectEnd" label="项目结束时间" rules={[{ required: true, message: '请选择结束时间' }]} style={{ flex: 1 }}>
                <DatePicker style={{ width: '100%' }} placeholder="选择结束时间" />
              </Form.Item>
            </div>
            <Form.Item name="leaveDays" label="请假天数" rules={[{ required: true, message: '请输入请假天数' }]}>
              <InputNumber min={0} max={365} style={{ width: '100%' }} placeholder="自动填入系统计算值" />
            </Form.Item>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: -8 }}>
            提示：选择人员/项目后会自动填入系统计算值（基于项目周期∩考勤周期-休假），可在此基础上微调保存
          </div>
        </Form>
      </Modal>

      {/* 批量人工校准 Modal */}
      <Modal
        title={
          <span>
            <ThunderboltOutlined style={{ color: '#52c41a', marginRight: 8 }} />
            批量人工校准
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 12, fontWeight: 'normal' }}>
              支持校准考勤（请假/应出勤）和岗位 · 仅保存实际修改的项
            </span>
          </span>
        }
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={handleBatchSave}
        okText="保存全部修改"
        cancelText="取消"
        width={960}
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #52c41a, #73d13d)', border: 'none' } }}
      >
        <Tabs
          activeKey={batchTab}
          onChange={(k) => setBatchTab(k as 'attendance' | 'position')}
          items={[
            {
              key: 'attendance',
              label: <span><EditOutlined /> 批量校准考勤（{filteredRows.length} 行）</span>,
              children: filteredRows.length === 0 ? (
                <Empty description="当前筛选无考勤数据" />
              ) : (
                <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
                  <div style={{ background: 'rgba(82,196,26,0.05)', border: '1px solid rgba(82,196,26,0.15)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                    <ToolOutlined style={{ color: '#52c41a', marginRight: 6 }} />
                    下方表格展示了「当前筛选条件下」的全部考勤行。修改「请假天数」保存后即覆盖自动计算结果。仅当数值与原值不同时才会落库。
                  </div>
                  <Table<AttendanceRow>
                    size="small"
                    pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条` }}
                    scroll={{ y: 360 }}
                    dataSource={filteredRows}
                    rowKey={(r) => `${r.memberId}|${r.projectName}`}
                    columns={[
                      {
                        title: '人员', dataIndex: 'memberName', width: 90,
                        render: (name: string, r) => (
                          <div>
                            <div style={{ fontSize: 12 }}>{name}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{r.position}</div>
                          </div>
                        ),
                      },
                      { title: '项目', dataIndex: 'projectName', width: 200, ellipsis: true },
                      { title: '应出勤', dataIndex: 'onDutyDays', width: 70, align: 'center' as const,
                        render: (v: number, r) => (
                          <InputNumber
                            size="small"
                            min={0} max={365}
                            value={batchAdj[`${r.memberId}|${r.projectName}`]?.onDutyDays ?? v}
                            onChange={(nv) => setBatchAdj((prev) => ({ ...prev, [`${r.memberId}|${r.projectName}`]: { ...prev[`${r.memberId}|${r.projectName}`], onDutyDays: nv ?? undefined } }))}
                            style={{ width: 60 }}
                          />
                        ),
                      },
                      { title: '请假', dataIndex: 'leaveDays', width: 70, align: 'center' as const,
                        render: (v: number, r) => (
                          <InputNumber
                            size="small"
                            min={0} max={365}
                            value={batchAdj[`${r.memberId}|${r.projectName}`]?.leaveDays ?? v}
                            onChange={(nv) => setBatchAdj((prev) => ({ ...prev, [`${r.memberId}|${r.projectName}`]: { ...prev[`${r.memberId}|${r.projectName}`], leaveDays: nv ?? undefined } }))}
                            style={{ width: 60 }}
                          />
                        ),
                      },
                      { title: '原值', key: 'orig', width: 100, align: 'center' as const,
                        render: (_v, r) => (
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                            应出 {r.onDutyDays} / 请假 {r.leaveDays}
                          </span>
                        ),
                      },
                      { title: '状态', key: 'dirty', width: 70, align: 'center' as const,
                        render: (_v, r) => {
                          const cur = batchAdj[`${r.memberId}|${r.projectName}`];
                          const dirty = (cur?.onDutyDays !== undefined && cur.onDutyDays !== r.onDutyDays) || (cur?.leaveDays !== undefined && cur.leaveDays !== r.leaveDays);
                          return dirty
                            ? <Tag color="orange" style={{ margin: 0 }}>已修改</Tag>
                            : <Tag style={{ margin: 0, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', border: 'none' }}>未变</Tag>;
                        },
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'position',
              label: <span><UserOutlined /> 批量校准岗位（{teamMembers.length} 人）</span>,
              children: (
                <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
                  <div style={{ background: 'rgba(77,159,255,0.05)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 6, padding: '8px 12px', marginBottom: 12, color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                    <UserOutlined style={{ color: '#4d9fff', marginRight: 6 }} />
                    修改岗位后即时保存到团队成员档案（影响所有页面）。仅当与原值不同时才会落库。
                  </div>
                  <Table
                    size="small"
                    pagination={false}
                    scroll={{ y: 360 }}
                    dataSource={teamMembers}
                    rowKey={(r) => r.id}
                    columns={[
                      { title: '人员', dataIndex: 'name', width: 100 },
                      { title: '工号', dataIndex: 'employeeId', width: 100 },
                      { title: '当前岗位', key: 'curPos', width: 140,
                        render: (_v, r) => {
                          const cur = r.position || POSITION_MAP[r.id] || '测试工程师';
                          const style = POSITION_STYLES[cur];
                          return style ? <Tag style={{ background: style.bg, color: style.color, border: 'none', margin: 0 }}>{cur}</Tag> : <span>{cur}</span>;
                        },
                      },
                      { title: '调整岗位', key: 'newPos', width: 180,
                        render: (_v, r) => (
                          <Select
                            size="small"
                            value={batchPos[r.id] ?? r.position ?? POSITION_MAP[r.id] ?? '测试工程师'}
                            onChange={(nv) => setBatchPos((prev) => ({ ...prev, [r.id]: nv }))}
                            style={{ width: '100%' }}
                            options={['助理测试工程师', '测试工程师', '项目主测', '项目经理'].map((v) => ({ value: v, label: v }))}
                          />
                        ),
                      },
                      { title: '状态', key: 'dirty', width: 70, align: 'center' as const,
                        render: (_v, r) => {
                          const cur = r.position || POSITION_MAP[r.id] || '测试工程师';
                          const nv = batchPos[r.id] ?? cur;
                          return nv !== cur
                            ? <Tag color="orange" style={{ margin: 0 }}>已修改</Tag>
                            : <Tag style={{ margin: 0, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', border: 'none' }}>未变</Tag>;
                        },
                      },
                    ]}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>
    </div>
  );
}

// ============== 统计视图组件（原视图封装）==============
function StatisticsView(props: {
  cycleType: CycleType; setCycleType: (v: CycleType) => void;
  monthFilter: dayjs.Dayjs; setMonthFilter: (v: dayjs.Dayjs) => void;
  projectFilter: string; setProjectFilter: (v: string) => void;
  memberFilter: string; setMemberFilter: (v: string) => void;
  cycleLabel: string; cycleStart: string;
  projectOptions: string[]; memberOptions: string[];
  kpiCards: { label: string; value: number; color: string }[];
  columns: ColumnsType<AttendanceNode>;
  treeData: AttendanceNode[];
  filteredRows: AttendanceRow[];
  kpi: { memberCount: number; totalOnDuty: number; totalAttend: number; totalLeave: number; avgRate: number };
}) {
  const { cycleType, setCycleType, monthFilter, setMonthFilter, projectFilter, setProjectFilter,
    memberFilter, setMemberFilter, cycleStart, projectOptions, memberOptions,
    kpiCards, columns, treeData, filteredRows, kpi } = props;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 20, marginTop: 16 }}>
        {kpiCards.map((c) => (
          <div key={c.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 6 }}>{c.label}</div>
            <div style={{ color: c.color, fontSize: 24, fontWeight: 500 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <Radio.Group value={cycleType} onChange={(e) => setCycleType(e.target.value)} optionType="button" buttonStyle="solid" size="small">
          <Radio.Button value="cycle19">19日考勤周期</Radio.Button>
          <Radio.Button value="month">自然月</Radio.Button>
        </Radio.Group>
        <DatePicker picker="month" value={monthFilter} onChange={(v) => v && setMonthFilter(v)} allowClear={false} style={{ width: 140 }} />
        <Select value={projectFilter} onChange={setProjectFilter} style={{ width: 200 }}
          showSearch optionFilterProp="label"
          options={projectOptions.map((v) => ({ value: v, label: v }))} />
        <Select value={memberFilter} onChange={setMemberFilter} style={{ width: 140 }}
          showSearch optionFilterProp="label"
          options={memberOptions.map((v) => ({ value: v, label: v }))} />
      </div>

      <style>{`.att-row-low > td { background: rgba(255,77,79,0.04) !important; }`}</style>
      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
        <Table<AttendanceNode> columns={columns} dataSource={treeData}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'], showTotal: (t) => `共 ${t} 条` }}
          size="small" scroll={{ x: 1050 }}
          expandable={{ defaultExpandAllRows: false, childrenColumnName: 'children' }}
          rowClassName={(record) => (record.children || record.rate >= 0.9) ? '' : 'att-row-low'}
          summary={() => {
            if (filteredRows.length === 0) return null;
            return (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={3}><span style={{ color: '#4d9fff', fontWeight: 600 }}>总计（{treeData.length} 个项目）</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="center"><span style={{ color: 'rgba(255,255,255,0.5)' }}>-</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="center"><span style={{ color: '#4d9fff', fontWeight: 500 }}>{kpi.totalOnDuty}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="center"><span style={{ color: '#52c41a', fontWeight: 500 }}>{kpi.totalAttend}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="center"><span style={{ color: '#faad14', fontWeight: 500 }}>{kpi.totalLeave}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="center"><span style={{ color: '#4d9fff', fontWeight: 500 }}>{(kpi.avgRate * 100).toFixed(1)}%</span></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>{dayjs(cycleStart).isAfter(dayjs().format('YYYY-MM-DD')) ? '该周期尚未开始' : '当前筛选无考勤数据'}</span>} /> }}
        />
      </div>
    </>
  );
}

// ============== 项目考勤录入组件（新视图）==============
function ProjectEntryView(props: {
  teamMembers: TeamMember[];
  projects: Project[];
  historyProjects: HistoricalProject[];
  attendanceAdjustments: Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number; position?: string; attendDays?: number }>;
  setAttendanceAdjustments: (updater: Record<string, any> | ((prev: Record<string, any>) => Record<string, any>)) => void;
  cycleType: CycleType; setCycleType: (v: CycleType) => void;
  monthFilter: dayjs.Dayjs; setMonthFilter: (v: dayjs.Dayjs) => void;
  cycleStart: string; cycleEnd: string; cycleLabel: string;
  projectOptions: string[];
}) {
  const { teamMembers, projects, historyProjects, attendanceAdjustments, setAttendanceAdjustments, cycleStart, cycleEnd, cycleLabel, projectOptions } = props;
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [editing, setEditing] = useState<Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number; position?: string; attendDays?: number }>>({});
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  // 手动添加到该项目的人员 ID（不在系统关联里、但实际参与了的人）
  const [manualMemberIds, setManualMemberIds] = useState<string[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [selectedNewMembers, setSelectedNewMembers] = useState<string[]>([]);

  // 切换项目时清空手动添加的人员
  useEffect(() => {
    setManualMemberIds([]);
    setSavedKeys(new Set());
  }, [selectedProject, cycleStart]);

  const today = dayjs().format('YYYY-MM-DD');

  // 选中项目后，计算该项目所有人员的考勤行
  const projectRows = useMemo(() => {
    if (!selectedProject || dayjs(cycleStart).isAfter(today)) return [];
    const rows: Array<{ memberId: string; memberName: string; projectStart: string; projectEnd: string; onDutyDays: number; attendDays: number; leaveDays: number; position: string; entered: boolean }> = [];

    // 先从 projects/historyProjects 找到项目本身（取项目周期作为兜底）
    const proj = projects.find((p) => p.name === selectedProject) ||
                 historyProjects.find((p) => p.name === selectedProject);
    const fallbackStart = proj?.startDate;
    const fallbackEnd = proj?.endDate;

    teamMembers.forEach((m) => {
      // 从多个来源查找该人员在选中项目的参与记录
      const allProjs = [...(m.projects || []), ...(m.upcomingProjects || [])];
      const p = allProjs.find((x) => x.projectName === selectedProject);
      // 如果人员 projects 里没找到，但项目的 assignedMemberIds 包含该人员，用项目本身的时间兜底
      const isAssigned = proj?.assignedMemberIds?.includes(m.id);
      // 手动添加的人员也列出
      const isManual = manualMemberIds.includes(m.id);
      if (!p && !isAssigned && !isManual) return;

      const projStart = p?.startDate || fallbackStart || cycleStart;
      const projEnd = p?.endDate || fallbackEnd || cycleEnd;
      const key = `${m.id}-${selectedProject}-${cycleStart}`;
      const adj = attendanceAdjustments[key];
      const finalStart = adj?.projectStart ?? projStart;
      const finalEnd = adj?.projectEnd ?? projEnd;
      let duty = dutyRange(finalStart, finalEnd, cycleStart, cycleEnd, today);
      // 手动添加的人员：如果项目周期与考勤周期无交集（如历史项目），
      // 用考勤周期本身作为应出勤区间，确保人员能显示出来
      if (!duty && isManual) {
        duty = { start: cycleStart, end: cycleEnd };
      }
      if (!duty) return;
      const onDutyDays = daysBetween(duty.start, duty.end);
      let baseLeave = 0;
      if (m.leaveStartDate && m.leaveEndDate) baseLeave = overlapDays(m.leaveStartDate, m.leaveEndDate, duty.start, duty.end);
      const leaveDays = adj?.leaveDays ?? baseLeave;
      const memberPos = m.position || POSITION_MAP[m.id] || '测试工程师';
      const position = adj?.position || memberPos;
      const attendDays = adj?.attendDays != null ? Math.min(adj.attendDays, onDutyDays) : Math.max(onDutyDays - leaveDays, 0);
      rows.push({ memberId: m.id, memberName: m.name, projectStart: finalStart, projectEnd: finalEnd, onDutyDays, attendDays, leaveDays, position, entered: adj?.attendDays != null });
    });
    return rows;
  }, [selectedProject, teamMembers, projects, historyProjects, attendanceAdjustments, cycleStart, cycleEnd, today, manualMemberIds]);

  // 初始化 editing（仅在切换项目/周期时执行）
  useEffect(() => {
    const init: Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number; position?: string }> = {};
    projectRows.forEach((r) => {
      // 从 attendanceAdjustments 或 projectRows 拿到当前的项目开始/结束时间
      const adjKey = `${r.memberId}-${selectedProject}-${cycleStart}`;
      const adj = attendanceAdjustments[adjKey];
      init[r.memberId] = {
        projectStart: adj?.projectStart ?? r.projectStart,
        projectEnd: adj?.projectEnd ?? r.projectEnd,
        leaveDays: r.leaveDays,
        position: r.position,
      };
    });
    setEditing(init);
    setSavedKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject, cycleStart]);

  const handleSave = async () => {
    setSaving(true);
    let count = 0;

    // 优化：先组装所有变更，再一次性 setState（避免循环里 N 次重渲染）
    const adjUpdates: Record<string, { projectStart: string; projectEnd: string; leaveDays: number; position?: string; attendDays?: number }> = {};
    const newSaved = new Set(savedKeys);

    projectRows.forEach((r) => {
      const edit = editing[r.memberId];
      if (!edit) return;
      const key = `${r.memberId}-${selectedProject}-${cycleStart}`;
      // 实际出勤的默认值 = max(应出勤-请假, 0)，录入等于默认值时不视为修改
      const dutyS = edit.projectStart ?? r.projectStart;
      const dutyE = edit.projectEnd ?? r.projectEnd;
      const dutyDays = (dutyS && dutyE) ? daysBetween(dutyS, dutyE) : 0;
      const attendFallback = Math.max(dutyDays - (edit.leaveDays ?? r.leaveDays ?? 0), 0);
      const attendChanged = edit.attendDays !== undefined && edit.attendDays !== attendFallback && edit.attendDays !== r.attendDays;
      const hasChange =
        (edit.projectStart !== undefined && edit.projectStart !== r.projectStart) ||
        (edit.projectEnd !== undefined && edit.projectEnd !== r.projectEnd) ||
        (edit.leaveDays !== undefined && edit.leaveDays !== r.leaveDays) ||
        (edit.position !== undefined && edit.position !== r.position) ||
        attendChanged;
      if (!hasChange) return;
      const existing = attendanceAdjustments[key];
      adjUpdates[key] = {
        projectStart: edit.projectStart ?? existing?.projectStart ?? r.projectStart,
        projectEnd: edit.projectEnd ?? existing?.projectEnd ?? r.projectEnd,
        leaveDays: edit.leaveDays ?? existing?.leaveDays ?? r.leaveDays,
        position: edit.position ?? existing?.position ?? r.position,
        attendDays: edit.attendDays ?? existing?.attendDays,
      };
      newSaved.add(r.memberId);
      count++;
    });

    if (count > 0) {
      setAttendanceAdjustments((prev) => ({ ...prev, ...adjUpdates }));
      setSavedKeys(newSaved);
    }
    setSaving(false);
    if (count === 0) message.info('未检测到修改');
    else message.success(`已保存 ${count} 人的考勤数据`);
  };

  return (
    <div style={{ marginTop: 16 }}>
      {/* 选择器条 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select
          placeholder="🔍 搜索或选择项目进行考勤录入"
          value={selectedProject || undefined}
          onChange={(v) => setSelectedProject(v || '')}
          style={{ width: 360 }}
          showSearch
          optionFilterProp="label"
          filterSort={(a, b) => (a.label as string).localeCompare(b.label as string, 'zh-CN')}
          options={projectOptions.filter((v) => v !== '全部').map((v) => ({ value: v, label: v }))}
        />
        {selectedProject && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSelectedNewMembers([]); setAddMemberOpen(true); }}
            style={{ borderRadius: 8, fontWeight: 500 }}>
            添加人员
          </Button>
        )}
        <Radio.Group value={props.cycleType} onChange={(e) => props.setCycleType(e.target.value)} optionType="button" buttonStyle="solid" size="small">
          <Radio.Button value="cycle19">19日周期</Radio.Button>
          <Radio.Button value="month">自然月</Radio.Button>
        </Radio.Group>
        <DatePicker picker="month" value={props.monthFilter} onChange={(v) => v && props.setMonthFilter(v)} allowClear={false} style={{ width: 140 }} />
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{cycleLabel}</span>
      </div>

      {!selectedProject ? (
        <Empty description={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>请选择一个项目进行考勤录入</span>} style={{ padding: 60 }} />
      ) : projectRows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Empty description={<span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>该项目在本周期内无在岗人员</span>} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setSelectedNewMembers([]); setAddMemberOpen(true); }}
            style={{ marginTop: 16, borderRadius: 8 }}>
            添加人员录入考勤
          </Button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 8, padding: '8px 14px', fontSize: 12, color: 'rgba(255,255,255,0.6)', flex: 1, marginRight: 12 }}>
              💡 应出勤 = 项目周期 ∩ 考勤周期（自动推算，含周末）· 实际出勤和岗位可直接编辑 · 修改后点击「一键保存」
            </div>
            <Button icon={<PlusOutlined />} onClick={() => { setSelectedNewMembers([]); setAddMemberOpen(true); }}
              style={{ borderRadius: 8, borderColor: 'rgba(77,159,255,0.3)', color: '#4d9fff', background: 'rgba(77,159,255,0.06)', whiteSpace: 'nowrap' }}>
              添加人员
            </Button>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
            <Table
              size="small" pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 人` }}
              dataSource={projectRows} rowKey="memberId"
              columns={[
                { title: '人员', dataIndex: 'memberName', width: 100,
                  render: (name: string, r: any) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>{name}</span>
                      {savedKeys.has(r.memberId) && <Tag color="success" style={{ margin: 0, fontSize: 10 }}>已保存</Tag>}
                    </div>
                  ),
                },
                { title: '项目岗位', dataIndex: 'position', width: 140,
                  render: (_: unknown, r: any) => (
                    <Select
                      size="small" value={editing[r.memberId]?.position ?? r.position}
                      onChange={(v) => setEditing((prev) => ({ ...prev, [r.memberId]: { ...prev[r.memberId], position: v } }))}
                      style={{ width: '100%' }}
                      options={['助理测试工程师', '测试工程师', '项目主测', '项目经理'].map((v) => ({ value: v, label: v }))}
                    />
                  ),
                },
                { title: '开始时间', key: 'start', width: 140,
                  render: (_: unknown, r: any) => (
                    <DatePicker
                      size="small" value={editing[r.memberId]?.projectStart ? dayjs(editing[r.memberId].projectStart) : (r.projectStart ? dayjs(r.projectStart) : null)}
                      onChange={(v) => setEditing((prev) => ({ ...prev, [r.memberId]: { ...prev[r.memberId], projectStart: v ? v.format('YYYY-MM-DD') : undefined } }))}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                { title: '结束时间', key: 'end', width: 140,
                  render: (_: unknown, r: any) => (
                    <DatePicker
                      size="small" value={editing[r.memberId]?.projectEnd ? dayjs(editing[r.memberId].projectEnd) : (r.projectEnd ? dayjs(r.projectEnd) : null)}
                      onChange={(v) => setEditing((prev) => ({ ...prev, [r.memberId]: { ...prev[r.memberId], projectEnd: v ? v.format('YYYY-MM-DD') : undefined } }))}
                      style={{ width: '100%' }}
                    />
                  ),
                },
                { title: '请假(天)', key: 'leave', width: 90, align: 'center' as const,
                  render: (_: unknown, r: any) => (
                    <InputNumber
                      size="small" min={0} max={365}
                      value={editing[r.memberId]?.leaveDays ?? r.leaveDays}
                      onChange={(nv) => setEditing((prev) => ({ ...prev, [r.memberId]: { ...prev[r.memberId], leaveDays: nv ?? 0 } }))}
                      style={{ width: 70 }}
                    />
                  ),
                },
                { title: '应出勤(天)', key: 'onduty', width: 90, align: 'center' as const,
                  render: (_: unknown, r: any) => {
                    // 自动算：结束-开始+1
                    const s = editing[r.memberId]?.projectStart ?? r.projectStart;
                    const e = editing[r.memberId]?.projectEnd ?? r.projectEnd;
                    const duty = (s && e) ? daysBetween(s, e) : 0;
                    return <span style={{ color: 'rgba(255,255,255,0.6)' }}>{duty}</span>;
                  },
                },
                { title: '实际出勤(天)', key: 'attend', width: 110, align: 'center' as const,
                  render: (_: unknown, r: any) => {
                    const s = editing[r.memberId]?.projectStart ?? r.projectStart;
                    const e = editing[r.memberId]?.projectEnd ?? r.projectEnd;
                    const duty = (s && e) ? daysBetween(s, e) : 0;
                    // 有录入值用录入值，否则按 应出勤-请假 推算
                    const leave = editing[r.memberId]?.leaveDays ?? r.leaveDays ?? 0;
                    const fallback = Math.max(duty - leave, 0);
                    const entered = editing[r.memberId]?.attendDays ?? r.attendDays;
                    return (
                      <InputNumber
                        size="small" min={0} max={duty || 365}
                        value={entered != null ? entered : fallback}
                        onChange={(nv) => setEditing((prev) => ({ ...prev, [r.memberId]: { ...prev[r.memberId], attendDays: nv ?? undefined } }))}
                        style={{ width: 80 }}
                      />
                    );
                  },
                },
                { title: '出勤率', key: 'rate', width: 80, align: 'center' as const,
                  render: (_: unknown, r: any) => {
                    const s = editing[r.memberId]?.projectStart ?? r.projectStart;
                    const e = editing[r.memberId]?.projectEnd ?? r.projectEnd;
                    const duty = (s && e) ? daysBetween(s, e) : 0;
                    const leave = editing[r.memberId]?.leaveDays ?? r.leaveDays ?? 0;
                    const entered = editing[r.memberId]?.attendDays ?? r.attendDays;
                    const attend = entered != null ? Math.min(entered, duty) : Math.max(duty - leave, 0);
                    const rate = duty > 0 ? attend / duty : 0;
                    const pct = (rate * 100).toFixed(0) + '%';
                    const color = rate >= 0.95 ? '#52c41a' : rate >= 0.9 ? '#faad14' : '#ff4d4f';
                    return <span style={{ color, fontWeight: 600 }}>{pct}</span>;
                  },
                },
              ]}
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={5}>
                      <span style={{ color: '#4d9fff', fontWeight: 600 }}>项目汇总（{projectRows.length} 人）</span>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="center"><span style={{ color: 'rgba(255,255,255,0.5)' }}>{projectRows.reduce((s, r) => { const st = editing[r.memberId]?.projectStart ?? r.projectStart; const en = editing[r.memberId]?.projectEnd ?? r.projectEnd; return s + ((st && en) ? daysBetween(st, en) : 0); }, 0)}</span></Table.Summary.Cell>
                    <Table.Summary.Cell index={6} align="center"><span style={{ color: '#4d9fff', fontWeight: 600 }}>-</span></Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </div>
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={handleSave} loading={saving}
              style={{ borderRadius: 8, fontWeight: 500 }}>
              一键保存全部
            </Button>
          </div>
        </>
      )}

      {/* 添加人员弹窗 */}
      <Modal
        title={`往「${selectedProject}」添加人员`}
        open={addMemberOpen}
        onCancel={() => setAddMemberOpen(false)}
        onOk={() => {
          if (selectedNewMembers.length === 0) { message.warning('请至少选择一人'); return; }
          setManualMemberIds((prev) => [...new Set([...prev, ...selectedNewMembers])]);
          // 批量初始化 editing（一次 setState，避免 N 次重渲染）
          const newEntries: Record<string, { projectStart?: string; projectEnd?: string; leaveDays?: number; position?: string }> = {};
          selectedNewMembers.forEach((mid) => {
            const m = teamMembers.find((x) => x.id === mid);
            if (m) newEntries[mid] = { projectStart: cycleStart, projectEnd: cycleEnd, leaveDays: 0, position: m.position || '测试工程师' };
          });
          if (Object.keys(newEntries).length > 0) {
            setEditing((prev) => ({ ...prev, ...newEntries }));
          }
          message.success(`已添加 ${selectedNewMembers.length} 人，请录入考勤`);
          setAddMemberOpen(false);
        }}
        okText="添加"
        cancelText="取消"
        width={520}
      >
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 6, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
          从团队池选择人员添加到本项目，添加后可录入其出勤天数和岗位。已在本项目列表中的人员不会重复显示。
        </div>
        <Select
          mode="multiple"
          placeholder="搜索并选择人员"
          value={selectedNewMembers}
          onChange={setSelectedNewMembers}
          style={{ width: '100%' }}
          showSearch
          optionFilterProp="label"
          options={teamMembers
            .filter((m) => !projectRows.some((r) => r.memberId === m.id))
            .map((m) => ({ value: m.id, label: `${m.name}（${m.employeeId || m.id}）` }))}
        />
      </Modal>
    </div>
  );
}

export default Attendance;
