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
  const q = state.quotes[symbol];
  const p = state.profiles[symbol];
  const f = state.financials[symbol];

  const up = q?.change_pct >= 0;

  const w52h = f?.week52_high || q?.week52_high;
  const w52l = f?.week52_low  || q?.week52_low;

  const stats = [
    { label: 'Open',      value: q?.open      ? `₹${fmt(q.open)}`      : '—' },
    { label: 'High',      value: q?.high      ? `₹${fmt(q.high)}`      : '—', cls: 'up' },
    { label: 'Low',       value: q?.low       ? `₹${fmt(q.low)}`       : '—', cls: 'down' },
    { label: 'Prev Close',value: q?.prev_close ? `₹${fmt(q.prev_close)}` : '—' },
    { label: 'Volume',    value: q?.volume    ? `${(q.volume / 1e5).toFixed(2)}L` : '—' },
    { label: 'Mkt Cap',   value: fmtCr(q?.mkt_cap || f?.market_cap) },
    { label: '52W High',  value: w52h ? `₹${fmt(w52h)}` : '—', cls: 'up' },
    { label: '52W Low',   value: w52l ? `₹${fmt(w52l)}` : '—', cls: 'down' },
    { label: 'P/E',       value: fmt(f?.pe_ratio) },
    { label: 'EPS',       value: f?.eps != null ? `₹${fmt(f.eps)}` : '—' },
  ];

  return (
    <div className="stock-header">
      <div className="stock-header__top">
        {p?.logo_url && (
          <img
            className="stock-header__logo"
            src={p.logo_url}
            alt=""
            onError={e => (e.target.style.display = 'none')}
          />
        )}

        <div className="stock-header__name-block">
          <h1 className="stock-header__name">{p?.name || symbol}</h1>
          <div className="stock-header__meta">
            <span className="badge badge--neutral">
              {symbol.replace('.NS', '').replace('.BO', '')}
            </span>
            {p?.exchange && <span className="badge badge--neutral">{p.exchange}</span>}
            {p?.sector   && <span className="badge badge--accent">{p.sector}</span>}
          </div>
        </div>

        <div className="stock-header__price-block">
          {q ? (
            <>
              <div className="stock-header__price">₹{fmt(q.price)}</div>
              <div className={`stock-header__change ${up ? 'up' : 'down'}`}>
                {up ? '▲' : '▼'}&nbsp;
                {up ? '+' : ''}{fmt(q.change)}&nbsp;
                ({up ? '+' : ''}{q.change_pct?.toFixed(2)}%)
              </div>
            </>
          ) : (
            <>
              <div className="skeleton" style={{ width: 160, height: 30 }} />
              <div className="skeleton" style={{ width: 110, height: 16, marginTop: 6 }} />
            </>
          )}
        </div>
      </div>

      <div className="stock-header__stats">
        {stats.map(s => (
          <div key={s.label} className="stat">
            <span className="stat__label">{s.label}</span>
            <span className={`stat__value${s.cls ? ` ${s.cls}` : ''}`}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
