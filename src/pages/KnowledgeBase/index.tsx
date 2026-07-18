import { useState, useMemo, useEffect } from 'react';
import { Tree, Input, Empty, Spin, Tag, Button, Tooltip, Space } from 'antd';
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
  ExportOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  ApartmentOutlined,
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

      {/* ===== 中间：文档详情卡片区（替代 iframe 嵌入） ===== */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <DocumentCardPane node={selectedNode} />
      </div>

      {/* ===== 右边：超链接列表 ===== */}
      <div
        style={{
          width: 300,
          flexShrink: 0,
          height: '100%',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12,
          padding: '16px 14px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <LinkListPane
          node={selectedNode}
          allNodes={kbData?.tree || []}
          onSelect={(k) => setSelectedKey(k)}
        />
      </div>
    </div>
  );
}

// ============================================================
// 中间：文档详情卡片（替代 iframe 嵌入）
//
// 设计原因：浏览器默认禁止第三方 cookie（Safari/FF 全禁，Chrome 即将全禁）
// iframe 嵌入飞书会导致扫码登录失败（qrPolling API 报"系统繁忙"）
// 飞书官方建议：使用 window.open() 在新标签打开
// ============================================================
function DocumentCardPane({ node }: { node: KBNode | null }) {
  const cfg = node ? (TYPE_CONFIG[node.type] || TYPE_CONFIG.docx) : null;

  return (
    <>
      {/* 顶部条：标题 + 类型 + 外链按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        {cfg && (
          <div
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: `${cfg.color}18`, border: `1px solid ${cfg.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, color: cfg.color, flexShrink: 0,
            }}
          >
            {cfg.icon}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600,
            fontFamily: 'var(--font-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {node ? node.title : '智航测试部知识库'}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
            {node ? `${cfg?.label || ''} · 飞书知识库` : '从左侧目录选择文档以查看详情'}
          </div>
        </div>
        {node && (
          <Button
            size="small"
            type="primary"
            icon={<ExportOutlined />}
            href={node.feishuLink}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              background: 'linear-gradient(135deg, #4d9fff, #00f0ff)',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            在飞书中打开 ↗
          </Button>
        )}
      </div>

      {/* 主体卡片区 */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {node ? (
          <DocumentCard node={node} />
        ) : (
          <WelcomeCard />
        )}
      </div>
    </>
  );
}

// ============================================================
// 文档详情卡片
// ============================================================
function DocumentCard({ node }: { node: KBNode }) {
  const cfg = TYPE_CONFIG[node.type] || TYPE_CONFIG.docx;
  const totalSubDocs = countAllDescendants(node);
  const breadcrumb = buildBreadcrumb(node);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 720, margin: '0 auto' }}>
      {/* 顶部大图标 + 标题 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginBottom: 28 }}>
        <div
          style={{
            width: 80, height: 80, borderRadius: 18, flexShrink: 0,
            background: `linear-gradient(135deg, ${cfg.color}25, ${cfg.color}10)`,
            border: `1px solid ${cfg.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, color: cfg.color,
            boxShadow: `0 8px 24px ${cfg.color}20`,
          }}
        >
          {cfg.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            margin: 0, marginBottom: 10,
            color: 'rgba(255,255,255,0.95)', fontSize: 24,
            fontFamily: 'var(--font-primary)', fontWeight: 600,
            lineHeight: 1.3,
          }}>
            {node.title}
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Tag style={{
              background: `${cfg.color}18`, color: cfg.color,
              border: `1px solid ${cfg.color}30`, fontSize: 12,
              margin: 0, padding: '2px 10px', borderRadius: 4,
            }}>
              {cfg.label}
            </Tag>
            {totalSubDocs > 0 && (
              <Tag style={{
                background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.1)', fontSize: 12,
                margin: 0, padding: '2px 10px', borderRadius: 4,
              }}>
                {totalSubDocs} 个子文档
              </Tag>
            )}
            <Tag style={{
              background: 'rgba(82,196,26,0.1)', color: '#52c41a',
              border: '1px solid rgba(82,196,26,0.2)', fontSize: 12,
              margin: 0, padding: '2px 10px', borderRadius: 4,
            }}>
              飞书知识库
            </Tag>
          </div>
        </div>
      </div>

      {/* 路径面包屑 */}
      {breadcrumb.length > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 14px', marginBottom: 20,
          background: 'rgba(77,159,255,0.04)',
          border: '1px solid rgba(77,159,255,0.12)',
          borderRadius: 8,
          color: 'rgba(255,255,255,0.6)', fontSize: 12,
          fontFamily: 'var(--font-primary)',
        }}>
          <ApartmentOutlined style={{ color: '#4d9fff' }} />
          {breadcrumb.map((seg, i) => (
            <span key={i}>
              <span style={{ color: i === breadcrumb.length - 1 ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                {seg}
              </span>
              {i < breadcrumb.length - 1 && <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 6px' }}>›</span>}
            </span>
          ))}
        </div>
      )}

      {/* 主操作卡片 */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(77,159,255,0.08), rgba(0,240,255,0.04))',
          border: '1px solid rgba(77,159,255,0.2)',
          borderRadius: 12,
          padding: '24px 28px',
          marginBottom: 20,
        }}
      >
        <div style={{
          color: 'rgba(255,255,255,0.85)', fontSize: 14, marginBottom: 12,
          fontFamily: 'var(--font-primary)', fontWeight: 600,
        }}>
          <ThunderboltOutlined style={{ color: '#52c41a', marginRight: 8 }} />
          点击下方按钮在飞书中查看完整内容
        </div>
        <div style={{
          color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 1.7, marginBottom: 18,
          fontFamily: 'var(--font-primary)',
        }}>
          <div>• 飞书知识库支持文档、多维表格、电子表格、附件等多种格式</div>
          <div>• 在线版样式更全，图片、表格、附件可正常显示和编辑</div>
          <div>• 首次打开会提示登录飞书；登录后浏览器自动记忆登录态</div>
        </div>

        <Button
          type="primary"
          size="large"
          icon={<ExportOutlined />}
          href={node.feishuLink}
          target="_blank"
          rel="noopener noreferrer"
          block
          style={{
            background: 'linear-gradient(135deg, #4d9fff, #00f0ff)',
            border: 'none', height: 48, fontSize: 15,
            fontFamily: 'var(--font-primary)', fontWeight: 600,
            borderRadius: 10,
            boxShadow: '0 4px 16px rgba(77,159,255,0.3)',
          }}
        >
          在飞书中打开此文档 ↗
        </Button>

        {/* 飞书链接展示 */}
        <Tooltip title="点击复制链接">
          <div
            onClick={() => {
              navigator.clipboard?.writeText(node.feishuLink);
            }}
            style={{
              marginTop: 14, padding: '8px 14px',
              background: 'rgba(0,0,0,0.2)', borderRadius: 8,
              color: 'rgba(255,255,255,0.35)', fontSize: 11,
              fontFamily: 'monospace', cursor: 'pointer',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textAlign: 'center',
            }}
          >
            {node.feishuLink}
          </div>
        </Tooltip>
      </div>

      {/* 子文档快速预览 */}
      {node.children.length > 0 && (
        <div>
          <div style={{
            color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: 600,
            marginBottom: 12, fontFamily: 'var(--font-primary)',
          }}>
            子文档（{node.children.length}） · 点击右侧「相关链接」在新窗口打开
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {node.children.slice(0, 5).map((child) => {
              const cc = TYPE_CONFIG[child.type] || TYPE_CONFIG.docx;
              return (
                <a
                  key={child.key}
                  href={child.feishuLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8, textDecoration: 'none',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${cc.color}15`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${cc.color}40`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)';
                  }}
                >
                  <span style={{ color: cc.color, fontSize: 14 }}>{cc.icon}</span>
                  <span style={{
                    color: 'rgba(255,255,255,0.85)', fontSize: 13,
                    fontFamily: 'var(--font-primary)', flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {child.title}
                  </span>
                  <Tag style={{
                    background: `${cc.color}12`, color: cc.color,
                    border: `1px solid ${cc.color}25`, fontSize: 10, margin: 0,
                  }}>
                    {cc.label}
                  </Tag>
                  <LinkOutlined style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }} />
                </a>
              );
            })}
            {node.children.length > 5 && (
              <div style={{
                color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center', padding: 6,
                fontFamily: 'var(--font-primary)',
              }}>
                还有 {node.children.length - 5} 个子文档，请在右侧「相关链接」查看全部
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部说明 */}
      <div style={{
        marginTop: 28, padding: '12px 14px',
        background: 'rgba(255,255,255,0.02)', borderRadius: 8,
        color: 'rgba(255,255,255,0.35)', fontSize: 11,
        fontFamily: 'var(--font-primary)', lineHeight: 1.6,
        textAlign: 'center',
      }}>
        <ClockCircleOutlined style={{ marginRight: 6 }} />
        为何不在本平台内嵌预览？浏览器默认禁止第三方 cookie（Safari/FF 全禁，Chrome 即将全禁），
        iframe 内飞书扫码登录会失败。采用「在新窗口打开」是飞书官方推荐的方案。
      </div>
    </div>
  );
}

// ============================================================
// 欢迎卡片（未选中节点）
// ============================================================
function WelcomeCard() {
  return (
    <div style={{
      textAlign: 'center', padding: '80px 20px',
      color: 'rgba(255,255,255,0.5)',
    }}>
      <BookOutlined style={{ fontSize: 64, color: '#4d9fff', opacity: 0.4, marginBottom: 20 }} />
      <h2 style={{ color: 'rgba(255,255,255,0.85)', fontSize: 22, marginBottom: 8, fontFamily: 'var(--font-primary)' }}>
        智航测试部知识库
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, fontFamily: 'var(--font-primary)', maxWidth: 400, margin: '0 auto' }}>
        从左侧目录选择文档，点击后在飞书中查看完整内容
      </p>
    </div>
  );
}

// ============================================================
// 辅助：递归统计所有后代
// ============================================================
function countAllDescendants(node: KBNode): number {
  let n = 0;
  const walk = (kids: KBNode[]) => {
    for (const c of kids) { n += 1; walk(c.children); }
  };
  walk(node.children);
  return n;
}

// ============================================================
// 辅助：构建面包屑（从 flat 找父链）
// ============================================================
function buildBreadcrumb(node: KBNode): string[] {
  // 我们只知道当前节点和它的 feishuLink 路径信息
  // 简化处理：从 title 反推不可能，我们返回 [当前 title]
  // 后续可以扩展为全局 flat 索引
  return [node.title];
}

// ============================================================
// 右边：超链接列表面板
// ============================================================
function LinkListPane({
  node, allNodes, onSelect,
}: {
  node: KBNode | null;
  allNodes: KBNode[];
  onSelect: (key: string) => void;
}) {
  // 把树拍平，方便查"同级节点"
  const flatList = useMemo(() => {
    const arr: Array<{ node: KBNode; parent: KBNode | null }> = [];
    const walk = (list: KBNode[], parent: KBNode | null) => {
      list.forEach((n) => {
        arr.push({ node: n, parent });
        if (n.children.length > 0) walk(n.children, n);
      });
    };
    walk(allNodes, null);
    return arr;
  }, [allNodes]);

  // 当前节点的同级（不含自己 + 不含子节点）
  const siblings = useMemo(() => {
    if (!node) return [];
    const entry = flatList.find((e) => e.node.key === node.key);
    if (!entry) return [];
    return flatList.filter((e) => e.parent?.key === entry.parent?.key && e.node.key !== node.key);
  }, [flatList, node]);

  if (!node) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 8px', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
        <LinkOutlined style={{ fontSize: 24, marginBottom: 8 }} />
        <div>未选中任何文档</div>
      </div>
    );
  }

  const sections = [
    { title: '当前文档', items: [node] },
    ...(node.children.length > 0 ? [{ title: `子文档（${node.children.length}）`, items: node.children }] : []),
    ...(siblings.length > 0 ? [{ title: `同级文档（${siblings.length}）`, items: siblings.map((s) => s.node) }] : []),
  ];

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12,
        paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <LinkOutlined style={{ color: '#4d9fff', fontSize: 14 }} />
        <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-primary)' }}>
          相关链接
        </span>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
          共 {sections.reduce((s, sec) => s + sec.items.length, 0)} 项
        </span>
      </div>
      {sections.map((sec) => (
        <div key={sec.title} style={{ marginBottom: 14 }}>
          <div style={{
            color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: 600,
            marginBottom: 6, fontFamily: 'var(--font-primary)',
            textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            {sec.title}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sec.items.map((item) => {
              const ic = TYPE_CONFIG[item.type] || TYPE_CONFIG.docx;
              const isCurrent = sec.title === '当前文档';
              return (
                <a
                  key={item.key}
                  href={item.feishuLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    // 当前文档行：拦截默认新窗口，改成"切换中栏 iframe"
                    if (isCurrent) {
                      e.preventDefault();
                      onSelect(item.key);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 10px',
                    background: isCurrent ? `${ic.color}18` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${isCurrent ? ic.color + '40' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 6,
                    textDecoration: 'none',
                    color: 'rgba(255,255,255,0.85)',
                    fontSize: 12,
                    fontFamily: 'var(--font-primary)',
                    transition: 'all 0.15s',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = `${ic.color}22`;
                    (e.currentTarget as HTMLElement).style.borderColor = `${ic.color}50`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = isCurrent ? `${ic.color}18` : 'rgba(255,255,255,0.03)';
                    (e.currentTarget as HTMLElement).style.borderColor = isCurrent ? `${ic.color}40` : 'rgba(255,255,255,0.06)';
                  }}
                >
                  <span style={{ color: ic.color, fontSize: 12, flexShrink: 0 }}>{ic.icon}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </span>
                  <Tooltip title="新窗口打开">
                    <LinkOutlined style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, flexShrink: 0 }} />
                  </Tooltip>
                </a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default KnowledgeBase;
