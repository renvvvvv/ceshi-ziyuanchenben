/**
 * 故障日志抓取（平台自身日志）
 * 一键聚合后端运行日志 / 宿主组件日志（docker/journal/资源）/ 图纸任务日志 / 数据库健康
 * 为一份快照；AI 解析错误时间线与根因建议；历史快照可追溯、可导出。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Card, Table, Button, message, Modal, Tag, Space, Select, Input, Tooltip,
  Typography, Empty, Spin, Timeline, Alert, Descriptions,
} from 'antd';
import {
  BugOutlined, ReloadOutlined, ThunderboltOutlined, DownloadOutlined,
  EyeOutlined, WarningOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { request } from '../../api';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAuth } from '../../store/AuthContext';

interface SnapshotItem {
  id: string; title: string; hours: number; username: string;
  created_at: string; component_count: number; ai_at: string | null;
  componentCount?: number; // POST /snapshot 即时响应字段（与列表的 component_count 对齐用）
}
interface ComponentLog { name: string; desc: string; lines: string }
interface AiAnalysis {
  severity: string; summary: string;
  timeline: { time: string; event: string }[];
  patterns: string[];
  root_causes: { cause: string; evidence: string; likelihood: string }[];
  actions: string[];
}
interface SnapshotDetail extends SnapshotItem {
  components: ComponentLog[]; ai_analysis: AiAnalysis | null; ai_model?: string;
}

const SEV_TAG: Record<string, { color: string; icon: React.ReactNode }> = {
  '高': { color: 'red', icon: <WarningOutlined /> },
  '中': { color: 'orange', icon: <WarningOutlined /> },
  '低': { color: 'green', icon: <CheckCircleOutlined /> },
};

export default function SystemLogs() {
  const isMobile = useIsMobile();
  const { canEdit } = useAuth();
  const canOperate = canEdit('systemLogs'); // 走权限矩阵（含 manualPerms），与全站一致
  const [items, setItems] = useState<SnapshotItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [hours, setHours] = useState(6);
  const [title, setTitle] = useState('');
  const [capturing, setCapturing] = useState(false);
  // 详情
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeComp, setActiveComp] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await request<{ success: boolean; items: SnapshotItem[] }>('/syslogs');
      if (r?.items) setItems(r.items);
    } catch { /* 静默 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const capture = async () => {
    setCapturing(true);
    try {
      const r = await request<{ success: boolean; snapshot: SnapshotItem; message?: string }>(
        '/syslogs/snapshot', { method: 'POST', body: JSON.stringify({ hours, title }), timeout: 60000 });
      if (r?.success) {
        message.success(`快照已抓取（${r.snapshot.componentCount ?? '?'} 个组件）`);
        setTitle('');
        load();
      } else message.error(r?.message || '抓取失败');
    } catch (e: any) { message.error(e?.message || '抓取失败'); }
    finally { setCapturing(false); }
  };

  const openDetail = async (id: string) => {
    setDetail(null); // 防失败时残留上一个快照内容
    setDetailOpen(true); setDetailLoading(true); setActiveComp('');
    try {
      const r = await request<{ success: boolean; snapshot: SnapshotDetail }>(`/syslogs/${id}`);
      if (r?.snapshot) {
        setDetail(r.snapshot);
        if (r.snapshot.components?.length) setActiveComp(r.snapshot.components[0].name);
      }
    } catch { message.error('读取快照失败'); }
    finally { setDetailLoading(false); }
  };

  const analyze = async () => {
    if (!detail) return;
    const targetId = detail.id; // 闭包捕获：响应到达时校验仍是这个快照（防结果串台）
    setAnalyzing(true);
    try {
      const r = await request<{ success: boolean; analysis?: AiAnalysis; message?: string }>(
        `/syslogs/${targetId}/analyze`, { method: 'POST', timeout: 180000 });
      if (r?.success && r.analysis) {
        setDetail(prev => prev && prev.id === targetId ? { ...prev, ai_analysis: r.analysis!, ai_model: 'glm-5.2' } : prev);
        message.success('AI 解析完成');
      } else message.error(r?.message || 'AI 解析失败');
    } catch (e: any) { message.error(e?.message || 'AI 解析失败（可能超时）'); }
    finally { setAnalyzing(false); }
  };

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true,
      render: (t: string, r: SnapshotItem) => (
        <a onClick={() => openDetail(r.id)} style={{ fontWeight: 500 }}>{t}</a>
      ) },
    { title: '组件数', dataIndex: 'component_count', key: 'n', width: 76, align: 'right' as const },
    { title: '范围', dataIndex: 'hours', key: 'hours', width: 70,
      render: (h: number) => <Tag style={{ margin: 0 }}>{h}h</Tag> },
    { title: 'AI 解析', dataIndex: 'ai_at', key: 'ai', width: 96,
      render: (v: string | null) => v
        ? <Tag color="geekblue" style={{ margin: 0 }}>已解析</Tag>
        : <Tag style={{ margin: 0 }}>未解析</Tag> },
    { title: '抓取人', dataIndex: 'username', key: 'user', width: 88 },
    { title: '抓取时间', dataIndex: 'created_at', key: 'time', width: 152,
      render: (t: string) => new Date(t).toLocaleString('zh-CN', { hour12: false }) },
    { title: '操作', key: 'op', width: 130, render: (_: any, r: SnapshotItem) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)}>查看</Button>
        <Tooltip title="导出 JSON">
          <Button size="small" icon={<DownloadOutlined />}
            onClick={() => { window.open(`/api/syslogs/${r.id}/export`, '_blank'); }} />
        </Tooltip>
      </Space>
    ) },
  ];

  const ai = detail?.ai_analysis;
  const sev = ai ? (SEV_TAG[ai.severity] || SEV_TAG['低']) : null;
  const curComp = detail?.components?.find(c => c.name === activeComp);

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Space wrap>
            <BugOutlined style={{ color: '#dc2626' }} />
            <Typography.Text strong>一键抓取平台故障日志快照</Typography.Text>
            <Select value={hours} onChange={setHours} size="small" style={{ width: 110 }}
              options={[
                { value: 1, label: '最近 1 小时' },
                { value: 6, label: '最近 6 小时' },
                { value: 24, label: '最近 24 小时' },
                { value: 72, label: '最近 3 天' },
              ]} />
            <Input size="small" style={{ width: isMobile ? '100%' : 240 }} maxLength={80}
              placeholder="快照备注（可选，如：AI 问答 502 排查）" value={title} onChange={e => setTitle(e.target.value)} />
            <Button type="primary" icon={<ThunderboltOutlined />} loading={capturing}
              disabled={!canOperate} onClick={capture}>抓取快照</Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            聚合来源：后端运行日志（内存实时，按所选范围过滤）· 容器/执行器/宿主日志（宿主滚动采集，固定尾部行数）· 最近图纸任务管线日志 · 数据库健康。
            {!canOperate && <span style={{ color: '#d97706' }}> 当前角色仅可查看，抓取与 AI 解析需编辑者以上权限。</span>}
          </Typography.Text>
        </Space>
      </Card>

      <Card size="small" title={
        <Space>
          <BugOutlined />
          <span>故障快照记录</span>
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={load} />
        </Space>
      }>
        <Table size="small" columns={columns} dataSource={items} rowKey="id"
          loading={loading} pagination={false}
          scroll={{ x: isMobile ? 800 : undefined }}
          locale={{ emptyText: <Empty description="暂无快照——遇到平台异常时点上方「抓取快照」留存现场" /> }}
        />
      </Card>

      <Modal open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null}
        width="94vw" style={{ top: 24, maxWidth: 1400 }} title={detail?.title || '快照详情'}>
        {detailLoading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> : detail && (
          <div>
            <Descriptions size="small" bordered column={isMobile ? 1 : 4} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="抓取时间">{new Date(detail.created_at).toLocaleString('zh-CN', { hour12: false })}</Descriptions.Item>
              <Descriptions.Item label="抓取人">{detail.username}</Descriptions.Item>
              <Descriptions.Item label="时间范围">{detail.hours} 小时</Descriptions.Item>
              <Descriptions.Item label="组件数">{detail.components?.length}</Descriptions.Item>
            </Descriptions>

            {/* AI 解析卡 */}
            <Card size="small" style={{ marginBottom: 12 }}
              title={<Space><ThunderboltOutlined style={{ color: '#6366f1' }} /><span>AI 故障解析</span>{ai && sev && <Tag color={sev.color} icon={sev.icon} style={{ margin: 0 }}>严重度：{ai.severity}</Tag>}</Space>}
              extra={canOperate && (
                <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />}
                  loading={analyzing} onClick={analyze} disabled={!!ai}>
                  {ai ? '已解析' : 'AI 解析（约 1-2 分钟）'}
                </Button>
              )}>
              {!ai && !analyzing ? (
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  AI 将分析各组件日志：提取错误时间线、识别异常模式（重启/超时/5xx/资源压力）、判断根因并给出处置建议。日志无明显异常时会如实说明。
                </Typography.Text>
              ) : analyzing ? (
                <Space><Spin size="small" /><Typography.Text type="secondary" style={{ fontSize: 12 }}>AI 正在分析各组件日志…</Typography.Text></Space>
              ) : ai && (
                <div>
                  {ai.summary && <Alert type={ai.severity === '高' ? 'error' : ai.severity === '中' ? 'warning' : 'success'}
                    showIcon message={ai.summary} style={{ marginBottom: 10 }} />}
                  {ai.timeline?.length > 0 && (
                    <Timeline mode="left" style={{ marginTop: 8, paddingTop: 0 }}
                      items={ai.timeline.map((t, i) => ({
                        color: i === ai.timeline.length - 1 ? 'red' : 'blue',
                        children: <div style={{ fontSize: 12.5 }}><b>{t.time}</b> — {t.event}</div>,
                      }))} />
                  )}
                  {ai.patterns?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Typography.Text strong style={{ fontSize: 13 }}>异常模式：</Typography.Text>
                      <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
                        {ai.patterns.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                  {ai.root_causes?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <Typography.Text strong style={{ fontSize: 13 }}>根因判断：</Typography.Text>
                      {ai.root_causes.map((rc, i) => (
                        <div key={i} style={{ padding: '6px 0', fontSize: 12.5, borderBottom: '1px dashed #e8e6f0' }}>
                          <Tag color={rc.likelihood === '高' ? 'red' : rc.likelihood === '中' ? 'orange' : 'default'} style={{ margin: 0 }}>{rc.likelihood}</Tag>
                          {' '}<b>{rc.cause}</b>
                          <div style={{ color: '#6b6892', marginTop: 2 }}>依据：{rc.evidence}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {ai.actions?.length > 0 && (
                    <div>
                      <Typography.Text strong style={{ fontSize: 13 }}>处置建议：</Typography.Text>
                      <ol style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 12.5 }}>
                        {ai.actions.map((a, i) => <li key={i} style={{ margin: '2px 0' }}>{a}</li>)}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* 组件日志 */}
            <Space wrap style={{ marginBottom: 8 }}>
              {detail.components?.map(c => (
                <Button key={c.name} size="small"
                  type={c.name === activeComp ? 'primary' : 'default'}
                  onClick={() => setActiveComp(c.name)}>{c.name}</Button>
              ))}
            </Space>
            {curComp && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{curComp.desc}（尾部 {curComp.lines.split('\n').length} 行）</Typography.Text>
                <pre style={{
                  marginTop: 6, maxHeight: '38vh', overflow: 'auto', fontSize: 11, lineHeight: 1.55,
                  background: '#17162a', color: '#c8d3f5', padding: '12px 14px', borderRadius: 10,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>{curComp.lines}</pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
