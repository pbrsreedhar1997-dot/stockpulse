import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import Portfolio from '../Portfolio/Portfolio';
import './WatchlistPortfolio.scss';

function fmt(n) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function WatchlistRow({ stock, active, onPick, onRemove, quote }) {
  const prevPriceRef = useRef(null);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    if (quote?.price == null) return;
    if (prevPriceRef.current != null && prevPriceRef.current !== quote.price) {
      const cls = quote.price > prevPriceRef.current ? 'flash-up' : 'flash-down';
      setFlash(cls);
      const t = setTimeout(() => setFlash(''), 700);
      prevPriceRef.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPriceRef.current = quote.price;
  }, [quote?.price]);

  const up = (quote?.change_pct ?? 0) >= 0;

  return (
    <div className={`wl-row ${active ? 'wl-row--active' : ''}`} onClick={onPick}>
      <div className="wl-row__info">
        <span className="wl-row__symbol">{stock.symbol.replace(/\.(NS|BO)$/i, '')}</span>
        <span className="wl-row__name">{stock.name}</span>
      </div>

      <div className="wl-row__right">
        {quote ? (
          <>
            <span className={`wl-row__price ${flash}`}>₹{fmt(quote.price)}</span>
            <span className={`wl-row__chg ${up ? 'up' : 'down'}`}>
              {up ? '+' : ''}{quote.change_pct?.toFixed(2)}%
            </span>
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

export default function WatchlistPortfolio() {
  const { state, dispatch } = useAppContext();
  const { remove } = useWatchlist();
  const { watchlist, quotes, currentSymbol } = state;
  const [tab, setTab] = useState('watchlist');

  const pick = (symbol) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
  };

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
              <div className="mylist__empty-icon">📋</div>
              <div className="mylist__empty-title">Your watchlist is empty</div>
              <div className="mylist__empty-sub">Search for a stock and add it to track prices here.</div>
            </div>
          ) : (
            <div className="wl-list">
              {watchlist.map(stock => (
                <WatchlistRow
                  key={stock.symbol}
                  stock={stock}
                  active={stock.symbol === currentSymbol}
                  quote={quotes[stock.symbol]}
                  onPick={() => pick(stock.symbol)}
                  onRemove={() => remove(stock.symbol)}
                />
              ))}
            </div>
          )
        )}

        {tab === 'portfolio' && <Portfolio />}
      </div>
    </div>
  );
}
