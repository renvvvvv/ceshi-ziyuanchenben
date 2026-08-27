import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Upload, Button, Spin, message, Tooltip, Modal, List, Empty, Popconfirm, Input, Progress, ConfigProvider, Tag } from 'antd';
import type { UploadProps } from 'antd';
import { useAuth } from '../../store/AuthContext';
import {
  InboxOutlined, DownloadOutlined, EditOutlined, CheckCircleOutlined,
  FileTextOutlined, ReloadOutlined, BookOutlined, BulbOutlined, DeleteOutlined,
  WarningOutlined, SwapOutlined,
} from '@ant-design/icons';

const { Dragger } = Upload;

interface TypoError {
  id: number;
  original: string;
  suggestion: string;
  context: string;
  fixed: boolean;
}

// 深色 Modal 主题 token
const DARK_MODAL_THEME = {
  token: {
    colorBgElevated: '#15233d',
    colorText: 'rgba(255,255,255,0.85)',
    colorTextSecondary: 'rgba(255,255,255,0.55)',
    colorBorder: 'rgba(255,255,255,0.1)',
    colorBgContainer: '#15233d',
  },
};

function ReportReview() {
  const { logout } = useAuth();
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState('');
  const [rawText, setRawText] = useState('');
  const [originalFile, setOriginalFile] = useState<File | null>(null);
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
  // 审核流程可视化：phase 跟踪当前阶段，elapsed 记录已耗时（秒）
  const [reviewPhase, setReviewPhase] = useState<'idle' | 'parsing' | 'dict' | 'ai' | 'done'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 审核中计时器（每秒 +1）
  useEffect(() => {
    if (reviewPhase === 'parsing' || reviewPhase === 'dict' || reviewPhase === 'ai') {
      const t = setInterval(() => setElapsed((s) => s + 1), 1000);
      return () => clearInterval(t);
    }
  }, [reviewPhase]);

  // 清理阶段定时器
  useEffect(() => () => { if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current); }, []);
  const previewRef = useRef<HTMLDivElement>(null);
  const jumpTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      jumpTimersRef.current.forEach((t) => clearTimeout(t));
      jumpTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    fetch('/api/report-review/learned', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.success) setLearnedSize(d.size); })
      .catch(() => {});
  }, []);

  const openManageLib = async () => {
    try {
      const r = await fetch('/api/report-review/learned', { credentials: 'include' });
      const d = await r.json();
      if (d.success) setLearnedItems(d.items || []);
    } catch {}
    setManageLibOpen(true);
  };

  const handleDeleteLearned = async (original: string) => {
    Modal.confirm({
      title: '从学习库移除',
      content: `确认移除纠错："${original}"？`,
      okText: '移除', okButtonProps: { danger: true }, cancelText: '取消',
      onOk: async () => {
        try {
          const r = await fetch('/api/report-review/learn', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ original }),
          });
          const d = await r.json();
          if (d.success) {
            setLearnedItems((prev) => prev.filter((i) => i.original !== original));
            setLearnedSize(d.remaining);
            message.success(`已移除："${original}"（剩余 ${d.remaining} 条）`);
          } else { message.error(d.message || d.error || '移除失败'); }
        } catch { message.error('网络异常'); }
      },
    });
  };

  const submitLearning = useCallback(async (original: string, suggestion: string) => {
    try {
      const res = await fetch('/api/report-review/learn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ original, suggestion }),
      });
      const data = await res.json();
      if (data.success) { setLearnedSize((s) => s + 1); }
      else { message.warning(data.message || data.error || '该纠错未能加入学习库'); }
    } catch {}
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
    setReviewing(true); setReviewed(false);
    // 流程可视化：先进入词典扫描阶段，3 秒后切入 AI 审核阶段（后端实际是并行/串行一体，此处为展示节奏）
    setReviewPhase('dict');
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current);
    phaseTimerRef.current = setTimeout(() => setReviewPhase((p) => (p === 'dict' ? 'ai' : p)), 3000);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000);
      const res = await fetch('/api/report-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ text }), signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { message.error(data.message || data.error || '登录已失效'); logout(); return; }
      if (res.ok && data.success && Array.isArray(data.errors)) {
        setErrors(data.errors.map((e: TypoError, i: number) => ({ ...e, fixed: false, id: i + 1 })));
        setReviewed(true);
        setReviewPhase('done');
        if (data.stats) setReviewStats(data.stats);
        const strategy = data.stats?.strategy; const textLen = data.stats?.textLength;
        if (strategy === 'hybrid') message.success(`文档 ${textLen} 字，已采用智能审核（词典全量+AI抽审前3万字），发现 ${data.errors.length} 处错别字`);
        else message.success(`AI 审核完成，发现 ${data.errors.length} 处错别字`);
      } else {
        const ruleCount = data.ruleErrorsOnly;
        if (typeof ruleCount === 'number' && ruleCount > 0) message.warning(`${data.message || 'AI 审核异常'}（但词典扫描仍发现 ${ruleCount} 处疑似错别字，建议缩短文档后重试）`);
        else message.error(data.message || data.error || `AI 审核失败（HTTP ${res.status}）`);
        setReviewPhase('idle');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') message.warning('审核超时（180秒），可能文档过长或 AI 服务繁忙，请缩短文档后重试');
      else { const detail = err instanceof Error ? err.message : ''; message.error(detail ? `审核请求失败：${detail}` : '审核请求失败，请确认后端服务已启动'); }
      setReviewPhase('idle');
    } finally { setReviewing(false); }
  }, [logout]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  };

  const uploadProps: UploadProps = {
    accept: '.docx,.pdf', multiple: false, showUploadList: false,
    beforeUpload: async (file) => {
      setFileName(file.name); setFileSize(formatFileSize(file.size));
      setRawText(''); setOriginalFile(file); setErrors([]); setReviewed(false);
      setReviewPhase('parsing'); setElapsed(0);
      try {
        const text = await parseDocument(file);
        setRawText(text);
        message.success(`已解析「${file.name}」（${text.length} 字）`);
        await reviewText(text);
      } catch (err) { console.error(err); message.error('文档解析失败，请检查文件格式'); setReviewPhase('idle'); }
      return false;
    },
  };

  // 高亮渲染预览内容
  const highlightedContent = useMemo(() => {
    if (!rawText) return null;
    if (errors.length === 0) {
      return <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.8 }}>{rawText}</pre>;
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
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.8 }}>
        {segments.map((seg, i) => {
          if (seg.type === 'error') {
            return (
              <span key={i} id={`error-${seg.error?.id}`} onClick={() => setActiveErrorId(seg.error?.id ?? null)}
                style={{ cursor: 'pointer', background: activeErrorId === seg.error?.id ? 'rgba(255,77,79,0.3)' : 'rgba(255,77,79,0.15)', color: '#ff7875', borderBottom: '2px solid #ff4d4f', padding: '1px 3px', borderRadius: 3, transition: 'background 0.3s' }}>
                {seg.text}
              </span>
            );
          }
          if (seg.type === 'fixed') {
            return <span key={i} id={`error-${seg.error?.id}`} style={{ background: 'rgba(82,196,26,0.12)', color: '#52c41a', padding: '1px 3px', borderRadius: 3 }}>{seg.text}</span>;
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
        submitLearning(e.original, e.suggestion);
        return { ...e, fixed: true };
      }
      return e;
    });
    setRawText(text); setErrors(updated);
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

  const handleAdoptOnly = (id: number) => {
    const err = errors.find((e) => e.id === id);
    if (!err) return;
    submitLearning(err.original, err.suggestion);
    message.success(`已采纳为新纠错：「${err.original}」→「${err.suggestion}」`);
  };

  const handleJumpToError = (id: number) => {
    setActiveErrorId(id);
    const t1 = window.setTimeout(() => {
      const el = document.getElementById(`error-${id}`);
      if (el && previewRef.current) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const t2 = window.setTimeout(() => setActiveErrorId(null), 2000);
      jumpTimersRef.current.push(t2);
    }, 100);
    jumpTimersRef.current.push(t1);
  };

  const handleExport = async () => {
    if (!rawText) return;
    setExporting(true);
    try {
      const isDocx = originalFile?.name.toLowerCase().endsWith('.docx');
      if (isDocx && originalFile) {
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(await originalFile.arrayBuffer());
        const docXmlFile = zip.file('word/document.xml');
        if (!docXmlFile) throw new Error('文档结构异常：未找到 word/document.xml');
        let docXml = await docXmlFile.async('string');
        const fixedErrors = errors.filter((e) => e.fixed && e.original && e.suggestion && e.original !== e.suggestion).sort((a, b) => b.original.length - a.original.length);
        if (fixedErrors.length > 0) {
          const runRe = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g;
          const textTagRe = /<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g;
          for (const err of fixedErrors) {
            docXml = docXml.replace(textTagRe, (match, attrs, text) => {
              if (!text.includes(err.original)) return match;
              const newText = text.split(err.original).join(err.suggestion);
              const escapedNewText = newText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const attrStr = attrs || '';
              const needPreserve = /^\s|\s$/.test(newText) ? ' xml:space="preserve"' : '';
              const finalAttrs = needPreserve && !/xml:space/.test(attrStr) ? attrStr + needPreserve : attrStr;
              return `<w:t${finalAttrs}>${escapedNewText}</w:t>`;
            });
          }
          for (const err of fixedErrors) {
            let m: RegExpExecArray | null;
            const globalRunRe = new RegExp(runRe.source, 'g');
            const matches: Array<{ start: number; end: number; content: string }> = [];
            while ((m = globalRunRe.exec(docXml)) !== null) matches.push({ start: m.index, end: m.index + m[0].length, content: m[0] });
            for (let i = 0; i < matches.length - 1; i++) {
              const run1Content = matches[i].content; const run2Content = matches[i + 1].content;
              const text1Match = run1Content.match(textTagRe); const text2Match = run2Content.match(textTagRe);
              if (!text1Match || !text2Match) continue;
              const text1 = text1Match[0].replace(textTagRe, '$2'); const text2 = text2Match[0].replace(textTagRe, '$2');
              const combined = text1 + text2;
              if (!combined.includes(err.original)) continue;
              const newCombined = combined.split(err.original).join(err.suggestion);
              const escapedNew = newCombined.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              const attrs1 = (text1Match[0].match(/<w:t(\s[^>]*)?>/) || [, ''])[1] || '';
              const attrs2 = (text2Match[0].match(/<w:t(\s[^>]*)?>/) || [, ''])[1] || '';
              const needPreserve1 = /^\s|\s$/.test(newCombined) ? ' xml:space="preserve"' : '';
              const finalAttrs1 = needPreserve1 && !/xml:space/.test(attrs1) ? attrs1 + needPreserve1 : attrs1;
              const newRun1 = run1Content.replace(textTagRe, `<w:t${finalAttrs1}>${escapedNew}</w:t>`);
              const newRun2 = run2Content.replace(textTagRe, `<w:t${attrs2}></w:t>`);
              docXml = docXml.slice(0, matches[i].start) + newRun1 + docXml.slice(matches[i].end, matches[i + 1].start) + newRun2 + docXml.slice(matches[i + 1].end);
              break;
            }
          }
        }
        zip.file('word/document.xml', docXml);
        const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `审核后_${fileName.replace(/\.[^.]+$/, '')}.docx`; a.click();
        URL.revokeObjectURL(url);
        message.success('已导出 Word 文档（保留原排版样式）');
      } else {
        const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
        const lines = rawText.split('\n');
        const paragraphs = lines.map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return new Paragraph({ children: [] });
          const isHeading = trimmed.length <= 20 && !/[，。；！？、,.!?;:]/.test(trimmed);
          return new Paragraph({ heading: isHeading ? HeadingLevel.HEADING_2 : undefined, children: [new TextRun({ text: trimmed, font: '微软雅黑', size: isHeading ? 32 : 24, bold: isHeading })], spacing: { after: isHeading ? 120 : 60 } });
        });
        const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `审核后_${fileName.replace(/\.[^.]+$/, '')}.docx`; a.click();
        URL.revokeObjectURL(url);
        message.success('已导出 Word 文档（PDF 源文件无法保留原样式，已按段落格式导出）');
      }
    } catch (err) { console.error(err); message.error(err instanceof Error ? `导出失败：${err.message}` : '导出失败'); }
    finally { setExporting(false); }
  };

  const handleReset = () => {
    setFileName(''); setFileSize(''); setRawText(''); setOriginalFile(null); setErrors([]); setReviewed(false);
    setReviewPhase('idle'); setElapsed(0);
  };

  const fixedCount = errors.filter((e) => e.fixed).length;
  const unfixedCount = errors.length - fixedCount;
  const hasFile = !!rawText;
  const fixProgress = errors.length > 0 ? Math.round((fixedCount / errors.length) * 100) : 0;

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* ===== 顶部统一信息条 ===== */}
      <TopBar
        hasFile={hasFile} reviewing={reviewing} reviewed={reviewed}
        fileName={fileName} fileSize={fileSize} rawTextLen={rawText.length}
        errors={errors} fixedCount={fixedCount} unfixedCount={unfixedCount} fixProgress={fixProgress}
        reviewStats={reviewStats} learnedSize={learnedSize}
        exporting={exporting} phase={reviewPhase} elapsed={elapsed}
        onExport={handleExport} onReset={handleReset}
        onFixAll={handleFixAll} onManageLib={openManageLib}
      />

      {/* ===== 双栏主体（解析/审核中也进入，保证流程可视化全程可见）===== */}
      {hasFile || reviewing || reviewPhase === 'parsing' ? (
        <div style={{ flex: 1, display: 'flex', gap: 12, minHeight: 0, marginTop: 12 }}>
          {/* 左侧：错别字列表 */}
          <ErrorList
            errors={errors} reviewing={reviewing} reviewed={reviewed} hasFile={hasFile}
            fixedCount={fixedCount} activeErrorId={activeErrorId}
            phase={reviewPhase} elapsed={elapsed}
            onJump={handleJumpToError} onFix={handleFixOne} onAdopt={handleAdoptOnly}
          />
          {/* 右侧：文档预览 */}
          <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600 }}>
                <FileTextOutlined style={{ marginRight: 8, color: '#4d9fff' }} />
                文档预览
              </span>
              {reviewed && errors.length > 0 && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  红色 = 错别字 · 绿色 = 已修改
                </span>
              )}
            </div>
            <div ref={previewRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
              {reviewing ? (
                <ReviewFlow phase={reviewPhase} fileName={fileName} fileSize={fileSize} textLen={rawText.length} elapsed={elapsed} />
              ) : highlightedContent}
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== 空态：上传引导 ===== */}
      {!hasFile && !reviewing && reviewPhase !== 'parsing' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
          <div style={{ width: '100%', maxWidth: 560 }}>
            <Dragger {...uploadProps} style={{ background: 'rgba(77,159,255,0.02)', borderRadius: 12 }}>
              <div style={{ padding: '50px 20px' }}>
                <InboxOutlined style={{ color: '#4d9fff', fontSize: 56, marginBottom: 16 }} />
                <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
                  拖拽测试报告到此处，或点击选择
                </p>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                  支持 .docx / .pdf 格式 · 上传后自动审核
                </p>
              </div>
            </Dragger>
          </div>
        </div>
      )}

      {/* ===== 学习库管理 Modal（深色主题）===== */}
      <ConfigProvider theme={DARK_MODAL_THEME}>
        <Modal
          title={<span><BookOutlined style={{ color: '#52c41a', marginRight: 8 }} />自我学习库管理<span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginLeft: 12, fontWeight: 'normal' }}>共 {learnedItems.length} 条</span></span>}
          open={manageLibOpen} onCancel={() => setManageLibOpen(false)}
          footer={<Button onClick={() => setManageLibOpen(false)}>关闭</Button>} width={720}
        >
          <div style={{ marginBottom: 12, padding: '10px 14px', background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 8, fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7 }}>
            <BulbOutlined style={{ color: '#4d9fff', marginRight: 6 }} />
            这些纠错已在历史审核中被采纳，下次遇到相同错误会优先识别。误学的条目可点击"移除"清除。
          </div>
          <Input placeholder="搜索原词或推荐词" value={learnedSearch} onChange={(e) => setLearnedSearch(e.target.value)} allowClear style={{ marginBottom: 12 }} />
          {learnedItems.length === 0 ? <Empty description="暂无学习数据" /> : (
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              <List dataSource={learnedItems.filter((it) => !learnedSearch || it.original.includes(learnedSearch) || it.suggestion.includes(learnedSearch)).slice().sort((a, b) => b.count - a.count)}
                renderItem={(item) => (
                  <List.Item style={{ opacity: item.count <= 1 ? 0.55 : 1, borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                    actions={[<Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteLearned(item.original)}>移除</Button>]}>
                    <List.Item.Meta
                      title={<span style={{ fontSize: 13 }}><span style={{ color: '#ff7875', textDecoration: 'line-through' }}>{item.original}</span><SwapOutlined style={{ color: 'rgba(255,255,255,0.4)', margin: '0 8px', fontSize: 11 }} /><span style={{ color: '#52c41a' }}>{item.suggestion}</span></span>}
                      description={<span style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>采纳 {item.count} 次 · 最近 {new Date(item.lastSeen).toLocaleString('zh-CN')} · 来源 {item.source || 'user'}</span>}
                    />
                  </List.Item>
                )}
              />
            </div>
          )}
        </Modal>
      </ConfigProvider>
    </div>
  );
}

// ============== 审核流程可视化组件 ==============
function ReviewFlow(props: {
  phase: 'idle' | 'parsing' | 'dict' | 'ai' | 'done';
  fileName: string; fileSize: string; textLen: number; elapsed: number;
}) {
  const { phase, fileName, fileSize, textLen, elapsed } = props;
  if (phase === 'idle') return null;

  const steps = [
    { key: 'upload', icon: <InboxOutlined />, label: '上传文档', desc: fileName ? `${fileName} · ${fileSize}` : '' },
    { key: 'parse', icon: <FileTextOutlined />, label: '解析内容', desc: textLen > 0 ? `${textLen.toLocaleString()} 字` : '' },
    { key: 'dict', icon: <BookOutlined />, label: '词典扫描', desc: '300+ 类常见错字' },
    { key: 'ai', icon: <BulbOutlined />, label: 'AI 智能审核', desc: textLen > 30000 ? '长文档 · 智能抽审' : '全量精审' },
    { key: 'done', icon: <CheckCircleOutlined />, label: '汇总结果', desc: '' },
  ];
  const phaseIdx: Record<string, number> = { parsing: 1, dict: 2, ai: 3, done: 5 };
  const activeIdx = phaseIdx[phase] ?? 0; // parsing 时高亮"解析内容"，dict→词典，ai→AI，done→全部完成
  const isFinished = phase === 'done';

  // 深度审核提示文案（根据文档长度与耗时动态变化）
  const phaseHint = phase === 'parsing' ? '正在提取文档内容...'
    : phase === 'dict' ? '正在使用错字词典快速扫描全文...'
    : phase === 'ai' ? (elapsed > 30 ? 'AI 深度审核中，长文档需要更多时间，请耐心等待...' : 'AI 正在逐段深度审核...')
    : '审核完成';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 380, padding: '40px 24px' }}>
      {/* 文档卡片 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '14px 22px', marginBottom: 44,
        background: 'rgba(77,159,255,0.05)', border: '1px solid rgba(77,159,255,0.15)', borderRadius: 12,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(77,159,255,0.12)', color: '#4d9fff', fontSize: 20,
        }}><FileTextOutlined /></div>
        <div>
          <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: 600, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {fileName}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 3 }}>
            {fileSize}{textLen > 0 ? ` · ${textLen.toLocaleString()} 字` : ''}
            {!isFinished && phase !== 'parsing' ? ` · 已用时 ${elapsed}s` : ''}
          </div>
        </div>
      </div>

      {/* 步骤流程条 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', maxWidth: 720 }}>
        {steps.map((s, i) => {
          const stepState = i < activeIdx || isFinished ? 'finish' : i === activeIdx ? 'active' : 'wait';
          return (
            <div key={s.key} style={{ flex: i === steps.length - 1 ? '0 0 auto' : 1, display: 'flex', alignItems: 'flex-start' }}>
              {/* 步骤节点 */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 64 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 17, transition: 'all 0.4s',
                  background: stepState === 'finish' ? 'rgba(82,196,26,0.15)'
                    : stepState === 'active' ? 'rgba(77,159,255,0.18)'
                    : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${stepState === 'finish' ? 'rgba(82,196,26,0.5)'
                    : stepState === 'active' ? '#4d9fff'
                    : 'rgba(255,255,255,0.12)'}`,
                  color: stepState === 'finish' ? '#52c41a'
                    : stepState === 'active' ? '#4d9fff'
                    : 'rgba(255,255,255,0.25)',
                  boxShadow: stepState === 'active' ? '0 0 0 0 rgba(77,159,255,0.35)' : 'none',
                  animation: stepState === 'active' ? 'reviewPulse 1.6s ease-out infinite' : 'none',
                }}>{s.icon}</div>
                <div style={{
                  marginTop: 8, fontSize: 12, fontWeight: stepState === 'active' ? 600 : 400, textAlign: 'center',
                  color: stepState === 'finish' ? 'rgba(82,196,26,0.9)'
                    : stepState === 'active' ? '#7cb8ff'
                    : 'rgba(255,255,255,0.35)',
                }}>{s.label}</div>
                {s.desc && stepState !== 'wait' && (
                  <div style={{ marginTop: 2, fontSize: 10.5, color: 'rgba(255,255,255,0.3)', textAlign: 'center', maxWidth: 80, lineHeight: 1.4 }}>{s.desc}</div>
                )}
              </div>
              {/* 连接线 */}
              {i < steps.length - 1 && (
                <div style={{ flex: 1, height: 1.5, marginTop: 20, margin: '20px 4px 0', background: i < activeIdx || isFinished ? 'rgba(82,196,26,0.4)' : 'rgba(255,255,255,0.08)', transition: 'background 0.4s' }} />
              )}
            </div>
          );
        })}
      </div>

      {/* 阶段提示 + 进度光带 */}
      <div style={{ marginTop: 36, width: '100%', maxWidth: 560, textAlign: 'center' }}>
        <div style={{
          color: isFinished ? '#52c41a' : 'rgba(255,255,255,0.65)', fontSize: 13.5, fontWeight: 500,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {!isFinished && phase !== 'parsing' && <Spin size="small" />}
          {phaseHint}
        </div>
        {/* 动态进度条（未完成时流动光带） */}
        <div style={{
          marginTop: 16, height: 4, borderRadius: 2, overflow: 'hidden',
          background: 'rgba(255,255,255,0.06)',
        }}>
          {isFinished ? (
            <div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, rgba(82,196,26,0.7), #52c41a)', borderRadius: 2, transition: 'width 0.6s' }} />
          ) : (
            <div style={{
              width: '36%', height: '100%', borderRadius: 2,
              background: 'linear-gradient(90deg, transparent, #4d9fff, transparent)',
              animation: 'reviewFlow 1.8s ease-in-out infinite',
            }} />
          )}
        </div>
      </div>

      {/* 呼吸点动画 keyframes */}
      <style>{`
        @keyframes reviewPulse {
          0% { box-shadow: 0 0 0 0 rgba(77,159,255,0.35); }
          70% { box-shadow: 0 0 0 10px rgba(77,159,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(77,159,255,0); }
        }
        @keyframes reviewFlow {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  );
}

// ============== 顶部信息条组件 ==============
function TopBar(props: {
  hasFile: boolean; reviewing: boolean; reviewed: boolean;
  fileName: string; fileSize: string; rawTextLen: number;
  errors: TypoError[]; fixedCount: number; unfixedCount: number; fixProgress: number;
  reviewStats: { aiErrors: number; ruleErrors: number; merged: number }; learnedSize: number;
  exporting: boolean; phase?: string; elapsed?: number;
  onExport: () => void; onReset: () => void; onFixAll: () => void; onManageLib: () => void;
}) {
  const { hasFile, reviewing, reviewed, fileName, fileSize, rawTextLen, errors, fixedCount, unfixedCount, fixProgress, reviewStats, learnedSize, exporting, phase, elapsed, onExport, onReset, onFixAll, onManageLib } = props;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, rowGap: 10, padding: '14px 18px',
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12,
    }}>
      {/* 文件信息 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <FileTextOutlined style={{ fontSize: 22, color: reviewed ? '#52c41a' : '#4d9fff' }} />
        <div>
          <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 14, fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hasFile ? fileName : '测试报告审核'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 }}>
            {hasFile ? `${fileSize} · ${rawTextLen.toLocaleString()} 字` : '上传 Word/PDF 报告，AI 自动审核错别字'}
          </div>
        </div>
      </div>

      <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.08)' }} />

      {/* 审核统计 */}
      {reviewing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spin size="small" />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
            {phase === 'parsing' ? '解析文档中...' : phase === 'dict' ? '词典扫描中...' : `AI 深度审核中... ${elapsed != null ? `${elapsed}s` : ''}`}
          </span>
        </div>
      ) : reviewed ? (
        <>
          {/* 错别字数量 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {errors.length > 0 ? (
              <Tag color="error" style={{ fontSize: 13, padding: '2px 10px', borderRadius: 6, margin: 0 }}>{errors.length} 处错别字</Tag>
            ) : (
              <Tag color="success" style={{ fontSize: 13, padding: '2px 10px', borderRadius: 6, margin: 0 }}><CheckCircleOutlined /> 未发现错别字</Tag>
            )}
            {reviewStats.merged > 0 && (
              <Tooltip title={`AI 检出 ${reviewStats.aiErrors} / 词典 ${reviewStats.ruleErrors} / 去重 ${reviewStats.merged}`}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, cursor: 'help', whiteSpace: 'nowrap' }}>（AI {reviewStats.aiErrors} · 词典 {reviewStats.ruleErrors}）</span>
              </Tooltip>
            )}
          </div>

          {/* 修复进度条 */}
          {errors.length > 0 && (
            <div style={{ flex: '1 1 160px', maxWidth: 280, minWidth: 140, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Progress percent={fixProgress} size="small" strokeColor={fixProgress === 100 ? '#52c41a' : '#4d9fff'} trailColor="rgba(255,255,255,0.08)" style={{ flex: 1, margin: 0, minWidth: 0 }} />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, whiteSpace: 'nowrap' }}>{fixedCount}/{errors.length}</span>
            </div>
          )}

          {/* 操作按钮组：整体不可压缩、不换行，空间不足时随外层换行到下一行，绝不与数据重叠 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0, flexWrap: 'nowrap' }}>
            <Tooltip title="点击管理已学习的纠错">
              <Button size="middle" icon={<BookOutlined />} onClick={onManageLib} style={{ borderRadius: 8, color: 'rgba(255,255,255,0.65)', borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(82,196,26,0.06)', flexShrink: 0 }}>
                学习库 {learnedSize}
              </Button>
            </Tooltip>
            {unfixedCount > 0 && (
              <Popconfirm title="一键修改全部错别字？" description={`将修改 ${unfixedCount} 处错别字并加入学习库，此操作不可撤销。`} onConfirm={onFixAll} okText="确认修改" cancelText="取消" okButtonProps={{ style: { background: '#faad14', borderColor: '#faad14' } }}>
                <Button icon={<WarningOutlined />} style={{ borderRadius: 8, borderColor: 'rgba(250,173,20,0.4)', color: '#faad14', background: 'rgba(250,173,20,0.08)', flexShrink: 0 }}>
                  一键修改（{unfixedCount}）
                </Button>
              </Popconfirm>
            )}
            <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={onExport} style={{ borderRadius: 8, fontWeight: 500, flexShrink: 0 }}>导出文档</Button>
            <Button icon={<ReloadOutlined />} onClick={onReset} style={{ borderRadius: 8, color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.1)', flexShrink: 0 }}>重新上传</Button>
          </div>
        </>
      ) : hasFile ? null : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexShrink: 0 }}>
          <Tooltip title="点击管理已学习的纠错">
            <Button size="middle" icon={<BookOutlined />} onClick={onManageLib} style={{ borderRadius: 8, color: 'rgba(255,255,255,0.65)', borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(82,196,26,0.06)', flexShrink: 0 }}>
              学习库 {learnedSize}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ============== 错别字列表组件 ==============
function ErrorList(props: {
  errors: TypoError[]; reviewing: boolean; reviewed: boolean; hasFile: boolean;
  fixedCount: number; activeErrorId: number | null; phase?: string; elapsed?: number;
  onJump: (id: number) => void; onFix: (id: number) => void; onAdopt: (id: number) => void;
}) {
  const { errors, reviewing, reviewed, hasFile, activeErrorId, phase, elapsed, onJump, onFix, onAdopt } = props;
  const phaseText = phase === 'parsing' ? '解析文档中...'
    : phase === 'dict' ? '词典扫描中...'
    : phase === 'ai' ? `AI 深度审核中... ${elapsed != null ? `(${elapsed}s)` : ''}`
    : 'AI 审核中...';

  return (
    <div style={{ width: 340, flexShrink: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600 }}>错别字列表</span>
        {reviewed && (
          <span style={{ color: errors.length > 0 ? '#ff7875' : 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: 500 }}>
            {errors.length > 0 ? `${errors.length} 处` : '无'}
          </span>
        )}
      </div>

      {/* body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {reviewing ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin size="small" />
            <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>{phaseText}</div>
          </div>
        ) : !reviewed ? (
          <div style={{ textAlign: 'center', padding: 50, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
            {hasFile ? '等待 AI 审核...' : '上传文档后自动审核'}
          </div>
        ) : errors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <CheckCircleOutlined style={{ fontSize: 36, color: '#52c41a' }} />
            <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>未发现错别字</div>
          </div>
        ) : (
          errors.map((err) => (
            <div key={err.id} onClick={() => onJump(err.id)} style={{
              marginBottom: 10, padding: '12px 14px', cursor: 'pointer', borderRadius: 8, transition: 'all 0.2s',
              background: activeErrorId === err.id ? (err.fixed ? 'rgba(82,196,26,0.12)' : 'rgba(255,77,79,0.12)') : (err.fixed ? 'rgba(82,196,26,0.05)' : 'rgba(255,77,79,0.04)'),
              border: `1px solid ${activeErrorId === err.id ? (err.fixed ? 'rgba(82,196,26,0.3)' : 'rgba(255,77,79,0.3)') : (err.fixed ? 'rgba(82,196,26,0.12)' : 'rgba(255,77,79,0.12)')}`,
            }}>
              {/* 序号 + 原文 → 建议 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  minWidth: 22, height: 22, borderRadius: 4, padding: '0 6px', fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: err.fixed ? 'rgba(82,196,26,0.15)' : 'rgba(255,77,79,0.15)',
                  color: err.fixed ? '#52c41a' : '#ff7875',
                }}>
                  {err.fixed ? '✓' : err.id}
                </span>
                <span style={{ color: '#ff7875', fontSize: 13, textDecoration: err.fixed ? 'line-through' : 'none', opacity: err.fixed ? 0.5 : 1 }}>{err.original}</span>
                <SwapOutlined style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }} />
                <span style={{ color: '#52c41a', fontSize: 13, fontWeight: 500 }}>{err.suggestion}</span>
              </div>

              {/* 上下文 */}
              {err.context && (
                <div style={{
                  color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.5, marginBottom: 8,
                  padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 4,
                  overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>
                  ...{err.context}...
                </div>
              )}

              {/* 操作 */}
              {!err.fixed && (
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <Popconfirm title="修改并加入学习库？" description={`「${err.original}」→「${err.suggestion}」`} onConfirm={(e) => { e?.stopPropagation(); onFix(err.id); }} onCancel={(e) => e?.stopPropagation()} okText="确认" cancelText="取消">
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={(e) => e.stopPropagation()} style={{ padding: 0, color: '#4d9fff', fontSize: 12, fontWeight: 500 }}>修改</Button>
                  </Popconfirm>
                  <Popconfirm title="仅采纳为纠错？" description="加入学习库但保留原文" onConfirm={(e) => { e?.stopPropagation(); onAdopt(err.id); }} onCancel={(e) => e?.stopPropagation()} okText="确认" cancelText="取消">
                    <Button size="small" type="link" onClick={(e) => e.stopPropagation()} style={{ padding: 0, color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>仅采纳</Button>
                  </Popconfirm>
                </div>
              )}
              {err.fixed && <span style={{ fontSize: 12, color: 'rgba(82,196,26,0.7)' }}>✓ 已修改并加入学习库</span>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default ReportReview;
