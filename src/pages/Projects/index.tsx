import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Select, Input, Space, Popconfirm, message, Tag, Tooltip } from 'antd';
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, EyeOutlined, SwapOutlined, LinkOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import StatusTag from '../../components/StatusTag';
import ProjectModal from '../../components/ProjectModal';
import ComparisonReportModal from '../../components/ComparisonReportModal';
import { useData } from '../../store/DataContext';
import type { Project, HistoricalProject } from '../../types';

function Projects() {
  const { projects, setProjects, historyProjects, setHistoryProjects } = useData();
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const navigate = useNavigate();

  // 过滤：项目管理只显示进行中和未开始的项目，已完成的自动归档到历史项目
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      // 已完成的项目不在项目管理中展示（归档到历史项目）
      if (p.status === '已完成') return false;
      if (statusFilter !== '全部' && p.status !== statusFilter) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!p.name.toLowerCase().includes(kw) && !p.city?.toLowerCase().includes(kw) && !p.customer.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [projects, statusFilter, searchText]);

  // 统计信息
  const stats = useMemo(() => ({
    active: projects.filter((p) => p.status === '测试中').length,
    pending: projects.filter((p) => p.status === '未开始').length,
  }), [projects]);

  const handleCreate = () => {
    setEditingProject(null);
    setModalOpen(true);
  };

  const handleEdit = (project: Project) => {
    setEditingProject(project);
    setModalOpen(true);
  };

  const handleDelete = (id: string) => {
    setProjects(projects.filter((p) => p.id !== id));
    message.success('项目删除成功');
  };

  // 提交（新建或编辑）
  const handleSubmit = useCallback((values: Project) => {
    if (editingProject) {
      // 编辑模式：检测是否改为"已完成"状态 → 自动归档到历史项目
      if (values.status === '已完成') {
        // 从项目管理移除
        setProjects(projects.filter((p) => p.id !== editingProject.id));
        // 添加到历史项目
        const archived: HistoricalProject = {
          ...values,
          id: editingProject.id,
          updatedAt: new Date().toISOString().slice(0, 10),
        };
        setHistoryProjects([archived, ...historyProjects]);
        message.info('项目状态已标记为「已完成」，已自动归档至历史项目板块');
      } else {
        setProjects(projects.map((p) =>
          (p.id === editingProject.id
            ? { ...values, id: editingProject.id, updatedAt: new Date().toISOString().slice(0, 10) }
            : p)
        ));
      }
      setModalOpen(false);
      setEditingProject(null);
    } else {
      const newProject: Project = {
        ...values,
        id: Date.now().toString(),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      setProjects([newProject, ...projects]);
      setModalOpen(false);
      message.success('项目创建成功');
    }
  }, [editingProject, projects, historyProjects, setProjects, setHistoryProjects]);

  const columns: ColumnsType<Project> = useMemo(() => [
    {
      title: '项目名称',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      render: (text: string, record: Project) => (
        <a onClick={() => navigate(`/projects/${record.id}`)} style={{ color: '#7cb8ff' }}>{text}</a>
      ),
    },
    { title: '项目经理', dataIndex: 'manager', key: 'manager', width: 100 },
    { title: '城市', dataIndex: 'city', key: 'city', width: 100 },
    { title: '客户', dataIndex: 'customer', key: 'customer', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => <StatusTag status={status} />,
    },
    { title: '开始日期', dataIndex: 'startDate', key: 'startDate', width: 110, sorter: (a, b) => a.startDate.localeCompare(b.startDate) },
    { title: '结束日期', dataIndex: 'endDate', key: 'endDate', width: 110, sorter: (a, b) => a.endDate.localeCompare(b.endDate) },
    { title: '计划交付日期', dataIndex: 'plannedDeliveryDate', key: 'plannedDeliveryDate', width: 120, sorter: (a, b) => (a.plannedDeliveryDate || '').localeCompare(b.plannedDeliveryDate || '') },
    {
      title: '实际交付日期',
      dataIndex: 'actualDeliveryDate',
      key: 'actualDeliveryDate',
      width: 150,
      sorter: (a, b) => (a.actualDeliveryDate || '').localeCompare(b.actualDeliveryDate || ''),
      render: (text?: string, record?: Project) => {
        if (!text) return <span style={{ color: 'rgba(255,255,255,0.3)' }}>-</span>;
        if (record?.plannedDeliveryDate) {
          const isEarly = text < record.plannedDeliveryDate;
          const isOnTime = text === record.plannedDeliveryDate;
          const tag = isOnTime
            ? <Tag style={{ marginLeft: 6, fontSize: 10, background: 'rgba(82,196,26,0.15)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.3)', borderRadius: 4, padding: '0 4px' }}>准时</Tag>
            : isEarly
              ? <Tag style={{ marginLeft: 6, fontSize: 10, background: 'rgba(82,196,26,0.15)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.3)', borderRadius: 4, padding: '0 4px' }}>提前</Tag>
              : <Tag style={{ marginLeft: 6, fontSize: 10, background: 'rgba(255,77,79,0.15)', color: '#ff4d4f', border: '1px solid rgba(255,77,79,0.3)', borderRadius: 4, padding: '0 4px' }}>延期</Tag>;
          return <span><span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>{tag}</span>;
        }
        return <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text}</span>;
      },
    },
    {
      title: '计划投入人力',
      dataIndex: 'plannedManpower',
      key: 'plannedManpower',
      width: 110,
      sorter: (a, b) => (a.plannedManpower || 0) - (b.plannedManpower || 0),
      render: (val?: number) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{val != null ? `${val} 人` : '-'}</span>,
    },
    { title: 'IT产出（MW）', dataIndex: 'itOutput', key: 'itOutput', width: 110, sorter: (a, b) => a.itOutput - b.itOutput },
    {
      title: '业务类型',
      dataIndex: 'businessType',
      key: 'businessType',
      width: 110,
      render: (text?: string) => <span style={{ color: 'rgba(255,255,255,0.6)' }}>{text || '-'}</span>,
    },
    {
      title: '测试管理链接',
      dataIndex: 'docLink',
      key: 'docLink',
      width: 120,
      render: (link: string) =>
        link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#4d9fff' }}>
            <LinkOutlined /> 查看
          </a>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>-</span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      fixed: 'right' as const,
      render: (_: unknown, record: Project) => (
        <Space size={0} split={null}>
          <Tooltip title="查看详情">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/projects/${record.id}`)} style={{ color: '#4d9fff', width: 32, height: 28 }} />
          </Tooltip>
          <Tooltip title="编辑项目">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} style={{ color: '#faad14', width: 32, height: 28 }} />
          </Tooltip>
          <Popconfirm
            title="确认删除"
            description={`确定要删除项目"${record.name}"吗？`}
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Tooltip title="删除项目">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ width: 32, height: 28 }} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ], [navigate]);

  return (
    <div>
      {/* 页面标题 + 创建按钮 */}
      <div className="page-header">
        <div>
          <h3>项目管理</h3>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 10px', background: 'rgba(77,159,255,0.1)', border: '1px solid rgba(77,159,255,0.2)',
              borderRadius: 20, fontSize: 12, color: '#7cb8ff',
            }}>进行中 {stats.active}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 10px', background: 'rgba(250,173,20,0.1)', border: '1px solid rgba(250,173,20,0.2)',
              borderRadius: 20, fontSize: 12, color: '#faad14',
            }}>未开始 {stats.pending}</span>
          </div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreate}
          style={{ background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none', fontFamily: 'var(--font-primary)', fontWeight: 500, borderRadius: 8, boxShadow: '0 4px 14px rgba(77,159,255,0.35)' }}
        >
          创建项目
        </Button>
      </div>

      {/* 筛选栏 + 历史数据对比按钮 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' as const, alignItems: 'center' }}>
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 130, fontFamily: 'var(--font-primary)' }}
          popupMatchSelectWidth={false}
        >
          <Select.Option value="全部">全部状态</Select.Option>
          <Select.Option value="未开始">未开始</Select.Option>
          <Select.Option value="测试中">测试中</Select.Option>
          <Select.Option value="阻塞">阻塞</Select.Option>
        </Select>
        <Input
          placeholder="搜索项目名称、客户或城市"
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250, fontFamily: 'var(--font-primary)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
          allowClear
          variant="borderless"
        />
        {/* 历史数据对比按钮 — 放在筛选栏右侧（截图红框位置） */}
        <Button
          icon={<SwapOutlined />}
          onClick={() => setReportOpen(true)}
          style={{
            borderColor: 'rgba(179,126,235,0.4)',
            color: '#b37feb',
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            borderRadius: 8,
            background: 'rgba(179,126,235,0.08)',
            flexShrink: 0,
          }}
        >
          历史交付对比
        </Button>
      </div>

      {/* 项目表格 */}
      <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden' }}>
        <Table
          columns={columns}
          dataSource={filteredProjects}
          rowKey="id"
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个项目`,
            size: 'small' as const,
          }}
          scroll={{ x: 1700, y: 'calc(100vh - 340px)' }}
          size="middle"
        />
      </div>

      {/* 新建/编辑弹窗 */}
      <ProjectModal
        open={modalOpen}
        project={editingProject}
        onCancel={() => {
          setModalOpen(false);
          setEditingProject(null);
        }}
        onSubmit={handleSubmit}
      />

      {/* 历史交付数据对比报告弹窗 */}
      <ComparisonReportModal
        open={reportOpen}
        currentProjects={projects.filter((p) => p.status !== '已完成')}
        historyProjects={historyProjects}
        onClose={() => setReportOpen(false)}
      />
    </div>
  );
}

export default Projects;
