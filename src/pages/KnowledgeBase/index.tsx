import { useState, useEffect } from 'react';
import { Button, Spin, Empty } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useIsMobile } from '../../hooks/useIsMobile';

// ============== 主组件：飞书知识库（iframe 嵌入）==============
export default function KnowledgeBase() {
  const isMobile = useIsMobile();
  const [kbData, setKbData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const defaultUrl = kbData?.tree?.[0]?.feishuLink || '';

  useEffect(() => {
    fetch('/kb/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { setKbData(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const feishuTitle = kbData?.tree?.[0]?.title || '飞书知识库';

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12,
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        padding: isMobile ? '10px 12px' : '12px 18px',
        borderBottom: '1px solid #e9e7f4',
        background: '#f6f5fc',
      }}>
        <GlobalOutlined style={{ color: '#6366f1', fontSize: 18 }} />
        <div style={{ flex: 1, minWidth: isMobile ? 0 : undefined }}>
          <div style={{ color: '#1e1b2e', fontSize: 15, fontWeight: 600 }}>
            飞书知识库
          </div>
          <div style={{ color: '#9d9ab8', fontSize: 11, marginTop: 2 }}>
            飞书知识库 · {kbData?.totalNodes || 0} 个文档
          </div>
        </div>
        {defaultUrl && (
          <Button
            size="small"
            type="primary"
            href={defaultUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ flexShrink: isMobile ? 0 : undefined }}
          >
            在飞书中打开 ↗
          </Button>
        )}
      </div>

      {/* 飞书 iframe 占满全屏 */}
      <div style={{ flex: 1, background: '#fff' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
            <Spin size="large" />
          </div>
        ) : defaultUrl ? (
          <iframe
            src={defaultUrl}
            title={feishuTitle}
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
