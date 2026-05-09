import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import { fmtPrice } from '../../utils/currency';
import Portfolio from '../Portfolio/Portfolio';
import './WatchlistPortfolio.scss';

/* ── Markdown renderer (mirrors Chat.jsx) ──────────────────────────────────── */
function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="background:var(--card2);padding:1px 4px;border-radius:3px">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="margin:8px 0 4px;font-size:13px;color:var(--accent)">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 style="margin:10px 0 5px;font-size:14px">$1</h3>')
    .replace(/^\- (.+)$/gm,  '<li style="margin:2px 0 2px 14px">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g,   '<br/>');
}

/* ── Quick questions pre-wired to the portfolio ────────────────────────────── */
const PORTFOLIO_QUESTIONS = [
  { label: '📊 Portfolio health',  q: 'Give me an overall health check of my watchlist. Which stocks look strong and which are weak right now?' },
  { label: '🛒 Best buy now',      q: 'Which stock in my watchlist has the best buy opportunity right now based on technicals and valuation?' },
  { label: '⚠️ Biggest risks',    q: 'What are the top 3 risks across my current watchlist I should be aware of?' },
  { label: '📈 Top momentum',      q: 'Which stocks in my watchlist have the strongest price momentum right now?' },
];

/* ── Inline portfolio AI chat ──────────────────────────────────────────────── */
function PortfolioChat({ symbols, token }) {
  const [open,      setOpen]      = useState(false);
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [streaming, setStreaming]  = useState(false);
  const abortRef  = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function send(question) {
    const q = (question || input).trim();
    if (!q || streaming) return;
    setInput('');
    setOpen(true);

    setMessages(prev => [...prev,
      { role: 'user',      content: q },
      { role: 'assistant', content: '' },
    ]);
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ question: q, symbols, token }),
        signal:  ctrl.signal,
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'delta') {
              setMessages(prev => {
                const up   = [...prev];
                const last = up[up.length - 1];
                if (last?.role === 'assistant')
                  up[up.length - 1] = { ...last, content: last.content + ev.text };
                return up;
              });
            }
          } catch { /* malformed chunk — skip */ }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => {
          const up = [...prev];
          up[up.length - 1] = { role: 'assistant', content: 'Something went wrong — please try again.' };
          return up;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className={`wl-ai ${open ? 'wl-ai--open' : ''}`}>
      {/* ── Collapsed / toggle bar ─── */}
      <button className="wl-ai__toggle" onClick={() => setOpen(o => !o)}>
        <span className="wl-ai__toggle-icon">✦</span>
        <span className="wl-ai__toggle-label">Ask AI about your watchlist</span>
        <span className="wl-ai__toggle-chevron">{open ? '▾' : '▴'}</span>
      </button>

      {open && (
        <div className="wl-ai__body">
          {/* ── Quick-question chips (show when no messages or between responses) ── */}
          {!streaming && (
            <div className="wl-ai__chips">
              {PORTFOLIO_QUESTIONS.map(a => (
                <button key={a.label} className="wl-ai__chip" onClick={() => send(a.q)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* ── Message thread ─── */}
          {messages.length > 0 && (
            <div className="wl-ai__messages">
              {messages.map((m, i) => (
                <div key={i} className={`wl-ai__msg wl-ai__msg--${m.role}`}>
                  {m.role === 'assistant' ? (
                    m.content
                      ? <div dangerouslySetInnerHTML={{ __html: parseMarkdown(m.content) }} />
                      : <span className="wl-ai__dots"><span/><span/><span/></span>
                  ) : m.content}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}

          {/* ── Input row ─── */}
          <div className="wl-ai__input-row">
            <input
              className="wl-ai__input"
              placeholder="Ask about your portfolio…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={streaming}
              autoComplete="off"
            />
            {streaming ? (
              <button className="wl-ai__send wl-ai__send--stop" onClick={stop} title="Stop">■</button>
            ) : (
              <button className="wl-ai__send" onClick={() => send()} disabled={!input.trim()} title="Send">↑</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Drag handle SVG ────────────────────────────────────────────────────────── */
function DragHandle() {
  return (
    <svg className="wl-row__drag-handle" viewBox="0 0 16 24" fill="currentColor">
      <circle cx="5" cy="5"  r="1.5"/><circle cx="11" cy="5"  r="1.5"/>
      <circle cx="5" cy="12" r="1.5"/><circle cx="11" cy="12" r="1.5"/>
      <circle cx="5" cy="19" r="1.5"/><circle cx="11" cy="19" r="1.5"/>
    </svg>
  );
}

/* ── Row ────────────────────────────────────────────────────────────────────── */
function WatchlistRow({
  stock, active, onPick, onRemove, quote,
  draggable, isDragging, isDropTarget, dropEdge,
  onDragStart, onDragEnter, onDragLeave, onDragOver, onDrop, onDragEnd,
}) {
  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (quote?.price == null) return;
    if (prevPriceRef.current != null && prevPriceRef.current !== quote.price) {
      setFlash(quote.price > prevPriceRef.current ? 'flash-up' : 'flash-down');
      const t = setTimeout(() => setFlash(''), 700);
      prevPriceRef.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPriceRef.current = quote.price;
  }, [quote?.price]);

  const up = (quote?.change_pct ?? 0) >= 0;

  const cls = [
    'wl-row',
    active       ? 'wl-row--active'      : '',
    isDragging   ? 'wl-row--dragging'    : '',
    isDropTarget ? `wl-row--drop-${dropEdge}` : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onPick}
    >
      {draggable && <DragHandle />}

      <div className="wl-row__info">
        <span className="wl-row__symbol">{stock.symbol.replace(/\.(NS|BO)$/i, '')}</span>
        <span className="wl-row__name">{stock.name}</span>
      </div>

      <div className="wl-row__right">
        {quote ? (
          <div className="wl-row__prices">
            <span className={`wl-row__price ${flash}`}>{fmtPrice(quote.price, quote.currency)}</span>
            <span className={`wl-row__chg ${up ? 'up' : 'down'}`}>
              {up ? '+' : ''}{quote.change_pct?.toFixed(2)}%
            </span>
          </div>
        ) : (
          <span className="skeleton" style={{ width: 72, height: 14, display: 'block', borderRadius: 4 }} />
        )}
        <button
          className="wl-row__rm"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="Remove from watchlist"
        >×</button>
      </div>
    </div>
  );
}

/* ── Sort options ───────────────────────────────────────────────────────────── */
const SORT_OPTIONS = [
  { key: 'manual',  label: '⠿ Drag'    },
  { key: 'name',    label: 'Name'      },
  { key: 'price',   label: 'Price'     },
  { key: 'change',  label: '% Change'  },
];

/* ── Main component ─────────────────────────────────────────────────────────── */
export default function WatchlistPortfolio() {
  const { state, dispatch } = useAppContext();
  const { remove } = useWatchlist();
  const { watchlist, quotes, currentSymbol } = state;
  const [tab, setTab]     = useState('watchlist');
  const [sortBy, setSortBy] = useState('manual');

  /* Drag state */
  const dragFromIdx = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [dropEdge, setDropEdge]       = useState('top'); // 'top' | 'bottom'

  const pick = (symbol) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
  };

  const todaySummary = useMemo(() => {
    if (!watchlist.length) return null;
    let up = 0, down = 0, totalChg = 0, count = 0;
    watchlist.forEach(s => {
      const q = quotes[s.symbol];
      if (q?.change_pct != null) {
        totalChg += q.change_pct;
        count++;
        if (q.change_pct >= 0) up++; else down++;
      }
    });
    if (!count) return null;
    return { up, down, avg: totalChg / count };
  }, [watchlist, quotes]);

  const sortedList = useMemo(() => {
    if (sortBy === 'manual') return watchlist;
    return [...watchlist].sort((a, b) => {
      const qa = quotes[a.symbol], qb = quotes[b.symbol];
      if (sortBy === 'name')   return a.name.localeCompare(b.name);
      if (sortBy === 'price')  return (qb?.price ?? 0) - (qa?.price ?? 0);
      if (sortBy === 'change') return (qb?.change_pct ?? 0) - (qa?.change_pct ?? 0);
      return 0;
    });
  }, [watchlist, quotes, sortBy]);

  /* ── Drag handlers ───────────────────────────────────────────────────────── */
  function getEdge(e, el) {
    const rect = el.getBoundingClientRect();
    return (e.clientY - rect.top) < rect.height / 2 ? 'top' : 'bottom';
  }

  function handleDragStart(e, idx) {
    dragFromIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    /* slightly delay so the ghost image looks right */
    setTimeout(() => setDragOverIdx(idx), 0);
  }

  function handleDragOver(e, idx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
    setDropEdge(getEdge(e, e.currentTarget));
  }

  function handleDrop(e, toIdx) {
    e.preventDefault();
    const fromIdx = dragFromIdx.current;
    if (fromIdx == null || fromIdx === toIdx) { reset(); return; }

    /* If dropping on bottom half of a row, insert after it */
    const edge = getEdge(e, e.currentTarget);
    const adjustedTo = edge === 'bottom' && toIdx >= fromIdx
      ? toIdx
      : edge === 'bottom' && toIdx < fromIdx
      ? toIdx + 1
      : toIdx > fromIdx
      ? toIdx - 1
      : toIdx;

    dispatch({ type: 'REORDER_WATCHLIST', payload: { fromIdx, toIdx: adjustedTo } });
    reset();
  }

  function reset() {
    dragFromIdx.current = null;
    setDragOverIdx(null);
  }

  const symbols = watchlist.map(s => s.symbol);

  return (
    <div className="mylist">
      <div className="tab-bar">
        <button
          className={`tab-bar__tab ${tab === 'watchlist' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('watchlist')}
        >
          Watchlist
          {watchlist.length > 0 && <span className="mylist__badge">{watchlist.length}</span>}
        </button>
        <button
          className={`tab-bar__tab ${tab === 'portfolio' ? 'tab-bar__tab--active' : ''}`}
          onClick={() => setTab('portfolio')}
        >
          Portfolio
        </button>
      </div>

      <div className="tab-content mylist__content">
        {tab === 'watchlist' && todaySummary && (
          <div className="wl-today-bar">
            <span className="wl-today-bar__label">Today</span>
            <span className="wl-today-bar__up">▲ {todaySummary.up}</span>
            <span className="wl-today-bar__down">▼ {todaySummary.down}</span>
            <span className={`wl-today-bar__avg ${todaySummary.avg >= 0 ? 'up' : 'down'}`}>
              Avg {todaySummary.avg >= 0 ? '+' : ''}{todaySummary.avg.toFixed(2)}%
            </span>
          </div>
        )}

        {tab === 'watchlist' && (
          watchlist.length === 0 ? (
            <div className="mylist__empty">
              <img
                className="mylist__empty-anime"
                src="https://media.giphy.com/media/fmXgCpO3IhesE/giphy.gif"
                alt=""
                loading="lazy"
              />
              <div className="mylist__empty-title">Your watchlist is empty</div>
              <div className="mylist__empty-sub">Search for a stock and add it to track prices here.</div>
            </div>
          ) : (
            <>
              {/* Sort bar */}
              <div className="wl-sort-bar">
                <span className="wl-sort-bar__label">Sort:</span>
                {SORT_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    className={`wl-sort-chip ${sortBy === opt.key ? 'wl-sort-chip--active' : ''}`}
                    onClick={() => setSortBy(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
                {sortBy === 'manual' && (
                  <span className="wl-sort-bar__hint">drag rows to reorder</span>
                )}
              </div>

              <div
                className="wl-list"
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) reset(); }}
              >
                {sortedList.map((stock, idx) => {
                  const origIdx = watchlist.findIndex(s => s.symbol === stock.symbol);
                  return (
                    <WatchlistRow
                      key={stock.symbol}
                      stock={stock}
                      active={stock.symbol === currentSymbol}
                      quote={quotes[stock.symbol]}
                      draggable={sortBy === 'manual'}
                      isDragging={dragFromIdx.current === origIdx}
                      isDropTarget={dragOverIdx === idx && dragFromIdx.current !== origIdx}
                      dropEdge={dropEdge}
                      onPick={() => pick(stock.symbol)}
                      onRemove={() => remove(stock.symbol)}
                      onDragStart={e => handleDragStart(e, origIdx)}
                      onDragEnter={e => e.preventDefault()}
                      onDragLeave={() => {}}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={e => handleDrop(e, origIdx)}
                      onDragEnd={reset}
                    />
                  );
                })}
              </div>
            </>
          )
        )}

        {tab === 'portfolio' && <Portfolio />}
      </div>

      {tab === 'watchlist' && watchlist.length > 0 && (
        <PortfolioChat symbols={symbols} token={state.token} />
      )}
    </div>
  );
}
