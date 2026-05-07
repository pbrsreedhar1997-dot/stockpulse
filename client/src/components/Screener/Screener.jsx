import React, { useEffect, useState } from 'react';
import { useScreener } from '../../hooks/useScreener';
import { useAppContext } from '../../contexts/AppContext';
import './Screener.scss';

function fmt(n, dec = 2) { if (n == null) return '—'; return typeof n === 'number' ? n.toFixed(dec) : n; }
function fmtCr(n) {
  if (!n) return '—';
  const cr = n / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(1)}L Cr`;
  if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(1)}K Cr`;
  return `₹${cr.toFixed(0)} Cr`;
}

const SORT_OPTS = [
  { label: 'Decline %', value: 'decline_pct' },
  { label: 'P/E', value: 'pe_ratio' },
  { label: 'Gross Margin', value: 'gross_margin' },
  { label: 'Market Cap', value: 'mkt_cap_cr' },
];

export default function Screener() {
  const { stocks, loading, error, load, refresh } = useScreener();
  const { dispatch } = useAppContext();
  const [sector, setSector] = useState('All');
  const [sortBy, setSortBy] = useState('decline_pct');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => { load(); }, []);

  const sectors = ['All', ...new Set(stocks.map(s => s.sector).filter(Boolean))].sort();

  const filtered = stocks
    .filter(s => sector === 'All' || s.sector === sector)
    .sort((a, b) => {
      const av = a[sortBy] || 0;
      const bv = b[sortBy] || 0;
      return sortDir === 'desc' ? bv - av : av - bv;
    });

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir('desc'); }
  };

  const pickStock = (stock) => {
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: stock.symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
  };

  return (
    <div className="screener">
      <div className="screener__header">
        <div>
          <h2 className="screener__title">Value Picks</h2>
          <p className="screener__sub">Large-cap NSE stocks ≥10% below 52W high with positive EPS</p>
        </div>
        <button className="screener__refresh" onClick={refresh} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻ Refresh'}
        </button>
      </div>

      <div className="screener__controls">
        <div className="screener__sectors">
          {sectors.map(s => (
            <button
              key={s}
              className={`filter-btn ${sector === s ? 'filter-btn--active' : ''}`}
              onClick={() => setSector(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="screener__sort">
          <span style={{ color: 'var(--text2)', fontSize: 12 }}>Sort by:</span>
          {SORT_OPTS.map(o => (
            <button
              key={o.value}
              className={`filter-btn ${sortBy === o.value ? 'filter-btn--active' : ''}`}
              onClick={() => toggleSort(o.value)}
            >
              {o.label} {sortBy === o.value ? (sortDir === 'desc' ? '↓' : '↑') : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="screener__error">{error}</div>}

      {loading && stocks.length === 0 ? (
        <div className="screener__loading">
          <span className="spinner" />
          <p>Scanning stocks for value opportunities…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="screener__empty">No stocks match filters</div>
      ) : (
        <div className="screener__grid">
          {filtered.map(stock => (
            <div key={stock.symbol} className="stock-card" onClick={() => pickStock(stock)}>
              <div className="stock-card__header">
                <div>
                  <div className="stock-card__symbol">{stock.symbol.replace('.NS', '').replace('.BO', '')}</div>
                  <div className="stock-card__name">{stock.name}</div>
                </div>
                <div className="badge badge--down" title="Below 52W High">
                  -{fmt(stock.decline_pct)}%
                </div>
              </div>

              <div className="stock-card__price">
                <span>₹{fmt(stock.price)}</span>
                {stock.sector && <span className="badge badge--accent">{stock.sector}</span>}
              </div>

              <div className="stock-card__stats">
                <div className="kv">
                  <span>P/E</span>
                  <strong className={stock.pe_ratio < 15 ? 'up' : stock.pe_ratio > 40 ? 'down' : ''}>
                    {fmt(stock.pe_ratio)}
                  </strong>
                </div>
                <div className="kv">
                  <span>Gross Margin</span>
                  <strong className={stock.gross_margin > 40 ? 'up' : ''}>
                    {stock.gross_margin ? fmt(stock.gross_margin) + '%' : '—'}
                  </strong>
                </div>
                <div className="kv">
                  <span>Mkt Cap</span>
                  <strong>{fmtCr(stock.mkt_cap_cr * 1e7)}</strong>
                </div>
                <div className="kv">
                  <span>52W High</span>
                  <strong>₹{fmt(stock.week52_high)}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
