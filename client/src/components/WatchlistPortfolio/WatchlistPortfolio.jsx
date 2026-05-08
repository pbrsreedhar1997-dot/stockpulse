import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import Portfolio from '../Portfolio/Portfolio';
import './WatchlistPortfolio.scss';

function fmt(n) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function WatchlistRow({ stock, active, onPick, onRemove, onMoveUp, onMoveDown, canUp, canDown, quote, showReorder }) {
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

  return (
    <div className={`wl-row ${active ? 'wl-row--active' : ''}`} onClick={onPick}>
      {showReorder && (
        <div className="wl-row__order" onClick={e => e.stopPropagation()}>
          <button className="wl-row__mv" disabled={!canUp} onClick={onMoveUp} title="Move up">▲</button>
          <button className="wl-row__mv" disabled={!canDown} onClick={onMoveDown} title="Move down">▼</button>
        </div>
      )}

      <div className="wl-row__info">
        <span className="wl-row__symbol">{stock.symbol.replace(/\.(NS|BO)$/i, '')}</span>
        <span className="wl-row__name">{stock.name}</span>
      </div>

      <div className="wl-row__right">
        {quote ? (
          <>
            <div className="wl-row__prices">
              <span className={`wl-row__price ${flash}`}>₹{fmt(quote.price)}</span>
              <span className={`wl-row__chg ${up ? 'up' : 'down'}`}>
                {up ? '+' : ''}{quote.change_pct?.toFixed(2)}%
              </span>
            </div>
          </>
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

const SORT_OPTIONS = [
  { key: 'manual',  label: '↕ Manual'  },
  { key: 'name',    label: 'Name'      },
  { key: 'price',   label: 'Price'     },
  { key: 'change',  label: '% Change'  },
];

export default function WatchlistPortfolio() {
  const { state, dispatch } = useAppContext();
  const { remove } = useWatchlist();
  const { watchlist, quotes, currentSymbol } = state;
  const [tab, setTab] = useState('watchlist');
  const [sortBy, setSortBy] = useState('manual');

  const pick = (symbol) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
  };

  const moveUp = (symbol) => dispatch({ type: 'MOVE_WATCHLIST_ITEM', payload: { symbol, direction: 'up' } });
  const moveDn = (symbol) => dispatch({ type: 'MOVE_WATCHLIST_ITEM', payload: { symbol, direction: 'down' } });

  const sortedList = useMemo(() => {
    if (sortBy === 'manual') return watchlist;
    return [...watchlist].sort((a, b) => {
      const qa = quotes[a.symbol];
      const qb = quotes[b.symbol];
      if (sortBy === 'name')   return a.name.localeCompare(b.name);
      if (sortBy === 'price')  return (qb?.price ?? 0) - (qa?.price ?? 0);
      if (sortBy === 'change') return (qb?.change_pct ?? 0) - (qa?.change_pct ?? 0);
      return 0;
    });
  }, [watchlist, quotes, sortBy]);

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
              </div>

              <div className="wl-list">
                {sortedList.map((stock, idx) => {
                  const origIdx = watchlist.findIndex(s => s.symbol === stock.symbol);
                  return (
                    <WatchlistRow
                      key={stock.symbol}
                      stock={stock}
                      active={stock.symbol === currentSymbol}
                      quote={quotes[stock.symbol]}
                      showReorder={sortBy === 'manual'}
                      canUp={origIdx > 0}
                      canDown={origIdx < watchlist.length - 1}
                      onPick={() => pick(stock.symbol)}
                      onRemove={() => remove(stock.symbol)}
                      onMoveUp={() => moveUp(stock.symbol)}
                      onMoveDown={() => moveDn(stock.symbol)}
                    />
                  );
                })}
              </div>
            </>
          )
        )}

        {tab === 'portfolio' && <Portfolio />}
      </div>
    </div>
  );
}
