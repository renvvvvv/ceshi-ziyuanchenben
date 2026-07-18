import { useState, useEffect, useRef } from 'react';
import { Spin, Button, Tooltip, Space, Alert } from 'antd';
import {
  FileTextOutlined,
  TableOutlined,
  FileExcelOutlined,
  PaperClipOutlined,
  BookOutlined,
  ExportOutlined,
  ReloadOutlined,
  ExclamationCircleOutlined,
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
// 全屏 iframe 组件
//
// 设计：把整个知识库页面当成一个"iframe 容器"
// - 默认加载飞书知识库的根目录（kb/index.json 中第一个顶层节点的链接）
// - 用户在 iframe 内部自由浏览、点击切换文档（飞书自己带完整目录）
// - 顶部条提供：刷新 + 在新窗口打开 + 加载状态指示
// ============================================================
function FullscreenIframe({ kbData, loading }: { kbData: KBIndex | null; loading: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeState, setIframeState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [bannerVisible, setBannerVisible] = useState(true);
  const loadTimerRef = useRef<number | null>(null);

  // 默认 URL：第一个顶层节点的链接
  const defaultUrl = kbData?.tree?.[0]?.feishuLink || '';

  // 启动超时检测（8 秒）
  useEffect(() => {
    if (!defaultUrl) return;
    setIframeState('loading');
    if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    loadTimerRef.current = window.setTimeout(() => {
      setIframeState('failed');
    }, 8000);
    return () => {
      if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    };
  }, [defaultUrl]);

  const handleIframeLoad = () => {
    setIframeState((s) => (s === 'failed' ? 'failed' : 'loaded'));
  };

  const handleRefresh = () => {
    if (!iframeRef.current || !defaultUrl) return;
    setBannerVisible(true); // 重新显示 banner 让用户看引导
    setIframeState('loading');
    if (loadTimerRef.current) window.clearTimeout(loadTimerRef.current);
    loadTimerRef.current = window.setTimeout(() => {
      setIframeState('failed');
    }, 8000);
    iframeRef.current.src = defaultUrl;
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
      {/* 顶部条：标题 + 状态 + 操作 */}
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
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>飞书知识库 · iframe 实时嵌入</span>
            {kbData && (
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>
                · 共 {kbData.totalNodes} 个文档 · 导出时间 {kbData.exportTime}
              </span>
            )}
            {iframeState === 'loading' && defaultUrl && <span style={{ color: '#4d9fff' }}>· 加载中…</span>}
            {iframeState === 'loaded' && <span style={{ color: '#52c41a' }}>· 已加载</span>}
            {iframeState === 'failed' && <span style={{ color: '#faad14' }}>· 加载超时（未登录飞书？）</span>}
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

      {/* 加载超时引导 banner（可关闭） */}
      {iframeState === 'failed' && defaultUrl && bannerVisible && (
        <Alert
          banner
          type="warning"
          showIcon
          closable
          onClose={() => setBannerVisible(false)}
          icon={<ExclamationCircleOutlined />}
          message={
            <span>
              <strong style={{ color: '#faad14' }}>iframe 加载超时</strong>
              <span style={{ color: 'rgba(255,255,255,0.65)', marginLeft: 8 }}>
                如果浏览器未登录飞书，iframe 内会显示登录二维码且不会自动跳转
              </span>
            </span>
          }
          description={
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, lineHeight: 1.7, paddingTop: 4 }}>
              <div>① 点击右上角「在飞书中打开 ↗」在新标签登录飞书</div>
              <div>② 登录成功后浏览器会记住飞书 cookie（30 天有效）</div>
              <div>③ 回到本页，点击 🔄 刷新按钮 → iframe 自动带 cookie → 显示内容</div>
              <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.5)' }}>
                iOS Safari 用户：设置 → Safari 浏览器 → 隐私与安全性 → 关闭「阻止跨站跟踪」
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
            key={defaultUrl}
            src={defaultUrl}
            title="智航测试部知识库"
            onLoad={handleIframeLoad}
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