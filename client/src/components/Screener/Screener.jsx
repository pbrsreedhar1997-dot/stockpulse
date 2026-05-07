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
  { label: 'Below 52W High', value: 'decline_pct' },
  { label: 'P/E Ratio',      value: 'pe_ratio'    },
  { label: 'Market Cap',     value: 'mkt_cap_cr'  },
  { label: 'Today %',        value: 'change_pct'  },
];

export default function Screener() {
  const { stocks, loading, error, load, refresh } = useScreener();
  const { dispatch } = useAppContext();
  const [sector, setSector]   = useState('All');
  const [sortBy, setSortBy]   = useState('decline_pct');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => { load(); }, []);

  const sectors = ['All', ...new Set(stocks.map(s => s.sector).filter(Boolean))].sort();

  const filtered = stocks
    .filter(s => sector === 'All' || s.sector === sector)
    .sort((a, b) => {
      const av = a[sortBy] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      const bv = b[sortBy] ?? (sortDir === 'desc' ? -Infinity : Infinity);
      return sortDir === 'desc' ? bv - av : av - bv;
    });

  const toggleSort = (field) => {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(field); setSortDir(field === 'pe_ratio' ? 'asc' : 'desc'); }
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
          <p className="screener__sub">
            Nifty 100 stocks trading ≥10% below their 52-week high with positive earnings.
            Click any row to review the stock.
          </p>
        </div>
        <button className="screener__refresh" onClick={refresh} disabled={loading}>
          {loading ? <span className="spinner" /> : '↻ Refresh'}
        </button>
      </div>

      <div className="screener__toolbar">
        <div className="screener__sectors">
          {sectors.map(s => (
            <button
              key={s}
              className={`sc-chip ${sector === s ? 'sc-chip--active' : ''}`}
              onClick={() => setSector(s)}
            >{s}</button>
          ))}
        </div>

        <div className="screener__sort">
          <span className="screener__sort-label">Sort:</span>
          {SORT_OPTS.map(o => (
            <button
              key={o.value}
              className={`sc-chip ${sortBy === o.value ? 'sc-chip--active' : ''}`}
              onClick={() => toggleSort(o.value)}
            >
              {o.label}
              {sortBy === o.value && <span className="sc-sort-arrow">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="screener__error">{error}</div>}

      {loading && stocks.length === 0 ? (
        <div className="screener__loading">
          <span className="spinner" />
          <p>Scanning {'>'}90 large-cap stocks for value opportunities…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="screener__empty">No stocks match the current filters.</div>
      ) : (
        <div className="sc-table-wrap">
          <table className="sc-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Company</th>
                <th className="sc-th--num">Price</th>
                <th className="sc-th--num" title="Today's price change">Today</th>
                <th className="sc-th--num" title="% below 52-week high — lower means more upside potential">
                  52W Below ↓
                </th>
                <th className="sc-th--num">52W High</th>
                <th className="sc-th--num">P/E</th>
                <th className="sc-th--num">Mkt Cap</th>
                <th>Sector</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(stock => {
                const todayUp  = (stock.change_pct ?? 0) >= 0;
                const hasTodayChg = stock.change_pct != null;
                const peColor  = stock.pe_ratio < 15 ? 'up' : stock.pe_ratio > 45 ? 'down' : '';

                return (
                  <tr key={stock.symbol} className="sc-row" onClick={() => pickStock(stock)}>
                    <td className="sc-td--symbol">
                      {stock.symbol.replace(/\.(NS|BO)$/i, '')}
                    </td>
                    <td className="sc-td--name">{stock.name}</td>
                    <td className="sc-td--num">₹{fmt(stock.price)}</td>
                    <td className="sc-td--num">
                      {hasTodayChg ? (
                        <span className={`sc-chg ${todayUp ? 'sc-chg--up' : 'sc-chg--down'}`}>
                          {todayUp ? '+' : ''}{fmt(stock.change_pct)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="sc-td--num">
                      <span className="sc-below">
                        -{fmt(stock.decline_pct)}%
                      </span>
                    </td>
                    <td className="sc-td--num sc-dim">₹{fmt(stock.week52_high)}</td>
                    <td className={`sc-td--num ${peColor}`}>
                      {stock.pe_ratio ? `${fmt(stock.pe_ratio)}x` : '—'}
                    </td>
                    <td className="sc-td--num sc-dim">
                      {stock.mkt_cap_cr ? fmtCr(stock.mkt_cap_cr * 1e7) : '—'}
                    </td>
                    <td className="sc-td--sector">
                      {stock.sector ? <span className="sc-sector">{stock.sector}</span> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
