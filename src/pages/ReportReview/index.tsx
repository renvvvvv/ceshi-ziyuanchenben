import { useState, useMemo, useCallback } from 'react';
import { Upload, Button, Empty, Spin, Tag, message } from 'antd';
import type { UploadProps } from 'antd';
import {
  InboxOutlined,
  DownloadOutlined,
  EditOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
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
  const [fileName, setFileName] = useState('');
  const [rawText, setRawText] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [errors, setErrors] = useState<TypoError[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 解析文档
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

  // AI 审核
  const reviewText = useCallback(async (text: string) => {
    setReviewing(true);
    setReviewed(false);
    try {
      const res = await fetch('/api/report-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.success) {
        setErrors(data.errors.map((e: TypoError, i: number) => ({ ...e, fixed: false, id: i + 1 })));
        setReviewed(true);
        message.success(`AI 审核完成，发现 ${data.errors.length} 处错别字`);
      } else {
        message.error(data.message || 'AI 审核失败');
      }
    } catch {
      message.error('审核请求失败，请确认后端服务已启动');
    } finally {
      setReviewing(false);
    }
  }, []);

  // 上传处理
  const uploadProps: UploadProps = {
    accept: '.docx,.pdf',
    multiple: false,
    showUploadList: false,
    beforeUpload: async (file) => {
      setFileName(file.name);
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

  // 高亮渲染原文
  const highlightedContent = useMemo(() => {
    if (!rawText) return null;
    if (errors.length === 0) {
      return <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.8 }}>{rawText}</pre>;
    }
    // 按错别字长度降序分割（避免短词破坏长词）
    const unfixedErrors = errors.filter((e) => !e.fixed && e.original);
    const fixedErrors = errors.filter((e) => e.fixed && e.original);
    let segments: Array<{ text: string; type: 'normal' | 'error' | 'fixed'; error?: TypoError }> = [{ text: rawText, type: 'normal' }];

    // 处理未修改的错别字（红色高亮）
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
    // 处理已修改的（绿色）
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
              <span key={i} style={{ background: 'rgba(255,77,79,0.18)', color: '#ff7875', borderBottom: '2px solid #ff4d4f', padding: '1px 3px', borderRadius: 3, cursor: 'pointer' }}>
                {seg.text}
              </span>
            );
          }
          if (seg.type === 'fixed') {
            return (
              <span key={i} style={{ background: 'rgba(82,196,26,0.12)', color: '#52c41a', padding: '1px 3px', borderRadius: 3 }}>
                {seg.text}
              </span>
            );
          }
          return <span key={i} style={{ color: 'rgba(255,255,255,0.75)' }}>{seg.text}</span>;
        })}
      </pre>
    );
  }, [rawText, errors]);

  // 一键修改
  const handleFixAll = () => {
    let text = rawText;
    const updated = errors.map((e) => {
      if (!e.fixed && e.original) {
        text = text.split(e.original).join(e.suggestion);
        return { ...e, fixed: true };
      }
      return e;
    });
    setRawText(text);
    setErrors(updated);
    message.success('已一键修改全部错别字');
  };

  // 单个修改
  const handleFixOne = (id: number) => {
    const err = errors.find((e) => e.id === id);
    if (!err || err.fixed) return;
    setRawText((prev) => prev.split(err.original).join(err.suggestion));
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, fixed: true } : e)));
    message.success(`已修改：「${err.original}」→「${err.suggestion}」`);
  };

  // 导出 docx
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

  const fixedCount = errors.filter((e) => e.fixed).length;
  const unfixedCount = errors.length - fixedCount;

  return (
    <div>
      {/* 页头 */}
      <div className="page-header">
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: '#4d9fff' }} />
            测试报告审核
          </h3>
          <div style={{ marginTop: 8, color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            上传 Word/PDF 测试报告 · AI 自动审核错别字 · 一键修改导出
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {reviewed && unfixedCount > 0 && (
            <Button
              icon={<CheckCircleOutlined />}
              onClick={handleFixAll}
              style={{ background: 'rgba(82,196,26,0.12)', border: '1px solid rgba(82,196,26,0.3)', color: '#52c41a', borderRadius: 8 }}
            >
              一键修改（{unfixedCount}）
            </Button>
          )}
          {rawText && (
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              loading={exporting}
              onClick={handleExport}
              style={{ background: 'linear-gradient(135deg, #4d9fff, #69b1ff)', border: 'none', borderRadius: 8, fontWeight: 500 }}
            >
              导出 Word
            </Button>
          )}
        </div>
      </div>

      {/* 上传区 */}
      {!rawText && !reviewing && (
        <div style={{ marginBottom: 20 }}>
          <Dragger {...uploadProps} style={{ background: 'rgba(77,159,255,0.03)', border: '1px dashed rgba(77,159,255,0.2)', borderRadius: 12 }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined style={{ color: '#4d9fff', fontSize: 48 }} />
            </p>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>拖拽 Word(.docx) / PDF 文档到此处，或点击上传</p>
            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>AI 自动审核全文错别字，支持一键修改和导出</p>
          </Dragger>
        </div>
      )}

      {/* 审核中 */}
      {reviewing && (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>AI 正在审核错别字，请稍候...</div>
        </div>
      )}

      {/* 审核结果 */}
      {rawText && !reviewing && (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 左侧：文档预览 */}
          <div style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 24px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
                <FileTextOutlined style={{ marginRight: 6 }} />
                {fileName}
              </span>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { setRawText(''); setFileName(''); setErrors([]); setReviewed(false); }} style={{ color: 'rgba(255,255,255,0.4)' }}>重新上传</Button>
            </div>
            {highlightedContent}
          </div>

          {/* 右侧：错别字列表 */}
          {reviewed && (
            <div style={{ width: 340, flexShrink: 0, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 500 }}>错别字列表</span>
                <span style={{ marginLeft: 8, color: errors.length > 0 ? '#ff4d4f' : 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                  共 {errors.length} 处
                </span>
              </div>

              {errors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <CheckCircleOutlined style={{ fontSize: 40, color: '#52c41a' }} />
                  <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>未发现错别字，文档质量良好</div>
                </div>
              ) : (
                <>
                  {errors.map((err) => (
                    <div
                      key={err.id}
                      style={{
                        marginBottom: 10,
                        padding: '12px',
                        background: err.fixed ? 'rgba(82,196,26,0.05)' : 'rgba(255,77,79,0.05)',
                        border: `1px solid ${err.fixed ? 'rgba(82,196,26,0.15)' : 'rgba(255,77,79,0.15)'}`,
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', background: err.fixed ? 'rgba(82,196,26,0.2)' : 'rgba(255,77,79,0.2)', color: err.fixed ? '#52c41a' : '#ff4d4f', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 500 }}>
                          {err.fixed ? '✓' : err.id}
                        </span>
                        <span style={{ color: '#ff7875', fontSize: 13, textDecoration: err.fixed ? 'line-through' : 'none', opacity: err.fixed ? 0.5 : 1 }}>{err.original}</span>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>→</span>
                        <span style={{ color: '#52c41a', fontSize: 13, fontWeight: 500 }}>{err.suggestion}</span>
                      </div>
                      {err.context && (
                        <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 1.5, marginBottom: 8, padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                          ...{err.context}...
                        </div>
                      )}
                      {!err.fixed && (
                        <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleFixOne(err.id)} style={{ padding: 0, color: '#4d9fff', fontSize: 12 }}>
                          修改此处
                        </Button>
                      )}
                    </div>
                  ))}
                  <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(77,159,255,0.05)', borderRadius: 6, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                    已修改 {fixedCount} / {errors.length} 处 · 待确认 {unfixedCount} 处
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReportReview;
