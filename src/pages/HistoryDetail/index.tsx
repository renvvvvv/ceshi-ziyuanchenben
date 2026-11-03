import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Input, Descriptions, Timeline, Button, Breadcrumb, Card, Avatar, Empty, Tag, Upload, message, Modal } from 'antd';
import { ArrowLeftOutlined, HomeOutlined, ProjectOutlined, FileOutlined, HistoryOutlined, LinkOutlined, DownloadOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import StatusTag from '../../components/StatusTag';
import { useData } from '../../store/DataContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { ProjectPhase, ProjectPhaseFile } from '../../types';

const PHASE_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: '#8c8c8c', label: '待开始' },
  in_progress: { color: '#6366f1', label: '进行中' },
  completed: { color: '#16a34a', label: '已完成' },
};

/** 文件类型颜色 */
function getFileIcon(fileType?: string) {
  const map: Record<string, string> = {
    pdf: '#dc2626',
    xlsx: '#16a34a',
    docx: '#6366f1',
    pptx: '#d97706',
    zip: '#a855f7',
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

function HistoryDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { historyProjects, historyPhases, setHistoryPhases } = useData();
  const isMobile = useIsMobile();

  const project = useMemo(() => historyProjects.find((p) => String(p.id) === String(id)), [historyProjects, id]);

  /** 获取项目的阶段数据，无数据则返回空模板（全部阶段均支持上传） */
  const phases: ProjectPhase[] = useMemo(() => {
    if (!project) return [];
    if (historyPhases[project.id]) {
      return historyPhases[project.id].map((p) => ({ ...p, allowUpload: true }));
    }
    return ALL_PHASE_TEMPLATES.map((t) => ({
      ...t,
      status: 'pending' as const,
      files: [],
      allowUpload: true,
    }));
  }, [project, historyPhases]);

  /** 计算项目总周期 */
  const totalDays = useMemo(() => {
    if (!project || !project.startDate || !project.endDate) return null;
    const start = new Date(project.startDate);
    const end = new Date(project.endDate);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }, [project]);

  /** 统计文件总数 */
  const fileStats = useMemo(() => {
    const total = phases.reduce((s, p) => s + p.files.length, 0);
    const completedPhases = phases.filter((p) => p.status === 'completed').length;
    return { total, completedPhases, totalPhases: phases.length };
  }, [phases]);

  if (!project) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Empty description="历史项目不存在">
          <Button type="primary" onClick={() => navigate('/history')}>
            返回历史项目
          </Button>
        </Empty>
      </div>
    );
  }

  // 添加链接弹窗状态
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkPhaseKey, setLinkPhaseKey] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  /** 添加链接 */
  const handleAddLink = () => {
    if (!project) return;
    const name = linkName.trim();
    const url = linkUrl.trim();
    if (!name) { message.warning('请输入链接名称'); return; }
    if (!/^https?:\/\/.+/.test(url)) { message.warning('请输入合法链接地址（以 http:// 或 https:// 开头）'); return; }
    const newFile: ProjectPhaseFile = {
      id: `link_${Date.now()}`,
      fileName: name,
      fileType: 'link',
      uploadedAt: new Date().toLocaleString('zh-CN'),
      link: url,
    };
    setHistoryPhases((prev) => {
      const current = prev[project.id] ?? ALL_PHASE_TEMPLATES.map((t) => ({
        ...t,
        status: 'pending' as const,
        files: [],
        allowUpload: true,
      }));
      return {
        ...prev,
        [project.id]: current.map((phase) =>
          phase.key === linkPhaseKey
            ? { ...phase, files: [...phase.files, newFile] }
            : phase
        ),
      };
    });
    message.success(`链接「${name}」添加成功`);
    setLinkModalOpen(false);
    setLinkName('');
    setLinkUrl('');
  };

  /** 文件上传处理 */
  const handleUpload = async (phaseKey: string, fileList: UploadFile[]) => {
    if (!project) return;
    const lastFile = fileList[fileList.length - 1];
    if (!lastFile?.originFileObj) return;

    let fileUrl: string | undefined;
    try {
      const fd = new FormData();
      fd.append('file', lastFile.originFileObj);
      const r = await fetch('/api/projects/files/upload', { method: 'POST', body: fd, credentials: 'include' }).then((x) => x.json());
      if (r?.success) fileUrl = r.fileUrl;
      else message.warning(`「${lastFile.name}」文件本体上传失败，仅记录了文件信息`);
    } catch { message.warning('网络异常，文件本体未上传'); }

    const newFile: ProjectPhaseFile = {
      id: `file_${Date.now()}`,
      fileName: lastFile.name,
      fileSize: lastFile.originFileObj.size ? formatFileSize(lastFile.originFileObj.size) : '-',
      fileType: lastFile.name.split('.').pop(),
      uploadedAt: new Date().toLocaleString('zh-CN'),
      fileUrl,
    };

    setHistoryPhases((prev) => {
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
            ? { ...phase, files: [...phase.files, newFile] }
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
        setHistoryPhases((prev) => {
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

  /** 渲染单个阶段内容（支持上传与删除） */
  const renderPhaseContent = (phase: ProjectPhase) => {
    const config = PHASE_STATUS_CONFIG[phase.status] || PHASE_STATUS_CONFIG.pending;
    return (
      <div style={{ width: '100%', minHeight: phase.files.length > 0 ? 'auto' : 40 }}>
        {/* 阶段头部 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, color: '#1e1b2e', lineHeight: 1.3 }}>
              {phase.name}
            </div>
            <div style={{ fontSize: 11.5, color: '#6b6892', marginTop: 2, lineHeight: 1.4 }}>
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
          <div style={{ fontSize: 11, color: '#9d9ab8', marginBottom: 6 }}>
            完成时间：{phase.date}
          </div>
        )}

        {/* 文件上传区（支持上传与删除） */}
        {phase.allowUpload && (
          <div
            style={{
              marginTop: 8,
              padding: phase.files.length > 0 ? '10px 12px' : '14px',
              borderRadius: 8,
              border: '1px dashed rgba(99,102,241,0.25)',
              background: 'rgba(99,102,241,0.04)',
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
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: '#f6f5fc',
                      border: '1px solid #e9e7f4',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {file.link ? <LinkOutlined style={{ color: '#6366f1', fontSize: 14, flexShrink: 0 }} /> : <FileOutlined style={{ color: getFileIcon(file.fileType), fontSize: 14, flexShrink: 0 }} />}
                      {file.link ? (
                          <a href={file.link} target="_blank" rel="noopener noreferrer" style={{ color: '#4f46e5', fontSize: 12, textDecoration: 'none' }} title={file.fileName}>{file.fileName}</a>
                        ) : file.fileUrl ? (
                          <a href={file.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#4f46e5', fontSize: 12, textDecoration: 'none' }} title={`${file.fileName}（点击预览）`}>{file.fileName}</a>
                        ) : (
                          <span style={{ color: '#46436a', fontSize: 12 }}>{file.fileName}</span>
                        )}
                      <span style={{ color: '#9d9ab8', fontSize: 11, flexShrink: 0 }}>
                        ({file.fileSize})
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      <span style={{ color: '#9d9ab8', fontSize: 10 }}>
                        {file.uploadedAt}
                      </span>
                      <DownloadOutlined
                        style={{ color: 'rgba(129,140,248,0.5)', fontSize: 12, cursor: 'pointer' }}
                        title={`下载：${file.fileName}`}
                      />
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteFile(phase.key, file.id)}
                        danger
                        style={{ color: 'rgba(220,38,38,0.45)', fontSize: 11, padding: '0 4px' }}
                      />
                    </div>
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
                  borderColor: 'rgba(99,102,241,0.35)',
                  color: '#6366f1',
                  fontFamily: 'var(--font-primary)',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'transparent',
                }}
              >
                上传文件
              </Button>
            </Upload>
              <Button
                icon={<LinkOutlined />}
                size="small"
                onClick={() => {
                  setLinkPhaseKey(phase.key);
                  setLinkName('');
                  setLinkUrl('');
                  setLinkModalOpen(true);
                }}
                style={{
                  borderColor: 'rgba(99,102,241,0.35)',
                  color: '#6366f1',
                  fontFamily: 'var(--font-primary)',
                  borderRadius: 6,
                  fontSize: 12,
                  background: 'transparent',
                  marginLeft: 8,
                }}
              >
                添加链接
              </Button>
          </div>
        )}

        {/* 不允许上传且无文件时显示占位 */}
        {!phase.allowUpload && phase.files.length === 0 && (
          <div style={{
            marginTop: 8, padding: '10px 12px', borderRadius: 8,
            border: '1px dashed #e9e7f4', background: '#f6f5fc',
            color: '#9d9ab8', fontSize: 11.5, textAlign: 'center',
          }}>
            暂无归档文件
          </div>
        )}
      </div>
    );
  };

  const timelineItems = phases.map((phase) => ({
    color:
      phase.status === 'in_progress'
        ? '#6366f1'
        : phase.status === 'completed'
          ? '#16a34a'
          : 'gray',
    children: renderPhaseContent(phase),
  }));

  return (
    <div style={{ minHeight: 'calc(100vh - 120px)' }}>
      <Breadcrumb
        style={{ marginBottom: 16 }}
        items={[
          { title: <><HomeOutlined /> 仪表盘</>, onClick: () => navigate('/dashboard') },
          { title: <><HistoryOutlined /> 历史项目</>, onClick: () => navigate('/history') },
          { title: project.name },
        ]}
      />

      {/* 顶部归档提示条 */}
      {project.status === '已完成' && (
        <div style={{
          marginBottom: 14, padding: '10px 16px',
          background: 'linear-gradient(135deg, rgba(22,163,74,0.08), rgba(22,163,74,0.03))',
          border: '1px solid rgba(22,163,74,0.2)',
          borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          <span style={{ fontSize: 16 }}>📦</span>
          <span style={{ color: '#16a34a', fontSize: 13, fontWeight: 500 }}>该项目已交付归档</span>
          <span style={{ color: '#6b6892', fontSize: 12 }}>
            · 共 {fileStats.total} 份归档文件，{fileStats.completedPhases}/{fileStats.totalPhases} 个阶段已完成
          </span>
          {project.docLink && (
            <a
              href={project.docLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{ marginLeft: 'auto', color: '#6366f1', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <LinkOutlined /> 测试管理文档
            </a>
          )}
        </div>
      )}

      {/* 左右两栏布局：超出区域时整体竖向滚动 */}
      <div className="detail-layout" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
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
                <Avatar size="small" icon={<ProjectOutlined />} style={{ marginRight: 8, backgroundColor: '#6366f1' }} />
                {project.manager}
              </Descriptions.Item>
              <Descriptions.Item label="开始日期">{project.startDate}</Descriptions.Item>
              <Descriptions.Item label="结束日期">{project.endDate || '-'}</Descriptions.Item>
              {totalDays !== null && (
                <Descriptions.Item label="项目周期">
                  <Tag color="blue">{totalDays} 天</Tag>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="计划交付">{project.plannedDeliveryDate || '-'}</Descriptions.Item>
              <Descriptions.Item label="实际交付">{project.actualDeliveryDate || '-'}</Descriptions.Item>
              <Descriptions.Item label="IT产出">{project.itOutput} MW</Descriptions.Item>
              <Descriptions.Item label="投入人力">{project.plannedManpower != null ? `${project.plannedManpower} 人` : '-'}</Descriptions.Item>
              <Descriptions.Item label="业务类型">{project.businessType || '-'}</Descriptions.Item>
              <Descriptions.Item label="项目描述">{project.description || '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </div>

        {/* 右侧：时间线 */}
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>项目阶段时间线</span>
              <Tag style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)', fontSize: 11 }}>
                支持上传
              </Tag>
            </div>
          }
          styles={{ header: { borderBottom: 'none' } }}
        >
          <Timeline items={timelineItems} />
        </Card>
      </div>

      <div className="detail-footer">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/history')}>
          返回历史项目
        </Button>
      </div>
    
      {/* 添加链接弹窗 */}
      <Modal
        title={<span style={{ fontFamily: 'var(--font-primary)' }}><LinkOutlined style={{ color: '#6366f1', marginRight: 8 }} />添加链接</span>}
        open={linkModalOpen}
        onOk={handleAddLink}
        onCancel={() => setLinkModalOpen(false)}
        okText="添加"
        cancelText="取消"
        okButtonProps={{ style: { background: 'linear-gradient(135deg, #6366f1, #818cf8)', border: 'none' } }}
        style={{ top: 160 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12, fontFamily: 'var(--font-primary)' }}>
          <div>
            <div style={{ fontSize: 12.5, color: '#46436a', marginBottom: 6, fontWeight: 500 }}>链接名称 <span style={{ color: '#dc2626' }}>*</span></div>
            <Input placeholder="例如：复盘总结飞书文档" value={linkName} onChange={(e) => setLinkName(e.target.value)} maxLength={60} />
          </div>
          <div>
            <div style={{ fontSize: 12.5, color: '#46436a', marginBottom: 6, fontWeight: 500 }}>链接地址 <span style={{ color: '#dc2626' }}>*</span></div>
            <Input placeholder="http:// 或 https:// 开头的完整地址" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />
            <div style={{ fontSize: 11, color: '#9d9ab8', marginTop: 4 }}>保存后点击名称即可跳转</div>
          </div>
        </div>
      </Modal>
</div>
  );
}

export default HistoryDetail;
