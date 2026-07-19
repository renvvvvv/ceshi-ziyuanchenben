import { useState, useEffect, useMemo } from 'react';
import {
  Input, Button, Tree, TreeSelect, Empty, Spin, Modal, Form, message, Space, Tag,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  BookOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  GlobalOutlined, FileTextOutlined, ReloadOutlined, FolderOutlined,
} from '@ant-design/icons';

// ============================================================
// 类型定义
// ============================================================
interface KBDocument {
  id: number;
  parent_id: number | null;
  title: string;
  content_md: string;
  external_url: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 简易 markdown 渲染（仅支持 # 标题、- 列表、** 加粗 **、`代码`）
// ============================================================
function renderMarkdown(md: string): string {
  if (!md) return '<p style="color:#999">（无内容）</p>';
  const escaped = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/^### (.+)$/gm, '<h3 style="color:#fff;font-size:16px;margin:16px 0 8px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#fff;font-size:18px;margin:20px 0 10px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:#fff;font-size:22px;margin:24px 0 12px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#7cb8ff">$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:3px;color:#52c41a">$1</code>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:20px;color:rgba(255,255,255,0.85)">$1</li>')
    .replace(/\n/g, '<br/>');
}

// ============================================================
// 主组件
// ============================================================
function KnowledgeBase() {
  const [mode, setMode] = useState<'local' | 'feishu'>('local');
  const [docs, setDocs] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [editingDoc, setEditingDoc] = useState<KBDocument | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [form] = Form.useForm();

  // 加载 KB
  const loadDocs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/kb', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setDocs(data.data || []);
        if (selectedId === null && data.data?.length > 0) {
          // 默认选第一个根节点
          const firstRoot = data.data.find((d: KBDocument) => d.parent_id === null);
          if (firstRoot) setSelectedId(firstRoot.id);
        }
      }
    } catch {
      message.error('加载知识库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDocs(); }, []);

  // 选中节点
  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) || null,
    [docs, selectedId]
  );

  // 构建目录树
  const treeData: DataNode[] = useMemo(() => {
    const buildTree = (parentId: number | null): DataNode[] => {
      return docs
        .filter((d) => d.parent_id === parentId)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
        .map((d) => ({
          key: d.id,
          title: (
            <span style={{ color: d.external_url ? '#4d9fff' : 'rgba(255,255,255,0.85)' }}>
              {d.external_url && <GlobalOutlined style={{ marginRight: 4, fontSize: 12 }} />}
              {d.title}
            </span>
          ),
          children: buildTree(d.id),
        }));
    };
    return buildTree(null);
  }, [docs]);

  // 搜索过滤（高亮匹配的文档）
  const expandedKeys = useMemo(() => {
    if (!searchText) return undefined;
    const matched: KBDocument[] = docs
      .filter((d) => d.title.toLowerCase().includes(searchText.toLowerCase()) || d.content_md.includes(searchText));
    // 展开所有父节点
    const parentIds = new Set<number>();
    for (const doc of matched) {
      let currentId: number | null = doc.parent_id;
      while (currentId !== null) {
        parentIds.add(currentId);
        const parent = docs.find((p) => p.id === currentId);
        if (!parent) break;
        currentId = parent.parent_id;
      }
    }
    return Array.from(parentIds);
  }, [docs, searchText]);

  // 操作：编辑
  const handleEdit = (doc: KBDocument | null) => {
    if (doc) {
      setEditingDoc(doc);
      form.setFieldsValue({
        title: doc.title,
        content_md: doc.content_md,
        external_url: doc.external_url || '',
        parent_id: doc.parent_id,
        sort_order: doc.sort_order,
      });
    } else {
      setEditingDoc(null);
      form.resetFields();
      // 新建时默认父节点 = 当前选中节点
      form.setFieldsValue({
        parent_id: selectedId,
        sort_order: 0,
      });
    }
    setPreviewMode(false);
    setEditorOpen(true);
  };

  // 操作：保存
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const body = {
        title: values.title,
        content_md: values.content_md || '',
        external_url: values.external_url || null,
        parent_id: values.parent_id || null,
        sort_order: values.sort_order || 0,
      };
      const url = editingDoc ? `/api/kb/${editingDoc.id}` : '/api/kb';
      const method = editingDoc ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        message.success(editingDoc ? '已保存' : '已新建');
        setEditorOpen(false);
        await loadDocs();
        if (!editingDoc && data.id) setSelectedId(data.id);
      } else {
        message.error(data.error || '保存失败');
      }
    } catch (err: any) {
      if (err?.errorFields) return; // 表单校验失败
      message.error(err?.message || '保存失败');
    }
  };

  // 操作：删除
  const handleDelete = async (doc: KBDocument) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除「${doc.title}」吗？${doc.parent_id === null ? '（删除根节点会同时删除其所有子节点）' : ''}`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await fetch(`/api/kb/${doc.id}`, {
            method: 'DELETE',
            credentials: 'include',
          });
          const data = await res.json();
          if (data.success) {
            message.success('已删除');
            if (selectedId === doc.id) setSelectedId(null);
            await loadDocs();
          } else {
            message.error(data.error || '删除失败');
          }
        } catch {
          message.error('网络错误');
        }
      },
    });
  };

  // ====== 飞书模式（iframe 兜底） ======
  if (mode === 'feishu') {
    return <FeishuIframeMode onBack={() => setMode('local')} />;
  }

  // ====== 本地模式 ======
  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部条 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)',
      }}>
        <BookOutlined style={{ color: '#4d9fff', fontSize: 18 }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600 }}>
            智航测试部知识库
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
            本地模式 · 共 {docs.length} 个文档
          </div>
        </div>
        <Button
          size="small"
          icon={<GlobalOutlined />}
          onClick={() => setMode('feishu')}
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
        >
          切换到飞书
        </Button>
      </div>

      {/* 主体：左侧树 + 右侧内容 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* 左侧 */}
        <div style={{
          width: 300, borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.15)',
        }}>
          <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
            <Input
              placeholder="搜索文档"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              size="small"
              style={{ flex: 1 }}
            />
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => handleEdit(null)}
            />
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={loadDocs}
              title="刷新"
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
            ) : treeData.length === 0 ? (
              <Empty description="暂无文档" style={{ padding: 20 }} />
            ) : (
              <Tree
                treeData={treeData}
                selectedKeys={selectedId ? [selectedId] : []}
                expandedKeys={expandedKeys}
                onSelect={(keys) => setSelectedId(keys[0] as number)}
                onExpand={() => {}}
                showLine
                blockNode
              />
            )}
          </div>
        </div>

        {/* 右侧 */}
        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          {!selected ? (
            <Empty description="从左侧选择一个文档" />
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <h2 style={{ color: '#fff', fontSize: 20, margin: 0 }}>{selected.title}</h2>
                {selected.external_url && <Tag color="blue" icon={<GlobalOutlined />}>外部链接</Tag>}
                <div style={{ flex: 1 }} />
                <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(selected)}>编辑</Button>
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(selected)}>删除</Button>
              </div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 16 }}>
                最后更新：{new Date(selected.updated_at).toLocaleString('zh-CN')}
              </div>
              {selected.external_url ? (
                <iframe
                  src={selected.external_url}
                  style={{ width: '100%', height: 'calc(100% - 100px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, background: '#fff' }}
                  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                  title={selected.title}
                />
              ) : (
                <div
                  style={{
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 13, lineHeight: 1.8,
                    background: 'rgba(255,255,255,0.03)',
                    padding: 20, borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)',
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.content_md) }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* 编辑/新建 Modal */}
      <Modal
        title={editingDoc ? '编辑文档' : '新建文档'}
        open={editorOpen}
        onCancel={() => setEditorOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="例如：电力系统测试 SOP" />
          </Form.Item>
          <Form.Item name="parent_id" label="父节点" tooltip="不选则为根节点">
            <TreeSelect
              treeData={treeData}
              placeholder="不选则为根节点"
              allowClear
              treeDefaultExpandAll
              fieldNames={{ label: 'title', value: 'key', children: 'children' }}
            />
          </Form.Item>
          <Form.Item name="external_url" label="外部链接（可选）" tooltip="填了则右侧用 iframe 嵌入，否则显示 markdown">
            <Input placeholder="https://example.feishu.cn/wiki/..." />
          </Form.Item>
          <Form.Item name="sort_order" label="排序" tooltip="数字越小越靠前">
            <Input type="number" placeholder="0" />
          </Form.Item>
          <Form.Item name="content_md" label="内容（Markdown）">
            <Input.TextArea
              rows={10}
              placeholder="# 标题\n- 要点 1\n- 要点 2\n\n支持 **加粗** 和 `代码` 等基础语法"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// 飞书模式（iframe 兜底）
function FeishuIframeMode({ onBack }: { onBack: () => void }) {
  const [kbData, setKbData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const defaultUrl = kbData?.tree?.[0]?.feishuLink || '';

  useEffect(() => {
    fetch('/kb/index.json')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        setKbData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)',
      }}>
        <GlobalOutlined style={{ color: '#4d9fff', fontSize: 18 }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600 }}>
            飞书知识库（iframe 模式）
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
            第三方 cookie 可能被浏览器拦截，建议优先使用本地模式
          </div>
        </div>
        <Button size="small" onClick={onBack} icon={<FileTextOutlined />}>切回本地模式</Button>
        {defaultUrl && (
          <Button size="small" type="primary" href={defaultUrl} target="_blank" rel="noopener noreferrer">
            在飞书中打开 ↗
          </Button>
        )}
      </div>
      <div style={{ flex: 1, background: '#fff' }}>
        {loading ? (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Spin />
          </div>
        ) : defaultUrl ? (
          <iframe
            src={defaultUrl}
            title="飞书知识库"
            style={{ width: '100%', height: '100%', border: 'none' }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation"
            allow="fullscreen"
          />
        ) : (
          <Empty description="飞书索引文件 /kb/index.json 不存在" style={{ padding: 80 }} />
        )}
      </div>
    </div>
  );
}

export default KnowledgeBase;