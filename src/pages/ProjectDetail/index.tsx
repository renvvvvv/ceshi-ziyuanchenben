import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Descriptions, Timeline, Button, Breadcrumb, Card, Avatar, Empty, Tag, Upload, message, Modal, Input } from 'antd';
import { EditOutlined, ArrowLeftOutlined, HomeOutlined, ProjectOutlined, DeleteOutlined, UploadOutlined, FileOutlined, LinkOutlined, SaveOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import dayjs from 'dayjs';
import StatusTag from '../../components/StatusTag';
import ProjectModal from '../../components/ProjectModal';
import { useData } from '../../store/DataContext';
import type { Project, ProjectPhase, ProjectPhaseFile } from '../../types';

const PHASE_STATUS_CONFIG: Record<string, { color: string; dotColor: string; label: string }> = {
  pending:    { color: '#8c8c8c', dotColor: '#8c8c8c', label: '待开始' },
  in_progress: { color: '#4d9fff', dotColor: '#1677ff', label: '进行中' },
  completed:  { color: '#52c41a', dotColor: '#52c41a', label: '已完成' },
};

/** 模拟文件类型图标 */
function getFileIcon(fileType?: string) {
  const map: Record<string, string> = {
    pdf: '#ff4d4f',
    xlsx: '#52c41a',
    docx: '#1890ff',
    pptx: '#faad14',
    default: '#8c8c8c',
  };
  return map[fileType || ''] || map['default'];
}

/** 模拟文件大小 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
}

/** 所有8个阶段的默认模板（全部支持上传） */
const ALL_PHASE_TEMPLATES = [
  { key: 'bid', name: '🏆 项目中标', description: '签订合同、确认项目范围与交付要求' },
  { key: 'planning', name: '📋 前期资源及计划排布', description: '人员分配、设备准备、测试计划制定、环境确认' },
  { key: 'survey', name: '🔍 现场踏勘', description: '现场勘察、确认测试环境和设备状态' },
  { key: 'kickoff', name: '🚀 测试启动会', description: '召开项目启动会议，明确各方职责和测试范围' },
  { key: 'testing', name: '⚙️ 测试中', description: '按计划执行各项测试任务，记录过程数据与问题' },
  { key: 'finished', name: '✅ 测试结束', description: '所有测试项执行完毕，整理现场并移交' },
  { key: 'review', name: '📊 测试复盘会', description: '总结测试结果，分析问题根因，提出改进建议' },
  { key: 'report', name: '📝 测试报告编写', description: '编制正式测试报告，归档所有交付文档' },
];

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { projects, setProjects, projectPhases, setProjectPhases, teamMembers, updateProject } = useData();
  const [modalOpen, setModalOpen] = useState(false);
  const [docLinkInput, setDocLinkInput] = useState('');

  const project = projects.find((p) => p.id === id);

  // 当项目切换时同步测试管理链接输入框
  useEffect(() => {
    setDocLinkInput(project?.docLink || '');
  }, [project?.id, project?.docLink]);

  /** 获取项目的阶段数据，无数据则返回空模板（全部阶段均支持上传） */
  const phases: ProjectPhase[] = useMemo(() => {
    if (!project) return [];
    if (projectPhases[project.id]) {
      return projectPhases[project.id].map((p) =>
        p.key === 'bid' ? { ...p, allowUpload: true } : p
      );
    }
    return ALL_PHASE_TEMPLATES.map((t) => ({
      ...t,
      status: 'pending' as const,
      files: [],
      allowUpload: true,
    }));
  }, [project, projectPhases]);

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

  const handleEdit = (values: Project) => {
    // 走 updateProject（DataContext）持久化到 DB
    updateProject(project.id, { ...values, id: project.id, updatedAt: dayjs().format('YYYY-MM-DD') });
    setModalOpen(false);
  };

  /** 更新测试管理链接 */
  const handleUpdateDocLink = () => {
    updateProject(project.id, { docLink: docLinkInput.trim(), updatedAt: dayjs().format('YYYY-MM-DD') });
    message.success('测试管理链接已更新');
  };

  /** 文件上传处理 */
  const handleUpload = (phaseKey: string, fileList: UploadFile[]) => {
    if (!project) return;
    const lastFile = fileList[fileList.length - 1];
    if (!lastFile?.originFileObj) return;

    const newFile: ProjectPhaseFile = {
      id: `file_${Date.now()}`,
      fileName: lastFile.name,
      fileSize: lastFile.originFileObj.size ? formatFileSize(lastFile.originFileObj.size) : '-',
      fileType: lastFile.name.split('.').pop(),
      uploadedAt: new Date().toLocaleString('zh-CN'),
    };

    setProjectPhases((prev) => {
      // 始终基于 prev[project.id] 计算，避免闭包 phases 陈旧覆盖
      // 若 prev 无此项目，从 ALL_PHASE_TEMPLATES 构造初始模板
      const current = prev[project.id] ?? ALL_PHASE_TEMPLATES.map((t) => ({
        ...t,
        status: 'pending' as const,
        files: [],
        allowUpload: true,
      }));
      return {
        ...prev,
        [project.id]: current.map((phase) =>
          phase.key === phaseKey
            ? { ...phase, files: [...phase.files, newFile], status: phase.status === 'pending' ? 'in_progress' : phase.status }
            : phase
        ),
      };
    });
    message.success(`文件「${lastFile.name}」上传成功`);
  };

  /** 删除文件 */
  const handleDeleteFile = (phaseKey: string, fileId: string) => {
    if (!project) return;
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除该文件吗？',
      okText: '删除',
      cancelText: '取消',
      onOk: () => {
        setProjectPhases((prev) => {
          const current = prev[project.id] ?? ALL_PHASE_TEMPLATES.map((t) => ({
            ...t,
            status: 'pending' as const,
            files: [],
            allowUpload: true,
          }));
          return {
            ...prev,
            [project.id]: current.map((phase) =>
              phase.key === phaseKey
                ? { ...phase, files: phase.files.filter((f) => f.id !== fileId) }
                : phase
            ),
          };
        });
        message.success('文件已删除');
      },
    });
  };

  /** 渲染单个阶段内容 */
  const renderPhaseContent = (phase: ProjectPhase, index: number) => {
    const config = PHASE_STATUS_CONFIG[phase.status] || PHASE_STATUS_CONFIG.pending;
    return (
      <div style={{ width: '100%', minHeight: phase.files.length > 0 ? 'auto' : 40 }}>
        {/* 阶段头部：名称 + 说明 + 状态标签 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: 'rgba(255,255,255,0.9)', lineHeight: 1.3 }}>
              {phase.name}
            </div>
            <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.42)', marginTop: 2, lineHeight: 1.4 }}>
              {phase.description}
            </div>
          </div>
          <Tag
            style={{
              background: `${config.color}18`,
              color: config.color,
              border: `1px solid ${config.color}35`,
              borderRadius: 10,
              fontSize: 11,
              flexShrink: 0,
              lineHeight: '20px',
              padding: '0 10px',
              whiteSpace: 'nowrap',
            }}
          >
            {config.label}
          </Tag>
        </div>

        {/* 完成日期 */}
        {phase.date && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.32)', marginBottom: 6 }}>
            完成时间：{phase.date}
          </div>
        )}

        {/* 文件上传区 */}
        {phase.allowUpload && (
          <div
            style={{
              marginTop: 8,
              padding: phase.files.length > 0 ? '10px 12px' : '14px',
              borderRadius: 8,
              border: '1px dashed rgba(77,159,255,0.25)',
              background: 'rgba(77,159,255,0.04)',
            }}
          >
            {/* 已上传文件列表 */}
            {phase.files.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                {phase.files.map((file) => (
                  <div
                    key={file.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '5px 10px',
                      borderRadius: 6,
                      background: 'rgba(13,31,60,0.7)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <FileOutlined style={{ color: getFileIcon(file.fileType), fontSize: 14, flexShrink: 0 }} />
                      <span
                        style={{
                          color: 'rgba(255,255,255,0.72)',
                          fontSize: 12,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={`${file.fileName} (${file.fileSize})`}
                      >
                        {file.fileName}
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 11, flexShrink: 0 }}>
                        ({file.fileSize})
                      </span>
                    </div>
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteFile(phase.key, file.id)}
                      danger
                      style={{ color: 'rgba(255,77,79,0.45)', fontSize: 11, flexShrink: 0, padding: '0 4px' }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 上传按钮 */}
            <Upload
              showUploadList={false}
              beforeUpload={() => false}
              onChange={({ fileList }) => handleUpload(phase.key, fileList)}
            >
              <Button
                icon={<UploadOutlined />}
                size="small"
                style={{
                  borderColor: 'rgba(77,159,255,0.35)',
                  color: '#4d9fff',
                  fontFamily: 'var(--font-primary)',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'transparent',
                }}
              >
                上传文件
              </Button>
            </Upload>
          </div>
        )}
      </div>
    );
  };

  const timelineItems = phases.map((phase, index) => ({
      color:
        index === phases.length - 1 && phase.status === 'completed'
          ? '#52c41a'
          : phase.status === 'in_progress'
            ? '#1677ff'
            : phase.status === 'completed'
              ? '#52c41a'
              : 'gray',
      children: renderPhaseContent(phase, index),
    }));

  return (
    <div style={{ minHeight: 'calc(100vh - 120px)' }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <><HomeOutlined /> 仪表盘</>, onClick: () => navigate('/dashboard') },
          { title: <><ProjectOutlined /> 项目管理</>, onClick: () => navigate('/projects') },
          { title: project.name },
        ]}
      />

      {/* 左右两栏布局 */}
      <div className="detail-layout">
        {/* 左侧：项目信息 + 项目详情 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="项目信息" className="detail-info-card">
            <Descriptions column={1} size="small" labelStyle={{ width: 80 }}>
              <Descriptions.Item label="项目名称">{project.name}</Descriptions.Item>
              <Descriptions.Item label="客户">{project.customer}</Descriptions.Item>
              {project.city && <Descriptions.Item label="城市">{project.city}</Descriptions.Item>}
              <Descriptions.Item label="状态"><StatusTag status={project.status} /></Descriptions.Item>
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
              <Descriptions.Item label="计划投入人力">{project.plannedManpower != null ? `${project.plannedManpower} 人` : '-'}</Descriptions.Item>
              <Descriptions.Item label="业务类型">{project.businessType || '-'}</Descriptions.Item>
              <Descriptions.Item label="项目描述">{project.description || '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </div>

        {/* 右侧：时间线 + 测试管理链接 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card
            title="项目时间线"
            styles={{ header: { borderBottom: 'none' } }}
          >
            <Timeline items={timelineItems} />
          </Card>

          <Card
            title="测试管理链接"
            styles={{ header: { borderBottom: '1px solid rgba(255,255,255,0.06)' } }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Input
                value={docLinkInput}
                onChange={(e) => setDocLinkInput(e.target.value)}
                placeholder="请输入测试管理文档链接（如飞书/钉钉/Confluence 链接）"
                prefix={<LinkOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {project.docLink ? (
                  <a
                    href={project.docLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#4d9fff', fontSize: 13 }}
                  >
                    <LinkOutlined /> 打开当前链接
                  </a>
                ) : (
                  <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>暂无测试管理链接</span>
                )}
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleUpdateDocLink}
                  style={{ background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none' }}
                >
                  保存链接
                </Button>
              </div>
            </div>
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
        teamMembers={teamMembers}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleEdit}
      />
    </div>
  );
}

export default ProjectDetail;
