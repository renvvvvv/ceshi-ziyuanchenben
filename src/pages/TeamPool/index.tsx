import { useState, useMemo, useEffect } from 'react';
import {
  Input, Tag, Avatar, Skeleton, Empty, message,
  Button, Modal, Form, Select, Transfer, DatePicker,
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
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { mockTeamMembers } from '../../data/mock';
import type { TeamMember, MemberStatus, MemberProject } from '../../types';

const statusConfig: Record<MemberStatus, { bg: string; color: string; dot: string }> = {
  '空闲': { bg: 'rgba(82, 196, 26, 0.12)', color: '#52c41a', dot: '#52c41a' },
  '测试中': { bg: 'rgba(235, 87, 108, 0.12)', color: '#eb576c', dot: '#eb576c' },
  '休假': { bg: 'rgba(24, 144, 255, 0.12)', color: '#1890ff', dot: '#1890ff' },
  '出差': { bg: 'rgba(114, 46, 209, 0.12)', color: '#722ed1', dot: '#722ed1' },
};

const PROJECTS = [
  '江苏太仓 D17A 段',
  '乌兰三期XM A1',
  '廊坊三河铭泰改造',
  '广州苹果',
  '乌兰三期字节A2',
];

/** 取名字后 1~2 个字作为头像文字 */
function getAvatarText(name: string): string {
  if (name.length <= 2) return name;
  return name.slice(-2);
}

/** 根据项目时间自动计算当前应有状态 */
function computeStatusFromProjects(projects: MemberProject[]): MemberStatus {
  const now = dayjs();
  const hasActive = projects.some(
    (p) => !dayjs(p.startDate).isAfter(now, 'day') && !dayjs(p.endDate).isBefore(now, 'day')
  );
  return hasActive ? '测试中' : '空闲';
}

/** 格式化为 MM-DD */
function fmtShort(dateStr: string): string {
  return dayjs(dateStr).format('MM-DD');
}

function TeamPool() {
  const [members, setMembers] = useState<TeamMember[]>(mockTeamMembers);
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [loading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [form] = Form.useForm();

  // 批量指派
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchTargetKeys, setBatchTargetKeys] = useState<string[]>([]);
  const [batchForm] = Form.useForm();

  // 自动状态切换定时器（每 30 秒检查一次）
  useEffect(() => {
    const timer = setInterval(() => {
      setMembers((prev) =>
        prev.map((m) => {
          const projects = m.projects || [];
          if (projects.length === 0) return m;
          const computed = computeStatusFromProjects(projects);
          if (computed !== m.status) {
            return { ...m, status: computed };
          }
          return m;
        })
      );
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (statusFilter !== '全部' && m.status !== statusFilter) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!m.name.toLowerCase().includes(kw) && !m.employeeId.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [members, statusFilter, searchText]);

  const statusFilters = ['全部', '空闲', '测试中'];

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
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    form.validateFields().then((values) => {
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
                  ...(becameIdle ? { projects: [], currentProjects: [] } : {}),
                }
              : m
          )
        );
        message.success(`成员「${values.name}」更新成功`);
      } else {
        const newMember: TeamMember = {
          id: `m${members.length + 1}`,
          name: values.name,
          employeeId: values.employeeId,
          status: values.status,
          skills: values.skills || [],
          currentProjects: [],
          email: values.email || '',
          phone: values.phone || '',
        };
        setMembers([...members, newMember]);
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

  const handleBatchAssign = () => {
    batchForm.validateFields().then((values) => {
      const project = values.project as string;
      const startDate = values.startDate ? dayjs(values.startDate).format('YYYY-MM-DD') : '';
      const endDate = values.endDate ? dayjs(values.endDate).format('YYYY-MM-DD') : '';
      const ids = batchTargetKeys;
      if (ids.length === 0) {
        message.warning('请至少选择一名人员');
        return;
      }
      const now = dayjs();
      const shouldBeTesting = startDate && endDate && !dayjs(startDate).isAfter(now, 'day') && !dayjs(endDate).isBefore(now, 'day');

      setMembers((prev) =>
        prev.map((m) => {
          if (!ids.includes(m.id)) return m;
          const newProject: MemberProject = { projectName: project, startDate, endDate };
          const existingProjects = m.projects || [];
          // 如果项目已存在则更新时间，否则追加
          const projectExists = existingProjects.find((p) => p.projectName === project);
          const updatedProjects = projectExists
            ? existingProjects.map((p) => (p.projectName === project ? newProject : p))
            : [...existingProjects, newProject];

          const newCurrentProjects = m.currentProjects.includes(project)
            ? m.currentProjects
            : [...m.currentProjects, project];

          return {
            ...m,
            status: shouldBeTesting ? '测试中' : m.status,
            currentProjects: newCurrentProjects,
            projects: updatedProjects,
          };
        })
      );
      message.success(`已成功指派 ${ids.length} 人到项目「${project}」`);
      setBatchModalOpen(false);
      batchForm.resetFields();
      setBatchTargetKeys([]);
    });
  };

  const transferRender: TransferProps<{ key: string; title: string; status: MemberStatus }>['render'] = (item) => {
    const cfg = statusConfig[item.status];
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
            const statusCfg = statusConfig[member.status];
            const memberProjects = member.projects || [];
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
                  {member.skills.map((skill) => (
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
            </Select>
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
                        ? { ...m, status: '空闲', projects: [], currentProjects: [] }
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
              {PROJECTS.map((p) => (
                <Select.Option key={p} value={p}>
                  {p}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item
              name="startDate"
              label="项目开始时间"
              rules={[{ required: true, message: '请选择开始时间' }]}
            >
              <DatePicker style={{ width: '100%' }} placeholder="选择开始日期" />
            </Form.Item>
            <Form.Item
              name="endDate"
              label="项目结束时间"
              rules={[{ required: true, message: '请选择结束时间' }]}
            >
              <DatePicker style={{ width: '100%' }} placeholder="选择结束日期" />
            </Form.Item>
          </div>
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
