import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Select, Input, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, SearchOutlined, DeleteOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import StatusTag from '../../components/StatusTag';
import ProjectModal from '../../components/ProjectModal';
import { mockProjects } from '../../data/mock';
import type { Project } from '../../types';

function Projects() {
  const [projects, setProjects] = useState<Project[]>(mockProjects);
  const [statusFilter, setStatusFilter] = useState<string>('全部');
  const [priorityFilter, setPriorityFilter] = useState<string>('全部');
  const [searchText, setSearchText] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const navigate = useNavigate();

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (statusFilter !== '全部' && p.status !== statusFilter) return false;
      if (priorityFilter !== '全部' && p.priority !== priorityFilter) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        if (!p.name.toLowerCase().includes(kw) && !p.city?.toLowerCase().includes(kw) && !p.customer.toLowerCase().includes(kw)) return false;
      }
      return true;
    });
  }, [projects, statusFilter, priorityFilter, searchText]);

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

  const handleSubmit = (values: Project) => {
    if (editingProject) {
      setProjects(projects.map((p) => (p.id === editingProject.id ? { ...values, id: editingProject.id, updatedAt: new Date().toISOString().slice(0, 10) } : p)));
    } else {
      const newProject: Project = {
        ...values,
        id: Date.now().toString(),
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      setProjects([newProject, ...projects]);
    }
    setModalOpen(false);
    setEditingProject(null);
  };

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
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 80,
      render: (p: string) => {
        return <StatusTag status={p} />;
      },
    },
    { title: '开始日期', dataIndex: 'startDate', key: 'startDate', width: 110, sorter: (a, b) => a.startDate.localeCompare(b.startDate) },
    { title: '结束日期', dataIndex: 'endDate', key: 'endDate', width: 110, sorter: (a, b) => a.endDate.localeCompare(b.endDate) },
    { title: '计划交付日期', dataIndex: 'plannedDeliveryDate', key: 'plannedDeliveryDate', width: 120, sorter: (a, b) => (a.plannedDeliveryDate || '').localeCompare(b.plannedDeliveryDate || '') },
    { title: '实际交付日期', dataIndex: 'actualDeliveryDate', key: 'actualDeliveryDate', width: 120, sorter: (a, b) => (a.actualDeliveryDate || '').localeCompare(b.actualDeliveryDate || '') },
    { title: 'IT产出（MW）', dataIndex: 'itOutput', key: 'itOutput', width: 110, sorter: (a, b) => a.itOutput - b.itOutput },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right' as const,
      render: (_: unknown, record: Project) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/projects/${record.id}`)} style={{ color: '#4d9fff', fontFamily: 'var(--font-primary)', padding: '0 4px' }}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} style={{ color: '#4d9fff', fontFamily: 'var(--font-primary)', padding: '0 4px' }}>
            编辑
          </Button>
          <Popconfirm
            title="确认删除"
            description={`确定要删除项目"${record.name}"吗？`}
            onConfirm={() => handleDelete(record.id)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} style={{ fontFamily: 'var(--font-primary)', padding: '0 4px' }}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [navigate]);

  return (
    <div>
      <div className="page-header">
        <h3>项目管理</h3>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleCreate}
          style={{ background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none', fontFamily: 'var(--font-primary)', fontWeight: 500, borderRadius: 8, boxShadow: '0 4px 14px rgba(77,159,255,0.35)' }}
        >
          创建项目
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' as const }}>
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          style={{ width: 130, fontFamily: 'var(--font-primary)' }}
          popupMatchSelectWidth={false}
        >
          <Select.Option value="全部">全部状态</Select.Option>
          <Select.Option value="未开始">未开始</Select.Option>
          <Select.Option value="测试中">测试中</Select.Option>
          <Select.Option value="已完成">已完成</Select.Option>
          <Select.Option value="阻塞">阻塞</Select.Option>
        </Select>
        <Select
          value={priorityFilter}
          onChange={setPriorityFilter}
          style={{ width: 130, fontFamily: 'var(--font-primary)' }}
          popupMatchSelectWidth={false}
        >
          <Select.Option value="全部">全部优先级</Select.Option>
          <Select.Option value="高">高</Select.Option>
          <Select.Option value="中">中</Select.Option>
          <Select.Option value="低">低</Select.Option>
        </Select>
        <Input
          placeholder="搜索项目名称或客户"
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250, fontFamily: 'var(--font-primary)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff' }}
          allowClear
          variant="borderless"
        />
      </div>

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
          scroll={{ x: 1300 }}
          size="middle"
        />
      </div>

      <ProjectModal
        open={modalOpen}
        project={editingProject}
        onCancel={() => {
          setModalOpen(false);
          setEditingProject(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export default Projects;
