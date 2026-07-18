import { useState, useMemo, useEffect } from 'react';
import {
  Input, Tag, Avatar, Skeleton, Empty, message,
  Button, Modal, Form, Select, Transfer, DatePicker, Tooltip,
} from 'antd';
import type { TransferProps } from 'antd';
import {
  SearchOutlined,
  EditOutlined,
  MailOutlined,
  PhoneOutlined,
  PlusOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useData } from '../../store/DataContext';
import type { TeamMember, MemberStatus, MemberProject } from '../../types';

const statusConfig: Record<MemberStatus, { bg: string; color: string; dot: string }> = {
  '空闲': { bg: 'rgba(82, 196, 26, 0.12)', color: '#52c41a', dot: '#52c41a' },
  '测试中': { bg: 'rgba(235, 87, 108, 0.12)', color: '#eb576c', dot: '#eb576c' },
  '休假': { bg: 'rgba(24, 144, 255, 0.12)', color: '#1890ff', dot: '#1890ff' },
};

/** 安全获取状态配置：未知 status 兜底为'空闲'，永远不返回 undefined */
function getStatusConfig(status: string): { bg: string; color: string; dot: string } {
  return statusConfig[status as MemberStatus] || statusConfig['空闲'];
}

/** 取名字后 1~2 个字作为头像文字 */
function getAvatarText(name: string): string {
  if (name.length <= 2) return name;
  return name.slice(-2);
}

/** 格式化为 MM-DD */
function fmtShort(dateStr: string): string {
  return dayjs(dateStr).format('MM-DD');
}

/** 检测人员参与的项目时间是否有重叠冲突 */
interface TimeConflict {
  project1: string;
  project2: string;
  overlapStart: string;
  overlapEnd: string;
  overlapDays: number;
}

function detectTimeConflicts(member: TeamMember): TimeConflict[] {
  const all = [...(member.projects || []), ...(member.upcomingProjects || [])];
  const conflicts: TimeConflict[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const s = dayjs(a.startDate).isAfter(b.startDate) ? a.startDate : b.startDate;
      const e = dayjs(a.endDate).isBefore(b.endDate) ? a.endDate : b.endDate;
      if (!dayjs(s).isAfter(e)) {
        const days = dayjs(e).diff(dayjs(s), 'day') + 1;
        if (days > 0) {
          conflicts.push({ project1: a.projectName, project2: b.projectName, overlapStart: s, overlapEnd: e, overlapDays: days });
        }
      }
    }
  }
  return conflicts;
}

function TeamPool() {
  const { teamMembers: members, setTeamMembers: setMembers, projects, setProjects, autoProcessProjects, autoProcessMembers, syncMembersFromProjects } = useData();

  // ===== 自动化流程：进入人员池时自动处理项目/人员状态 + 同步人员项目数据 =====
  useEffect(() => {
    autoProcessProjects();
    autoProcessMembers();
    syncMembersFromProjects();
  }, [autoProcessProjects, autoProcessMembers, syncMembersFromProjects]);
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [projectFilter, setProjectFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [loading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [form] = Form.useForm();

  // 批量指派
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchTargetKeys, setBatchTargetKeys] = useState<string[]>([]);

  // 冲突人员查看
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [batchForm] = Form.useForm();

  // 从项目管理中提取未开始/测试中的项目列表
  const allProjects = useMemo(() => {
    return projects
      .filter((p) => p.status === '未开始' || p.status === '测试中')
      .map((p) => p.name)
      .sort();
  }, [projects]);

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (statusFilter !== '全部' && m.status !== statusFilter) return false;
      if (projectFilter !== '全部') {
        const allMemberProjects = [
          ...(m.currentProjects || []),
          ...(m.projects || []).map((p) => p.projectName),
          ...(m.upcomingProjects || []).map((p) => p.projectName),
        ];
        if (!allMemberProjects.includes(projectFilter)) return false;
      }
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!m.name.toLowerCase().includes(kw) && !m.employeeId.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [members, statusFilter, projectFilter, searchText]);

  const statusFilters = ['全部', '空闲', '测试中', '休假'];

  const openAdd = () => {
    setEditingMember(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (member: TeamMember) => {
    setEditingMember(member);
    form.setFieldsValue({
      name: member.name,
      employeeId: member.employeeId,
      status: member.status,
      skills: member.skills,
      email: member.email || '',
      phone: member.phone || '',
      leaveStartDate: member.leaveStartDate ? dayjs(member.leaveStartDate) : null,
      leaveEndDate: member.leaveEndDate ? dayjs(member.leaveEndDate) : null,
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    form.validateFields().then((values) => {
      const leaveStartDate = values.leaveStartDate ? dayjs(values.leaveStartDate).format('YYYY-MM-DD') : undefined;
      const leaveEndDate = values.leaveEndDate ? dayjs(values.leaveEndDate).format('YYYY-MM-DD') : undefined;

      if (editingMember) {
        const becameIdle = editingMember.status === '测试中' && values.status === '空闲';
        setMembers((prev) =>
          prev.map((m) =>
            m.id === editingMember.id
              ? {
                  ...m,
                  name: values.name,
                  employeeId: values.employeeId,
                  status: values.status,
                  skills: values.skills || [],
                  email: values.email || '',
                  phone: values.phone || '',
                  leaveStartDate,
                  leaveEndDate,
                  // 转为空闲时清除所有项目关联（包括 upcomingProjects）
                  ...(becameIdle ? { projects: [], currentProjects: [], upcomingProjects: [] } : {}),
                }
              : m
          )
        );
        message.success(`成员「${values.name}」更新成功`);
      } else {
        // 使用时间戳生成唯一 ID，避免删除后添加导致 ID 冲突
        const newMember: TeamMember = {
          id: `m${Date.now()}`,
          name: values.name,
          employeeId: values.employeeId,
          status: values.status,
          skills: values.skills || [],
          currentProjects: [],
          email: values.email || '',
          phone: values.phone || '',
          leaveStartDate,
          leaveEndDate,
        };
        setMembers((prev) => [...prev, newMember]);
        message.success(`成员「${values.name}」添加成功`);
      }
      setModalOpen(false);
      form.resetFields();
      setEditingMember(null);
    });
  };

  // 批量指派
  const transferData = useMemo(
    () =>
      members.map((m) => ({
        key: m.id,
        title: `${m.name}  ${m.employeeId}`,
        status: m.status,
        chosen: m.status === '测试中',
      })),
    [members]
  );

  // 人员统计
  const stats = useMemo(() => {
    const testingCount = members.filter((m) => m.status === '测试中').length;
    const idleCount = members.filter((m) => m.status === '空闲').length;
    const onLeaveCount = members.filter((m) => m.status === '休假').length;
    const conflictCount = members.filter((m) => detectTimeConflicts(m).length > 0).length;
    return { testingCount, idleCount, onLeaveCount, conflictCount };
  }, [members]);

  // 冲突人员列表（展平所有冲突为行）
  const conflictRows = useMemo(() => {
    const rows: { key: string; memberId: string; memberName: string; projectA: string; projectB: string; overlapStart: string; overlapEnd: string; overlapDays: number }[] = [];
    members.forEach((m) => {
      const conflicts = detectTimeConflicts(m);
      conflicts.forEach((c, i) => {
        rows.push({
          key: `${m.id}-${i}`,
          memberId: m.id,
          memberName: m.name,
          projectA: c.project1,
          projectB: c.project2,
          overlapStart: c.overlapStart,
          overlapEnd: c.overlapEnd,
          overlapDays: c.overlapDays,
        });
      });
    });
    return rows;
  }, [members]);

  const handleBatchAssign = () => {
    batchForm.validateFields().then((values) => {
      const project = values.project as string;
      const ids = batchTargetKeys;
      if (ids.length === 0) {
        message.warning('请至少选择一名人员');
        return;
      }
      // 从项目管理中自动同步项目时间，无需手动选择
      const projectInfo = projects.find((p) => p.name === project);
      if (!projectInfo) {
        message.error('未找到对应项目信息，请重试');
        return;
      }
      const startDate = projectInfo.startDate;
      const endDate = projectInfo.endDate;
      if (!startDate || !endDate) {
        message.error('项目时间信息缺失，无法指派');
        return;
      }
      const now = dayjs();
      const isStarted = !dayjs(startDate).isAfter(now, 'day'); // startDate <= today
      const isEnded = dayjs(endDate).isBefore(now, 'day'); // endDate < today
      const isActive = isStarted && !isEnded; // 进行中
      const isUpcoming = !isStarted; // 未开始

      // 项目已结束：直接拒绝，不执行指派（提前判断，避免无效的状态更新）
      if (!isActive && !isUpcoming) {
        message.error('该项目已结束，无法指派人员');
        return;
      }

      // 检测时间冲突：新增项目与被指派人员的现有项目时间重叠
      const conflictNames: string[] = [];
      ids.forEach((id) => {
        const m = members.find((x) => x.id === id);
        if (!m) return;
        const existing = [...(m.projects || []), ...(m.upcomingProjects || [])];
        for (const p of existing) {
          if (p.projectName === project) continue;
          const s = dayjs(p.startDate).isAfter(startDate) ? p.startDate : startDate;
          const e = dayjs(p.endDate).isBefore(endDate) ? p.endDate : endDate;
          if (!dayjs(s).isAfter(e)) {
            conflictNames.push(m.name);
            break;
          }
        }
      });
      if (conflictNames.length > 0) {
        message.warning(`⚠ ${conflictNames.join('、')} 与现有项目时间冲突，请及时调整`);
      }

      setMembers((prev) =>
        prev.map((m) => {
          if (!ids.includes(m.id)) return m;
          const newProject: MemberProject = { projectName: project, startDate, endDate };

          if (isActive) {
            // 项目进行中 → 状态转为「测试中」，写入 projects + currentProjects
            const existingProjects = m.projects || [];
            const projectExists = existingProjects.find((p) => p.projectName === project);
            const updatedProjects = projectExists
              ? existingProjects.map((p) => (p.projectName === project ? newProject : p))
              : [...existingProjects, newProject];
            const newCurrentProjects = m.currentProjects.includes(project)
              ? m.currentProjects
              : [...m.currentProjects, project];
            // 同步移除 upcomingProjects 中的同名项目（避免重复）
            const cleanedUpcoming = (m.upcomingProjects || []).filter(
              (p) => p.projectName !== project
            );
            return {
              ...m,
              status: '测试中',
              currentProjects: newCurrentProjects,
              projects: updatedProjects,
              upcomingProjects: cleanedUpcoming,
            };
          }

          if (isUpcoming) {
            // 项目未开始 → 写入 upcomingProjects，状态保持不变
            const existingUpcoming = m.upcomingProjects || [];
            const upcomingExists = existingUpcoming.find((p) => p.projectName === project);
            const updatedUpcoming = upcomingExists
              ? existingUpcoming.map((p) => (p.projectName === project ? newProject : p))
              : [...existingUpcoming, newProject];
            return {
              ...m,
              upcomingProjects: updatedUpcoming,
            };
          }

          // 兜底（项目已结束）：allProjects 理论上不会包含已结束项目，但保险起见处理
          return m;
        })
      );

      // 同步更新项目的 assignedMemberIds（避免 syncMembersFromProjects 覆盖手动指派）
      setProjects((prev) => prev.map((p) => {
        if (p.name !== project) return p;
        const existing = p.assignedMemberIds || [];
        const merged = Array.from(new Set([...existing, ...ids]));
        return { ...p, assignedMemberIds: merged };
      }));

      const statusHint = isActive
        ? '，项目进行中已自动转为测试中'
        : '，项目未开始已加入即将参与';
      message.success(`已成功指派 ${ids.length} 人到项目「${project}」${statusHint}`);
      setBatchModalOpen(false);
      batchForm.resetFields();
      setBatchTargetKeys([]);
    });
  };

  const transferRender: TransferProps<{ key: string; title: string; status: MemberStatus }>['render'] = (item) => {
    const cfg = getStatusConfig(item.status);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: cfg.dot,
            display: 'inline-block',
            boxShadow: `0 0 6px ${cfg.dot}`,
          }}
        />
        <span style={{ color: '#fff', fontFamily: 'var(--font-primary)', fontSize: 13 }}>{item.title}</span>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header">
        <h3>测试人员池</h3>
      </div>

      {/* 人员统计卡片 */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <div style={{
          flex: 1, minWidth: 140, maxWidth: 200,
          background: 'rgba(235, 87, 108, 0.08)',
          border: '1px solid rgba(235, 87, 108, 0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(235, 87, 108, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TeamOutlined style={{ color: '#eb576c', fontSize: 20 }} />
          </div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 2 }}>测试中</div>
            <div style={{ color: '#eb576c', fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{stats.testingCount}</div>
          </div>
        </div>
        <div style={{
          flex: 1, minWidth: 140, maxWidth: 200,
          background: 'rgba(82, 196, 26, 0.08)',
          border: '1px solid rgba(82, 196, 26, 0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(82, 196, 26, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TeamOutlined style={{ color: '#52c41a', fontSize: 20 }} />
          </div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 2 }}>空闲</div>
            <div style={{ color: '#52c41a', fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{stats.idleCount}</div>
          </div>
        </div>
        <div style={{
          flex: 1, minWidth: 140, maxWidth: 200,
          background: 'rgba(24, 144, 255, 0.08)',
          border: '1px solid rgba(24, 144, 255, 0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(24, 144, 255, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <TeamOutlined style={{ color: '#1890ff', fontSize: 20 }} />
          </div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 2 }}>休假</div>
            <div style={{ color: '#1890ff', fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{stats.onLeaveCount}</div>
          </div>
        </div>
        <div style={{
          flex: 1, minWidth: 140, maxWidth: 200,
          background: 'rgba(250, 173, 20, 0.08)',
          border: '1px solid rgba(250, 173, 20, 0.2)',
          borderRadius: 10,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(250, 173, 20, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <WarningOutlined style={{ color: '#faad14', fontSize: 20 }} />
          </div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginBottom: 2 }}>时间冲突</div>
            <div style={{ color: '#faad14', fontSize: 24, fontWeight: 700, lineHeight: 1 }}>{stats.conflictCount}</div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 24, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {statusFilters.map((s) => (
            <Tag.CheckableTag
              key={s}
              checked={statusFilter === s}
              onChange={() => setStatusFilter(s)}
              style={{
                padding: '4px 16px',
                border: statusFilter === s ? '1px solid rgba(77,159,255,0.5)' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: 20,
                fontSize: 13,
                background: statusFilter === s ? 'rgba(77,159,255,0.15)' : 'rgba(255,255,255,0.04)',
                color: statusFilter === s ? '#7cb8ff' : 'rgba(255,255,255,0.5)',
                fontFamily: 'var(--font-primary)',
              }}
            >
              {s}
            </Tag.CheckableTag>
          ))}
        </div>
        <Select
          value={projectFilter}
          onChange={setProjectFilter}
          style={{ width: 200, fontFamily: 'var(--font-primary)' }}
          popupMatchSelectWidth={false}
          placeholder="按项目筛选人员"
        >
          <Select.Option value="全部">📋 全部项目</Select.Option>
          {allProjects.map((p) => (
            <Select.Option key={p} value={p}>{p}</Select.Option>
          ))}
        </Select>
        <Input
          placeholder="搜索姓名或工号"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 220, fontFamily: 'var(--font-primary)' }}
          allowClear
          variant="borderless"
        />
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openAdd}
          style={{
            background: 'linear-gradient(135deg, #4d9fff, #69b1ff)',
            border: 'none',
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            borderRadius: 8,
            boxShadow: '0 4px 14px rgba(77,159,255,0.35)',
          }}
        >
          添加人员
        </Button>
        <Button
          icon={<TeamOutlined />}
          onClick={() => {
            setBatchModalOpen(true);
            setBatchTargetKeys([]);
            batchForm.resetFields();
          }}
          style={{
            background: 'rgba(77,159,255,0.12)',
            border: '1px solid rgba(77,159,255,0.3)',
            color: '#7cb8ff',
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            borderRadius: 8,
          }}
        >
          批量指派
        </Button>
        <Button
          icon={<WarningOutlined />}
          onClick={() => setConflictModalOpen(true)}
          style={{
            background: stats.conflictCount > 0 ? 'rgba(250,173,20,0.15)' : 'rgba(250,173,20,0.05)',
            border: `1px solid ${stats.conflictCount > 0 ? 'rgba(250,173,20,0.4)' : 'rgba(250,173,20,0.2)'}`,
            color: stats.conflictCount > 0 ? '#faad14' : 'rgba(250,173,20,0.6)',
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            borderRadius: 8,
          }}
        >
          冲突人员查看{stats.conflictCount > 0 ? ` (${stats.conflictCount})` : ''}
        </Button>
      </div>

      {loading ? (
        <div className="team-grid">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="member-card">
              <Skeleton avatar active paragraph={{ rows: 2 }} />
            </div>
          ))}
        </div>
      ) : filteredMembers.length === 0 ? (
        <Empty description={<span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-primary)' }}>暂无匹配的团队成员</span>} />
      ) : (
        <div className="team-grid">
{filteredMembers.map((member) => {
          const statusCfg = getStatusConfig(member.status);
            const memberProjects = member.projects || [];
            const conflicts = detectTimeConflicts(member);
            // 当前进行中的项目
            const now = dayjs();
            const activeProjects = memberProjects.filter(
              (p) => !dayjs(p.startDate).isAfter(now, 'day') && !dayjs(p.endDate).isBefore(now, 'day')
            );
            return (
              <div key={member.id} className="member-card" style={{ position: 'relative' }}>
                {/* 左上角状态圆点 */}
                <div
                  style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: statusCfg.dot,
                    boxShadow: `0 0 8px ${statusCfg.dot}`,
                    zIndex: 2,
                  }}
                />

                {/* 编辑按钮 */}
                <EditOutlined
                  style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    fontSize: 18,
                    color: '#4d9fff',
                    cursor: 'pointer',
                    transition: 'color 0.2s',
                    zIndex: 2,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(member);
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.color = '#7cb8ff';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.color = '#4d9fff';
                  }}
                />

                {/* 时间冲突警告 */}
                {conflicts.length > 0 && (
                  <Tooltip
                    title={
                      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>时间冲突（{conflicts.length} 处）</div>
                        {conflicts.map((c, i) => (
                          <div key={i}>
                            「{c.project1}」与「{c.project2}」重叠 {c.overlapDays} 天
                            <span style={{ color: 'rgba(255,255,255,0.5)' }}>（{c.overlapStart} ~ {c.overlapEnd}）</span>
                          </div>
                        ))}
                      </div>
                    }
                    placement="bottom"
                  >
                    <WarningOutlined
                      style={{
                        position: 'absolute',
                        top: 12,
                        right: 40,
                        fontSize: 16,
                        color: '#faad14',
                        cursor: 'pointer',
                        zIndex: 2,
                      }}
                    />
                  </Tooltip>
                )}

                {/* 头像 + 名字 — 整体居中 */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginBottom: 12 }}>
                  <Avatar
                    size={64}
                    style={{
                      background: 'linear-gradient(135deg, #4d9fff, #69b1ff)',
                      marginBottom: 10,
                      boxShadow: '0 4px 12px rgba(77,159,255,0.3)',
                      fontSize: 20,
                      fontWeight: 600,
                      fontFamily: 'var(--font-primary)',
                    }}
                  >
                    {getAvatarText(member.name)}
                  </Avatar>
                  <span className="member-name">{member.name}</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, fontFamily: 'var(--font-primary)', marginTop: 2 }}>
                    {member.employeeId}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.4)',
                    marginBottom: 4,
                    fontFamily: 'var(--font-primary)',
                    textAlign: 'center',
                  }}
                >
                  {member.email && (
                    <>
                      <MailOutlined /> {member.email}
                    </>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.4)',
                    marginBottom: 10,
                    fontFamily: 'var(--font-primary)',
                    textAlign: 'center',
                  }}
                >
                  {member.phone && (
                    <>
                      <PhoneOutlined /> {member.phone}
                    </>
                  )}
                </div>

                {/* 休假信息 */}
                {member.status === '休假' && member.leaveStartDate && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: 8,
                      fontFamily: 'var(--font-primary)',
                      background: 'rgba(24,144,255,0.08)',
                      borderRadius: 6,
                      padding: '6px 8px',
                      border: '1px solid rgba(24,144,255,0.15)',
                      textAlign: 'center',
                    }}
                  >
                    <ClockCircleOutlined style={{ marginRight: 4, color: '#1890ff' }} />
                    <span style={{ color: '#1890ff' }}>休假中</span>
                    <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>
                      {fmtShort(member.leaveStartDate)} ~ {member.leaveEndDate ? fmtShort(member.leaveEndDate) : '未定'}
                    </span>
                  </div>
                )}

                {/* 未来项目 */}
                {member.upcomingProjects && member.upcomingProjects.length > 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.5)',
                      marginBottom: 8,
                      fontFamily: 'var(--font-primary)',
                      background: 'rgba(250,173,20,0.08)',
                      borderRadius: 6,
                      padding: '6px 8px',
                      border: '1px solid rgba(250,173,20,0.15)',
                      textAlign: 'center',
                    }}
                  >
                    <ClockCircleOutlined style={{ marginRight: 4, color: '#faad14' }} />
                    <span style={{ color: '#faad14' }}>即将参与</span>
                    {member.upcomingProjects.map((p) => (
                      <div key={p.projectName} style={{ marginBottom: 2 }}>
                        <span style={{ color: 'rgba(255,255,255,0.6)' }}>{p.projectName}</span>
                        <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>
                          {fmtShort(p.startDate)} ~ {fmtShort(p.endDate)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 当前进行中的项目及时间 */}
                <div
                  style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.5)',
                    marginBottom: 8,
                    fontFamily: 'var(--font-primary)',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 6,
                    padding: '6px 8px',
                    border: '1px solid rgba(255,255,255,0.06)',
                    textAlign: 'center',
                  }}
                >
                  {activeProjects.length > 0 ? (
                    <>
                      <ClockCircleOutlined style={{ marginRight: 4 }} />
                      {activeProjects.map((p) => (
                        <div key={p.projectName} style={{ marginBottom: 2 }}>
                          <span style={{ color: '#faad14' }}>{p.projectName}</span>
                          <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 6 }}>
                            {fmtShort(p.startDate)} ~ {fmtShort(p.endDate)}
                          </span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <>当前项目：暂无项目</>
                  )}
                </div>

                <div className="skill-tags" style={{ justifyContent: 'center' }}>
                  {(member.skills || []).map((skill) => (
                    <Tag
                      key={skill}
                      style={{
                        background: 'rgba(77,159,255,0.12)',
                        color: '#7cb8ff',
                        border: '1px solid rgba(77,159,255,0.2)',
                        borderRadius: 4,
                        fontFamily: 'var(--font-primary)',
                        fontSize: 11,
                        margin: '0 2px 2px 0',
                      }}
                    >
                      {skill}
                    </Tag>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 添加/编辑人员 Modal */}
      <Modal
        title={editingMember ? '编辑人员' : '添加人员'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
          setEditingMember(null);
        }}
        okText={editingMember ? '保存修改' : '确认添加'}
        cancelText="取消"
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none' } }}
        bodyStyle={{ background: 'rgba(13,31,60,0.95)' }}
        style={{ top: 120 }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          <Form.Item name="employeeId" label="工号" rules={[{ required: true, message: '请输入工号' }]}>
            <Input placeholder="请输入工号" />
          </Form.Item>
          <Form.Item
            name="status"
            label="状态"
            rules={[{ required: true, message: '请选择状态' }]}
            initialValue="空闲"
          >
            <Select placeholder="请选择状态">
              <Select.Option value="空闲">空闲</Select.Option>
              <Select.Option value="测试中">测试中</Select.Option>
              <Select.Option value="休假">休假</Select.Option>
            </Select>
          </Form.Item>

          {/* 休假日期（仅在状态为休假时显示，使用 shouldUpdate 监听 status 变化） */}
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.status !== curr.status}>
            {({ getFieldValue }) =>
              getFieldValue('status') === '休假' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <Form.Item name="leaveStartDate" label="休假开始日期" rules={[{ required: true, message: '请选择休假开始日期' }]}>
                    <DatePicker style={{ width: '100%' }} placeholder="选择开始日期" />
                  </Form.Item>
                  <Form.Item name="leaveEndDate" label="休假结束日期" rules={[{ required: true, message: '请选择休假结束日期' }]}>
                    <DatePicker style={{ width: '100%' }} placeholder="选择结束日期" />
                  </Form.Item>
                </div>
              ) : null
            }
          </Form.Item>
          <Form.Item name="skills" label="技能标签">
            <Select mode="tags" placeholder="输入技能标签，按回车确认" allowClear />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="请输入电话" />
          </Form.Item>

          {/* 编辑时展示项目时间信息 */}
          {editingMember && editingMember.projects && editingMember.projects.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  color: 'rgba(255,255,255,0.6)',
                  fontSize: 13,
                  fontFamily: 'var(--font-primary)',
                  marginBottom: 8,
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  paddingBottom: 6,
                }}
              >
                <ClockCircleOutlined style={{ marginRight: 6 }} />
                项目时间安排
              </div>
              {editingMember.projects.map((p) => {
                const isActive = !dayjs().isBefore(dayjs(p.startDate), 'day') && !dayjs().isAfter(dayjs(p.endDate), 'day');
                return (
                  <div
                    key={p.projectName}
                    style={{
                      background: isActive ? 'rgba(250,173,20,0.08)' : 'rgba(255,255,255,0.03)',
                      border: isActive ? '1px solid rgba(250,173,20,0.2)' : '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 6,
                      padding: '8px 10px',
                      marginBottom: 6,
                      fontSize: 12,
                      fontFamily: 'var(--font-primary)',
                    }}
                  >
                    <div style={{ color: isActive ? '#faad14' : 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
                      {p.projectName} {isActive && <Tag style={{ marginLeft: 4, fontSize: 10, lineHeight: '14px', padding: '0 4px' }}>进行中</Tag>}
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
                      开始：{p.startDate}　结束：{p.endDate}
                    </div>
                  </div>
                );
              })}

              {/* 转为空闲按钮 */}
              <Button
                block
                onClick={() => {
                  if (!editingMember) return;
                  setMembers((prev) =>
                    prev.map((m) =>
                      m.id === editingMember.id
                        ? { ...m, status: '空闲', projects: [], currentProjects: [], upcomingProjects: [] }
                        : m
                    )
                  );
                  message.success(`「${editingMember.name}」已转为空闲状态，项目信息已清除`);
                  setModalOpen(false);
                  form.resetFields();
                  setEditingMember(null);
                }}
                style={{
                  marginTop: 12,
                  background: 'rgba(82, 196, 26, 0.12)',
                  border: '1px solid rgba(82, 196, 26, 0.3)',
                  color: '#52c41a',
                  fontFamily: 'var(--font-primary)',
                  fontWeight: 500,
                  borderRadius: 6,
                  height: 36,
                }}
              >
                转为空闲
              </Button>
            </div>
          )}
        </Form>
      </Modal>

      {/* 冲突人员查看 Modal */}
      <Modal
        title={`时间冲突人员（共 ${stats.conflictCount} 人 / ${conflictRows.length} 处冲突）`}
        open={conflictModalOpen}
        onCancel={() => setConflictModalOpen(false)}
        footer={<Button onClick={() => setConflictModalOpen(false)}>关闭</Button>}
        width={820}
        bodyStyle={{ background: 'rgba(13,31,60,0.95)' }}
        style={{ top: 60 }}
      >
        {conflictRows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
            当前没有时间冲突的人员
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(77,159,255,0.06)', borderBottom: '2px solid rgba(77,159,255,0.2)' }}>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>人员</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>冲突项目 A</th>
                <th style={{ padding: '10px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>冲突项目 B</th>
                <th style={{ padding: '10px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>重叠区间</th>
                <th style={{ padding: '10px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>重叠天数</th>
              </tr>
            </thead>
            <tbody>
              {conflictRows.map((r) => (
                <tr key={r.key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 8px', color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}>{r.memberName}</td>
                  <td style={{ padding: '10px 8px', color: 'rgba(255,255,255,0.7)' }}>{r.projectA}</td>
                  <td style={{ padding: '10px 8px', color: 'rgba(255,255,255,0.7)' }}>{r.projectB}</td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                    {r.overlapStart} ~ {r.overlapEnd}
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                    <span style={{ display: 'inline-block', padding: '2px 10px', background: 'rgba(250,173,20,0.12)', color: '#faad14', border: '1px solid rgba(250,173,20,0.3)', borderRadius: 4, fontSize: 12 }}>
                      {r.overlapDays} 天
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      {/* 批量指派 Modal */}
      <Modal
        title="批量指派人员到项目"
        open={batchModalOpen}
        onOk={handleBatchAssign}
        onCancel={() => {
          setBatchModalOpen(false);
          setBatchTargetKeys([]);
          batchForm.resetFields();
        }}
        okText="确认指派"
        cancelText="取消"
        width={680}
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none' } }}
        bodyStyle={{ background: 'rgba(13,31,60,0.95)' }}
        style={{ top: 60 }}
      >
        <Form form={batchForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="project" label="选择测试项目" rules={[{ required: true, message: '请选择一个项目' }]}>
            <Select placeholder="请选择要指派的测试项目">
              {allProjects.map((p) => (
                <Select.Option key={p} value={p}>
                  {p}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          {/* 选择项目后自动同步显示项目时间（无需手动选择） */}
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.project !== curr.project}>
            {({ getFieldValue }) => {
              const selectedProjectName = getFieldValue('project') as string | undefined;
              const selectedProject = selectedProjectName
                ? projects.find((p) => p.name === selectedProjectName)
                : undefined;
              if (!selectedProject) return null;
              const now = dayjs();
              const isStarted = !dayjs(selectedProject.startDate).isAfter(now, 'day');
              const isEnded = dayjs(selectedProject.endDate).isBefore(now, 'day');
              const phase = !isStarted
                ? { label: '未开始', color: '#7cb8ff' }
                : !isEnded
                ? { label: '进行中', color: '#faad14' }
                : { label: '已结束', color: 'rgba(255,255,255,0.5)' };
              return (
                <div
                  style={{
                    marginBottom: 16,
                    padding: '12px 14px',
                    background: 'rgba(77,159,255,0.08)',
                    border: '1px solid rgba(77,159,255,0.2)',
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: 'var(--font-primary)',
                    color: 'rgba(255,255,255,0.65)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ClockCircleOutlined style={{ color: '#4d9fff' }} />
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>项目时间（自动同步）</span>
                  </div>
                  <div style={{ display: 'flex', gap: 24, paddingLeft: 22 }}>
                    <span>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>开始：</span>
                      <span style={{ color: '#fff' }}>{selectedProject.startDate}</span>
                    </span>
                    <span>
                      <span style={{ color: 'rgba(255,255,255,0.4)' }}>结束：</span>
                      <span style={{ color: '#fff' }}>{selectedProject.endDate}</span>
                    </span>
                    <Tag
                      style={{
                        color: phase.color,
                        background: `${phase.color}1a`,
                        border: `1px solid ${phase.color}40`,
                        borderRadius: 4,
                        fontSize: 11,
                        lineHeight: '16px',
                        padding: '0 6px',
                        margin: 0,
                      }}
                    >
                      {phase.label}
                    </Tag>
                  </div>
                  <div style={{ paddingLeft: 22, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                    {phase.label === '进行中'
                      ? '指派后人员状态将自动转为「测试中」'
                      : phase.label === '未开始'
                      ? '指派后将加入「即将参与」列表，到达开始日期后自动转为测试中'
                      : '该项目已结束，无法指派'}
                  </div>
                </div>
              );
            }}
          </Form.Item>
        </Form>
        <div
          style={{
            marginBottom: 8,
            color: 'rgba(255,255,255,0.5)',
            fontSize: 13,
            fontFamily: 'var(--font-primary)',
          }}
        >
          从左侧选择人员，添加到右侧后点击「确认指派」
        </div>
        <Transfer
          dataSource={transferData}
          titles={['可选人员', '已选人员']}
          targetKeys={batchTargetKeys}
          onChange={(nextTargetKeys) => setBatchTargetKeys(nextTargetKeys as string[])}
          render={transferRender}
          listStyle={{
            width: 280,
            height: 320,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
          }}
          selectAllLabels={['全选', '全选']}
        />
      </Modal>

      {/* Transfer 深色主题选中项样式覆盖 */}
      <style>{`
        .ant-transfer-list-content-item-checked {
          background: rgba(77, 159, 255, 0.2) !important;
        }
        .ant-transfer-list-content-item:hover {
          background: rgba(77, 159, 255, 0.1) !important;
        }
        .ant-transfer-list-content-item-checked .ant-transfer-list-content-item-text {
          color: #fff !important;
        }
        .ant-transfer-list-header {
          background: rgba(255,255,255,0.06) !important;
          border-bottom: 1px solid rgba(255,255,255,0.1) !important;
          color: rgba(255,255,255,0.7) !important;
        }
        .ant-transfer-list-body-search-action {
          color: rgba(255,255,255,0.5) !important;
        }
        .ant-transfer-list-body-search-action:hover {
          color: #7cb8ff !important;
        }
        .ant-picker-input > input {
          color: #fff !important;
        }
        .ant-picker-suffix {
          color: rgba(255,255,255,0.5) !important;
        }
      `}</style>
    </div>
  );
}

export default TeamPool;
