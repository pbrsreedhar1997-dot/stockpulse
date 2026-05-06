import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../hooks/useChat';
import { useAppContext } from '../../contexts/AppContext';
import './Chat.scss';

const QUICK_ACTIONS = [
  { label: '📊 Analyze', question: 'Give me a comprehensive fundamental analysis of this stock.' },
  { label: '📈 Bullish?', question: 'What are the key bullish catalysts for this stock?' },
  { label: '⚠️ Risks', question: 'What are the main risks and bearish factors for this stock?' },
  { label: '💰 Valuation', question: 'Is this stock overvalued or undervalued based on its fundamentals?' },
  { label: '📰 News Impact', question: 'How does the recent news impact the stock outlook?' },
  { label: '🎯 Price Target', question: 'What is a reasonable 12-month price target for this stock?' },
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

export default function Chat() {
  const { state } = useAppContext();
  const { messages, streaming, send, stop, clear } = useChat();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submit = (question) => {
    const q = question || input.trim();
    if (!q) return;
    setInput('');
    send(q);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const currentStock = state.currentSymbol
    ? state.watchlist.find(s => s.symbol === state.currentSymbol) || { symbol: state.currentSymbol }
    : null;

  return (
    <div className="chat">
      <div className="chat__header">
        <div>
          <h2 className="chat__title">AI Stock Analyst</h2>
          <p className="chat__sub">
            {currentStock
              ? `Analyzing ${currentStock.symbol.replace('.NS', '').replace('.BO', '')} — ${currentStock.name || ''}`
              : 'Ask about any stock in your watchlist'}
          </p>
        </div>
        {messages.length > 0 && (
          <button className="chat__clear" onClick={clear}>Clear chat</button>
        )}
      </div>

      <div className="chat__messages">
        {messages.length === 0 ? (
          <div className="chat__welcome">
            <div className="chat__welcome-icon">🤖</div>
            <h3>Ask me about any stock</h3>
            <p>I'll analyze fundamentals, technicals, news, and give you a data-driven assessment.</p>
            <div className="chat__quick-actions">
              {QUICK_ACTIONS.map(a => (
                <button key={a.label} className="quick-btn" onClick={() => submit(a.question)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`message message--${msg.role}`}>
              <div className="message__avatar">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message__bubble">
                {msg.role === 'assistant' ? (
                  <div dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }} />
                ) : (
                  <div>{msg.content}</div>
                )}
                {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                  <span className="message__cursor" />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {messages.length > 0 && !streaming && (
        <div className="chat__quick-bar">
          {QUICK_ACTIONS.slice(0, 4).map(a => (
            <button key={a.label} className="quick-btn quick-btn--sm" onClick={() => submit(a.question)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="chat__input-area">
        <textarea
          ref={inputRef}
          className="chat__textarea"
          placeholder="Ask about fundamentals, valuation, news impact…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          rows={1}
        />
        {streaming ? (
          <button className="chat__send chat__send--stop" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="chat__send" onClick={() => submit()} disabled={!input.trim()}>
            Send ↑
          </button>
        )}
      </div>
    </div>
  );
}
