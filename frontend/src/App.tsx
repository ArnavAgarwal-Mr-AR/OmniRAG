import { useState, useRef, useEffect } from 'react';
import { UploadCloud, Send, FileText, Image as ImageIcon, PlayCircle, Trash2, Sparkles, Zap, ChevronRight } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import logo from './assets/logo.png';
import userAvatar from './assets/user-avatar.png';
import aiAvatar from './assets/ai-avatar.png';

/* ─── Global styles injected once ─────────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #000000;
    --surface:   #050508;
    --panel:     #08080c;
    --border:    rgba(255,255,255,0.04);
    --border-hi: rgba(255,255,255,0.08);
    --accent:    #8b7dff;
    --accent-lo: rgba(139,125,255,0.06);
    --accent-mid:rgba(139,125,255,0.12);
    --text-1:    #ffffff;
    --text-2:    #a1a1aa;
    --text-3:    #52525b;
    --green:     #10b981;
    --amber:     #f59e0b;
    --serif:     'Instrument Serif', Georgia, serif;
    --sans:      'Inter', system-ui, sans-serif;
    --radius-lg: 18px;
    --radius-xl: 24px;
    --radius-2xl:32px;
    font-family: var(--sans);
  }

  html, body, #root { height: 100%; background: var(--bg); }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border-hi); border-radius: 99px; }

  /* Thinking dots */
  @keyframes blink {
    0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
    40%            { opacity: 1;   transform: translateY(-3px); }
  }
  .dot { animation: blink 1.4s infinite both; }
  .dot:nth-child(2) { animation-delay: .2s; }
  .dot:nth-child(3) { animation-delay: .4s; }

  /* Spin */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 2s linear infinite; }

  /* Fade + slide in */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fade-up { animation: fadeUp .35s ease both; }

  /* Pulse ring */
  @keyframes pulse-ring {
    0%   { transform: scale(1);   opacity: .4; }
    100% { transform: scale(1.6); opacity: 0; }
  }
  .pulse-ring::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--green);
    animation: pulse-ring 2s ease-out infinite;
  }

  /* Grain overlay */
  .grain::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: .025;
    z-index: 9999;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 128px;
  }
`;

/* ─── Types ────────────────────────────────────────────────────────────────── */
type Modality = 'pdf' | 'image' | 'audio';
type UploadedDoc = {
  id: string; name: string; type: Modality;
  status: 'uploading' | 'processing' | 'ready';
  jobId?: string; sourceId?: string; selected: boolean;
};
type ChatMessage = { role: 'user' | 'bot'; content: string; id: string };

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
const parseMessageContent = (content: string) => {
  const audioRegex = /\[AUDIO:(.+?)\s\|\s(.+?)\s\|\s([\d.]+)s\s-\s([\d.]+)s\]/g;
  const imageRegex = /\[IMAGE_SOURCE:(.+?)\]\sImage\sURL:\s(https?:\/\/[^\s|]+)(?:\s\|\sImage\sDescription:\s(.*?))?(?=\n|$|\[)/g;
  const sourceRegex = /\[SOURCE:(.+?)\sPage:(.+?)\]/g;
  const audioCitations: any[] = [], imageCitations: any[] = [], sourceCitations: any[] = [];
  let cleanContent = content, match;
  while ((match = audioRegex.exec(content)) !== null) {
    audioCitations.push({ source: match[1], speaker: match[2], start: match[3], end: match[4] });
    cleanContent = cleanContent.replace(match[0], `[Audio: ${match[2]}]`);
  }
  while ((match = imageRegex.exec(content)) !== null) {
    imageCitations.push({ source: match[1], url: match[2], desc: match[3] || 'Image' });
    cleanContent = cleanContent.replace(match[0], '[Image Ref]');
  }
  while ((match = sourceRegex.exec(content)) !== null) {
    sourceCitations.push({ source: match[1], page: match[2] });
    cleanContent = cleanContent.replace(match[0], `[Page ${match[2]}]`);
  }
  return { cleanContent, audioCitations, imageCitations, sourceCitations };
};

const typeIcon = (type: Modality) => {
  if (type === 'image') return <ImageIcon size={11} />;
  if (type === 'audio') return <PlayCircle size={11} />;
  return <FileText size={11} />;
};

/* ─── Sub-components ───────────────────────────────────────────────────────── */

function StatusDot({ status }: { status: UploadedDoc['status'] }) {
  return (
    <span style={{
      position: 'relative',
      display: 'inline-flex',
      width: 7, height: 7, borderRadius: '50%',
      background: status === 'ready' ? 'var(--green)' : 'var(--amber)',
      boxShadow: status === 'ready' ? '0 0 6px var(--green)' : '0 0 6px var(--amber)',
    }} />
  );
}

function SourceChip({ doc, onToggle, onRemove }: {
  doc: UploadedDoc;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px',
        borderRadius: 12,
        border: `1px solid ${doc.selected ? 'var(--accent-mid)' : hovered ? 'var(--border-hi)' : 'transparent'}`,
        background: doc.selected ? 'var(--accent-lo)' : hovered ? 'rgba(255,255,255,0.03)' : 'transparent',
        cursor: 'pointer',
        transition: 'all .15s ease',
        userSelect: 'none',
      }}
    >
      <StatusDot status={doc.status} />
      <span style={{
        color: doc.selected ? 'var(--accent)' : 'var(--text-3)',
        display: 'flex', alignItems: 'center',
        transition: 'color .15s',
      }}>
        {typeIcon(doc.type)}
      </span>
      <span style={{
        fontSize: 11,
        fontWeight: 500,
        color: doc.selected ? 'var(--text-1)' : 'var(--text-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, minWidth: 0,
        transition: 'color .15s',
        letterSpacing: '.01em',
      }}>
        {doc.name}
      </span>
      {hovered && (
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: 6,
            background: 'rgba(255,80,80,0.1)',
            border: 'none', cursor: 'pointer', color: '#ff6060',
            flexShrink: 0,
          }}
        >
          <Trash2 size={9} />
        </button>
      )}
    </div>
  );
}

function UserBubble({ content, avatar }: { content: string; avatar: string }) {
  return (
    <div className="fade-up" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 12 }}>
      <div style={{
        maxWidth: '58%',
        background: 'linear-gradient(135deg, #7c6aff 0%, #5a4de0 100%)',
        borderRadius: '18px 18px 4px 18px',
        padding: '12px 18px',
        boxShadow: '0 4px 24px rgba(124,106,255,0.2), 0 1px 0 rgba(255,255,255,0.08) inset',
      }}>
        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: '#fff', fontWeight: 400 }}>{content}</p>
      </div>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        overflow: 'hidden', flexShrink: 0,
        border: '1.5px solid rgba(255,255,255,0.1)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
      }}>
        <img src={avatar} alt="You" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    </div>
  );
}

function BotBubble({
  content, avatar, isStreaming,
  audioCitations, imageCitations, sourceCitations,
}: {
  content: string; avatar: string; isStreaming: boolean;
  audioCitations: any[]; imageCitations: any[]; sourceCitations: any[];
}) {
  return (
    <div className="fade-up" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        overflow: 'hidden', flexShrink: 0, marginTop: 2,
        border: '1.5px solid rgba(124,106,255,0.3)',
        boxShadow: '0 0 12px rgba(124,106,255,0.15)',
      }}>
        <img src={avatar} alt="AI" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>

      <div style={{ flex: 1, minWidth: 0, maxWidth: '66%' }}>
        {/* Label */}
        <div style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '.08em',
          color: 'var(--text-3)', textTransform: 'uppercase',
          marginBottom: 6, paddingLeft: 2,
        }}>
          Response
        </div>

        <div style={{
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: '4px 18px 18px 18px',
          padding: '14px 18px',
          boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* subtle left accent */}
          <div style={{
            position: 'absolute', left: 0, top: '20%', bottom: '20%',
            width: 2, borderRadius: 2,
            background: 'linear-gradient(to bottom, transparent, var(--accent), transparent)',
            opacity: 0.5,
          }} />
          <p style={{
            fontSize: 13.5, lineHeight: 1.72, color: 'var(--text-1)',
            whiteSpace: 'pre-wrap', fontWeight: 300,
            letterSpacing: '.01em',
          }}>
            {content}
            {isStreaming && (
              <span style={{
                display: 'inline-block', width: 2, height: 14,
                background: 'var(--accent)', borderRadius: 2,
                marginLeft: 2, verticalAlign: 'text-bottom',
                animation: 'blink 1s ease infinite',
              }} />
            )}
          </p>
        </div>

        {/* Citations */}
        {(imageCitations.length > 0 || audioCitations.length > 0 || sourceCitations.length > 0) && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {imageCitations.map((img, i) => (
              <div key={i} style={{
                width: 140, borderRadius: 12,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                overflow: 'hidden',
              }}>
                <div style={{ height: 72, overflow: 'hidden' }}>
                  {img.url.startsWith('http')
                    ? <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: .7 }} />
                    : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <ImageIcon size={14} color="var(--text-3)" />
                      </div>}
                </div>
                <div style={{ padding: '6px 10px' }}>
                  <p style={{ fontSize: 10, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.desc}</p>
                </div>
              </div>
            ))}
            {audioCitations.map((aud, i) => (
              <button key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px', borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                cursor: 'pointer', color: 'inherit',
              }}>
                <PlayCircle size={12} color="var(--accent)" />
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontSize: 10, color: 'var(--text-1)', fontWeight: 500 }}>{aud.speaker}</p>
                  <p style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'monospace' }}>{aud.start}–{aud.end}s</p>
                </div>
              </button>
            ))}
            {sourceCitations.map((src, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
              }}>
                <FileText size={10} color="var(--accent)" style={{ opacity: .6 }} />
                <span style={{ fontSize: 10, color: 'var(--text-2)', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.source}</span>
                <span style={{
                  fontSize: 9, color: 'var(--accent)',
                  background: 'var(--accent-lo)',
                  padding: '2px 6px', borderRadius: 4,
                  fontFamily: 'monospace',
                }}>p.{src.page}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ avatar }: { avatar: string }) {
  return (
    <div className="fade-up" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        border: '1.5px solid rgba(124,106,255,0.3)',
      }}>
        <img src={avatar} alt="AI" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '12px 18px',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: '4px 18px 18px 18px',
      }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
          <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
          <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Zap size={10} color="var(--accent)" /> Synthesizing
        </span>
      </div>
    </div>
  );
}

/* ─── Main App ─────────────────────────────────────────────────────────────── */
export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState('');
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [isTyping, setIsTyping]   = useState(false);
  const [isBooting, setIsBooting] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLInputElement>(null);

  /* Inject global CSS once */
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
    fetch(`${apiUrl}/api/v1/wakeup`).then(() => setIsBooting(false)).catch(() => setIsBooting(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  /* ── Upload ── */
  const onDrop = async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      let type: Modality = 'pdf';
      if (file.type.startsWith('image/')) type = 'image';
      else if (file.type.startsWith('audio/') || file.type.startsWith('video/')) type = 'audio';
      const tempId = Math.random().toString(36).substring(7);
      setDocuments(prev => [{ id: tempId, name: file.name, type, status: 'processing', selected: true }, ...prev]);
      const formData = new FormData();
      formData.append('file', file); formData.append('collection_id', 'default');
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const res  = await fetch(`${apiUrl}/api/v1/ingest`, { method: 'POST', body: formData });
        const data = await res.json();
        setDocuments(prev => prev.map(d => d.id === tempId ? { ...d, status: 'ready', jobId: data.job_id, sourceId: data.b2_file_key } : d));
      } catch {
        setDocuments(prev => prev.filter(d => d.id !== tempId));
      }
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  /* ── Send ── */
  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const userMsg = input.trim();
    const msgId   = Math.random().toString(36).substring(7);
    setMessages(prev => [...prev, { role: 'user', content: userMsg, id: msgId }]);
    setInput('');
    setIsTyping(true);
    const botMsgId = Math.random().toString(36).substring(7);
    setMessages(prev => [...prev, { role: 'bot', content: '', id: botMsgId }]);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const selectedSourceIds = documents.filter(d => d.selected && d.status === 'ready' && d.sourceId).map(d => d.sourceId!);
      const res = await fetch(`${apiUrl}/api/v1/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg, top_k: 5, selected_source_ids: selectedSourceIds }),
      });
      if (!res.ok) throw new Error('Query failed');
      const reader  = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split('\n')) {
            if (line.startsWith('data: ') && line !== 'data: [DONE]')
              setMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, content: m.content + line.replace('data: ', '') } : m));
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === botMsgId && m.content === '' ? { ...m, content: 'An error occurred.' } : m));
    } finally {
      setIsTyping(false);
    }
  };

  const toggleSource = (id: string) => setDocuments(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d));
  const removeSource = (id: string) => setDocuments(prev => prev.filter(d => d.id !== id));
  const areAllSelected = documents.length > 0 && documents.every(d => d.selected);
  const toggleAll = () => setDocuments(prev => prev.map(d => ({ ...d, selected: !areAllSelected })));
  const isProcessing = documents.some(d => d.status === 'processing');

  /* ── Boot screen ── */
  if (isBooting) {
    return (
      <div className="grain" style={{
        height: '100vh', width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 32, animation: 'fadeUp .6s ease both' }}>
          <img src={logo} alt="Logo" style={{ width: 300, height: 300, objectFit: 'contain' }} />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
              <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
              <span className="dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'block' }} />
            </div>
            <p style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 20, letterSpacing: '.25em', textTransform: 'uppercase' }}>
              Initializing OmniRAG...
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main UI ── */
  return (
    <div className="grain" style={{
      height: '100vh', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)',
      padding: 20,
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'fixed', width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(124,106,255,0.04) 0%, transparent 70%)',
        top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }} />

      {/* ── Outer shell ── */}
      <div style={{
        width: '100%', maxWidth: 1100,
        height: '100%', maxHeight: 820,
        borderRadius: 'var(--radius-2xl)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        display: 'flex',
        overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(255,255,255,0.03), 0 24px 80px rgba(0,0,0,0.6)',
        position: 'relative',
      }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: 240,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid var(--border)',
          background: 'var(--bg)',
        }}>

          {/* Logo */}
          <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{
              width: '100%', aspectRatio: '1',
              borderRadius: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 16,
            }}>
              <img src={logo} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
          </div>

          {/* Upload */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <div {...getRootProps()} style={{
              padding: '11px 14px',
              borderRadius: 14,
              border: `1px dashed ${isDragActive ? 'var(--accent)' : 'var(--border-hi)'}`,
              background: isDragActive ? 'var(--accent-lo)' : 'transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              transition: 'all .2s ease',
            }}>
              <UploadCloud size={14} color={isDragActive ? 'var(--accent)' : 'var(--text-3)'} style={{ flexShrink: 0 }} />
              <div>
                <p style={{ fontSize: 12, fontWeight: 500, color: isDragActive ? 'var(--accent)' : 'var(--text-2)' }}>
                  {isDragActive ? 'Drop to upload' : 'Upload files'}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>PDF · Image · Audio</p>
              </div>
              <input {...getInputProps()} />
            </div>
          </div>

          {/* Sources */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
                Sources
                {documents.length > 0 && (
                  <span style={{ color: 'var(--accent)', opacity: .7 }}>
                    {' '}({documents.filter(d => d.selected).length}/{documents.length})
                  </span>
                )}
              </span>
              {documents.length > 1 && (
                <button onClick={toggleAll} style={{
                  fontSize: 10, color: 'var(--accent)', background: 'none',
                  border: 'none', cursor: 'pointer', fontWeight: 500,
                  fontFamily: 'var(--sans)',
                }}>
                  {areAllSelected ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>

            {/* Source list box */}
            <div style={{
              flex: 1, borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.01)',
              overflow: 'hidden',
            }}>
              {documents.length === 0 ? (
                <div style={{
                  height: '100%', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: 16,
                }}>
                  <FileText size={16} color="var(--text-3)" style={{ opacity: .4 }} />
                  <p style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.5, opacity: .6 }}>
                    No sources uploaded yet
                  </p>
                </div>
              ) : (
                <div style={{ height: '100%', overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {documents.map(doc => (
                    <SourceChip
                      key={doc.id} doc={doc}
                      onToggle={() => toggleSource(doc.id)}
                      onRemove={() => removeSource(doc.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar footer */}
          <div style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ position: 'relative', width: 7, height: 7 }} className="pulse-ring">
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', position: 'relative', zIndex: 1 }} />
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: '.05em' }}>System online</span>
          </div>
        </aside>

        {/* ── Chat main ── */}
        <main style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg)',
        }}>

          {/* Top bar */}
          <div style={{
            padding: '16px 28px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <div>
              <h1 style={{
                fontFamily: 'var(--serif)',
                fontSize: 20, fontWeight: 400,
                color: 'var(--text-1)',
                letterSpacing: '.01em',
              }}>
                OmniRAG Intelligence Console
              </h1>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, letterSpacing: '.04em' }}>
                Multimodal Retrieval-augmented synthesis
              </p>
            </div>
            {documents.filter(d => d.selected && d.status === 'ready').length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 8,
                background: 'var(--accent-lo)',
                border: '1px solid var(--accent-mid)',
              }}>
                <Sparkles size={10} color="var(--accent)" />
                <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 500 }}>
                  {documents.filter(d => d.selected && d.status === 'ready').length} source{documents.filter(d => d.selected && d.status === 'ready').length !== 1 ? 's' : ''} active
                </span>
              </div>
            )}
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, minHeight: 0,
            overflowY: 'auto',
            padding: '28px 28px 12px',
            display: 'flex', flexDirection: 'column', gap: 20,
          }}>
            {messages.length === 0 ? (
              <div style={{
                height: '100%',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                textAlign: 'center', animation: 'fadeUp .5s ease both',
              }}>
                {/* Icon */}
                <div style={{ position: 'relative', marginBottom: 28 }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: 20,
                    background: 'var(--accent-lo)',
                    border: '1px solid var(--accent-mid)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Sparkles size={26} color="var(--accent)" style={{ opacity: .8 }} />
                  </div>
                </div>

                <h2 style={{
                  fontFamily: 'var(--serif)',
                  fontSize: 26, fontWeight: 400,
                  color: 'var(--text-1)', marginBottom: 10,
                  letterSpacing: '-.01em',
                }}>
                  What do you want to know?
                </h2>
                <p style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 280, lineHeight: 1.6, marginBottom: 28 }}>
                  Upload your documents, select sources, and ask anything about them.
                </p>

                {/* Suggestion chips */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {['Summarize this document', 'List key findings', 'Compare sources', 'Extract key dates'].map(s => (
                    <button
                      key={s}
                      onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px',
                        borderRadius: 10,
                        border: '1px solid var(--border-hi)',
                        background: 'transparent',
                        cursor: 'pointer', color: 'var(--text-2)',
                        fontSize: 12, fontWeight: 400,
                        fontFamily: 'var(--sans)',
                        transition: 'all .15s ease',
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLElement).style.color = 'var(--text-1)';
                        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hi)';
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLElement).style.color = 'var(--text-2)';
                        (e.currentTarget as HTMLElement).style.background = 'transparent';
                      }}
                    >
                      {s}
                      <ChevronRight size={10} style={{ opacity: .5 }} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => {
                if (msg.role === 'user') {
                  return <UserBubble key={msg.id} content={msg.content} avatar={userAvatar} />;
                }
                const { cleanContent, audioCitations, imageCitations, sourceCitations } = parseMessageContent(msg.content);
                const isLastBot = isTyping && i === messages.length - 1;
                return (
                  <BotBubble
                    key={msg.id}
                    content={cleanContent}
                    avatar={aiAvatar}
                    isStreaming={isLastBot}
                    audioCitations={audioCitations}
                    imageCitations={imageCitations}
                    sourceCitations={sourceCitations}
                  />
                );
              })
            )}

            {isTyping && messages[messages.length - 1]?.content === '' && (
              <ThinkingIndicator avatar={aiAvatar} />
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input bar ── */}
          <div style={{ padding: '16px 24px 20px', flexShrink: 0 }}>
            {/* Processing notice */}
            {isProcessing && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginBottom: 10, padding: '6px 12px', borderRadius: 8,
                background: 'rgba(240,164,58,0.06)',
                border: '1px solid rgba(240,164,58,0.15)',
                width: 'fit-content',
              }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--amber)', display: 'inline-block' }} />
                <span style={{ fontSize: 10, color: 'var(--amber)', letterSpacing: '.04em' }}>Processing uploads…</span>
              </div>
            )}

            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '4px 6px 4px 18px',
              borderRadius: 16,
              border: `1px solid ${inputFocused ? 'rgba(124,106,255,0.35)' : 'var(--border-hi)'}`,
              background: inputFocused ? 'rgba(124,106,255,0.04)' : 'var(--surface)',
              boxShadow: inputFocused ? '0 0 0 3px rgba(124,106,255,0.06)' : 'none',
              transition: 'all .2s ease',
              opacity: isProcessing ? .5 : 1,
            }}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={isProcessing ? 'Processing files…' : isTyping ? 'Synthesizing…' : 'Ask anything about your documents…'}
                disabled={isProcessing || isTyping}
                style={{
                  flex: 1, background: 'transparent',
                  border: 'none', outline: 'none',
                  fontSize: 13.5, color: 'var(--text-1)',
                  fontFamily: 'var(--sans)', fontWeight: 400,
                  padding: '12px 0',
                  caretColor: 'var(--accent)',
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping || isProcessing}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 38, height: 38, borderRadius: 12,
                  border: 'none', cursor: input.trim() && !isTyping && !isProcessing ? 'pointer' : 'default',
                  background: input.trim() && !isTyping && !isProcessing
                    ? 'linear-gradient(135deg, #7c6aff, #5a4de0)'
                    : 'rgba(255,255,255,0.04)',
                  boxShadow: input.trim() && !isTyping && !isProcessing
                    ? '0 4px 12px rgba(124,106,255,0.3)'
                    : 'none',
                  transition: 'all .2s ease',
                  flexShrink: 0,
                }}
              >
                <Send size={14} color={input.trim() && !isTyping && !isProcessing ? '#fff' : 'var(--text-3)'} />
              </button>
            </div>

            <p style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', marginTop: 10, letterSpacing: '.04em' }}>
              Press Enter to send · responses are AI-generated
            </p>
          </div>

        </main>
      </div>
      {/* Vercel Monitoring */}
      <Analytics />
      <SpeedInsights />
    </div>
  );
}

