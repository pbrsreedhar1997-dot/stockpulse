import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../hooks/useChat';
import { useAppContext } from '../../contexts/AppContext';
import './Chat.scss';

const QUICK_ACTIONS = [
  { label: '📊 Full Analysis',   question: 'Give me a full analysis — fundamentals, technicals, news sentiment, ensemble score, and bear/base/bull price targets.' },
  { label: '📈 Technical Setup', question: 'What is the technical setup? Cover MA cross, RSI, MACD, Bollinger Bands, and volume trend.' },
  { label: '💰 Fundamentals',    question: 'How are the fundamentals? P/E, margins, ROE, debt levels, and revenue growth.' },
  { label: '📰 News Sentiment',  question: 'What does the recent news say? Summarise sentiment and the key themes.' },
  { label: '⚠️ Key Risks',       question: 'What are the top risks that could push the price down?' },
  { label: '🎯 Price Targets',   question: 'What are the bear, base, and bull case price targets for the next 30 days?' },
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
              ? <>Active: <strong>{currentStock.symbol.replace(/\.(NS|BO)$/i, '')}</strong>{currentStock.name ? ` — ${currentStock.name}` : ''}</>
              : 'Select a stock first, then ask anything about it'}
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
            <h3>
              {currentStock
                ? `Ask me anything about ${currentStock.symbol.replace(/\.(NS|BO)$/i, '')}`
                : 'AI Stock Analyst'}
            </h3>
            <p>
              {currentStock
                ? 'I already have the live price, technicals (RSI, MACD, Bollinger Bands), fundamentals, and news sentiment loaded. Just ask.'
                : 'Select a stock from the Stock tab first. I\'ll have its live data, technicals, and news ready for your questions.'}
            </p>
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
