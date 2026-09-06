import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button, Spin, Input, message, Modal, Empty, Segmented, Tooltip } from 'antd';
import {
  RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined,
  BulbOutlined, SearchOutlined, CheckOutlined, LinkOutlined,
  ThunderboltOutlined, BookOutlined, GlobalOutlined,
  BankOutlined, SwapOutlined, FileProtectOutlined, DatabaseOutlined,
  ToolOutlined, BarChartOutlined, AlertOutlined, ProjectOutlined, ReadOutlined,
} from '@ant-design/icons';
import { request } from '../../api';
import { useIsMobile } from '../../hooks/useIsMobile';
import ParticleSphere, { type ParticleSphereHandle, type KBSphereLabel } from '../../components/ParticleSphere';

const { TextArea } = Input;

// ============== Markdown 渲染（深色主题）==============
function renderMarkdown(md: string): string {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, (_m, code) =>
      `<pre style="background:#f6f5fc;padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0;font-size:12px"><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code style="background:#f1f0fe;padding:1px 5px;border-radius:3px;font-size:12px;color:#16a34a">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#1e1b2e;margin:14px 0 6px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#1e1b2e;margin:16px 0 8px;font-size:15px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="color:#1e1b2e;margin:18px 0 10px;font-size:17px">$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#6366f1">$1</strong>')
    .replace(/^- (.+)$/gm, '<div style="padding-left:16px;text-indent:-12px;margin:2px 0">• $1</div>')
    .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:20px;margin:2px 0">$1</div>')
    .replace(/^\|[-| :]+$/gm, '')
    .replace(/\n/g, '<br/>');
  return html;
}

// ============== 类型 ==============
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  sources?: { title: string; file: string }[];
  webSearch?: { title: string; link: string; media: string }[] | null;
  _question?: string;
}

// ============== 预设快捷问题 ==============
const QUICK_QUESTIONS = [
  { icon: '🔥', text: '液冷漏液告警怎么处理？' },
  { icon: '⚡', text: 'PDU 和列头柜的压测怎么做？各厂商要求？' },
  { icon: '🔌', text: '数据中心接地电阻各厂商要求多少？和国标比？' },
  { icon: '📋', text: 'A级机房验收必须做哪些检测？' },
  { icon: '🌡️', text: '机房PUE 1.6 怎么优化？' },
  { icon: '🏭', text: '柴发满载测试要跑多久？温度限值多少？' },
  { icon: '📐', text: '变压器满载测试的三相温度和谐波标准？' },
  { icon: '🔧', text: '字节、阿里、腾讯的测试规范有什么区别？' },
];

// ============== 内置知识库清单（与 server/knowledge/references 实际文件一一对应，配色按类别区分） ==============
const KB_ITEMS = [
  { icon: <BankOutlined />, title: '阿里巴巴 IDC 测试验证指引 V3.0', grad: 'linear-gradient(135deg,#FF9A3D,#FF6A00)' },
  { icon: <BankOutlined />, title: '腾讯 IDC 验证测试规范 V1.8', grad: 'linear-gradient(135deg,#6366f1,#818cf8)' },
  { icon: <BankOutlined />, title: '字节跳动测试管理规范 V5.0', grad: 'linear-gradient(135deg,#0d9488,#06b6c4)' },
  { icon: <SwapOutlined />, title: '三大厂标准 vs 国标对照表', grad: 'linear-gradient(135deg,#a855f7,#7c3aed)' },
  { icon: <FileProtectOutlined />, title: '国标条款速查 GB50174/50462', grad: 'linear-gradient(135deg,#f87171,#CF1322)' },
  { icon: <ReadOutlined />, title: '国标规范全文库 · 26 本', grad: 'linear-gradient(135deg,#FF85C0,#9E1068)' },
  { icon: <DatabaseOutlined />, title: '现场设备速查手册', grad: 'linear-gradient(135deg,#06b6d4,#6366f1)' },
  { icon: <ToolOutlined />, title: '现场排障方法论', grad: 'linear-gradient(135deg,#16a34a,#0d9488)' },
  { icon: <BarChartOutlined />, title: '测试数据分析框架', grad: 'linear-gradient(135deg,#FFD666,#D48806)' },
  { icon: <AlertOutlined />, title: '故障案例库 · 16 个案例', grad: 'linear-gradient(135deg,#FF9C6E,#D4380D)' },
  { icon: <ProjectOutlined />, title: '测试策略与项目管理', grad: 'linear-gradient(135deg,#6366f1,#a855f7)' },
];

// 知识球标注线轮播标签（icon 用 emoji，画布内渲染；title 来自上方 KB_ITEMS）
const KB_SPHERE_EMOJI = ['🏢', '🏢', '🏢', '🔄', '📑', '📚', '🔧', '🛠️', '📊', '⚠️', '📋'];
const KB_SPHERE_LABELS = KB_ITEMS.map((kb, i) => ({ icon: KB_SPHERE_EMOJI[i % KB_SPHERE_EMOJI.length], text: kb.title }));

// ============== 主组件 ==============
// 顶栏已删（与全局页头/对话态头卡重复），球区铺满整页
export default function AiTestExpert() {
  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <ChatArea />
      </div>
    </div>
  );
}

// ============== 左侧对话区 ==============
function ChatArea() {
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  // 问答模式：fast=GLM-5.3-Flash 秒级（默认），deep=GLM-5.2 深度思考
  const [qaMode, setQaMode] = useState<'fast' | 'deep'>('fast');
  const [asking, setAsking] = useState(false);
  // 粒子球：唯一实例常驻。orbCorner=false 居中大球；首个答案 token 到达后 morph 到左上角常驻
  const [burstTick, setBurstTick] = useState(0);
  const [orbCorner, setOrbCorner] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState('');
  // 大球 ref（文字粒子吸收）+ 首次挂载标记（入场汇聚动画只在第一次播）
  const heroRef = useRef<ParticleSphereHandle>(null);
  const heroMountedOnce = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  // 全屏入场：聚拢期间画布经 orb-intro 铺满全屏，球心/半径用 viewBox 钉在最终英雄位
  const [introPlaying, setIntroPlaying] = useState(true);
  const [introVB, setIntroVB] = useState<{ cx: number; cy: number; r: number } | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, asking]);

  const handleAsk = useCallback(async (questionText?: string) => {
    const question = (questionText ?? input).trim();
    if (!question || asking) return;
    heroRef.current?.absorbText(question); // 问题化成粒子飞进球
    setInput('');
    setAsking(true);

    const userMsg: ChatMessage = { role: 'user', content: question };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setCurrentQuestion(question);
    // 流式输出；首个 token 到达时球体裂变并平滑 morph 到左上角常驻
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, userMsg, {
      role: 'assistant', content: '', reasoning: '', sources: [],
      webSearch: null, _question: question,
    } as ChatMessage]);
    let firstToken = true;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 175000);

      const res = await fetch('/api/kb/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: history, question, mode: qaMode }),
        signal: controller.signal,
      });

      if (res.status === 401) { message.error('登录已失效，请重新登录'); clearTimeout(timeoutId); return; }
      if (!res.ok) { message.error(`AI 问答失败（HTTP ${res.status}）`); clearTimeout(timeoutId); return; }

      // 流式读取 SSE
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let fullReasoning = '';
      let sources: any[] = [];
      let webSearch: any = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            try {
              const data = JSON.parse(trimmed.slice(5).trim());
              if (data.type === 'sources') {
                sources = data.sources || [];
                setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, sources } : m));
              } else if (data.type === 'content') {
                if (firstToken) {
                  firstToken = false;
                  setBurstTick(t => t + 1); // 💥 先在全尺寸裂变（此时流式输出已开始）
                  // 裂变峰值过后再启程：粒子先炸开→弹性重组回完整球→整球缩小飞向左上角，全程连续
                  setTimeout(() => setOrbCorner(true), 620);
                }
                fullContent += data.text;
                setMessages(prev => prev.map((m, i) => i === assistantIdx ? { ...m, content: fullContent } : m));
              } else if (data.type === 'reasoning') {
                fullReasoning += data.text;
              } else if (data.type === 'done') {
                fullReasoning = data.reasoning || fullReasoning;
                webSearch = data.webSearch || null;
                setMessages(prev => prev.map((m, i) => i === assistantIdx ? {
                  ...m, content: fullContent, reasoning: fullReasoning, webSearch,
                } : m));
              } else if (data.type === 'error') {
                if (data.partial) fullContent = data.partial;
                const errMsg = data.message || 'AI 回答过程中出现异常';
                setMessages(prev => prev.map((m, i) => i === assistantIdx ? {
                  ...m, content: fullContent || `⚠️ ${errMsg}`, reasoning: fullReasoning,
                } : m));
                message.error(errMsg);
              }
            } catch {}
          }
        }
      }
      clearTimeout(timeoutId);

      // 兜底：流已关闭但 content 仍为空（GLM 返回了空响应）
      if (!fullContent.trim()) {
        setMessages(prev => prev.map((m, i) => i === assistantIdx ? {
          ...m, content: '⚠️ AI 未返回有效内容，请稍后重试或换一种问法。',
        } : m));
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') message.warning('AI 回答超时（GLM-5.2 思考+联网搜索耗时较长），请稍后重试');
      else message.error('问答请求失败，请确认后端服务正常');
    } finally {
      setAsking(false);
    }
  }, [input, asking, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); }
  };

  // 全屏入场收尾：换回英雄位 class（CSS morph），随后解除 viewBox 让球用画布自身几何
  const handleIntroDone = useCallback(() => {
    setIntroPlaying(false);
    setIntroVB(null); // Portal 换回页面内会重建引擎，必须立即清钉位（旧坐标对新画布越界 → 球消失）
  }, []);

  // 入场期间：orb-intro 画布铺满全屏，viewBox 把球心/半径钉在最终英雄位（按 .orb-hero 几何计算）
  useEffect(() => {
    if (!introPlaying) return;
    const raf = requestAnimationFrame(() => {
      const page = pageRef.current;
      if (!page) return;
      const rect = page.getBoundingClientRect();
      const mob = window.matchMedia('(max-width: 767px)').matches;
      const hw = Math.min(640, rect.width - 24);
      const hh = Math.min(mob ? 300 : 420, window.innerHeight * (mob ? 0.42 : 0.52));
      setIntroVB({
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height * (mob ? 0.34 : 0.42),
        r: Math.min(hw, hh) * 0.33, // 引擎 kbLine 模式半径系数
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [introPlaying]);

  return (
    <div ref={pageRef} className="ai-page" style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* 唯一粒子球：入场 orb-intro 全屏聚拢（Portal 到 body，绕开 .app-content 动画 transform 对 fixed 的劫持）
          → orb-hero 居中 ↔ orb-corner 左上角，CSS morph + 引擎实时自适应 */}
      {(() => {
        const orbNode = (
          <div className={`orb-layer ${introPlaying ? 'orb-intro' : orbCorner ? 'orb-corner' : 'orb-hero'}`}>
            <ParticleSphere
              ref={heroRef}
              width="100%" height="100%"
              kbLine
              kbItems={KB_SPHERE_LABELS}
              thinking={asking}
              burstSignal={burstTick}
              intro={!heroMountedOnce.current}
              onIntroDone={handleIntroDone}
              viewBox={introPlaying ? introVB : null}
              onLabelClick={(item: KBSphereLabel) => handleAsk(`请基于「${item.text}」的知识，介绍核心要点与实际应用场景`)}
            />
          </div>
        );
        return introPlaying ? createPortal(orbNode, document.body) : orbNode;
      })()}
      {/* 挂载即标记：后续不重播入场汇聚 */}
      <div style={{ display: 'none' }}>{(() => { heroMountedOnce.current = true; return null; })()}</div>

      {!orbCorner ? (
        /* 欢迎层（球居中）：提问时显示思考回显。
           外层 flex:1 占位把输入区压到底部，欢迎文案锚在占位区底部（即输入区上方） */
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <div style={{
            position: 'absolute', left: 0, right: 0, bottom: isMobile ? 10 : 18,
            textAlign: 'center', pointerEvents: 'none', zIndex: 3, padding: '0 16px',
          }}>
            {asking && (
              <div style={{ color: '#6b6892', fontSize: 13, maxWidth: 640, margin: '0 auto', lineHeight: 1.7 }}>
                {qaMode === 'fast' ? '⚡ 快速回答中' : '🧠 正在深度思考 + 联网搜索'}
                <span style={{ color: '#46436a' }}>：{currentQuestion}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* 答案层：左上角球伴飞（球在绝对层），毛玻璃头卡给球留位 */
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            minHeight: isMobile ? 60 : 76,
            padding: isMobile ? '8px 12px 8px 68px' : '10px 20px 10px 88px',
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(16px) saturate(1.4)',
            borderBottom: '1px solid rgba(233,231,244,0.8)',
            zIndex: 2,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#1e1b2e', fontSize: 13, fontWeight: 600 }}>
                AI 测试专家 {asking && <span style={{ color: '#6366f1', fontWeight: 400 }}>· 思考中…</span>}
              </div>
              <div style={{ color: '#9d9ab8', fontSize: 11, marginTop: 1 }}>
                {asking ? currentQuestion.slice(0, 40) : '继续提问，球在此思考并回答'}
              </div>
            </div>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { setMessages([]); setOrbCorner(false); }}
              style={{ borderRadius: 8, borderColor: '#d9d5f0', color: '#6366f1' }}>新对话</Button>
          </div>
          <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: isMobile ? '12px 12px' : '20px 24px' }}>
            <div style={{ maxWidth: 1150, margin: '0 auto' }}>
              {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
            </div>
          </div>
        </>
      )}

      {/* 输入区（毛玻璃悬浮）—— marginTop:auto 钉在底部：
          欢迎模式下球/标题层均为绝对定位不占文档流，没有它会浮到顶部 */}
      <div style={{
        marginTop: 'auto',
        position: 'relative', zIndex: 5,
        borderTop: '1px solid rgba(233,231,244,0.8)', padding: isMobile ? '12px 12px' : '14px 24px',
        // 入场期间（全屏粒子画布在下方滚动）不做 backdrop 模糊：逐帧重模糊在弱 GPU 上是大开销
        background: introPlaying ? 'rgba(241,240,254,0.97)' : 'rgba(241,240,254,0.78)',
        backdropFilter: introPlaying ? 'none' : 'blur(16px) saturate(1.4)',
        WebkitBackdropFilter: introPlaying ? 'none' : 'blur(16px) saturate(1.4)',
      }}>
        <div style={{ maxWidth: 1150, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Segmented
              value={qaMode}
              onChange={(v) => setQaMode(v as 'fast' | 'deep')}
              disabled={asking}
              options={[
                { value: 'fast', label: <span style={{ fontSize: 12 }}>⚡ 快速回答 <span style={{ color: '#9d9ab8', display: isMobile ? 'none' : undefined }}>· 5.3-Flash 秒级</span></span> },
                { value: 'deep', label: <span style={{ fontSize: 12 }}>🧠 深度思考 <span style={{ color: '#9d9ab8', display: isMobile ? 'none' : undefined }}>· GLM-5.2 30-90秒</span></span> },
              ]}
            />
            <Tooltip title={qaMode === 'fast' ? '适合标准查询、简单排障，通常几秒内回答' : '适合复杂分析、跨标准对比、深度排障，思考更充分但耗时较长'}>
              <span style={{ color: '#9d9ab8', fontSize: 11, cursor: 'help', display: isMobile ? 'none' : undefined }}>
                {qaMode === 'fast' ? '常规问题用这档' : '复杂问题用这档'}
              </span>
            </Tooltip>
          </div>
          <div style={{ display: 'flex', gap: isMobile ? 8 : 10, alignItems: 'flex-end' }}>
            <TextArea
              value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="向 AI 测试专家提问...（Enter 发送，Shift+Enter 换行）"
              autoSize={{ minRows: 1, maxRows: 5 }}
              style={{
                background: '#f6f5fc', border: '1px solid #d9d5f0',
                borderRadius: 10, color: '#1e1b2e', resize: 'none', fontSize: 14,
                flex: isMobile ? 1 : undefined, minWidth: isMobile ? 0 : undefined,
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => handleAsk()}
              loading={asking} disabled={!input.trim()} style={{ borderRadius: 10, height: 42, width: 42, flexShrink: isMobile ? 0 : undefined }} />
            {messages.length > 0 && (
              <Button icon={<ReloadOutlined />} onClick={() => { setMessages([]); setOrbCorner(false); }}
                title="新对话" style={{ borderRadius: 10, height: 42, width: 42, flexShrink: isMobile ? 0 : undefined }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============== 消息气泡 ==============
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isMobile = useIsMobile();
  const isUser = msg.role === 'user';
  const [showReasoning, setShowReasoning] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnText, setLearnText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLearn = async () => {
    if (!learnText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/kb/qa/learn', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ question: msg._question || '', answer: learnText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        message.success('已采纳到知识库');
        setLearnOpen(false); setLearnText('');
      } else { message.error(data.message || '采纳失败'); }
    } catch { message.error('网络错误'); }
    finally { setSubmitting(false); }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start', marginBottom: 24,
    }}>
      {/* 头像+角色 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
        flexDirection: isUser ? 'row-reverse' : 'row',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isUser ? '#6366f1' : 'rgba(22,163,74,0.15)',
        }}>
          {isUser ? <UserOutlined style={{ color: '#fff', fontSize: 14 }} /> : <RobotOutlined style={{ color: '#16a34a', fontSize: 14 }} />}
        </div>
        <span style={{ color: '#6b6892', fontSize: 12, fontWeight: 500 }}>
          {isUser ? '我' : 'AI 测试专家'}
        </span>
      </div>

      {/* 思考过程 */}
      {!isUser && msg.reasoning && msg.reasoning.trim() && (
        <div style={{ width: '100%', maxWidth: isMobile ? '100%' : 1000, marginBottom: 8 }}>
          <Button size="small" type="text" icon={<BulbOutlined style={{ color: '#d97706' }} />}
            onClick={() => setShowReasoning(!showReasoning)}
            style={{ color: '#6b6892', fontSize: 12 }}>
            {showReasoning ? '收起思考过程' : `查看思考过程（${msg.reasoning.length}字）`}
          </Button>
          {showReasoning && (
            <div style={{
              background: '#fff7ed', border: '1px solid rgba(217,119,6,0.25)',
              borderRadius: 8, padding: '12px 14px', marginTop: 6, fontSize: 12, lineHeight: 1.7,
              color: '#6b6892', whiteSpace: 'pre-wrap', maxHeight: 350, overflowY: 'auto',
            }}>
              {msg.reasoning}
            </div>
          )}
        </div>
      )}

      {/* 气泡内容 */}
      <div style={{
        background: isUser ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'rgba(255,255,255,0.72)',
        backdropFilter: isUser ? undefined : 'blur(14px) saturate(1.3)',
        WebkitBackdropFilter: isUser ? undefined : 'blur(14px) saturate(1.3)',
        boxShadow: isUser ? '0 8px 24px rgba(99,102,241,0.25)' : '0 4px 20px rgba(99,102,241,0.08)',
        border: isUser ? 'none' : '1px solid rgba(233,231,244,0.9)',
        color: isUser ? '#fff' : '#1e1b2e',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: isMobile ? '10px 12px' : '14px 18px', maxWidth: isMobile ? '90%' : 1000, fontSize: 14, lineHeight: 1.8, wordBreak: 'break-word',
      }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />

      {/* 联网搜索来源 */}
      {!isUser && msg.webSearch && msg.webSearch.length > 0 && (
        <div style={{ marginTop: 10, maxWidth: isMobile ? '100%' : 1000, fontSize: 12 }}>
          <div style={{ color: '#9d9ab8', marginBottom: 6 }}>
            <SearchOutlined style={{ marginRight: 4 }} />联网搜索来源：
          </div>
          {msg.webSearch.map((s, i) => (
            <a key={i} href={s.link} target="_blank" rel="noopener noreferrer"
              style={{ color: '#818cf8', fontSize: 12, textDecoration: 'none', display: 'block', marginBottom: 2 }}>
              <LinkOutlined /> {s.media || '来源'}：{s.title}
            </a>
          ))}
        </div>
      )}

      {/* RAG 知识来源 */}
      {!isUser && msg.sources && msg.sources.length > 0 && (
        <div style={{
          marginTop: 10, fontSize: 12, color: '#9d9ab8',
          display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: isMobile ? '100%' : 1000,
        }}>
          <span>📎 知识库来源：</span>
          {msg.sources.map((s, i) => (
            <span key={i} style={{
              background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
              borderRadius: 4, padding: '2px 8px', color: '#818cf8',
            }}>{s.title}</span>
          ))}
        </div>
      )}

      {/* 采纳/补充 */}
      {!isUser && msg._question && (
        <div style={{ marginTop: 10 }}>
          <Button size="small" type="text" icon={<CheckOutlined style={{ color: '#16a34a' }} />}
            onClick={() => setLearnOpen(true)}
            style={{ color: '#6b6892', fontSize: 12 }}>
            采纳/补充到知识库
          </Button>
        </div>
      )}

      {/* 采纳弹窗 */}
      <Modal title="补充知识到学习库" open={learnOpen}
        onCancel={() => { setLearnOpen(false); setLearnText(''); }}
        onOk={handleLearn} confirmLoading={submitting} okText="提交" cancelText="取消" width={520}>
        <div style={{ marginBottom: 8, fontSize: 12, color: '#6b6892' }}>
          原始问题：{msg._question}
        </div>
        <TextArea value={learnText} onChange={(e) => setLearnText(e.target.value)}
          placeholder="补充或纠正 AI 的回答。后续相似问题会参考此补充。"
          rows={5} autoFocus />
      </Modal>
    </div>
  );
}
