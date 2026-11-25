import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Input,
  Tag,
  Empty,
  Button,
  Modal,
  Upload,
  Form,
  Select,
  message,
  Popconfirm,
  Tooltip,
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  EyeOutlined,
  SearchOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  UploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  CloudUploadOutlined,
  ReloadOutlined,
  ExportOutlined,
} from '@ant-design/icons';
import { useData } from '../../store/DataContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { TestDoc } from '../../types';

const { Option } = Select;

const getFileIcon = (fileType?: string, size = 18) => {
  const t = fileType?.toLowerCase();
  if (t === 'pdf') return <FilePdfOutlined style={{ fontSize: size, color: '#dc2626' }} />;
  if (t === 'doc' || t === 'docx') return <FileWordOutlined style={{ fontSize: size, color: '#6366f1' }} />;
  if (t === 'xls' || t === 'xlsx') return <FileExcelOutlined style={{ fontSize: size, color: '#16a34a' }} />;
  if (t === 'jpg' || t === 'jpeg' || t === 'png') return <FileImageOutlined style={{ fontSize: size, color: '#7c3aed' }} />;
  return <FileOutlined style={{ fontSize: size, color: '#8c8c8c' }} />;
};

function TestGuide() {
  const isMobile = useIsMobile();
  const { testDocs: docs, setTestDocs: setDocs, docCategoriesList: docCategories } = useData();
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePreviewDoc, setMobilePreviewDoc] = useState<TestDoc | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const uploadingRef = useRef(false); // 上传期间挂起轮询，防止在途轮询响应覆盖刚上传的文档
  // 本机刚上传、服务器列表里还没出现的文档：只有这些才在轮询合并时暂时保留
  const pendingUploadIdsRef = useRef<Set<string>>(new Set());
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const filteredDocs = useMemo(() => {
    return docs.filter((doc) => {
      if (selectedCategory !== '全部' && doc.category !== selectedCategory) return false;
      if (searchText) {
        const kw = searchText.toLowerCase();
        const inTitle = doc.title.toLowerCase().includes(kw);
        const inContent = (doc.content || '').toLowerCase().includes(kw);
        if (!inTitle && !inContent) return false;
      }
      return true;
    });
  }, [selectedCategory, searchText, docs]);

  // 默认选中第一个文件：进入页面即直接看到文档内容
  useEffect(() => {
    if (filteredDocs.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!filteredDocs.some((d) => d.id === selectedId)) {
      setSelectedId(filteredDocs[0].id);
    }
  }, [filteredDocs, selectedId]);

  // 多端同步：30 秒轮询最新列表（其他账号上传/删除的文档自动出现/消失，无需刷新页面）
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return; // 页面在后台时跳过
      if (uploadingRef.current) return; // 上传进行中：这一轮不拉，防在途的上传被下一轮列表覆盖
      try {
        const res = await fetch('/api/test-docs', { credentials: 'include' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setDocs((prev) => {
            // 以服务器为准。只有“本机刚上传、服务器列表里还没出现”的文档才暂时保留（防上传与轮询竞态）。
            // 此前保留的是“本地有、服务器没有”的全部文档——别人删掉的文档正好落在这个范围里，
            // 在本机列表里永远不会消失，点开是 404
            const ids = new Set(data.data.map((d: TestDoc) => d.id));
            for (const id of pendingUploadIdsRef.current) if (ids.has(id)) pendingUploadIdsRef.current.delete(id);
            const localOnly = prev.filter((d) => !ids.has(d.id) && pendingUploadIdsRef.current.has(d.id));
            return [...localOnly, ...data.data];
          });
        }
      } catch { /* 网络抖动忽略，下轮再试 */ }
    }, 30000);
    return () => clearInterval(timer);
  }, [setDocs]);

  const selectedDoc = filteredDocs.find((d) => d.id === selectedId) || null;
  const previewUrl = (id: string) => `/api/test-docs/${id}/preview`;

  const [uploading, setUploading] = useState(false);

  const handleUpload = () => {
    uploadForm.validateFields().then(async (values) => {
      if (fileList.length === 0) {
        message.error('请选择要上传的文件');
        return;
      }
      const file = fileList[0];
      const rawFile = file.originFileObj;
      if (!rawFile) return;

      setUploading(true);
      uploadingRef.current = true;
      try {
        // 上传到后端（multipart/form-data）
        const formData = new FormData();
        formData.append('file', rawFile);
        formData.append('title', values.title || file.name);
        formData.append('category', values.category);
        formData.append('description', values.description || '');

        const res = await fetch('/api/test-docs/upload', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        const data = await res.json().catch(() => ({}));
        if (data.success && data.data) {
          pendingUploadIdsRef.current.add(data.data.id);
          setDocs((prev) => [data.data, ...prev]);
          setSelectedId(data.data.id); // 上传完成直接展示新文档
          setIframeKey((k) => k + 1);
          message.success('文件上传成功，已为您展示');
          setUploadModalOpen(false);
          uploadForm.resetFields();
          setFileList([]);
        } else {
          message.error(data.message || '上传失败');
        }
      } catch (err) {
        message.error('上传失败，请检查网络');
      } finally {
        setUploading(false);
        uploadingRef.current = false;
      }
    }).catch(() => { /* 校验失败信息已由表单展示，reject 不再进控制台 */ });
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/test-docs/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setDocs((prev) => prev.filter((d) => d.id !== id));
        message.success('文件已删除');
      } else {
        // 删除失败保留列表行（服务器数据为准，30s 轮询不会出现"删了又复活"的误导）
        message.error(data.message || data.error || '删除失败（可能无权限）');
      }
    } catch {
      message.error('网络错误，删除失败，请重试');
    }
  };

  const handleDownload = (doc: TestDoc) => {
    if (doc.fileUrl) {
      const a = document.createElement('a');
      a.href = doc.fileUrl;
      a.target = '_blank';
      a.click();
    } else {
      message.info('该文件无下载链接');
    }
  };

  const categoryColors: Record<string, string> = {
    '电气系统': '#d97706',
    '暖通系统': '#16a34a',
    '弱电系统': '#6366f1',
    '消防系统': '#ec4899',
  };

  // ── 左侧文件列表条目 ──
  const DocListItem = ({ doc }: { doc: TestDoc }) => {
    const active = doc.id === selectedId;
    return (
      <div
        onClick={() => {
          if (doc.id === selectedId) return; // 点击当前阅读中的文档不重新挂载 iframe（保留滚动位置）
          setSelectedId(doc.id);
          setIframeKey((k) => k + 1);
          setIframeLoading(true);
        }}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '10px 12px',
          borderRadius: 8,
          cursor: 'pointer',
          background: active ? 'rgba(99,102,241,0.10)' : 'transparent',
          border: active ? '1px solid rgba(99,102,241,0.35)' : '1px solid transparent',
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!active) (e.currentTarget as HTMLElement).style.background = '#f6f5fc';
        }}
        onMouseLeave={(e) => {
          if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        {getFileIcon(doc.fileType)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              color: active ? '#6366f1' : 'var(--text-primary)',
              fontFamily: 'var(--font-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={doc.title}
          >
            {doc.title}
          </div>
          <div style={{ fontSize: 11, color: '#9d9ab8', display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
            <span style={{ color: categoryColors[doc.category] || '#6366f1' }}>● {doc.category}</span>
            {doc.fileSize && <span>{doc.fileSize}</span>}
          </div>
        </div>
        <Popconfirm
          title="确认删除"
          description={`确定要删除"${doc.title}"吗？`}
          onConfirm={(e) => {
            e?.stopPropagation();
            handleDelete(doc.id);
          }}
          okText="确认"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#f87171' }}
          />
        </Popconfirm>
      </div>
    );
  };

  // ── 右侧预览区工具条 ──
  const PreviewToolbar = ({ doc }: { doc: TestDoc }) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderBottom: 'none',
        borderRadius: '12px 12px 0 0',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
        {getFileIcon(doc.fileType, 16)}
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={doc.title}
        >
          {doc.title}
        </span>
        <Tag
          style={{
            background: `${categoryColors[doc.category] || '#6366f1'}18`,
            border: `1px solid ${categoryColors[doc.category] || '#6366f1'}33`,
            color: categoryColors[doc.category] || '#6366f1',
            fontSize: 11,
            borderRadius: 4,
            padding: '0 8px',
            lineHeight: '18px',
            marginInlineEnd: 0,
          }}
        >
          {doc.category}
        </Tag>
        <span style={{ fontSize: 11, color: '#9d9ab8', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <ClockCircleOutlined />
          {doc.lastUpdated} · {doc.fileSize}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Tooltip title="刷新预览（Office 文档首次打开需转换，loading 页会自动刷新）">
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => setIframeKey((k) => k + 1)}
            style={{ color: '#6b6892' }}
          />
        </Tooltip>
        <Tooltip title="新窗口打开">
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            onClick={() => window.open(previewUrl(doc.id), '_blank')}
            style={{ color: '#6b6892' }}
          />
        </Tooltip>
        <Tooltip title="下载原文件">
          <Button
            type="text"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => handleDownload(doc)}
            style={{ color: '#6366f1' }}
          />
        </Tooltip>
      </div>
    </div>
  );

  return (
    <div>
      {/* 页面标题 */}
      <div
        style={{
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--font-primary)',
              fontWeight: 600,
              fontSize: 20,
              color: 'var(--text-primary)',
              letterSpacing: '0.5px',
            }}
          >
            测试管理制度
          </h3>
          <p
            style={{
              color: '#6b6892',
              marginTop: 6,
              fontSize: 13,
              fontFamily: 'var(--font-primary)',
            }}
          >
            点击左侧文件直接阅读 · Office 文档自动转换为在线预览
          </p>
        </div>
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          onClick={() => setUploadModalOpen(true)}
          style={{
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            height: 38,
            boxShadow: '0 4px 12px rgba(99,102,241,0.25)',
          }}
        >
          上传文件
        </Button>
      </div>

      {isMobile ? (
        /* ── 移动端：列表卡片 + 点击全屏预览 ── */
        <>
          <Input
            placeholder="搜索文件名称或内容"
            prefix={<SearchOutlined style={{ color: '#9d9ab8' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ marginBottom: 12, background: '#f8f7fd', border: '1px solid #e9e7f4', borderRadius: 8 }}
            allowClear
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {docCategories.map((cat) => (
              <Tag.CheckableTag
                key={cat}
                checked={selectedCategory === cat}
                onChange={() => setSelectedCategory(cat)}
                style={{
                  padding: '4px 14px',
                  borderRadius: 20,
                  fontSize: 12,
                  border: selectedCategory === cat ? '1px solid rgba(99,102,241,0.5)' : '1px solid #e9e7f4',
                  background: selectedCategory === cat ? 'rgba(99,102,241,0.18)' : '#f6f5fc',
                  color: selectedCategory === cat ? '#6366f1' : '#46436a',
                }}
              >
                {cat}
              </Tag.CheckableTag>
            ))}
          </div>
          {filteredDocs.length === 0 ? (
            <Empty description="暂无匹配的文件" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ color: '#6b6892', marginTop: 60 }} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => setMobilePreviewDoc(doc)}
                  style={{
                    background: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {getFileIcon(doc.fileType, 24)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-primary)' }}>
                      {doc.title}
                    </div>
                    <div style={{ fontSize: 11, color: '#9d9ab8', marginTop: 2 }}>
                      {doc.category} · {doc.fileSize} · {doc.lastUpdated}
                    </div>
                  </div>
                  <EyeOutlined style={{ color: '#6366f1' }} />
                </div>
              ))}
            </div>
          )}
          <Modal
            open={!!mobilePreviewDoc}
            onCancel={() => setMobilePreviewDoc(null)}
            footer={null}
            width="100%"
            style={{ top: 8, maxWidth: '100vw', padding: 0 }}
            title={mobilePreviewDoc?.title || '预览'}
            destroyOnClose
            styles={{
              content: { borderRadius: 12, padding: 0 },
              body: { padding: 0, height: '78vh' },
            }}
          >
            {mobilePreviewDoc && (
              <iframe
                key={`m-${mobilePreviewDoc.id}`}
                src={previewUrl(mobilePreviewDoc.id)}
                style={{ width: '100%', height: '100%', border: 'none', borderRadius: '0 0 12px 12px', background: '#fff' }}
                title="文档预览"
              />
            )}
          </Modal>
        </>
      ) : (
        /* ── 桌面端：左列表 + 右内嵌阅读器 ── */
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
          {/* 左栏：筛选 + 文件列表 */}
          <div
            style={{
              width: 300,
              flexShrink: 0,
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(16px)',
              border: '1px solid var(--glass-border)',
              borderRadius: 12,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'calc(100vh - 210px)',
            }}
          >
            <Input
              placeholder="搜索文件名称或内容"
              prefix={<SearchOutlined style={{ color: '#9d9ab8' }} />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{
                background: '#f8f7fd',
                border: '1px solid #e9e7f4',
                borderRadius: 8,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-primary)',
                marginBottom: 10,
              }}
              allowClear
            />
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: '1px solid #e9e7f4',
              }}
            >
              {docCategories.map((cat) => {
                const cnt = cat === '全部' ? docs.length : docs.filter((d) => d.category === cat).length;
                return (
                  <Tag.CheckableTag
                    key={cat}
                    checked={selectedCategory === cat}
                    onChange={() => setSelectedCategory(cat)}
                    style={{
                      padding: '3px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontFamily: 'var(--font-primary)',
                      border: selectedCategory === cat ? '1px solid rgba(99,102,241,0.5)' : '1px solid #e9e7f4',
                      background: selectedCategory === cat ? 'rgba(99,102,241,0.18)' : '#f6f5fc',
                      color: selectedCategory === cat ? '#6366f1' : '#46436a',
                      transition: 'all 0.2s',
                      cursor: 'pointer',
                    }}
                  >
                    {cat} {cnt > 0 && <span style={{ opacity: 0.65, fontSize: 11 }}>{cnt}</span>}
                  </Tag.CheckableTag>
                );
              })}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {filteredDocs.length === 0 ? (
                <Empty
                  description="暂无匹配的文件"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  style={{ color: '#6b6892', marginTop: 40 }}
                />
              ) : (
                filteredDocs.map((doc) => <DocListItem key={doc.id} doc={doc} />)
              )}
            </div>
            <div
              style={{
                paddingTop: 10,
                marginTop: 6,
                borderTop: '1px solid #e9e7f4',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#6b6892',
                fontFamily: 'var(--font-primary)',
              }}
            >
              <FileTextOutlined style={{ color: '#6366f1' }} />
              共 <strong style={{ color: 'var(--text-primary)' }}>{docs.length}</strong> 个文件，当前展示 {filteredDocs.length} 个
            </div>
          </div>

          {/* 右栏：内嵌文档阅读器 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {selectedDoc ? (
              <>
                <PreviewToolbar doc={selectedDoc} />
                <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
                  <iframe
                    key={`${selectedDoc.id}-${iframeKey}`}
                    src={previewUrl(selectedDoc.id)}
                    onLoad={() => setIframeLoading(false)}
                    style={{
                      flex: 1,
                      minHeight: 'calc(100vh - 265px)',
                      width: '100%',
                      border: '1px solid var(--glass-border)',
                      borderRadius: '0 0 12px 12px',
                      background: '#fff',
                    }}
                    title="文档预览"
                  />
                  {iframeLoading && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        background: '#fafafd',
                        borderRadius: '0 0 12px 12px',
                        zIndex: 1,
                      }}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          border: '4px solid #e9e7f4',
                          borderTopColor: '#6366f1',
                          borderRadius: '50%',
                          animation: 'tg-spin 1s linear infinite',
                        }}
                      />
                      <div style={{ fontSize: 14, color: '#46436a', fontFamily: 'var(--font-primary)', fontWeight: 500 }}>
                        文档加载中...
                      </div>
                      <div style={{ fontSize: 12, color: '#9d9ab8', fontFamily: 'var(--font-primary)' }}>
                        {selectedDoc.title}（{selectedDoc.fileSize}）· 大文件首次打开稍慢
                      </div>
                      <style>{'@keyframes tg-spin{to{transform:rotate(360deg)}}'}</style>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 500,
                  border: '1px dashed #e9e7f4',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#fafafd',
                }}
              >
                <Empty description="选择左侧文件开始阅读" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ color: '#6b6892' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 上传弹窗 */}
      <Modal
        title="上传文件到知识库"
        open={uploadModalOpen}
        onOk={handleUpload}
        confirmLoading={uploading}
        onCancel={() => {
          setUploadModalOpen(false);
          uploadForm.resetFields();
          setFileList([]);
        }}
        okText="上传"
        cancelText="取消"
        width={520}
        styles={{
          content: {
            background: '#ffffff',
            border: '1px solid #e9e7f4',
            borderRadius: 12,
          },
          header: {
            background: '#ffffff',
            borderBottom: '1px solid #e9e7f4',
          },
          body: {
            background: '#ffffff',
            padding: '24px',
          },
          mask: {
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
          },
        }}
      >
        <Form form={uploadForm} layout="vertical">
          <Form.Item
            name="file"
            label="选择文件"
            rules={[{ required: true, message: '请选择文件' }]}
            style={{ marginBottom: 16 }}
          >
            <Upload
              beforeUpload={() => false}
              fileList={fileList}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              maxCount={1}
              style={{ width: '100%' }}
            >
              <Button
                icon={<UploadOutlined />}
                block
                style={{
                  background: '#f8f7fd',
                  border: '1px dashed #d9d5f0',
                  color: '#46436a',
                  borderRadius: 8,
                  height: 80,
                  fontFamily: 'var(--font-primary)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <CloudUploadOutlined style={{ fontSize: 20 }} />
                  <span>点击或拖拽文件到此处上传</span>
                  <span style={{ fontSize: 11, color: '#9d9ab8' }}>
                    支持 PDF、Word、Excel、图片等格式
                  </span>
                </div>
              </Button>
            </Upload>
          </Form.Item>

          <Form.Item
            name="category"
            label="所属分类"
            rules={[{ required: true, message: '请选择分类' }]}
            initialValue="电气系统"
            style={{ marginBottom: 16 }}
          >
            <Select
              placeholder="选择专业分类"
              style={{
                background: '#f8f7fd',
                borderRadius: 6,
                fontFamily: 'var(--font-primary)',
              }}
              dropdownStyle={{
                background: '#ffffff',
                border: '1px solid #dcd9f2',
              }}
            >
              {docCategories.slice(1).map((cat) => (
                <Option key={cat} value={cat}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: categoryColors[cat] || '#6366f1',
                      }}
                    />
                    {cat}
                  </div>
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="title"
            label="文件名称"
            rules={[{ required: true, message: '请输入文件名称' }]}
            style={{ marginBottom: 16 }}
          >
            <Input
              placeholder="输入文件名称"
              style={{
                background: '#f8f7fd',
                border: '1px solid #e9e7f4',
                borderRadius: 6,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-primary)',
              }}
            />
          </Form.Item>

          <Form.Item name="description" label="文件描述" style={{ marginBottom: 0 }}>
            <Input.TextArea
              placeholder="输入文件描述（可选）"
              rows={3}
              style={{
                background: '#f8f7fd',
                border: '1px solid #e9e7f4',
                borderRadius: 6,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-primary)',
                resize: 'none',
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default TestGuide;
