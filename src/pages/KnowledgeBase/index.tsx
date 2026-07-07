import { useState, useMemo, useEffect } from 'react';
import { Tree, Input, Empty, Spin, Tag, Button, Tooltip } from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  SearchOutlined,
  FileTextOutlined,
  TableOutlined,
  FileExcelOutlined,
  PaperClipOutlined,
  LinkOutlined,
  BookOutlined,
  ExpandOutlined,
  CompressOutlined,
} from '@ant-design/icons';

// ============================================================
// 类型定义
// ============================================================
interface KBNode {
  key: string;
  title: string;
  type: string;
  depth: number;
  feishuLink: string;
  status: string;
  children: KBNode[];
}

interface KBIndex {
  spaceId: string;
  exportTime: string;
  totalNodes: number;
  typeStats: Record<string, number>;
  tree: KBNode[];
  flat: Array<{
    idx: number;
    title: string;
    type: string;
    path: string;
    depth: number;
    feishuLink: string;
    status: string;
  }>;
}

// ============================================================
// 类型图标与颜色配置
// ============================================================
const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  docx: { icon: <FileTextOutlined />, color: '#4d9fff', label: '文档' },
  bitable: { icon: <TableOutlined />, color: '#52c41a', label: '多维表格' },
  sheet: { icon: <FileExcelOutlined />, color: '#faad14', label: '电子表格' },
  file: { icon: <PaperClipOutlined />, color: '#eb576c', label: '附件' },
};

// ============================================================
// 辅助函数
// ============================================================

/** 递归收集所有节点的 key（用于展开全部） */
function collectAllKeys(nodes: KBNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: KBNode[]) => {
    for (const n of list) {
      keys.push(n.key);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return keys;
}

/** 递归过滤树（按关键词搜索标题） */
function filterTree(nodes: KBNode[], keyword: string): KBNode[] {
  if (!keyword) return nodes;
  const kw = keyword.toLowerCase();
  const result: KBNode[] = [];
  for (const n of nodes) {
    const matched = n.title.toLowerCase().includes(kw);
    const filteredChildren = n.children.length > 0 ? filterTree(n.children, keyword) : [];
    if (matched || filteredChildren.length > 0) {
      result.push({ ...n, children: filteredChildren });
    }
  }
  return result;
}

/** 将 KBNode 转为 Ant Design Tree DataNode */
function toDataNode(nodes: KBNode[]): DataNode[] {
  return nodes.map((n) => {
    const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.docx;
    return {
      key: n.key,
      title: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: cfg.color, fontSize: 13 }}>{cfg.icon}</span>
          <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>{n.title}</span>
          {n.children.length > 0 && (
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>({n.children.length})</span>
          )}
        </span>
      ),
      children: n.children.length > 0 ? toDataNode(n.children) : undefined,
      isLeaf: n.children.length === 0,
    };
  });
}

// ============================================================
// 主组件
// ============================================================
function KnowledgeBase() {
  const [loading, setLoading] = useState(true);
  const [kbData, setKbData] = useState<KBIndex | null>(null);
  const [searchText, setSearchText] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 加载索引数据
  useEffect(() => {
    fetch('/kb/index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: KBIndex) => {
        setKbData(data);
        // 默认展开第一层
        setExpandedKeys(data.tree.map((n) => n.key));
        setLoading(false);
      })
      .catch((err) => {
        console.error('加载知识库索引失败:', err);
        setLoading(false);
      });
  }, []);

  // 搜索过滤后的树
  const filteredTree = useMemo(() => {
    if (!kbData) return [];
    return filterTree(kbData.tree, searchText);
  }, [kbData, searchText]);

  // Ant Design Tree 数据
  const treeData = useMemo(() => toDataNode(filteredTree), [filteredTree]);

  // 所有 key（用于展开/折叠全部）
  const allKeys = useMemo(() => (kbData ? collectAllKeys(kbData.tree) : []), [kbData]);

  // 当前选中的节点信息
  const selectedNode = useMemo<KBNode | null>(() => {
    if (!kbData || !selectedKey) return null;
    const find = (nodes: KBNode[]): KBNode | null => {
      for (const n of nodes) {
        if (n.key === selectedKey) return n;
        const found = find(n.children);
        if (found) return found;
      }
      return null;
    };
    return find(kbData.tree);
  }, [kbData, selectedKey]);

  // 展开/折叠全部
  const handleExpandAll = () => setExpandedKeys(allKeys);
  const handleCollapseAll = () => setExpandedKeys([]);

  // 搜索时自动展开所有匹配节点
  useEffect(() => {
    if (searchText) {
      const keys = collectAllKeys(filteredTree);
      setExpandedKeys(keys);
    }
  }, [searchText, filteredTree]);

  return (
    <div style={{ display: 'flex', gap: 20, height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
      {/* ===== 左侧目录树 ===== */}
      <div
        style={{
          width: 360,
          flexShrink: 0,
          height: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: '16px 12px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* 标题 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <BookOutlined style={{ color: '#4d9fff', fontSize: 18 }} />
          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-primary)' }}>
            知识库目录
          </span>
          {kbData && (
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginLeft: 'auto' }}>
              {kbData.totalNodes} 篇
            </span>
          )}
        </div>

        {/* 搜索框 */}
        <Input
          placeholder="搜索文档标题"
          prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          variant="borderless"
          style={{
            marginBottom: 12,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#fff',
            fontFamily: 'var(--font-primary)',
          }}
        />

        {/* 展开/折叠按钮 */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Button
            size="small"
            icon={<ExpandOutlined />}
            onClick={handleExpandAll}
            style={{
              flex: 1,
              background: 'rgba(77,159,255,0.08)',
              border: '1px solid rgba(77,159,255,0.2)',
              color: '#7cb8ff',
              fontSize: 11,
              fontFamily: 'var(--font-primary)',
              borderRadius: 6,
            }}
          >
            全部展开
          </Button>
          <Button
            size="small"
            icon={<CompressOutlined />}
            onClick={handleCollapseAll}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.5)',
              fontSize: 11,
              fontFamily: 'var(--font-primary)',
              borderRadius: 6,
            }}
          >
            全部折叠
          </Button>
        </div>

        {/* 树形目录 */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="small" />
            </div>
          ) : treeData.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, fontFamily: 'var(--font-primary)' }}>
                  {searchText ? '未找到匹配的文档' : '暂无数据'}
                </span>
              }
            />
          ) : (
            <Tree
              treeData={treeData}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys)}
              selectedKeys={selectedKey ? [selectedKey] : []}
              onSelect={(keys) => {
                if (keys.length > 0) {
                  setSelectedKey(keys[0] as string);
                }
              }}
              showLine={{ showLeafIcon: false }}
              blockNode
              style={{
                background: 'transparent',
                fontFamily: 'var(--font-primary)',
                color: 'rgba(255,255,255,0.85)',
              }}
            />
          )}
        </div>

        {/* 底部统计 */}
        {kbData && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Tag style={{ background: 'rgba(77,159,255,0.1)', color: '#4d9fff', border: '1px solid rgba(77,159,255,0.2)', fontSize: 11 }}>
              文档 {kbData.typeStats.docx}
            </Tag>
            <Tag style={{ background: 'rgba(82,196,26,0.1)', color: '#52c41a', border: '1px solid rgba(82,196,26,0.2)', fontSize: 11 }}>
              多维表格 {kbData.typeStats.bitable}
            </Tag>
            <Tag style={{ background: 'rgba(250,173,20,0.1)', color: '#faad14', border: '1px solid rgba(250,173,20,0.2)', fontSize: 11 }}>
              表格 {kbData.typeStats.sheet}
            </Tag>
            <Tag style={{ background: 'rgba(235,87,108,0.1)', color: '#eb576c', border: '1px solid rgba(235,87,108,0.2)', fontSize: 11 }}>
              附件 {kbData.typeStats.file}
            </Tag>
          </div>
        )}
      </div>

      {/* ===== 右侧内容区 ===== */}
      <div
        style={{
          flex: 1,
          height: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: '24px 32px',
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        {selectedNode ? (
          <SelectedNodeView node={selectedNode} />
        ) : (
          <WelcomeView kbData={kbData} />
        )}
      </div>
    </div>
  );
}

// ============================================================
// 选中节点的展示视图
// ============================================================
function SelectedNodeView({ node }: { node: KBNode }) {
  const cfg = TYPE_CONFIG[node.type] || TYPE_CONFIG.docx;

  return (
    <div>
      {/* 文档标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: `${cfg.color}18`,
            border: `1px solid ${cfg.color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            color: cfg.color,
          }}
        >
          {cfg.icon}
        </div>
        <div>
          <h3 style={{ margin: 0, color: 'rgba(255,255,255,0.95)', fontSize: 20, fontFamily: 'var(--font-primary)' }}>
            {node.title}
          </h3>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Tag style={{ background: `${cfg.color}18`, color: cfg.color, border: `1px solid ${cfg.color}30`, fontSize: 11 }}>
              {cfg.label}
            </Tag>
            {node.children.length > 0 && (
              <Tag style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 11 }}>
                {node.children.length} 个子节点
              </Tag>
            )}
          </div>
        </div>
      </div>

      {/* 分隔线 */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '20px 0' }} />

      {/* 飞书跳转卡片 */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(77,159,255,0.08), rgba(0,240,255,0.05))',
          border: '1px solid rgba(77,159,255,0.2)',
          borderRadius: 12,
          padding: '24px 28px',
          textAlign: 'center',
        }}
      >
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginBottom: 8, fontFamily: 'var(--font-primary)' }}>
          此文档来源于飞书知识库
        </div>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginBottom: 20, fontFamily: 'var(--font-primary)' }}>
          点击下方按钮在飞书中查看完整内容（在线版样式更全，图片可正常显示）
        </div>

        <Button
          type="primary"
          size="large"
          icon={<LinkOutlined />}
          href={node.feishuLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: 'linear-gradient(135deg, #4d9fff, #00f0ff)',
            border: 'none',
            height: 44,
            paddingInline: 32,
            fontSize: 14,
            fontFamily: 'var(--font-primary)',
            fontWeight: 600,
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(77,159,255,0.3)',
          }}
        >
          在飞书中查看 ↗
        </Button>

        {/* 飞书链接展示 */}
        <Tooltip title="复制链接">
          <div
            style={{
              marginTop: 16,
              padding: '8px 14px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: 8,
              color: 'rgba(255,255,255,0.35)',
              fontSize: 11,
              fontFamily: 'monospace',
              cursor: 'pointer',
              maxWidth: 500,
              margin: '16px auto 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            onClick={() => {
              navigator.clipboard?.writeText(node.feishuLink);
            }}
          >
            {node.feishuLink}
          </div>
        </Tooltip>
      </div>

      {/* 子节点列表 */}
      {node.children.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: 13,
              marginBottom: 12,
              fontFamily: 'var(--font-primary)',
              fontWeight: 600,
            }}
          >
            子文档（{node.children.length}）
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {node.children.map((child) => {
              const childCfg = TYPE_CONFIG[child.type] || TYPE_CONFIG.docx;
              return (
                <a
                  key={child.key}
                  href={child.feishuLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8,
                    textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(77,159,255,0.08)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(77,159,255,0.2)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
                  }}
                >
                  <span style={{ color: childCfg.color, fontSize: 14 }}>{childCfg.icon}</span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontFamily: 'var(--font-primary)', flex: 1 }}>
                    {child.title}
                  </span>
                  <Tag style={{ background: `${childCfg.color}12`, color: childCfg.color, border: `1px solid ${childCfg.color}25`, fontSize: 10 }}>
                    {childCfg.label}
                  </Tag>
                  <LinkOutlined style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }} />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 欢迎页（未选中节点时）
// ============================================================
function WelcomeView({ kbData }: { kbData: KBIndex | null }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div
        style={{
          width: 80,
          height: 80,
          borderRadius: 20,
          background: 'linear-gradient(135deg, rgba(77,159,255,0.12), rgba(0,240,255,0.06))',
          border: '1px solid rgba(77,159,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          fontSize: 36,
          color: '#4d9fff',
        }}
      >
        <BookOutlined />
      </div>
      <h2 style={{ color: 'rgba(255,255,255,0.9)', fontSize: 24, fontFamily: 'var(--font-primary)', marginBottom: 8 }}>
        智航测试部知识库
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, fontFamily: 'var(--font-primary)', marginBottom: 32 }}>
        从左侧目录选择文档，点击后在飞书中查看完整内容
      </p>

      {kbData && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, flexWrap: 'wrap' }}>
          {Object.entries(kbData.typeStats).map(([type, count]) => {
            const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.docx;
            return (
              <div
                key={type}
                style={{
                  minWidth: 140,
                  padding: '16px 24px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: `${cfg.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    color: cfg.color,
                  }}
                >
                  {cfg.icon}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ color: cfg.color, fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{count}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }}>{cfg.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 40, color: 'rgba(255,255,255,0.25)', fontSize: 12, fontFamily: 'var(--font-primary)' }}>
        导出时间：{kbData?.exportTime} · 空间 ID：{kbData?.spaceId}
      </div>
    </div>
  );
}

export default KnowledgeBase;
