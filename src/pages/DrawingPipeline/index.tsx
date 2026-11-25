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
  BulbOutlined,
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
  learning_ids?: string[];
  corrected_value?: string;  // 人工修正值（结构化，入学习库供管线回写）
}
interface ReviewState {
  model: string;
  mode?: 'standard' | 'deep';   // deep：页面发起的 GLM-5.3 后台复核；standard：旧的 GLM-5.2 同步复核结果
  updated_at: string; findings: ReviewFinding[];
  stats: Record<string, number>; summary: string;
}
/** 后台复核的状态（与后端 PendingReview 对齐）：running 时前端轮询，failed 时提示 */
interface PendingReview {
  mode: string; status: 'running' | 'failed'; started_at: string; by?: string;
  failed_at?: string; error?: string;
}
interface ReviewHistoryItem { role: string; kind: string; at: string; by?: string; [k: string]: any }
/** 复核历史条目的标签：人工侧分 反馈 / 修正 / 建议 三种，后端 history 里用 kind 区分 */
function historyLabel(h: ReviewHistoryItem): string {
  if (h.role === 'human') {
    const who = h.by || '—';
    return h.kind === 'correct' ? `人工修正（${who}）` : h.kind === 'suggest' ? `优化建议（${who}）` : `人工反馈（${who}）`;
  }
  return h.kind === 'reverify' ? 'AI 重核' : `AI 复核（${h.dur_sec ?? '?'}s）`;
}
/** 复核历史条目的正文：修正记录存的是 finding + value，没有 message */
function historyText(h: ReviewHistoryItem): string {
  if (h.role === 'human' && h.kind === 'correct') return `疑点 ${h.finding ?? ''} 的修正值：${h.value ?? ''}`;
  return h.role === 'human' ? h.message : h.summary;
}

/** 自学习库条目（与后端 Learning 对齐） */
interface LearningItem {
  id: string; kind: string; content: string; buildings: string[];
  source_job: string; created_by: string; at: string; applied: number;
}

/** 默认打开数据最丰富的表：机柜路由 > 低压一层 > 首个（「说明」页仅3行文字，观感像空白） */
function pickDefaultSheet(list: SheetMeta[] | undefined | null): string {
  if (!list?.length) return '';
  const prefer = list.find((x) => x.name.includes('机房机柜路由'))
    || list.find((x) => x.name.includes('低压系统'))
    || list[0];
  return prefer.file;
}

const STAGE_TEXT: Record<string, { text: string; pct: number }> = {
  'queued': { text: '排队中', pct: 5 },
  '完成': { text: '完成', pct: 100 },   // 解析脚本从日志里认出的收尾阶段，状态写成 done 之前会短暂停在这里
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
  const [learnings, setLearnings] = useState<LearningItem[]>([]);
  const [reviewPending, setReviewPending] = useState<PendingReview | null>(null); // 后台复核：进行中 / 失败
  const [reviewStarting, setReviewStarting] = useState(false); // 启动请求发出去了（还没拿到 202）
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  // 人工修正值（findingId → value）与优化建议
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [suggestText, setSuggestText] = useState('');
  const [suggestSending, setSuggestSending] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const pollRef = useRef<number | null>(null);
  const detailSeqRef = useRef(0);          // 详情请求序号：切换任务后，旧任务的迟到响应一律丢弃

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
      if (stop) return; // 卸载发生在请求期间时不再排下一轮（否则每次进出页面泄漏一条永久轮询链）
      const anyRunning = jobsRef.current.some(j => j.status === 'running' || j.status === 'queued');
      pollRef.current = window.setTimeout(tick, anyRunning ? 3000 : 15000);
    };
    pollRef.current = window.setTimeout(tick, 3000);
    return () => { stop = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [loadJobs]);

  const jobsRef = useRef<JobItem[]>([]);
  jobsRef.current = jobs;
  const detailIdRef = useRef<string>('');  // 当前显示的任务 id，供异步回调核对“用户还停在这个任务上吗”
  detailIdRef.current = detail?.id ?? '';

  // 详情打开时轮询详情（运行中滚动日志）。用 setTimeout 链而不是 setInterval：
  // interval 派发的异步回调没有先后约束，慢的那次可能后到，把“已完成”覆盖回“运行中”。
  useEffect(() => {
    if (!detailOpen || !detail?.id) return;
    const id = detail.id;
    let stop = false;
    let finished = false;   // 到了终态就不再接受任何迟到的响应
    let timer: number | null = null;
    const tick = async () => {
      if (stop) return;
      let r: any = null;
      try { r = await request<any>(`/drawing/jobs/${id}`); } catch { /* 网络抖动，下一轮再查 */ }
      if (stop || finished) return;
      if (r?.job) {
        setDetail((prev: any) => (prev?.id === id
          ? { ...prev, ...r.job, __status: r.status, __report: r.report, __validate: r.validate, __sheets: r.sheetsIndex }
          : prev));
        if (r.job.status === 'done' || r.job.status === 'error') {
          finished = true;
          // 上传后立刻点“查看”的任务：打开时还没有表格，选中的一直是空值，跑完时在这里补上默认表
          if (r.job.status === 'done') setActiveSheet((cur) => cur || pickDefaultSheet(r.sheetsIndex || []));
          loadJobs(); // 终态补刷一次列表
          return;
        }
      }
      timer = window.setTimeout(tick, 3000);
    };
    timer = window.setTimeout(tick, 3000);
    return () => { stop = true; if (timer) clearTimeout(timer); };
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
    const seq = ++detailSeqRef.current;
    setSheetData(null);
    setActiveSheet(''); // 先清空：再打开同一个任务时选中表必须发生变化，下面的加载逻辑才会重跑
    setReview(null); setReviewHistory([]); setLearnings([]); setFeedbackText(''); setCorrections({}); setSuggestText(''); setSuggestions([]);
    setReviewPending(null);
    setDetail(null);   // 读取期间显示加载态，不把上一个任务的信息当成这个任务的
    setDetailOpen(true);
    try {
      const r = await request<any>(`/drawing/jobs/${id}`);
      if (seq !== detailSeqRef.current) return; // 期间又打开了别的任务，这次的结果作废
      setDetail({ ...r.job, __status: r.status, __report: r.report, __validate: r.validate, __sheets: r.sheetsIndex });
      setActiveSheet(pickDefaultSheet(r.sheetsIndex));
      // 已有 AI 复核结果则带出（含历史 + 自学习库）
      try {
        const rv = await request<any>(`/drawing/jobs/${id}/review`);
        if (seq !== detailSeqRef.current) return;
        if (rv?.review) setReview(rv.review);
        if (rv?.history) setReviewHistory(rv.history);
        if (rv?.learnings) setLearnings(rv.learnings);
        if (rv?.pending) setReviewPending(rv.pending);   // 别人或刚才发起的复核还在后台跑
      } catch { /* 尚无复核 */ }
    } catch { if (seq === detailSeqRef.current) message.error('读取任务详情失败'); }
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

  // ============== AI 复核（GLM-5.3，后台任务，约 6~8 分钟） ==============
  // 后端收到 deep: true 后登记为后台任务并立即返回，结果靠下面的轮询取。
  // 不同步等待：一个要挂 7 分钟的请求太脆弱（代理超时、电脑休眠、切换网络都会断）。
  const reviewRunning = reviewPending?.status === 'running';
  const runReview = async () => {
    if (!detail?.id) return;
    const targetId = detail.id; // 请求期间用户可能切到了别的任务：响应只允许写回原任务
    setReviewStarting(true);
    try {
      const r = await request<any>(`/drawing/jobs/${targetId}/review`, { method: 'POST', body: JSON.stringify({ deep: true }) });
      if (detailIdRef.current !== targetId) return;
      if (r?.started) {
        setReviewPending({ mode: 'deep', status: 'running', started_at: new Date().toISOString() });
        message.info('AI 复核已在后台开始，约需 6~8 分钟，可以离开页面，稍后回来看结果');
      } else { message.error(r?.message || 'AI 复核启动失败'); }
    } catch (e: any) {
      if (detailIdRef.current !== targetId) return;
      if (e?.statusCode === 409) {
        // 别人（或另一个标签页）已经对这个任务发起了复核：转入“进行中”去轮询他的结果
        setReviewPending({ mode: 'deep', status: 'running', started_at: new Date().toISOString() });
        message.info(e?.message || '该任务已在复核中');
      } else { message.error(e?.message || 'AI 复核启动失败'); }
    } finally { setReviewStarting(false); }
  };

  // 复核进行中：每 10 秒查一次状态。完成则刷新结果；失败则提示。关掉详情页即停，不留轮询链。
  useEffect(() => {
    if (!detailOpen || !detail?.id || !reviewRunning) return;
    const id = detail.id;
    let stop = false;
    let timer: number | null = null;
    const tick = async () => {
      if (stop) return;
      let rv: any = null;
      try { rv = await request<any>(`/drawing/jobs/${id}/review`); } catch { /* 网络抖动，下一轮再查 */ }
      if (stop) return;
      if (!rv) { timer = window.setTimeout(tick, 15000); return; }
      if (rv.pending?.status === 'running') { setReviewPending(rv.pending); timer = window.setTimeout(tick, 10000); return; }
      // 不再“进行中”：要么跑完了，要么失败了
      if (rv.review) setReview(rv.review);
      if (rv.history) setReviewHistory(rv.history);
      if (rv.learnings) setLearnings(rv.learnings);
      setReviewPending(rv.pending?.status === 'failed' ? rv.pending : null);
      if (rv.pending?.status === 'failed') message.error(`AI 复核失败：${rv.pending.error || '未知原因'}`);
      else message.success(`AI 复核完成：${rv.review?.stats?.total ?? 0} 条疑点`);
    };
    timer = window.setTimeout(tick, 5000);
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [detailOpen, detail?.id, reviewRunning]);

  const sendFeedback = async () => {
    if (!detail?.id || !feedbackText.trim()) { message.warning('请先填写反馈内容'); return; }
    const targetId = detail.id;
    setFeedbackSending(true);
    try {
      const r = await request<any>(`/drawing/jobs/${targetId}/review/feedback`, {
        method: 'POST', body: JSON.stringify({ message: feedbackText.trim() }), timeout: 450000,
      });
      if (detailIdRef.current !== targetId) return; // 重核要等一会儿，期间用户可能已经切到别的任务
      if (r?.review) {
        setReview(r.review);
        if (r.learnings) setLearnings(r.learnings);
        setFeedbackText('');
        message.success('AI 已结合你的反馈重新复核');
        try {
          const rv = await request<any>(`/drawing/jobs/${targetId}/review`);
          if (detailIdRef.current === targetId && rv?.history) setReviewHistory(rv.history);
        } catch { /* */ }
      } else { message.error(r?.message || '反馈失败'); }
    } catch (e: any) { message.error(e?.message || '反馈失败（可能超时，请重试）'); }
    finally { setFeedbackSending(false); }
  };

  /** 逐条修正：缺失/推定疑点直接填正确值，结构化入学习库（管线回写消费） */
  const submitCorrection = async (findingId: string) => {
    const value = (corrections[findingId] || '').trim();
    if (!value) { message.warning('请先填写修正值'); return; }
    const targetId = detail.id;
    setCorrectingId(findingId);
    try {
      const r = await request<any>(`/drawing/jobs/${targetId}/review/correct`, {
        method: 'POST', body: JSON.stringify({ findingId, value }), timeout: 60000,
      });
      if (detailIdRef.current !== targetId) return;
      if (r?.review) {
        setReview(r.review);
        if (r.learnings) setLearnings(r.learnings);
        setCorrections(prev => { const n = { ...prev }; delete n[findingId]; return n; });
        message.success('修正已记录（高置信入学习库，下次同楼栋自动应用）');
        try {
          const rv = await request<any>(`/drawing/jobs/${targetId}/review`);
          if (detailIdRef.current === targetId && rv?.history) setReviewHistory(rv.history);
        } catch { /* */ }
      } else message.error(r?.message || '提交修正失败');
    } catch (e: any) { message.error(e?.message || '提交修正失败'); }
    finally { setCorrectingId(null); }
  };

  /** 优化建议：给管线迭代的线索（版式问题/识别缺陷/改进想法） */
  const submitSuggestion = async () => {
    if (!suggestText.trim()) { message.warning('请先填写建议内容'); return; }
    setSuggestSending(true);
    try {
      const r = await request<any>(`/drawing/jobs/${detail.id}/review/suggest`, {
        method: 'POST', body: JSON.stringify({ message: suggestText.trim() }), timeout: 60000,
      });
      if (r?.suggestions) {
        setSuggestions(r.suggestions);
        setSuggestText('');
        message.success('建议已入库（供规则迭代参考）');
      } else message.error(r?.message || '提交失败');
    } catch (e: any) { message.error(e?.message || '提交失败'); }
    finally { setSuggestSending(false); }
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
  // 认不出的阶段回落到任务状态自己的档位，再不行按“处理中”显示——不能回落到“排队中 5%”
  const stageInfo = STAGE_TEXT[st?.stage || detail?.status || 'queued'] || STAGE_TEXT[detail?.status || ''] || STAGE_TEXT['处理中'];
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
        {!detail ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
        ) : (
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
                  {Array.isArray(st?.log) ? st.log.join('\n') : String(st?.log ?? '') || '等待执行器接管…'}
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
                    <Tooltip title="GLM-5.3 深度推理，能发现需要跨表对照才能看出的疑点。约需 6~8 分钟，在后台运行，可以离开页面。">
                      <Button size="small" type="primary" icon={<AuditOutlined />}
                        loading={reviewStarting} onClick={runReview}
                        disabled={feedbackSending || reviewRunning}>
                        {review ? '重新复核' : '发起 AI 复核'}
                      </Button>
                    </Tooltip>
                  }
                >
                  {reviewRunning && reviewPending && (
                    <Alert type="info" showIcon style={{ marginBottom: 10 }}
                      message={`AI 复核在后台进行中（已进行 ${Math.max(0, Math.round((Date.now() - (Date.parse(reviewPending.started_at) || Date.now())) / 60000))} 分钟），约需 6~8 分钟。可以离开页面，稍后回来看结果。`}
                      description="复核期间不能再次复核，也不能提交人工反馈。" />
                  )}
                  {reviewPending?.status === 'failed' && (
                    <Alert type="error" showIcon closable style={{ marginBottom: 10 }}
                      onClose={() => setReviewPending(null)}
                      message="AI 复核没有完成，原有复核结果没有被改动。"
                      description={reviewPending.error || '未知原因'} />
                  )}
                  {!review && !reviewRunning && (
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, marginBottom: 0 }}>
                      规则引擎负责确定性提取（可追溯坐标），AI 只做二次确认：扫描最终输出的<span style={{ color: '#dc2626' }}>缺失（?）、乱码、推定值、跨表不一致</span>，
                      逐条给出证据与建议；AI 不直接改数，所有疑点以「建议需人工确认」呈现。
                      {learnings.length > 0 && (
                        <span style={{ color: '#6366f1' }}>自学习库已积累 {learnings.length} 条经验，会在复核时自动复用。</span>
                      )}
                    </Typography.Paragraph>
                  )}
                  {review && (
                    <div>
                      {review.summary && (
                        <Alert type={review.stats?.high ? 'warning' : 'success'} showIcon style={{ marginBottom: 10 }}
                          message={review.summary}
                          description={review.mode === 'deep'
                            ? '这是 AI 给出的总结。实测中它出现过计数错误和夸大，请以下方逐条疑点为准。' : undefined} />
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
                              {f.learning_ids?.length ? (
                                <div style={{ marginTop: 4 }}>
                                  <b>引用经验：</b>{f.learning_ids.map(l => <Tag key={l} color="geekblue" style={{ marginInlineEnd: 4 }}>{l}</Tag>)}
                                  <span style={{ color: '#6b6892', fontSize: 12 }}>（来自自学习库的人工反馈结论）</span>
                                </div>
                              ) : null}
                              {/* 人工修正值输入：缺失/推定类疑点有明确正确值可填，高置信入学习库 */}
                              {(f.type === '缺失' || f.type === '推定') && f.status !== '已修正' && (
                                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <Input
                                    size="small" style={{ width: 260 }} placeholder="填写正确值（如 1AH5 / 500kVA）"
                                    value={corrections[f.id] || ''}
                                    onChange={e => setCorrections(prev => ({ ...prev, [f.id]: e.target.value }))}
                                    onKeyDown={e => {
                                      // 中文输入法里按回车是“上屏”：组合期间（isComposing）的回车不能当成提交
                                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitCorrection(f.id);
                                    }}
                                  />
                                  <Button size="small" type="primary" loading={correctingId === f.id}
                                    disabled={!(corrections[f.id] || '').trim()}
                                    onClick={() => submitCorrection(f.id)}>提交修正</Button>
                                  <span style={{ color: '#16a34a', fontSize: 12 }}>一次确认，同楼栋终身自动应用</span>
                                </div>
                              )}
                              {f.status === '已修正' && f.corrected_value && (
                                <div style={{ marginTop: 6 }}>
                                  <Tag color="success" style={{ margin: 0 }}>已修正</Tag>
                                  {' '}<b style={{ color: '#16a34a' }}>{f.corrected_value}</b>
                                  <span style={{ color: '#6b6892', fontSize: 12 }}>（已入学习库，管线将自动应用）</span>
                                </div>
                              )}
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
                              color={v === '已修正' ? 'success' : v === '已解决' ? 'success' : v === '人工已反馈' ? 'purple' : 'default'}>{v}</Tag> },
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
                          disabled={!feedbackText.trim() || reviewRunning}>
                          提交反馈并让 AI 重新复核
                        </Button>
                      </div>
                      {/* 优化建议通道：给管线迭代的线索（区别于上面的纠错反馈） */}
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e8e6f0' }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                          💡 管线优化建议（版式问题 / 识别缺陷 / 改进想法——供规则迭代参考，与上面的纠错反馈互补）
                        </Typography.Text>
                        <Input.TextArea
                          value={suggestText} onChange={e => setSuggestText(e.target.value)}
                          placeholder="例：这种版式的柴发标签是竖排的，识别不到；变压器容量应优先看设备表；建议增加 XX 表的识别…"
                          autoSize={{ minRows: 1, maxRows: 3 }} maxLength={1000}
                        />
                        <Button size="small" icon={<BulbOutlined />} style={{ marginTop: 8 }}
                          loading={suggestSending} onClick={submitSuggestion}
                          disabled={!suggestText.trim()}>
                          提交优化建议
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
                                        {historyLabel(h)}
                                      </Typography.Text>
                                      <div style={{ marginTop: 2 }}>
                                        {historyText(h)}
                                      </div>
                                      {h.kind === 'reverify' && Array.isArray(h.responses) && h.responses.length > 0 && (
                                        <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#6b6892' }}>
                                          {h.responses.map((rp: any, i: number) => (
                                            <li key={i}>针对「{(rp.to || '').slice(0, 40)}」：{rp.conclusion}</li>
                                          ))}
                                        </ul>
                                      )}
                                      {h.kind === 'reverify' && (h.learned_added || h.learned_applied) ? (
                                        <div style={{ marginTop: 2, color: '#6366f1' }}>
                                          自学习：沉淀 {h.learned_added ?? 0} 条新经验{h.learned_dup ? `（${h.learned_dup} 条重复忽略）` : ''}，本轮引用 {h.learned_applied ?? 0} 条
                                        </div>
                                      ) : null}
                                      {h.kind === 'review' && h.learned_applied ? (
                                        <div style={{ marginTop: 2, color: '#6366f1' }}>自学习：本轮引用 {h.learned_applied} 条历史经验</div>
                                      ) : null}
                                    </div>
                                  ),
                                }))} />
                            ),
                          }]} />
                      )}
                      {/* 自学习库 */}
                      {learnings.length > 0 && (
                        <Collapse size="small" style={{ marginTop: 6 }}
                          items={[{
                            key: 'l',
                            label: (
                              <Space size={6}>
                                <BulbOutlined style={{ color: '#f59e0b' }} />
                                <span>自学习库（{learnings.length} 条经验，复核时自动复用）</span>
                                {learnings.filter(l => l.kind === '修正值').length > 0 && (
                                  <Tag color="success" style={{ margin: 0 }}>人工修正 {learnings.filter(l => l.kind === '修正值').length} 条</Tag>
                                )}
                              </Space>
                            ),
                            children: (
                              <div>
                                <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                                  来自人工反馈的可复用事实结论：AI 复核时自动注入相关经验并引用编号；同类问题不会再犯第二次，精度随反馈持续提升。
                                </Typography.Paragraph>
                                {learnings.map(l => (
                                  <div key={l.id} style={{ fontSize: 12.5, padding: '4px 0', borderBottom: '1px dashed #e8e6f0' }}>
                                    <Space size={6} wrap>
                                      <Tag color="geekblue" style={{ margin: 0 }}>{l.id}</Tag>
                                      <Tag style={{ margin: 0 }}>{l.kind}</Tag>
                                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        来源 {l.source_job} · {l.created_by || '—'} · {new Date(l.at).toLocaleDateString('zh-CN')}
                                        {l.applied > 0 && ` · 已被引用 ${l.applied} 次`}
                                      </Typography.Text>
                                    </Space>
                                    <div style={{ marginTop: 2 }}>{l.content}</div>
                                  </div>
                                ))}
                              </div>
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
