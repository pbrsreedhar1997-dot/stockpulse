import React from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import './StockHeader.scss';

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtCr(n) {
  if (!n) return '—';
  const cr = n / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L Cr`;
  if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(2)}K Cr`;
  return `₹${cr.toFixed(0)} Cr`;
}

export default function StockHeader({ symbol }) {
  const { state } = useAppContext();
  const { watchlist } = useWatchlist();
  const q = state.quotes[symbol];
  const p = state.profiles[symbol];
  const f = state.financials[symbol];

  const inWatchlist = watchlist.find(s => s.symbol === symbol);
  const up = q?.change_pct >= 0;

  return (
    <div className="stock-header">
      <div className="stock-header__top">
        {p?.logo_url && (
          <img className="stock-header__logo" src={p.logo_url} alt={p.name} onError={e => e.target.style.display = 'none'} />
        )}
        <div className="stock-header__name-block">
          <h1 className="stock-header__name">{p?.name || symbol}</h1>
          <div className="stock-header__meta">
            <span className="badge badge--neutral">{symbol.replace('.NS', '').replace('.BO', '')}</span>
            {p?.exchange && <span className="badge badge--neutral">{p.exchange}</span>}
            {p?.sector && <span className="badge badge--accent">{p.sector}</span>}
          </div>
        </div>

        <div className="stock-header__price-block">
          {q ? (
            <>
              <div className="stock-header__price">
                ₹{fmt(q.price)}
              </div>
              <div className={`stock-header__change ${up ? 'up' : 'down'}`}>
                {up ? '▲' : '▼'} {up ? '+' : ''}{fmt(q.change)} ({up ? '+' : ''}{q.change_pct?.toFixed(2)}%)
              </div>
            </>
          ) : (
            <>
              <div className="skeleton" style={{ width: 140, height: 32 }} />
              <div className="skeleton" style={{ width: 100, height: 18, marginTop: 6 }} />
            </>
          )}
        </div>
      </div>

      <div className="stock-header__stats">
        <div className="stat">
          <span className="stat__label">Open</span>
          <span className="stat__value">₹{fmt(q?.open)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">High</span>
          <span className="stat__value up">₹{fmt(q?.high)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Low</span>
          <span className="stat__value down">₹{fmt(q?.low)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Prev Close</span>
          <span className="stat__value">₹{fmt(q?.prev_close)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Volume</span>
          <span className="stat__value">{q?.volume ? (q.volume / 1e5).toFixed(2) + 'L' : '—'}</span>
        </div>
        <div className="stat">
          <span className="stat__label">Mkt Cap</span>
          <span className="stat__value">{fmtCr(q?.mkt_cap || f?.market_cap)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">52W High</span>
          <span className="stat__value">₹{fmt(f?.week52_high)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">52W Low</span>
          <span className="stat__value">₹{fmt(f?.week52_low)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">P/E</span>
          <span className="stat__value">{fmt(f?.pe_ratio)}</span>
        </div>
        <div className="stat">
          <span className="stat__label">EPS</span>
          <span className="stat__value">{fmt(f?.eps)}</span>
        </div>
      </div>
    </div>
  );
}
