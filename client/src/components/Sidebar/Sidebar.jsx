import React from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import './Sidebar.scss';

function fmt(n) {
  if (!n && n !== 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
          {watchlist.map(stock => {
            const q = quotes[stock.symbol];
            const active = stock.symbol === currentSymbol;
            const up = q?.change_pct >= 0;

            return (
              <div
                key={stock.symbol}
                className={`stock-row ${active ? 'stock-row--active' : ''}`}
                onClick={() => pick(stock.symbol)}
              >
                <div className="stock-row__info">
                  <span className="stock-row__symbol">
                    {stock.symbol.replace('.NS', '').replace('.BO', '')}
                  </span>
                  <span className="stock-row__name">{stock.name}</span>
                </div>

                <div className="stock-row__price">
                  {q ? (
                    <>
                      <span className="stock-row__value">₹{fmt(q.price)}</span>
                      <span className={`stock-row__change ${up ? 'up' : 'down'}`}>
                        {up ? '+' : ''}{q.change_pct?.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <span className="skeleton" style={{ width: 60, height: 16, display: 'block' }} />
                  )}
                </div>

                <button
                  className="stock-row__remove"
                  onClick={e => { e.stopPropagation(); remove(stock.symbol); }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
