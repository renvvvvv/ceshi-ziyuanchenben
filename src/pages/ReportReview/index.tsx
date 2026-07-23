import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Upload, Button, Spin, message, Tooltip, Modal, List, Empty, Popconfirm, Input } from 'antd';
import type { UploadProps } from 'antd';
import { useAuth } from '../../store/AuthContext';
import {
  InboxOutlined,
  DownloadOutlined,
  EditOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  BookOutlined,
  BulbOutlined,
  DeleteOutlined,
} from '@ant-design/icons';

const { Dragger } = Upload;

interface TypoError {
  id: number;
  original: string;
  suggestion: string;
  context: string;
  fixed: boolean;
}

function ReportReview() {
  const { logout } = useAuth();
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [rawText, setRawText] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [errors, setErrors] = useState<TypoError[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeErrorId, setActiveErrorId] = useState<number | null>(null);
  const [learnedSize, setLearnedSize] = useState<number>(0);
  const [reviewStats, setReviewStats] = useState<{aiErrors: number; ruleErrors: number; merged: number}>({aiErrors: 0, ruleErrors: 0, merged: 0});
  const [manageLibOpen, setManageLibOpen] = useState(false);
  const [learnedItems, setLearnedItems] = useState<Array<{original:string;suggestion:string;count:number;lastSeen:string;source?:string}>>([]);
  const [learnedSearch, setLearnedSearch] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const jumpTimersRef = useRef<number[]>([]);

  // 组件卸载时清理所有 setTimeout，防止 setState on unmounted
  useEffect(() => {
    return () => {
      jumpTimersRef.current.forEach((t) => clearTimeout(t));
      jumpTimersRef.current = [];
    };
  }, []);

  // 加载学习库规模
  useEffect(() => {
    fetch('/api/report-review/learned', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.success) setLearnedSize(d.size); })
      .catch(() => {});
  }, []);

  // 打开"管理学习库"Modal 时刷新列表
  const openManageLib = async () => {
    try {
      const r = await fetch('/api/report-review/learned', { credentials: 'include' });
      const d = await r.json();
      if (d.success) setLearnedItems(d.items || []);
    } catch {}
    setManageLibOpen(true);
  };

  // 删除一条学习记录
  const handleDeleteLearned = async (original: string) => {
    Modal.confirm({
      title: '从学习库移除',
      content: `确认移除纠错："${original}"？`,
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const r = await fetch('/api/report-review/learn', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ original }),
          });
          const d = await r.json();
          if (d.success) {
            setLearnedItems((prev) => prev.filter((i) => i.original !== original));
            setLearnedSize(d.remaining);
            message.success(`已移除："${original}"（剩余 ${d.remaining} 条）`);
          } else {
            message.error(d.message || d.error || '移除失败');
          }
        } catch {
          message.error('网络异常');
        }
      },
    });
  };

  // 提交采纳纠错到后端学习库
  const submitLearning = useCallback(async (original: string, suggestion: string) => {
    try {
      const res = await fetch('/api/report-review/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ original, suggestion }),
      });
      const data = await res.json();
      if (data.success) {
        setLearnedSize((s) => s + 1);
      } else {
        // 后端校验失败（如"原词=推荐词"），给出友好提示
        message.warning(data.message || data.error || '该纠错未能加入学习库');
      }
    } catch {
      // 静默失败，不打扰主流程
    }
  }, []);

  const parseDocument = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    if (file.name.toLowerCase().endsWith('.docx')) {
      const mammoth = await import('mammoth/mammoth.browser');
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const div = document.createElement('div');
      div.innerHTML = result.value;
      return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
    } else if (file.name.toLowerCase().endsWith('.pdf')) {
      const pdfjsLib: any = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n\n';
      }
      return text.trim();
    }
    throw new Error('不支持的格式');
  }, []);

  const reviewText = useCallback(async (text: string) => {
    setReviewing(true);
    setReviewed(false);
    try {
      const res = await fetch('/api/report-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        message.error(data.message || data.error || '登录状态已失效，请重新登录');
        logout();
        return;
      }

      if (res.ok && data.success && Array.isArray(data.errors)) {
        setErrors(data.errors.map((e: TypoError, i: number) => ({ ...e, fixed: false, id: i + 1 })));
        setReviewed(true);
        if (data.stats) setReviewStats(data.stats);
        message.success(`AI 审核完成，发现 ${data.errors.length} 处错别字`);
      } else {
        message.error(data.message || data.error || `AI 审核失败（HTTP ${res.status}）`);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      message.error(detail ? `审核请求失败：${detail}` : '审核请求失败，请确认后端服务已启动');
    } finally {
      setReviewing(false);
    }
  }, [logout]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const uploadProps: UploadProps = {
    accept: '.docx,.pdf',
    multiple: false,
    showUploadList: false,
    beforeUpload: async (file) => {
      setFileName(file.name);
      setFileSize(formatFileSize(file.size));
      setRawText('');
      setErrors([]);
      setReviewed(false);
      try {
        const text = await parseDocument(file);
        setRawText(text);
        message.success(`已解析「${file.name}」（${text.length} 字）`);
        await reviewText(text);
      } catch (err) {
        console.error(err);
        message.error('文档解析失败，请检查文件格式');
      }
      return false;
    },
  };

  // 高亮渲染预览内容
  const highlightedContent = useMemo(() => {
    if (!rawText) return null;
    if (errors.length === 0) {
      return <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 12.5, color: 'rgba(255,255,255,0.75)', lineHeight: 1.8 }}>{rawText}</pre>;
    }
    const unfixedErrors = errors.filter((e) => !e.fixed && e.original && e.original.length > 0);
    const fixedErrors = errors.filter((e) => e.fixed && e.suggestion && e.suggestion.length > 0);
    let segments: Array<{ text: string; type: 'normal' | 'error' | 'fixed'; error?: TypoError }> = [{ text: rawText, type: 'normal' }];

    for (const err of unfixedErrors) {
      const newSegs: typeof segments = [];
      for (const seg of segments) {
        if (seg.type !== 'normal') { newSegs.push(seg); continue; }
        const parts = seg.text.split(err.original);
        parts.forEach((part, i) => {
          if (part) newSegs.push({ text: part, type: 'normal' });
          if (i < parts.length - 1) newSegs.push({ text: err.original, type: 'error', error: err });
        });
      }
      segments = newSegs;
    }
    for (const err of fixedErrors) {
      const newSegs: typeof segments = [];
      for (const seg of segments) {
        if (seg.type !== 'normal') { newSegs.push(seg); continue; }
        const parts = seg.text.split(err.suggestion);
        parts.forEach((part, i) => {
          if (part) newSegs.push({ text: part, type: 'normal' });
          if (i < parts.length - 1) newSegs.push({ text: err.suggestion, type: 'fixed', error: err });
        });
      }
      segments = newSegs;
    }

    return (
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 12.5, lineHeight: 1.8 }}>
        {segments.map((seg, i) => {
          if (seg.type === 'error') {
            return (
              <span key={i} id={`error-${seg.error?.id}`} style={{
                background: activeErrorId === seg.error?.id ? 'rgba(255,77,79,0.3)' : 'rgba(255,77,79,0.18)',
                color: '#ff7875', borderBottom: '2px solid #ff4d4f', padding: '1px 3px', borderRadius: 3,
                transition: 'background 0.3s',
              }}>
                {seg.text}
              </span>
            );
          }
          if (seg.type === 'fixed') {
            return (
              <span key={i} id={`error-${seg.error?.id}`} style={{
                background: 'rgba(82,196,26,0.12)', color: '#52c41a', padding: '1px 3px', borderRadius: 3,
              }}>
                {seg.text}
              </span>
            );
          }
          return <span key={i} style={{ color: 'rgba(255,255,255,0.75)' }}>{seg.text}</span>;
        })}
      </pre>
    );
  }, [rawText, errors, activeErrorId]);

  const handleFixAll = () => {
    let text = rawText;
    const updated = errors.map((e) => {
      if (!e.fixed && e.original) {
        text = text.split(e.original).join(e.suggestion);
        // 异步学习（采纳）
        submitLearning(e.original, e.suggestion);
        return { ...e, fixed: true };
      }
      return e;
    });
    setRawText(text);
    setErrors(updated);
    message.success('已一键修改全部错别字，并加入学习库');
  };

  const handleFixOne = (id: number) => {
    const err = errors.find((e) => e.id === id);
    if (!err || err.fixed) return;
    setRawText((prev) => prev.split(err.original).join(err.suggestion));
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, fixed: true } : e)));
    submitLearning(err.original, err.suggestion);
    message.success(`已修改：「${err.original}」→「${err.suggestion}」`);
  };

  // 仅采纳纠错但暂不修改文本（用于想保留原文讨论的场景）
  const handleAdoptOnly = (id: number) => {
    const err = errors.find((e) => e.id === id);
    if (!err) return;
    submitLearning(err.original, err.suggestion);
    message.success(`已采纳为新纠错：「${err.original}」→「${err.suggestion}」`);
  };

  // 点击错别字 → 右栏滚动到对应位置
  const handleJumpToError = (id: number) => {
    setActiveErrorId(id);
    const t1 = window.setTimeout(() => {
      const el = document.getElementById(`error-${id}`);
      if (el && previewRef.current) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const t2 = window.setTimeout(() => setActiveErrorId(null), 2000);
      jumpTimersRef.current.push(t2);
    }, 100);
    jumpTimersRef.current.push(t1);
  };

  const handleExport = async () => {
    if (!rawText) return;
    setExporting(true);
    try {
      const { Document, Packer, Paragraph, TextRun } = await import('docx');
      const paragraphs = rawText
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => new Paragraph({ children: [new TextRun({ text: line, font: '微软雅黑', size: 24 })] }));
      const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `审核后_${fileName.replace(/\.[^.]+$/, '')}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('已导出 Word 文档');
    } catch {
      message.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleReset = () => {
    setFileName('');
    setFileSize('');
    setRawText('');
    setErrors([]);
    setReviewed(false);
  };

  const fixedCount = errors.filter((e) => e.fixed).length;
  const unfixedCount = errors.length - fixedCount;
  const hasFile = !!rawText;

  return (
    <div>
      <div className="page-header">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: '#4d9fff' }} />
            测试报告审核
          </h3>
          <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            上传 Word/PDF 测试报告 · AI 自动审核错别字 · 在线预览修改
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {reviewed && reviewStats.merged > 0 && (
            <Tooltip title="AI 检出 / 词典兜底 / 合并去重后总数">
              <div style={{
                background: 'rgba(77,159,255,0.08)', border: '1px solid rgba(77,159,255,0.2)',
                borderRadius: 6, padding: '4px 10px', fontSize: 11, color: 'rgba(255,255,255,0.6)',
              }}>
                <BulbOutlined style={{ color: '#4d9fff', marginRight: 4 }} />
                AI {reviewStats.aiErrors} · 词典 {reviewStats.ruleErrors} · 去重 {reviewStats.merged}
              </div>
            </Tooltip>
          )}
          <Tooltip title="点击管理已学习的纠错（采纳后会自动应用于下次审核）">
            <div
              onClick={openManageLib}
              style={{
                cursor: 'pointer', userSelect: 'none',
                background: 'rgba(82,196,26,0.08)', border: '1px solid rgba(82,196,26,0.2)',
                borderRadius: 6, padding: '4px 10px', fontSize: 11, color: 'rgba(255,255,255,0.6)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(82,196,26,0.16)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(82,196,26,0.08)'; }}
            >
              <BookOutlined style={{ color: '#52c41a', marginRight: 4 }} />
              学习库 {learnedSize} 条（点击管理）
            </div>
          </Tooltip>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 160px)', minHeight: 500 }}>
        {/* 左栏：上传 + 文件信息 + 按钮 */}
        <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'rgba(77,159,255,0.03)', border: '1px solid rgba(77,159,255,0.12)', borderRadius: 10, padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ color: '#4d9fff', fontSize: 12, fontWeight: 500, marginBottom: 12 }}>上传文档</div>

            {!hasFile && !reviewing ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Dragger {...uploadProps} style={{ background: 'transparent', border: 'none', flex: 1, minHeight: 240 }}>
                  <div style={{ padding: '30px 0' }}>
                    <InboxOutlined style={{ color: '#4d9fff', fontSize: 48 }} />
                    <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 14, marginBottom: 4 }}>拖拽文件到此处</p>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>或点击选择文件</p>
                    <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10, marginTop: 18 }}>支持 .docx / .pdf</p>
                  </div>
                </Dragger>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* 文件信息 */}
                <div style={{ background: 'rgba(82,196,26,0.06)', border: '1px solid rgba(82,196,26,0.15)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                  <div style={{ color: '#52c41a', fontSize: 11, fontWeight: 500, marginBottom: 4 }}>{fileName}</div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{fileSize} · {rawText.length} 字</div>
                  {reviewed && (
                    <div style={{ color: errors.length > 0 ? '#faad14' : '#52c41a', fontSize: 10, marginTop: 4 }}>
                      {errors.length > 0 ? `AI 审核: ${errors.length} 处错别字` : 'AI 审核: 无错别字'}
                    </div>
                  )}
                </div>

                {/* 重新上传 */}
                <Button size="small" icon={<ReloadOutlined />} onClick={handleReset} style={{ marginBottom: 12, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                  重新上传
                </Button>

                <div style={{ flex: 1 }} />

                {/* 操作按钮 */}
                {reviewed && unfixedCount > 0 && (
                  <Button icon={<CheckCircleOutlined />} onClick={handleFixAll} block style={{
                    background: 'rgba(82,196,26,0.12)', border: '1px solid rgba(82,196,26,0.3)', color: '#52c41a',
                    fontWeight: 500, borderRadius: 8, marginBottom: 8, height: 36,
                  }}>
                    一键修改全部（{unfixedCount}）
                  </Button>
                )}
                {hasFile && (
                  <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={handleExport} block style={{
                    background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none', fontWeight: 500, borderRadius: 8, height: 36,
                  }}>
                    导出修改后文档
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 中栏：错别字列表 */}
        <div style={{ width: 300, flexShrink: 0, background: 'rgba(250,173,20,0.03)', border: '1px solid rgba(250,173,20,0.12)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#faad14', fontSize: 12, fontWeight: 500 }}>错别字列表</span>
            <span style={{ marginLeft: 8, color: errors.length > 0 ? '#ff4d4f' : 'rgba(255,255,255,0.3)', fontSize: 11 }}>
              共 {errors.length} 处
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
            {reviewing ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="small" />
                <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>AI 审核中...</div>
              </div>
            ) : !reviewed ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>
                {hasFile ? '等待 AI 审核...' : '上传文档后自动审核'}
              </div>
            ) : errors.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a' }} />
                <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>未发现错别字</div>
              </div>
            ) : (
              errors.map((err) => (
                <div key={err.id} onClick={() => handleJumpToError(err.id)} style={{
                  marginBottom: 8, padding: '10px 12px', cursor: 'pointer',
                  background: err.fixed ? 'rgba(82,196,26,0.05)' : 'rgba(255,77,79,0.05)',
                  border: `1px solid ${err.fixed ? 'rgba(82,196,26,0.15)' : 'rgba(255,77,79,0.15)'}`,
                  borderRadius: 8, transition: 'all 0.2s',
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = err.fixed ? 'rgba(82,196,26,0.3)' : 'rgba(255,77,79,0.3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = err.fixed ? 'rgba(82,196,26,0.15)' : 'rgba(255,77,79,0.15)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: err.fixed ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)',
                      color: err.fixed ? '#52c41a' : '#ff4d4f', fontSize: 10, fontWeight: 500,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {err.fixed ? '✓' : err.id}
                    </span>
                    <span style={{ color: '#ff7875', fontSize: 12, textDecoration: err.fixed ? 'line-through' : 'none', opacity: err.fixed ? 0.5 : 1 }}>{err.original}</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>→</span>
                    <span style={{ color: '#52c41a', fontSize: 12, fontWeight: 500 }}>{err.suggestion}</span>
                  </div>
                  {err.context && (
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, lineHeight: 1.4, marginBottom: 6, padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                      ...{err.context}...
                    </div>
                  )}
                  {!err.fixed && (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <Popconfirm
                        title="修改并加入学习库？"
                        description={`将把「${err.original}」→「${err.suggestion}」加入学习库，后续 AI 审核会自动应用此纠错。`}
                        onConfirm={(e) => { e?.stopPropagation(); handleFixOne(err.id); }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="确认"
                        cancelText="取消"
                      >
                        <Button size="small" type="link" icon={<EditOutlined />} onClick={(e) => e.stopPropagation()} style={{ padding: 0, color: '#4d9fff', fontSize: 11 }}>
                          修改并学习
                        </Button>
                      </Popconfirm>
                      <Popconfirm
                        title="仅采纳为纠错？"
                        description={`将把「${err.original}」→「${err.suggestion}」加入学习库，但保留原文不动。`}
                        onConfirm={(e) => { e?.stopPropagation(); handleAdoptOnly(err.id); }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="确认采纳"
                        cancelText="取消"
                      >
                        <Button size="small" type="link" onClick={(e) => e.stopPropagation()} style={{ padding: 0, color: 'rgba(82,196,26,0.7)', fontSize: 11 }}>
                          仅采纳
                        </Button>
                      </Popconfirm>
                    </div>
                  )}
                  {err.fixed && (
                    <span style={{ fontSize: 10, color: 'rgba(82,196,26,0.6)' }}>✓ 已修改并加入学习库</span>
                  )}
                </div>
              ))
            )}
          </div>

          {reviewed && errors.length > 0 && (
            <div style={{ padding: '8px 16px', background: 'rgba(77,159,255,0.05)', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>已修改 {fixedCount} / {errors.length} · 待确认 {unfixedCount}</span>
            </div>
          )}
        </div>

        {/* 右栏：文档预览 */}
        <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 500 }}>
              <FileTextOutlined style={{ marginRight: 6 }} />
              文档预览（修改后）
            </span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>在线预览 · 实时更新</span>
          </div>
          <div ref={previewRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
            {!hasFile && !reviewing ? (
              <div style={{ textAlign: 'center', padding: 80, color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
                <FileTextOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
                上传文档后此处显示预览
              </div>
            ) : reviewing ? (
              <div style={{ textAlign: 'center', padding: 80 }}>
                <Spin />
                <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>解析文档中...</div>
              </div>
            ) : (
              highlightedContent
            )}
          </div>
        </div>
      </div>

      {/* 管理学习库 Modal */}
      <Modal
        title={
          <span>
            <BookOutlined style={{ color: '#52c41a', marginRight: 8 }} />
            自我学习库管理
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 12, fontWeight: 'normal' }}>
              共 {learnedItems.length} 条已采纳纠错
            </span>
          </span>
        }
        open={manageLibOpen}
        onCancel={() => setManageLibOpen(false)}
        footer={<Button onClick={() => setManageLibOpen(false)}>关闭</Button>}
        width={760}
      >
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(77,159,255,0.05)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 6, fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
          <BulbOutlined style={{ color: '#4d9fff', marginRight: 6 }} />
          这些纠错已在历史审核中被你采纳，下次遇到相同错误会优先识别（按 count 频次排序）。
          误学的条目可点击右侧"移除"按钮清除。count=1 的条目已标灰，可考虑清理。
        </div>
        {/* 搜索框 */}
        <Input
          placeholder="搜索原词或推荐词"
          value={learnedSearch}
          onChange={(e) => setLearnedSearch(e.target.value)}
          allowClear
          size="small"
          style={{ marginBottom: 12 }}
        />
        {learnedItems.length === 0 ? (
          <Empty description="暂无学习数据" />
        ) : (
          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            <List
              size="small"
              dataSource={learnedItems
                .filter((it) => !learnedSearch || it.original.includes(learnedSearch) || it.suggestion.includes(learnedSearch))
                .slice()  // 不修改原数组
                .sort((a, b) => b.count - a.count)}
              renderItem={(item) => (
                <List.Item
                  style={{ opacity: item.count <= 1 ? 0.55 : 1 }}
                  actions={[
                    <Tooltip key="del" title="从学习库移除">
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteLearned(item.original)}
                      >
                        移除
                      </Button>
                    </Tooltip>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <span style={{ fontSize: 13 }}>
                        <span style={{ color: '#ff4d4f', textDecoration: 'line-through' }}>{item.original}</span>
                        {' → '}
                        <span style={{ color: '#52c41a' }}>{item.suggestion}</span>
                      </span>
                    }
                    description={
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                        采纳 {item.count} 次 · 最近 {new Date(item.lastSeen).toLocaleString('zh-CN')} · 来源 {item.source || 'user'}
                      </span>
                    }
                  />
                </List.Item>
              )}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

export default ReportReview;
