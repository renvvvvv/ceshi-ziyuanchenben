/**
 * 图纸路由模块：上传 DWG 图纸 → 宿主机自动转换捋路由 → 可视化表格 → 一键导出
 * 后端 POST /api/drawing/*；任务状态轮询 3s；成品 sheet 以表格渲染。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Card, Table, Button, Input, Upload, message, Modal, Tag, Space, Tooltip,
  Progress, Tabs, Empty, Spin, Popconfirm, Typography, Alert, Collapse, Timeline,
} from 'antd';
import {
  UploadOutlined, FileExcelOutlined, ReloadOutlined, DeleteOutlined,
  EyeOutlined, ExperimentOutlined, ClockCircleOutlined, AuditOutlined, SendOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { useAuth } from '../../store/AuthContext';
import { request } from '../../api';
import { useIsMobile } from '../../hooks/useIsMobile';

interface JobItem {
  id: string; title: string; status: 'queued' | 'running' | 'done' | 'error';
  stage?: string | null; detail?: string | null;
  file_count: number; dwg_count: number | null; username: string;
  error: string | null; created_at: string; finished_at: string | null;
}
interface SheetMeta { name: string; total: number; truncated: boolean; file: string }
interface SheetData { name: string; total: number; rows: string[][] }
/** AI 复核疑点（与后端 drawingReview.ts Finding 对齐） */
interface ReviewFinding {
  id: string; source: 'scan' | 'ai'; type: string; severity: string;
  sheet: string; row: string; problem: string; evidence: string;
  suggestion: string; confidence: string; status: string;
}
interface ReviewState {
  model: string; updated_at: string; findings: ReviewFinding[];
  stats: Record<string, number>; summary: string;
}
interface ReviewHistoryItem { role: string; kind: string; at: string; by?: string; [k: string]: any }

const STAGE_TEXT: Record<string, { text: string; pct: number }> = {
  'queued': { text: '排队中', pct: 5 },
  '解压归档': { text: '解压归档', pct: 10 },
  '格式转换': { text: 'DWG 格式转换（最耗时）', pct: 35 },
  '处理中': { text: '处理中', pct: 50 },
  '路由挖掘': { text: '路由挖掘', pct: 70 },
  '生成Excel': { text: '生成 Excel', pct: 90 },
  '生成可视化': { text: '生成可视化', pct: 96 },
  'done': { text: '完成', pct: 100 },
  'error': { text: '失败', pct: 100 },
};

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  queued: { color: 'default', label: '排队中' },
  running: { color: 'processing', label: '运行中' },
  done: { color: 'success', label: '完成' },
  error: { color: 'error', label: '失败' },
};

export default function DrawingPipeline() {
  const isMobile = useIsMobile();
  const { canEdit, user } = useAuth();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [pairs, setPairs] = useState('');
  const [floors, setFloors] = useState('');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  // 详情
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  // AI 复核
  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewHistory, setReviewHistory] = useState<ReviewHistoryItem[]>([]);
  const [reviewing, setReviewing] = useState(false);       // AI 复核进行中
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const r = await request<{ success: boolean; items: JobItem[] }>('/drawing/jobs');
      if (r?.items) setJobs(r.items);
    } catch { /* 静默 */ }
  }, []);

  useEffect(() => {
    loadJobs();
    // 有运行中任务时 3s 轮询，否则 15s 常规刷新
    let stop = false;
    const tick = async () => {
      if (stop) return;
      await loadJobs();
      const anyRunning = jobsRef.current.some(j => j.status === 'running' || j.status === 'queued');
      pollRef.current = window.setTimeout(tick, anyRunning ? 3000 : 15000);
    };
    pollRef.current = window.setTimeout(tick, 3000);
    return () => { stop = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [loadJobs]);

  const jobsRef = useRef<JobItem[]>([]);
  jobsRef.current = jobs;

  // 详情打开时轮询详情（运行中滚动日志）
  useEffect(() => {
    if (!detailOpen || !detail?.id) return;
    const id = detail.id;
    const iv = window.setInterval(async () => {
      try {
        const r = await request<any>(`/drawing/jobs/${id}`);
        if (r?.job) {
          setDetail((prev: any) => ({ ...prev, ...r.job, __status: r.status, __report: r.report, __validate: r.validate, __sheets: r.sheetsIndex }));
          if (r.job.status === 'done' || r.job.status === 'error') {
            // 终态停轮询并补一次列表
            clearInterval(iv);
            loadJobs();
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [detailOpen, detail?.id, loadJobs]);

  const handleUpload = async () => {
    if (!fileList.length) { message.warning('请先选择图纸文件（.dwg / .zip / .rar）'); return; }
    const fd = new FormData();
    fileList.forEach(f => { if (f.originFileObj) fd.append('files', f.originFileObj); });
    fd.append('title', title || '');
    if (pairs.trim()) fd.append('pairs', pairs.trim());
    if (floors.trim()) fd.append('floors', floors.trim());
    setUploading(true);
    try {
      // FormData 必须由浏览器自动设 multipart 边界，绕开统一 request 的 JSON 头
      const res = await fetch('/api/drawing/upload', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      const r = await res.json().catch(() => ({}));
      if (res.ok && r?.success && r.jobId) {
        message.success(`已提交，后台开始转换（${r.fileCount} 个文件），预计 5-40 分钟`);
        setTitle(''); setFileList([]); setPairs(''); setFloors('');
        loadJobs();
      } else {
        message.error(r?.message || `上传失败: ${res.status}`);
      }
    } catch (e: any) {
      message.error(e?.message || '上传失败');
    } finally { setUploading(false); }
  };

  const openDetail = async (id: string) => {
    setSheetData(null);
    setReview(null); setReviewHistory([]); setFeedbackText('');
    setDetailOpen(true);
    try {
      const r = await request<any>(`/drawing/jobs/${id}`);
      setDetail({ ...r.job, __status: r.status, __report: r.report, __validate: r.validate, __sheets: r.sheetsIndex });
      if (r.sheetsIndex?.length) {
        // 默认打开数据最丰富的表：机柜路由 > 低压一层 > 首个（「说明」页仅3行文字，观感像空白）
        const prefer = r.sheetsIndex.find((x: SheetMeta) => x.name.includes('机房机柜路由'))
          || r.sheetsIndex.find((x: SheetMeta) => x.name.includes('低压系统'))
          || r.sheetsIndex[0];
        setActiveSheet(prefer.file);
      }
      // 已有 AI 复核结果则带出（含历史）
      try {
        const rv = await request<any>(`/drawing/jobs/${id}/review`);
        if (rv?.review) setReview(rv.review);
        if (rv?.history) setReviewHistory(rv.history);
      } catch { /* 尚无复核 */ }
    } catch { message.error('读取任务详情失败'); }
  };

  // 拉取 sheet 数据
  useEffect(() => {
    if (!detail?.id || !activeSheet || detail.status !== 'done') { setSheetData(null); return; }
    let stop = false;
    (async () => {
      setSheetLoading(true);
      try {
        const r = await request<{ success: boolean; sheet: SheetData }>(
          `/drawing/jobs/${detail.id}/sheet?file=${encodeURIComponent(activeSheet)}`);
        if (!stop && r?.sheet) setSheetData(r.sheet);
      } catch { if (!stop) setSheetData(null); }
      finally { if (!stop) setSheetLoading(false); }
    })();
    return () => { stop = true; };
  }, [detail?.id, detail?.status, activeSheet]);

  // ============== AI 复核 ==============
  const runReview = async () => {
    if (!detail?.id) return;
    setReviewing(true);
    try {
      const r = await request<any>(`/drawing/jobs/${detail.id}/review`, { method: 'POST', timeout: 180000 });
      if (r?.review) {
        setReview(r.review);
        message.success(`AI 复核完成：${r.review.stats?.total ?? 0} 条疑点`);
        try {
          const rv = await request<any>(`/drawing/jobs/${detail.id}/review`);
          if (rv?.history) setReviewHistory(rv.history);
        } catch { /* */ }
      } else { message.error(r?.message || 'AI 复核失败'); }
    } catch (e: any) { message.error(e?.message || 'AI 复核失败（可能超时，请重试）'); }
    finally { setReviewing(false); }
  };

  const sendFeedback = async () => {
    if (!detail?.id || !feedbackText.trim()) { message.warning('请先填写反馈内容'); return; }
    setFeedbackSending(true);
    try {
      const r = await request<any>(`/drawing/jobs/${detail.id}/review/feedback`, {
        method: 'POST', body: JSON.stringify({ message: feedbackText.trim() }), timeout: 180000,
      });
      if (r?.review) {
        setReview(r.review);
        setFeedbackText('');
        message.success('AI 已结合你的反馈重新复核');
        try {
          const rv = await request<any>(`/drawing/jobs/${detail.id}/review`);
          if (rv?.history) setReviewHistory(rv.history);
        } catch { /* */ }
      } else { message.error(r?.message || '反馈失败'); }
    } catch (e: any) { message.error(e?.message || '反馈失败（可能超时，请重试）'); }
    finally { setFeedbackSending(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const r = await request<{ success: boolean }>(`/drawing/jobs/${id}`, { method: 'DELETE' });
      if (r?.success) { message.success('已删除'); loadJobs(); }
    } catch (e: any) { message.error(e?.message || '删除失败'); }
  };

  const canUpload = canEdit('drawingPipeline');

  // ============== 渲染 ==============
  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true,
      render: (t: string, r: JobItem) => (
        <a onClick={() => openDetail(r.id)} style={{ fontWeight: 500 }}>{t}</a>
      ) },
    { title: '状态', dataIndex: 'status', key: 'status', width: 150,
      render: (s: string, r: JobItem) => {
        const tag = STATUS_TAG[s] || STATUS_TAG.queued;
        const stage = STAGE_TEXT[r.stage || ''] ;
        return (
          <Space size={6}>
            <Tag color={tag.color}>{tag.label}</Tag>
            {s === 'running' && stage && (
              <span style={{ fontSize: 12, color: '#6b6892' }}>{stage.text}</span>
            )}
          </Space>
        );
      } },
    { title: '图纸数', dataIndex: 'dwg_count', key: 'dwg', width: 80, render: (v: number | null) => v ?? '—' },
    { title: '上传人', dataIndex: 'username', key: 'user', width: 90 },
    { title: '发起时间', dataIndex: 'created_at', key: 'time', width: 150,
      render: (t: string) => new Date(t).toLocaleString('zh-CN', { hour12: false }) },
    { title: '耗时', key: 'dur', width: 90,
      render: (_: any, r: JobItem) => {
        const start = new Date(r.created_at).getTime();
        const end = r.finished_at ? new Date(r.finished_at).getTime() : Date.now();
        const mins = Math.max(0, Math.round((end - start) / 60000));
        return r.status === 'done' ? `${mins} 分钟` : r.status === 'running' ? `${mins} 分钟…` : '—';
      } },
    { title: '操作', key: 'actions', width: 210, render: (_: any, r: JobItem) => (
      <Space>
        <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)}>查看</Button>
        {r.status === 'done' && (
          <Tooltip title="导出 Excel">
            <Button size="small" type="primary" ghost icon={<FileExcelOutlined />}
              onClick={() => { window.open(`/api/drawing/jobs/${r.id}/export`, '_blank'); }}>导出</Button>
          </Tooltip>
        )}
        {user?.role === '管理者' && (
          <Popconfirm title="删除该任务及全部文件？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        )}
      </Space>
    ) },
  ];

  const st = detail?.__status;
  const stageInfo = STAGE_TEXT[st?.stage || detail?.status || 'queued'] || STAGE_TEXT.queued;
  const sheets: SheetMeta[] = detail?.__sheets || [];

  const sheetTable = () => {
    if (!sheetData) return <Empty description={sheetLoading ? '加载中…' : '无数据'} />;
    const rows = sheetData.rows || [];
    // 智能表头：跳过大标题行（非空格子占比低且文本长），取首个「多数格子非空」的行作列名行
    let hi = 0;
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const cols = rows[i].length || 1;
      const nonEmpty = rows[i].filter(c => c && c.trim()).length;
      if (nonEmpty >= Math.max(2, Math.floor(cols * 0.5))) { hi = i; break; }
      hi = i + 1;
    }
    if (hi >= rows.length) hi = 0;
    // AntD v5：列必须给 dataIndex 才能取到单元格值（只给 key 会渲染空格子）
    const headers = (rows[hi] || []).map((h, i) => ({ title: h || `列${i + 1}`, dataIndex: String(i), key: String(i), ellipsis: true, width: 140 }));
    const dataRows = rows.slice(hi + 1).map((r, ri) => {
      const obj: any = { __key: ri };
      r.forEach((c, ci) => { obj[String(ci)] = c; });
      return obj;
    });
    return (
      <Table
        size="small" bordered
        columns={headers} dataSource={dataRows}
        rowKey="__key"
        pagination={dataRows.length > 50 ? { pageSize: 50, showSizeChanger: false, size: 'small' } : false}
        scroll={{ x: 'max-content' }}
      />
    );
  };

  return (
    <div>
      {/* 上传区 */}
      {canUpload && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Space wrap>
              <Input
                style={{ width: isMobile ? '100%' : 360 }}
                placeholder="路由表标题（如：D7楼二批 7#楼430液冷 测试界面路由表 V1.0）"
                value={title} onChange={e => setTitle(e.target.value)} maxLength={80}
                prefix={<ExperimentOutlined style={{ color: '#9d9ab8' }} />}
              />
              <Button type="primary" icon={<UploadOutlined />} loading={uploading} onClick={handleUpload}>
                提交后台解析
              </Button>
            </Space>
            <Space wrap size={8}>
              <Input style={{ width: isMobile ? '100%' : 250 }} placeholder="成对低压柜（可选）如 P5:P6,P7:P8"
                value={pairs} onChange={e => setPairs(e.target.value)} />
              <Input style={{ width: isMobile ? '100%' : 180 }} placeholder="楼层（可选）如 1,2,3"
                value={floors} onChange={e => setFloors(e.target.value)} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                两项为精度参数：A/B 路成对柜与涉及楼层，填写后生成的配对与镜像表更准
              </Typography.Text>
            </Space>
            <Upload.Dragger
              multiple
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl)}
              accept=".dwg,.zip,.rar,.xlsx"
              showUploadList={{ showRemoveIcon: true }}
            >
              <p className="ant-upload-drag-icon"><UploadOutlined /></p>
              <p className="ant-upload-text">点击或拖入图纸文件</p>
              <p className="ant-upload-hint" style={{ fontSize: 12 }}>
                支持整个图纸包（.zip / .rar，含子目录）或多个 .dwg；可附蓄电池配置 .xlsx（可选，暂不支持 .7z）
              </p>
            </Upload.Dragger>
          </Space>
        </Card>
      )}

      {/* 任务记录 */}
      <Card size="small" title={
        <Space>
          <ClockCircleOutlined />
          <span>解析任务记录</span>
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadJobs} />
        </Space>
      }>
        <Table
          size="small" columns={columns} dataSource={jobs} rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: isMobile ? 900 : undefined }}
          locale={{ emptyText: <Empty description="暂无任务，上传图纸发起第一次解析" /> }}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        width="94vw"
        style={{ top: 24, maxWidth: 1400 }}
        title={detail?.title || '任务详情'}
        footer={detail?.status === 'done' ? (
          <Space>
            <Button icon={<FileExcelOutlined />} type="primary"
              onClick={() => { window.open(`/api/drawing/jobs/${detail.id}/export`, '_blank'); }}>
              一键导出 Excel
            </Button>
          </Space>
        ) : null}
      >
        {detail && (
          <div>
            {/* 进度 */}
            <div style={{ marginBottom: 12 }}>
              <Progress
                percent={stageInfo.pct}
                status={detail.status === 'error' ? 'exception' : detail.status === 'done' ? 'success' : 'active'}
                format={() => detail.status === 'error' ? '失败' : stageInfo.text}
              />
              {st?.detail && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{st.detail}</Typography.Text>}
            </div>
            {detail.status === 'error' && (
              <Alert type="error" showIcon style={{ marginBottom: 12 }}
                message="解析失败"
                description={
                  <div>
                    <div>{st?.detail || detail.error}</div>
                    <a href={`/api/drawing/jobs/${detail.id}/log`} target="_blank" rel="noreferrer">查看完整日志</a>
                  </div>
                } />
            )}
            {/* 运行中：实时日志 */}
            {(detail.status === 'running' || detail.status === 'queued') && (
              <Card size="small" title="实时日志" style={{ marginBottom: 12 }}>
                <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {(st?.log || []).join('\n') || '等待执行器接管…'}
                </pre>
              </Card>
            )}
            {/* 完成：AI 复核 + 校验报告 + sheet 可视化 */}
            {detail.status === 'done' && (
              <>
                {/* AI 复核（二次确认）面板 */}
                <Card size="small" style={{ marginBottom: 12 }}
                  title={
                    <Space>
                      <AuditOutlined style={{ color: '#6366f1' }} />
                      <span>AI 复核（二次确认）</span>
                      {review && (
                        <Space size={4}>
                          <Tag color="red" style={{ margin: 0 }}>高 {review.stats?.high ?? 0}</Tag>
                          <Tag color="orange" style={{ margin: 0 }}>中 {review.stats?.medium ?? 0}</Tag>
                          <Tag color="blue" style={{ margin: 0 }}>低 {review.stats?.low ?? 0}</Tag>
                          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                            {review.model} · {new Date(review.updated_at).toLocaleString('zh-CN', { hour12: false })}
                          </Typography.Text>
                        </Space>
                      )}
                    </Space>
                  }
                  extra={
                    <Button size="small" type="primary" ghost icon={<AuditOutlined />}
                      loading={reviewing} onClick={runReview} disabled={feedbackSending}>
                      {review ? '重新复核' : '发起 AI 复核'}
                    </Button>
                  }
                >
                  {reviewing && (
                    <Alert type="info" showIcon style={{ marginBottom: 10 }}
                      message="AI 正在复核（预扫描疑点 → 逐条校准审核），约需 30~90 秒…" />
                  )}
                  {!review && !reviewing && (
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
                      规则引擎负责确定性提取（可追溯坐标），AI 只做二次确认：扫描最终输出的<span style={{ color: '#dc2626' }}>缺失（?）、乱码、推定值、跨表不一致</span>，
                      逐条给出证据与建议；AI 不直接改数，所有疑点以「建议需人工确认」呈现。
                    </Typography.Paragraph>
                  )}
                  {review && (
                    <div>
                      {review.summary && (
                        <Alert type={review.stats?.high ? 'warning' : 'success'} showIcon style={{ marginBottom: 10 }}
                          message={review.summary} />
                      )}
                      <Table size="small" bordered
                        dataSource={review.findings}
                        rowKey="id"
                        pagination={(review.findings?.length || 0) > 20 ? { pageSize: 20, showSizeChanger: false, size: 'small' } : false}
                        scroll={{ x: 'max-content' }}
                        expandable={{
                          expandedRowRender: (f: ReviewFinding) => (
                            <div style={{ fontSize: 12.5 }}>
                              <div><b>证据：</b><span style={{ color: '#6b6892' }}>{f.evidence || '—'}</span></div>
                              <div style={{ marginTop: 4 }}><b>建议：</b>{f.suggestion || '—'}</div>
                            </div>
                          ),
                        }}
                        columns={[
                          { title: '级别', dataIndex: 'severity', width: 64,
                            render: (v: string) => <Tag color={v === '高' ? 'red' : v === '中' ? 'orange' : 'blue'} style={{ margin: 0 }}>{v}</Tag> },
                          { title: '类型', dataIndex: 'type', width: 70 },
                          { title: '位置', width: 150,
                            render: (_: any, f: ReviewFinding) => (
                              <span style={{ fontSize: 12 }}>{f.sheet}{f.row ? ` · ${f.row}` : ''}</span>
                            ) },
                          { title: '问题', dataIndex: 'problem', ellipsis: true },
                          { title: '置信度', dataIndex: 'confidence', width: 70,
                            render: (v: string) => <span style={{ fontSize: 12, color: v === '高' ? '#16a34a' : v === '低' ? '#dc2626' : '#d97706' }}>{v}</span> },
                          { title: '来源', dataIndex: 'source', width: 70,
                            render: (v: string) => <Tag style={{ margin: 0 }}>{v === 'scan' ? '预扫描' : 'AI'}</Tag> },
                          { title: '状态', dataIndex: 'status', width: 96,
                            render: (v: string) => <Tag style={{ margin: 0 }}
                              color={v === '已解决' ? 'success' : v === '人工已反馈' ? 'purple' : 'default'}>{v}</Tag> },
                        ]}
                      />
                      {/* 人工反馈 → AI 重核 */}
                      <div style={{ marginTop: 12 }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                          指出 AI 哪里有错误或补充事实（如「F2-P1 中压柜实际为 1AH5/2AH3/2AH5，与 F1-P1 同构」），提交后 AI 会结合反馈重新复核
                        </Typography.Text>
                        <Space.Compact style={{ width: '100%' }}>
                          <Input.TextArea
                            value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                            placeholder="例：F3-P3-T06 的 IT 变压器容量图纸标注为 2000kVA，不是推定值；柴发并机在 xx 图有标注…"
                            autoSize={{ minRows: 1, maxRows: 3 }} maxLength={1000}
                          />
                        </Space.Compact>
                        <Button size="small" type="primary" icon={<SendOutlined />} style={{ marginTop: 8 }}
                          loading={feedbackSending} onClick={sendFeedback}
                          disabled={!feedbackText.trim()}>
                          提交反馈并让 AI 重新复核
                        </Button>
                      </div>
                      {/* 复核历史 */}
                      {reviewHistory.length > 0 && (
                        <Collapse size="small" style={{ marginTop: 10 }}
                          items={[{
                            key: 'h', label: `复核历史（${reviewHistory.length} 条）`,
                            children: (
                              <Timeline mode="left" style={{ marginTop: 0, paddingTop: 4 }}
                                items={reviewHistory.map(h => ({
                                  color: h.role === 'human' ? 'purple' : 'blue',
                                  children: (
                                    <div style={{ fontSize: 12.5 }}>
                                      <Typography.Text type="secondary">
                                        {new Date(h.at).toLocaleString('zh-CN', { hour12: false })} ·{' '}
                                        {h.role === 'human' ? `人工反馈（${h.by || '—'}）` : h.kind === 'reverify' ? 'AI 重核' : `AI 复核（${h.dur_sec ?? '?'}s）`}
                                      </Typography.Text>
                                      <div style={{ marginTop: 2 }}>
                                        {h.role === 'human' ? h.message : h.summary}
                                      </div>
                                      {h.kind === 'reverify' && Array.isArray(h.responses) && h.responses.length > 0 && (
                                        <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#6b6892' }}>
                                          {h.responses.map((rp: any, i: number) => (
                                            <li key={i}>针对「{(rp.to || '').slice(0, 40)}」：{rp.conclusion}</li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  ),
                                }))} />
                            ),
                          }]} />
                      )}
                    </div>
                  )}
                </Card>
                {detail.__validate && (
                  <Card size="small" title="结构校验报告" style={{ marginBottom: 12 }}>
                    <pre style={{ maxHeight: 160, overflow: 'auto', fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {detail.__validate}
                    </pre>
                  </Card>
                )}
                {sheets.length > 0 ? (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                      点击下方标签切换各张分析表（括号内为行数）；完整数据请用「一键导出 Excel」
                    </Typography.Text>
                    <Tabs
                      activeKey={activeSheet}
                      onChange={setActiveSheet}
                      items={sheets.map(s => ({
                        key: s.file,
                        label: `${s.name} (${s.total})`,
                        children: <div style={{ maxHeight: '52vh', overflow: 'auto' }}>{sheetLoading ? <Spin /> : sheetTable()}</div>,
                      }))}
                    />
                  </div>
                ) : <Empty description="无表格数据" />}
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
