import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import './Sidebar.scss';

function fmt(n) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function StockRow({ stock, active, onPick, onRemove, quote }) {
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

  const up = quote?.change_pct >= 0;

  return (
    <div
      className={`stock-row ${active ? 'stock-row--active' : ''}`}
      onClick={onPick}
    >
      <div className="stock-row__info">
        <span className="stock-row__symbol">
          {stock.symbol.replace(/\.(NS|BO)$/i, '')}
        </span>
        <span className="stock-row__name">{stock.name}</span>
      </div>

      <div className="stock-row__price">
        {quote ? (
          <>
            <span className={`stock-row__value ${flash}`}>₹{fmt(quote.price)}</span>
            <span className={`stock-row__change ${up ? 'up' : 'down'}`}>
              {up ? '+' : ''}{quote.change_pct?.toFixed(2)}%
            </span>
          </>
        ) : (
          <span className="skeleton" style={{ width: 60, height: 16, display: 'block' }} />
        )}
      </div>

      <button
        className="stock-row__remove"
        onClick={e => { e.stopPropagation(); onRemove(); }}
        title="Remove"
      >×</button>
    </div>
  );
}

export default function Sidebar() {
  const { state, dispatch } = useAppContext();
  const { remove } = useWatchlist();
  const { watchlist, quotes, currentSymbol } = state;

  const pick = (symbol) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__title">Watchlist</span>
        <span className="sidebar__count">{watchlist.length}</span>
      </div>

      {watchlist.length === 0 ? (
        <div className="sidebar__empty">
          <div>📋</div>
          <p>Add stocks to track them here</p>
        </div>
      ) : (
        <div className="sidebar__list">
          {watchlist.map(stock => (
            <StockRow
              key={stock.symbol}
              stock={stock}
              active={stock.symbol === currentSymbol}
              quote={quotes[stock.symbol]}
              onPick={() => pick(stock.symbol)}
              onRemove={() => remove(stock.symbol)}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
