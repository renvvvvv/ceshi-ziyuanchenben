import { useState, useEffect, useRef } from 'react';
import { Spin, Button, Tooltip, Space } from 'antd';
import {
  BookOutlined,
  ExportOutlined,
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
// 主组件：知识库 = 全屏 iframe 嵌入飞书
// ============================================================
function KnowledgeBase() {
  const [loading, setLoading] = useState(true);
  const [kbData, setKbData] = useState<KBIndex | null>(null);

  // 加载索引数据（用来取默认入口 URL）
  useEffect(() => {
    fetch('/kb/index.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: KBIndex) => {
        setKbData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('加载知识库索引失败:', err);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ height: 'calc(100vh - 120px)', overflow: 'hidden' }}>
      <FullscreenIframe kbData={kbData} loading={loading} />
    </div>
  );
}

// ============================================================
// 全屏 iframe 组件（极简版）
//
// 设计：去掉所有自检逻辑
// - 直接嵌入飞书 URL，浏览器自己处理登录态
// - 顶部条只保留：标题 + 刷新 + 在飞书中打开
// - 没有超时检测、没有 banner、没有状态指示
// ============================================================
function FullscreenIframe({ kbData, loading }: { kbData: KBIndex | null; loading: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 默认 URL：第一个顶层节点的链接
  const defaultUrl = kbData?.tree?.[0]?.feishuLink || '';

  const handleRefresh = () => {
    if (!iframeRef.current || !defaultUrl) return;
    // 强制 reload：用随机参数绕过浏览器缓存
    iframeRef.current.src = defaultUrl + (defaultUrl.includes('?') ? '&' : '?') + '_t=' + Date.now();
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 顶部条：标题 + 操作 */}
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
        <BookOutlined style={{ color: '#4d9fff', fontSize: 18 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600,
            fontFamily: 'var(--font-primary)',
          }}>
            智航测试部知识库
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
            飞书知识库 · iframe 实时嵌入
            {kbData && (
              <span style={{ marginLeft: 8, color: 'rgba(255,255,255,0.3)' }}>
                · 共 {kbData.totalNodes} 个文档
              </span>
            )}
          </div>
        </div>
        {defaultUrl && (
          <Space>
            <Tooltip title="刷新 iframe">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleRefresh}
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.7)',
                }}
              />
            </Tooltip>
            <Button
              size="small"
              type="primary"
              icon={<ExportOutlined />}
              href={defaultUrl}
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

      {/* iframe 全屏 */}
      <div style={{ flex: 1, background: '#fff', minHeight: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(77,159,255,0.04), rgba(0,240,255,0.02))',
            color: 'rgba(255,255,255,0.5)',
          }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, fontSize: 13 }}>加载知识库索引…</div>
          </div>
        ) : defaultUrl ? (
          <iframe
            ref={iframeRef}
            src={defaultUrl}
            title="智航测试部知识库"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-top-navigation allow-modals"
            allow="fullscreen"
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(77,159,255,0.04), rgba(0,240,255,0.02))',
            color: 'rgba(255,255,255,0.5)',
          }}>
            <BookOutlined style={{ fontSize: 64, color: '#4d9fff', opacity: 0.4, marginBottom: 20 }} />
            <div style={{ fontSize: 14 }}>暂无知识库数据</div>
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.6 }}>
              请确认 <code style={{ color: '#7cb8ff' }}>/kb/index.json</code> 是否存在
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default KnowledgeBase;