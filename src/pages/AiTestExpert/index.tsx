import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Spin, Input, message, Modal, Empty } from 'antd';
import {
  RobotOutlined, UserOutlined, SendOutlined, ReloadOutlined,
  BulbOutlined, SearchOutlined, CheckOutlined, LinkOutlined,
  ThunderboltOutlined, BookOutlined, GlobalOutlined,
} from '@ant-design/icons';

const { TextArea } = Input;

// ============== Markdown 渲染（深色主题）==============
function renderMarkdown(md: string): string {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, (_m, code) =>
      `<pre style="background:rgba(0,0,0,0.3);padding:12px;border-radius:6px;overflow-x:auto;margin:8px 0;font-size:12px"><code>${code.trim()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;font-size:12px;color:#52c41a">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#fff;margin:14px 0 6px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#fff;margin:16px 0 8px;font-size:15px">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 style="color:#fff;margin:18px 0 10px;font-size:17px">$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#7cb8ff">$1</strong>')
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

// ============== 主组件 ==============
export default function AiTestExpert() {
  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <RobotOutlined style={{ color: '#52c41a', fontSize: 20 }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600 }}>
            AI 测试专家
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>
            数据中心测试领域智能助手 · GLM-5.2 深度思考 + 联网搜索
          </div>
        </div>
      </div>

      {/* 主体：左对话 + 右侧栏 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <ChatArea />
        <SidePanel />
      </div>
    </div>
  );
}

// ============== 左侧对话区 ==============
function ChatArea() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [asking, setAsking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, asking]);

  const handleAsk = useCallback(async (questionText?: string) => {
    const question = (questionText ?? input).trim();
    if (!question || asking) return;
    setInput('');
    setAsking(true);

    const userMsg: ChatMessage = { role: 'user', content: question };
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, userMsg]);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 175000); // 175s，对齐 nginx 180s，给后端150s+余量
      const res = await fetch('/api/kb/qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: history, question }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { message.error(data.message || '登录已失效，请重新登录'); return; }
      if (res.ok && data.success) {
        setMessages(prev => [...prev, {
          role: 'assistant', content: data.answer, reasoning: data.reasoning,
          sources: data.sources, webSearch: data.webSearch, _question: question,
        } as any]);
      } else {
        message.error(data.message || `AI 问答失败（HTTP ${res.status}）`);
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

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* 对话列表（居中 max-width 900）*/}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {messages.length === 0 ? (
            <WelcomeScreen onQuick={handleAsk} />
          ) : (
            <>
              {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}
              {asking && (
                <div style={{ display: 'flex', marginBottom: 16 }}>
                  <div style={{
                    background: 'rgba(255,255,255,0.06)', borderRadius: '12px 12px 12px 2px',
                    padding: '12px 16px',
                  }}>
                    <Spin size="small" />
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginLeft: 10 }}>
                      正在深度思考 + 联网搜索...
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 输入区（居中）*/}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)', padding: '16px 24px',
        background: 'rgba(0,0,0,0.15)',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <TextArea
            value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="向 AI 测试专家提问...（Enter 发送，Shift+Enter 换行）"
            autoSize={{ minRows: 1, maxRows: 5 }}
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, color: 'rgba(255,255,255,0.9)', resize: 'none', fontSize: 14,
            }}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={() => handleAsk()}
            loading={asking} disabled={!input.trim()} style={{ borderRadius: 10, height: 42, width: 42 }} />
          {messages.length > 0 && (
            <Button icon={<ReloadOutlined />} onClick={() => setMessages([])}
              title="新对话" style={{ borderRadius: 10, height: 42, width: 42 }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============== 欢迎屏 ==============
function WelcomeScreen({ onQuick }: { onQuick: (q: string) => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '40px 20px', textAlign: 'center',
    }}>
      <RobotOutlined style={{ fontSize: 56, color: 'rgba(82,196,26,0.4)', marginBottom: 20 }} />
      <h2 style={{ color: 'rgba(255,255,255,0.9)', fontSize: 22, margin: '0 0 8px' }}>
        数据中心测试专家
      </h2>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, maxWidth: 480, lineHeight: 1.8, margin: '0 0 28px' }}>
        基于 GLM-5.2 深度思考引擎，内置阿里巴巴/腾讯/字节跳动三大厂测试标准 + 国标 GB50174/GB50462。
        可以问答设备参数、排障方法、验收标准，回答会标注厂商标准与国标的对应关系。
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
        maxWidth: 640, width: '100%',
      }}>
        {QUICK_QUESTIONS.map((q, i) => (
          <div key={i} onClick={() => onQuick(q.text)} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: '12px 14px', cursor: 'pointer', textAlign: 'left',
            transition: 'all 0.2s', fontSize: 13, color: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(77,159,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(77,159,255,0.2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
          >
            <span style={{ fontSize: 16 }}>{q.icon}</span>
            <span>{q.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============== 消息气泡 ==============
function MessageBubble({ msg }: { msg: ChatMessage }) {
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
          background: isUser ? '#4d9fff' : 'rgba(82,196,26,0.15)',
        }}>
          {isUser ? <UserOutlined style={{ color: '#fff', fontSize: 14 }} /> : <RobotOutlined style={{ color: '#52c41a', fontSize: 14 }} />}
        </div>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: 500 }}>
          {isUser ? '我' : 'AI 测试专家'}
        </span>
      </div>

      {/* 思考过程 */}
      {!isUser && msg.reasoning && msg.reasoning.trim() && (
        <div style={{ width: '100%', maxWidth: 800, marginBottom: 8 }}>
          <Button size="small" type="text" icon={<BulbOutlined style={{ color: '#faad14' }} />}
            onClick={() => setShowReasoning(!showReasoning)}
            style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
            {showReasoning ? '收起思考过程' : `查看思考过程（${msg.reasoning.length}字）`}
          </Button>
          {showReasoning && (
            <div style={{
              background: 'rgba(250,173,20,0.05)', border: '1px solid rgba(250,173,20,0.15)',
              borderRadius: 8, padding: '12px 14px', marginTop: 6, fontSize: 12, lineHeight: 1.7,
              color: 'rgba(255,255,255,0.55)', whiteSpace: 'pre-wrap', maxHeight: 350, overflowY: 'auto',
            }}>
              {msg.reasoning}
            </div>
          )}
        </div>
      )}

      {/* 气泡内容 */}
      <div style={{
        background: isUser ? '#4d9fff' : 'rgba(255,255,255,0.06)',
        color: isUser ? '#fff' : 'rgba(255,255,255,0.9)',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        padding: '14px 18px', maxWidth: 800, fontSize: 14, lineHeight: 1.8, wordBreak: 'break-word',
      }} dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />

      {/* 联网搜索来源 */}
      {!isUser && msg.webSearch && msg.webSearch.length > 0 && (
        <div style={{ marginTop: 10, maxWidth: 800, fontSize: 12 }}>
          <div style={{ color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
            <SearchOutlined style={{ marginRight: 4 }} />联网搜索来源：
          </div>
          {msg.webSearch.map((s, i) => (
            <a key={i} href={s.link} target="_blank" rel="noopener noreferrer"
              style={{ color: '#7cb8ff', fontSize: 12, textDecoration: 'none', display: 'block', marginBottom: 2 }}>
              <LinkOutlined /> {s.media || '来源'}：{s.title}
            </a>
          ))}
        </div>
      )}

      {/* RAG 知识来源 */}
      {!isUser && msg.sources && msg.sources.length > 0 && (
        <div style={{
          marginTop: 10, fontSize: 12, color: 'rgba(255,255,255,0.35)',
          display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 800,
        }}>
          <span>📎 知识库来源：</span>
          {msg.sources.map((s, i) => (
            <span key={i} style={{
              background: 'rgba(77,159,255,0.1)', border: '1px solid rgba(77,159,255,0.2)',
              borderRadius: 4, padding: '2px 8px', color: '#7cb8ff',
            }}>{s.title}</span>
          ))}
        </div>
      )}

      {/* 采纳/补充 */}
      {!isUser && msg._question && (
        <div style={{ marginTop: 10 }}>
          <Button size="small" type="text" icon={<CheckOutlined style={{ color: '#52c41a' }} />}
            onClick={() => setLearnOpen(true)}
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            采纳/补充到知识库
          </Button>
        </div>
      )}

      {/* 采纳弹窗 */}
      <Modal title="补充知识到学习库" open={learnOpen}
        onCancel={() => { setLearnOpen(false); setLearnText(''); }}
        onOk={handleLearn} confirmLoading={submitting} okText="提交" cancelText="取消" width={520}>
        <div style={{ marginBottom: 8, fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
          原始问题：{msg._question}
        </div>
        <TextArea value={learnText} onChange={(e) => setLearnText(e.target.value)}
          placeholder="补充或纠正 AI 的回答。后续相似问题会参考此补充。"
          rows={5} autoFocus />
      </Modal>
    </div>
  );
}

// ============== 右侧栏 ==============
function SidePanel() {
  return (
    <div style={{
      width: 290, borderLeft: '1px solid rgba(255,255,255,0.08)',
      display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.15)',
      overflowY: 'auto',
    }}>
      {/* 能力说明 */}
      <div style={{ padding: '16px' }}>
        <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          ⚡ AI 能力
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: <BulbOutlined style={{ color: '#faad14' }} />, title: 'GLM-5.2 深度思考', desc: '思考强度最高，展示推理过程' },
            { icon: <GlobalOutlined style={{ color: '#4d9fff' }} />, title: '联网搜索', desc: '获取最新标准与资讯' },
            { icon: <BookOutlined style={{ color: '#52c41a' }} />, title: '三大厂标准', desc: '阿里/腾讯/字节测试规范' },
            { icon: <ThunderboltOutlined style={{ color: '#7cb8ff' }} />, title: '国标对照', desc: 'GB50174 / GB50462 关联' },
            { icon: <CheckOutlined style={{ color: '#52c41a' }} />, title: '自我学习', desc: '采纳纠错，持续积累' },
          ].map((cap, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
              background: 'rgba(255,255,255,0.03)', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ marginTop: 2 }}>{cap.icon}</div>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 500 }}>{cap.title}</div>
                <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, marginTop: 2 }}>{cap.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 内置知识库 */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          📚 内置知识库
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[
            '阿里巴巴 IDC 测试验证指引 V3.0',
            '腾讯 IDC 验证测试规范 V1.8',
            '字节跳动测试管理规范 V5.0',
            '厂商标准 vs 国标对照表',
            'GB50174-2017 / GB50462-2024',
            '数据中心设备速查手册',
            '现场排障方法论',
            '测试数据分析框架',
          ].map((kb, i) => (
            <div key={i} style={{
              color: 'rgba(255,255,255,0.55)', fontSize: 12, padding: '4px 0',
              borderBottom: i < 7 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            }}>
              📄 {kb}
            </div>
          ))}
        </div>
      </div>

      {/* 提示 */}
      <div style={{ padding: '0 16px 16px', marginTop: 'auto' }}>
        <div style={{
          background: 'rgba(77,159,255,0.06)', border: '1px solid rgba(77,159,255,0.12)',
          borderRadius: 6, padding: 10, fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7,
        }}>
          💡 回答涉及具体数值时会标注来源（国标条款号 / 厂商规范版本），方便交付引用。
        </div>
      </div>
    </div>
  );
}
