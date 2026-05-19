import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Descriptions, Timeline, Button, Breadcrumb, Card, Avatar, Empty, Tag } from 'antd';
import { EditOutlined, ArrowLeftOutlined, HomeOutlined, ProjectOutlined } from '@ant-design/icons';
import StatusTag from '../../components/StatusTag';
import ProjectModal from '../../components/ProjectModal';
import { mockProjects, mockTimeline } from '../../data/mock';
import type { Project } from '../../types';

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>(mockProjects);
  const [modalOpen, setModalOpen] = useState(false);

  const project = projects.find((p) => p.id === id);

  if (!project) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Empty description="项目不存在">
          <Button type="primary" onClick={() => navigate('/projects')}>
            返回项目列表
          </Button>
        </Empty>
      </div>
    );
  }

  const timeline = mockTimeline[project.id] || [];

  const handleEdit = (values: Project) => {
    setProjects(projects.map((p) => (p.id === project.id ? { ...values, id: project.id, updatedAt: new Date().toISOString().slice(0, 10) } : p)));
    setModalOpen(false);
  };

  const getPriorityColor = (p: string) => {
    const colors: Record<string, string> = { '高': 'red', '中': 'orange', '低': 'default' };
    return colors[p] || 'default';
  };

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <><HomeOutlined /> 仪表盘</>, onClick: () => navigate('/dashboard') },
          { title: <><ProjectOutlined /> 项目管理</>, onClick: () => navigate('/projects') },
          { title: project.name },
        ]}
      />

      <div className="detail-layout">
        <div>
          <Card title="项目信息" className="detail-info-card">
            <Descriptions column={1} size="small" labelStyle={{ width: 80 }}>
              <Descriptions.Item label="项目名称">{project.name}</Descriptions.Item>
              <Descriptions.Item label="客户">{project.customer}</Descriptions.Item>
              <Descriptions.Item label="状态"><StatusTag status={project.status} /></Descriptions.Item>
              <Descriptions.Item label="优先级">
                <Tag color={getPriorityColor(project.priority)}>{project.priority}</Tag>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="项目详情" className="detail-info-card">
            <Descriptions column={1} size="small" labelStyle={{ width: 80 }}>
              <Descriptions.Item label="项目经理">
                <Avatar size="small" icon={<ProjectOutlined />} style={{ marginRight: 8, backgroundColor: '#1677ff' }} />
                {project.manager}
              </Descriptions.Item>
              <Descriptions.Item label="开始日期">{project.startDate}</Descriptions.Item>
              <Descriptions.Item label="结束日期">{project.endDate || '-'}</Descriptions.Item>
              <Descriptions.Item label="IT产出">{project.itOutput} MW</Descriptions.Item>
              <Descriptions.Item label="合同金额">{project.contractAmount ? `${project.contractAmount} 万元` : '-'}</Descriptions.Item>
              <Descriptions.Item label="业务类型">{project.businessType || '-'}</Descriptions.Item>
              <Descriptions.Item label="项目描述">{project.description || '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </div>

        <div>
          <Card title="项目时间线" style={{ height: '100%' }}>
            {timeline.length > 0 ? (
              <div className="timeline-container">
                <Timeline
                  items={timeline.map((event, index) => ({
                    color: index === 0 ? '#1677ff' : index === timeline.length - 1 ? 'green' : 'blue',
                    children: (
                      <div>
                        <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{event.timestamp}</div>
                        <Tag style={{ marginBottom: 4 }}>{event.type}</Tag>
                        <div style={{ color: '#333' }}>{event.description}</div>
                      </div>
                    ),
                  }))}
                />
              </div>
            ) : (
              <Empty description="暂无时间线数据" />
            )}
          </Card>
        </div>
      </div>

      <div className="detail-footer">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
          返回
        </Button>
        <Button type="primary" icon={<EditOutlined />} onClick={() => setModalOpen(true)}>
          编辑
        </Button>
      </div>

      <ProjectModal
        open={modalOpen}
        project={project}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleEdit}
      />
    </div>
  );
}

export default ProjectDetail;
