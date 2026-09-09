/**
 * 资源配置模块 · 新版工作台嵌入页
 * 内容为 public/rc/index.html 单文件应用（与新工具同源），经 /api/rc/store
 * 与平台 PostgreSQL 双向同步；登录态由同源 Cookie 自动携带。
 */
import { useEffect, useRef } from 'react';
import { useIsMobile } from '../../hooks/useIsMobile';

export default function ResourceConfig() {
  const isMobile = useIsMobile();
  const ref = useRef<HTMLIFrameElement>(null);
  // 同源 iframe：高度撑满内容区（app-content 已有内边距，这里抵消为全幅）
  useEffect(() => {
    const onResize = () => {
      const f = ref.current;
      if (!f) return;
      f.style.height = `${Math.max(560, window.innerHeight - 130)}px`;
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div style={{ margin: isMobile ? -12 : -24, padding: 0 }}>
      <iframe
        ref={ref}
        src="/rc/index.html"
        title="资源配置工作台"
        style={{
          width: '100%', height: '80vh', border: 'none', display: 'block', background: '#f6f5fc',
        }}
        allow="clipboard-write"
      />
    </div>
  );
}
