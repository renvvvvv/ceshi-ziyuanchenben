import { useState, useMemo, useEffect, useRef } from 'react';
import { Tree, Input, Empty, Spin, Tag, Button, Tooltip, Alert, Space } from 'antd';
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
  ExclamationCircleOutlined,
  ReloadOutlined,
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

      {/* ===== 中间：iframe 嵌入区 ===== */}
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
        <IframePane node={selectedNode} />
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
// 中间：iframe 嵌入面板（带智能加载状态 + 飞书登录引导）
// ============================================================
function IframePane({ node }: { node: KBNode | null }) {
  const cfg = node ? (TYPE_CONFIG[node.type] || TYPE_CONFIG.docx) : null;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // iframe 加载状态：'idle' | 'loading' | 'loaded' | 'blocked'
  // 'blocked' 触发条件：onLoad 超时（说明被 X-Frame-Options 拦截或网络不通）
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'loaded' | 'blocked'>('idle');
  const loadTimerRef = useRef<number | null>(null);

  // 切换节点时重置加载状态 + 启动超时检测
  useEffect(() => {
    if (!node) {
      setLoadState('idle');
      if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
      return;
    }
    setLoadState('loading');
    // 6 秒后仍未 onLoad → 视为被拦截
    if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    loadTimerRef.current = window.setTimeout(() => {
      setLoadState((s) => (s === 'loading' ? 'blocked' : s));
    }, 6000);
    return () => {
      if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    };
  }, [node?.key]);

  const handleIframeLoad = () => {
    if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    setLoadState('loaded');
  };

  const handleManualRefresh = () => {
    if (!iframeRef.current || !node) return;
    setLoadState('loading');
    if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    loadTimerRef.current = window.setTimeout(() => {
      setLoadState((s) => (s === 'loading' ? 'blocked' : s));
    }, 6000);
    iframeRef.current.src = node.feishuLink;
  };

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
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            {node ? (
              <>
                <span>{cfg?.label || ''} · 飞书内嵌预览</span>
                {loadState === 'loading' && <span style={{ color: '#4d9fff' }}>· 加载中…</span>}
                {loadState === 'loaded' && <span style={{ color: '#52c41a' }}>· 已加载</span>}
                {loadState === 'blocked' && <span style={{ color: '#faad14' }}>· 嵌入受限</span>}
              </>
            ) : '从左侧目录选择文档以预览'}
          </div>
        </div>
        {node && (
          <Space>
            <Tooltip title="刷新 iframe">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleManualRefresh}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}
              />
            </Tooltip>
            <Button
              size="small"
              type="primary"
              icon={<LinkOutlined />}
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
          </Space>
        )}
      </div>

      {/* 智能引导 banner：检测到被拦截时显示 */}
      {loadState === 'blocked' && node && (
        <Alert
          banner
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message={
            <span>
              <strong style={{ color: '#faad14' }}>iframe 嵌入受限</strong>
              <span style={{ color: 'rgba(255,255,255,0.65)', marginLeft: 8 }}>
                飞书禁止跨域嵌入（X-Frame-Options）。请按下方步骤操作：
              </span>
            </span>
          }
          description={
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 1.7, paddingTop: 4 }}>
              <div>① 点击右上角 <strong style={{ color: '#7cb8ff' }}>「在飞书中打开 ↗」</strong>，在新标签登录飞书</div>
              <div>② 登录成功后浏览器会记住飞书 cookie（同一域自动生效）</div>
              <div>③ 回到本页，点 <strong style={{ color: '#7cb8ff' }}>「刷新」</strong> 或重新选择文档</div>
              <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.45)' }}>
                提示：只要浏览器在 feishu.cn 有登录态，本页 iframe 就能直接展示和操作。
              </div>
            </div>
          }
          style={{
            background: 'rgba(250,173,20,0.08)',
            border: '1px solid rgba(250,173,20,0.2)',
            borderRadius: 0,
            margin: 0,
          }}
        />
      )}

      {/* iframe 区 */}
      <div style={{ flex: 1, position: 'relative', background: '#fff', minHeight: 0 }}>
        {node ? (
          <iframe
            ref={iframeRef}
            key={node.key}
            src={node.feishuLink}
            title={node.title}
            onLoad={handleIframeLoad}
            style={{
              width: '100%', height: '100%', border: 'none', display: 'block',
            }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation allow-modals"
          />
        ) : (
          <div
            style={{
              width: '100%', height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(77,159,255,0.04), rgba(0,240,255,0.02))',
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            <BookOutlined style={{ fontSize: 56, color: '#4d9fff', opacity: 0.4, marginBottom: 16 }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 6 }}>
              智航测试部知识库
            </div>
            <div style={{ fontSize: 12 }}>从左侧目录选择文档，在此处内嵌预览</div>
          </div>
        )}
      </div>
    </>
  );
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
