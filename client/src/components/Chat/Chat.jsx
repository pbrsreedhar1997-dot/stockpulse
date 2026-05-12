import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../../hooks/useChat';
import { useAppContext } from '../../contexts/AppContext';
import './Chat.scss';

function predictQuestion(sym) {
  return `Give me a complete price prediction for ${sym} using the 4-model ensemble framework. ` +
    `Show ensemble scores for Technical, Fundamental, Sentiment, and Macro models (0–100 each). ` +
    `Then provide bear/base/bull price targets for 1-month, 6-month, and 12-month horizons. ` +
    `Include DCF fair value estimate, ATR-based risk, VWAP and Ichimoku cloud signal, and overall prediction confidence.`;
}

const QUICK_ACTIONS = [
  { label: '🔮 Predict Reliance',      question: predictQuestion('RELIANCE.NS') },
  { label: '🔮 Predict TCS',           question: predictQuestion('TCS.NS')       },
  { label: '🔮 Predict Infosys',       question: predictQuestion('INFY.NS')      },
  { label: '📊 Analyse HDFC Bank',     question: 'Give me a full analysis of HDFC Bank — fundamentals, technicals, news sentiment, and price targets.' },
  { label: '📈 TCS Technicals',        question: 'What is the technical setup for TCS? Cover MA cross, RSI, MACD, Bollinger Bands, ATR, and volume trend.' },
  { label: '💰 Nifty50 Valuation',     question: 'Is the Nifty50 fairly valued right now? Analyse trailing P/E, EPS growth, DII/FII flows, and macro outlook.' },
  { label: '📰 Adani News Sentiment',  question: 'What does the recent news say about Adani Enterprises? Summarise sentiment and key themes.' },
  { label: '🌍 Macro Outlook',         question: 'What is the current macroeconomic environment? Cover interest rates, inflation, yield curve, and impact on Indian IT and banking sectors.' },
];

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:var(--card2);padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 6px;font-size:14px;color:var(--accent)">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 8px;font-size:16px">$1</h3>')
    .replace(/^\- (.+)$/gm, '<li style="margin:3px 0 3px 16px">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

function fmtDate(ts) {
  const d = new Date(Number(ts) * 1000);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ── History sidebar ───────────────────────────────────────────────────────── */
function HistorySidebar({ open, onClose, token, sessionId, onLoad, onDelete, onNew }) {
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [deleting, setDeleting] = useState(null);

  const loadSessions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/chat/sessions', { headers: { 'Authorization': `Bearer ${token}` } });
      const d = await r.json();
      if (d.ok) setSessions(d.sessions);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (open && token) loadSessions(); }, [open, token]);

  async function handleDelete(e, id) {
    e.stopPropagation();
    setDeleting(id);
    await onDelete(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setDeleting(null);
  }

  return (
    <div className={`chat-history ${open ? 'chat-history--open' : ''}`}>
      <div className="chat-history__header">
        <span className="chat-history__title">Chat History</span>
        <button className="chat-history__close" onClick={onClose} title="Close">✕</button>
      </div>

      <button className="chat-history__new" onClick={() => { onNew(); onClose(); }}>
        <span>+</span> New Chat
      </button>

      <div className="chat-history__list">
        {!token ? (
          <div className="chat-history__empty">Sign in to save and view chat history.</div>
        ) : loading ? (
          <div className="chat-history__empty">Loading…</div>
        ) : !sessions.length ? (
          <div className="chat-history__empty">No saved chats yet. Start a conversation!</div>
        ) : sessions.map(s => (
          <div
            key={s.id}
            className={`chat-history__item ${s.id === sessionId ? 'chat-history__item--active' : ''}`}
            onClick={() => { onLoad(s.id); onClose(); }}
          >
            <div className="chat-history__item-title">{s.title}</div>
            <div className="chat-history__item-meta">{fmtDate(s.updated_at)}</div>
            <button
              className="chat-history__item-del"
              onClick={e => handleDelete(e, s.id)}
              title="Delete"
              disabled={deleting === s.id}
            >
              {deleting === s.id ? '…' : '×'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main Chat component ───────────────────────────────────────────────────── */
export default function Chat() {
  const { state } = useAppContext();
  const { messages, streaming, sessionId, send, stop, clear, loadSession, deleteSession } = useChat();
  const [input,       setInput]       = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef       = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (question) => {
    const q = question || input.trim();
    if (!q) return;
    setInput('');
    // Always pass the currently viewed stock so the AI can fetch its live price
    // even when the question doesn't mention a stock name ("what's the price?")
    const ctxSymbols = state.currentSymbol ? [state.currentSymbol] : [];
    send(q, { symbols: ctxSymbols });
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="chat">
      {/* ── History sidebar ── */}
      <HistorySidebar
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        token={state.token}
        sessionId={sessionId}
        onLoad={loadSession}
        onDelete={deleteSession}
        onNew={clear}
      />

      {/* ── Header ── */}
      <div className="chat__header">
        <button
          className={`chat__history-btn ${historyOpen ? 'chat__history-btn--active' : ''}`}
          onClick={() => setHistoryOpen(o => !o)}
          title="Chat history"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        </button>
        <div className="chat__header-info">
          <h2 className="chat__title">AI Stock Analyst</h2>
          <p className="chat__sub">Predict prices · Analyse stocks · News sentiment · Macro trends</p>
        </div>
        <div className="chat__header-actions">
          {messages.length > 0 && (
            <button className="chat__clear" onClick={clear} title="New chat">New chat</button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="chat__messages">
        {messages.length === 0 ? (
          <div className="chat__welcome">
            <div className="chat__welcome-icon">
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="40" height="40" rx="8" stroke="none" fill="var(--accent-dim)"/>
                <polyline points="10 34 18 22 24 28 32 16 38 20" strokeWidth="2.5" stroke="var(--accent)"/>
                <circle cx="10" cy="34" r="2" fill="var(--accent)" stroke="none"/>
                <circle cx="18" cy="22" r="2" fill="var(--accent)" stroke="none"/>
                <circle cx="24" cy="28" r="2" fill="var(--accent)" stroke="none"/>
                <circle cx="32" cy="16" r="2" fill="var(--accent)" stroke="none"/>
                <circle cx="38" cy="20" r="2" fill="var(--accent)" stroke="none"/>
                <path d="M32 34h6M32 38h4" strokeWidth="2" stroke="var(--text3)"/>
              </svg>
            </div>
            <h3>AI Stock Analyst</h3>
            <p>Ask anything — predict prices, analyse fundamentals, check technicals, or explore news &amp; macro trends.</p>

            <div className="chat__quick-actions">
              {QUICK_ACTIONS.map(a => (
                <button
                  key={a.label}
                  className={`quick-btn ${a.label.startsWith('🔮') ? 'quick-btn--predict' : ''}`}
                  onClick={() => submit(a.question)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message message--${msg.role}`}>
              <div className="message__avatar">
                {msg.role === 'user'
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="7" r="4"/><path d="M2 21c0-5 4-9 10-9s10 4 10 9"/></svg>
                  : <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="40" height="40" rx="8" stroke="none" fill="var(--accent-dim)"/><polyline points="10 34 18 22 24 28 32 16 38 20" strokeWidth="2.5" stroke="var(--accent)"/></svg>
                }
              </div>
              <div className="message__bubble">
                {msg.role === 'assistant' ? (
                  <>
                    {!msg.content && streaming && i === messages.length - 1 ? (
                      <span className="message__thinking-dots"><span /><span /><span /></span>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }} />
                    )}
                  </>
                ) : (
                  <div>{msg.content}</div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick bar (mid-conversation) ── */}
      {messages.length > 0 && !streaming && (
        <div className="chat__quick-bar">
          {QUICK_ACTIONS.slice(0, 5).map(a => (
            <button
              key={a.label}
              className={`quick-btn quick-btn--sm ${a.label.startsWith('🔮') ? 'quick-btn--predict' : ''}`}
              onClick={() => submit(a.question)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Input area ── */}
      <div className="chat__input-area">
        <textarea
          ref={inputRef}
          className="chat__textarea"
          placeholder="Ask anything — predict a stock, check technicals, analyse fundamentals…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
        />
        {streaming ? (
          <button className="chat__send chat__send--stop" onClick={stop}>■ Stop</button>
        ) : (
          <button className="chat__send" onClick={() => submit()} disabled={!input.trim()}>Send ↑</button>
        )}
      </div>

      {/* ── History backdrop ── */}
      {historyOpen && <div className="chat-history__backdrop" onClick={() => setHistoryOpen(false)} />}
    </div>
  );
}
