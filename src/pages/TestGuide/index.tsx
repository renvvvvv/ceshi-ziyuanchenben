import { useState, useMemo, useRef } from 'react';
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
} from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import {
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
} from '@ant-design/icons';
import { mockTestDocs, docCategories } from '../../data/mock';
import type { TestDoc } from '../../types';

const { Option } = Select;

const getFileIcon = (fileType?: string) => {
  const t = fileType?.toLowerCase();
  if (t === 'pdf') return <FilePdfOutlined style={{ fontSize: 36, color: '#ff4d4f' }} />;
  if (t === 'doc' || t === 'docx') return <FileWordOutlined style={{ fontSize: 36, color: '#4d9fff' }} />;
  if (t === 'xls' || t === 'xlsx') return <FileExcelOutlined style={{ fontSize: 36, color: '#52c41a' }} />;
  if (t === 'jpg' || t === 'jpeg' || t === 'png') return <FileImageOutlined style={{ fontSize: 36, color: '#722ed1' }} />;
  return <FileOutlined style={{ fontSize: 36, color: '#8c8c8c' }} />;
};

const getFileTypeFromName = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext || 'unknown';
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

function TestGuide() {
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [searchText, setSearchText] = useState('');
  const [docs, setDocs] = useState<TestDoc[]>(mockTestDocs);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const fileUrlMap = useRef<Map<string, string>>(new Map());

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

  const handleUpload = () => {
    uploadForm.validateFields().then((values) => {
      if (fileList.length === 0) {
        message.error('请选择要上传的文件');
        return;
      }
      const file = fileList[0];
      const rawFile = file.originFileObj;
      if (!rawFile) return;

      const url = URL.createObjectURL(rawFile);
      const newDoc: TestDoc = {
        id: 'doc_' + Date.now(),
        title: values.title || file.name,
        category: values.category,
        lastUpdated: new Date().toISOString().split('T')[0],
        content: values.description || '',
        fileName: file.name,
        fileSize: formatFileSize(rawFile.size),
        fileType: getFileTypeFromName(file.name),
        fileUrl: url,
      };

      fileUrlMap.current.set(newDoc.id, url);
      setDocs((prev) => [newDoc, ...prev]);
      message.success('文件上传成功');
      setUploadModalOpen(false);
      uploadForm.resetFields();
      setFileList([]);
    });
  };

  const handleDelete = (id: string) => {
    const url = fileUrlMap.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      fileUrlMap.current.delete(id);
    }
    setDocs((prev) => prev.filter((d) => d.id !== id));
    message.success('文件已删除');
  };

  const handleDownload = (doc: TestDoc) => {
    if (doc.fileUrl) {
      const a = document.createElement('a');
      a.href = doc.fileUrl;
      a.download = doc.fileName || doc.title;
      a.click();
    } else {
      message.info('演示数据，暂无实际文件下载');
    }
  };

  const categoryColors: Record<string, string> = {
    '电气系统': '#faad14',
    '暖通系统': '#52c41a',
    '弱电系统': '#4d9fff',
    '消防系统': '#eb576c',
  };

  return (
    <div>
      {/* 页面标题 */}
      <div
        style={{
          marginBottom: 24,
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
              color: 'rgba(255,255,255,0.45)',
              marginTop: 6,
              fontSize: 13,
              fontFamily: 'var(--font-primary)',
            }}
          >
            实现测试流程标准化、测试规范数字化、质量管理体系化
          </p>
        </div>
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          onClick={() => setUploadModalOpen(true)}
          style={{
            background: 'linear-gradient(135deg, #4d9fff 0%, #2b6cb0 100%)',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'var(--font-primary)',
            fontWeight: 500,
            height: 38,
            boxShadow: '0 4px 12px rgba(77,159,255,0.25)',
          }}
        >
          上传文件
        </Button>
      </div>

      {/* 分类标签 + 搜索 */}
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {docCategories.map((cat) => (
            <Tag.CheckableTag
              key={cat}
              checked={selectedCategory === cat}
              onChange={() => setSelectedCategory(cat)}
              style={{
                padding: '5px 18px',
                borderRadius: 20,
                fontSize: 13,
                fontFamily: 'var(--font-primary)',
                border: selectedCategory === cat
                  ? '1px solid rgba(77,159,255,0.5)'
                  : '1px solid rgba(255,255,255,0.12)',
                background: selectedCategory === cat
                  ? 'rgba(77,159,255,0.18)'
                  : 'rgba(255,255,255,0.03)',
                color: selectedCategory === cat ? '#4d9fff' : 'rgba(255,255,255,0.6)',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
            >
              {cat}
            </Tag.CheckableTag>
          ))}
        </div>
        <Input
          placeholder="搜索文件名称或内容"
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{
            width: 260,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-primary)',
          }}
          allowClear
        />
      </div>

      {/* 文件列表 */}
      {filteredDocs.length === 0 ? (
        <Empty
          description="暂无匹配的文件"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ color: 'rgba(255,255,255,0.4)', marginTop: 60 }}
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {filteredDocs.map((doc) => (
            <div
              key={doc.id}
              style={{
                background: 'var(--glass-bg)',
                backdropFilter: 'blur(16px)',
                border: '1px solid var(--glass-border)',
                borderRadius: 12,
                padding: 20,
                transition: 'all 0.25s ease',
                cursor: 'default',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(77,159,255,0.25)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--glass-border)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
            >
              {/* 头部：图标 + 标题 */}
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {getFileIcon(doc.fileType)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 15,
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-primary)',
                      marginBottom: 6,
                      lineHeight: 1.4,
                      wordBreak: 'break-all',
                    }}
                  >
                    {doc.title}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Tag
                      style={{
                        background: `${categoryColors[doc.category] || '#4d9fff'}18`,
                        border: `1px solid ${categoryColors[doc.category] || '#4d9fff'}33`,
                        color: categoryColors[doc.category] || '#4d9fff',
                        fontSize: 11,
                        borderRadius: 4,
                        padding: '0 8px',
                        lineHeight: '20px',
                        fontFamily: 'var(--font-primary)',
                      }}
                    >
                      {doc.category}
                    </Tag>
                    {doc.fileSize && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'rgba(255,255,255,0.35)',
                          fontFamily: 'var(--font-primary)',
                        }}
                      >
                        {doc.fileSize}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 描述 */}
              {doc.content && (
                <div
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.45)',
                    fontFamily: 'var(--font-primary)',
                    lineHeight: 1.6,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {doc.content}
                </div>
              )}

              {/* 底部：时间 + 操作 */}
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.3)',
                    fontFamily: 'var(--font-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <ClockCircleOutlined />
                  更新于 {doc.lastUpdated}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="text"
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => handleDownload(doc)}
                    style={{
                      color: '#4d9fff',
                      fontSize: 12,
                      fontFamily: 'var(--font-primary)',
                    }}
                  >
                    下载
                  </Button>
                  <Popconfirm
                    title="确认删除"
                    description={`确定要删除"${doc.title}"吗？`}
                    onConfirm={() => handleDelete(doc.id)}
                    okText="确认"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      style={{
                        color: '#ff7875',
                        fontSize: 12,
                        fontFamily: 'var(--font-primary)',
                      }}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 统计信息 */}
      <div
        style={{
          marginTop: 24,
          padding: '16px 20px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 10,
          display: 'flex',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined style={{ color: '#4d9fff', fontSize: 16 }} />
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontFamily: 'var(--font-primary)' }}>
            共 <strong style={{ color: 'var(--text-primary)' }}>{docs.length}</strong> 个文件
          </span>
        </div>
        {docCategories.slice(1).map((cat) => {
          const count = docs.filter((d) => d.category === cat).length;
          return (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: categoryColors[cat] || '#4d9fff',
                }}
              />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, fontFamily: 'var(--font-primary)' }}>
                {cat} <strong style={{ color: 'var(--text-primary)' }}>{count}</strong> 个
              </span>
            </div>
          );
        })}
      </div>

      {/* 上传弹窗 */}
      <Modal
        title="上传文件到知识库"
        open={uploadModalOpen}
        onOk={handleUpload}
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
            background: '#0d1f3c',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
          },
          header: {
            background: '#0d1f3c',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          },
          body: {
            background: '#0d1f3c',
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
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px dashed rgba(255,255,255,0.15)',
                  color: 'rgba(255,255,255,0.6)',
                  borderRadius: 8,
                  height: 80,
                  fontFamily: 'var(--font-primary)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <CloudUploadOutlined style={{ fontSize: 20 }} />
                  <span>点击或拖拽文件到此处上传</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
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
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 6,
                fontFamily: 'var(--font-primary)',
              }}
              dropdownStyle={{
                background: '#0d1f3c',
                border: '1px solid rgba(255,255,255,0.1)',
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
                        background: categoryColors[cat] || '#4d9fff',
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
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
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
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
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
