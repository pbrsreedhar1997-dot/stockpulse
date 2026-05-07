import React, { useEffect } from 'react';
import { useStocks } from '../../../hooks/useStocks';
import { useAppContext } from '../../../contexts/AppContext';
import './tabs.scss';

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

function MarginRow({ label, value, max = 100, color }) {
  const pct = value != null ? Math.min(Math.max(value, 0), max) : 0;
  const width = `${(pct / max) * 100}%`;
  return (
    <div className="margin-row">
      <div className="margin-row__header">
        <span>{label}</span>
        <strong className={value > 0 ? 'up' : value < 0 ? 'down' : ''}>
          {value != null ? `${value > 0 ? '+' : ''}${fmt(value)}%` : '—'}
        </strong>
      </div>
      <div className="margin-row__track">
        <div
          className="margin-row__fill"
          style={{ width, background: value >= 0 ? color : 'var(--down)' }}
        />
      </div>
    </div>
  );
}

export default function FinancialsTab({ symbol }) {
  const { fetchFinancials } = useStocks();
  const { state }          = useAppContext();
  const f = state.financials[symbol];

  useEffect(() => { fetchFinancials(symbol); }, [symbol]);

  if (!f) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
        <span className="spinner" style={{ display: 'block', margin: '0 auto 12px' }} />
        Loading financial data…
      </div>
    );
  }

  return (
    <div className="tab-panel">
      {/* Valuation & income */}
      <div className="card-grid">
        <div className="info-card">
          <h3 className="info-card__title">Valuation</h3>
          <div className="info-card__rows">
            <div className="kv"><span>Market Cap</span><strong>{fmtCr(f.market_cap)}</strong></div>
            <div className="kv">
              <span>P/E Ratio</span>
              <strong className={f.pe_ratio < 15 ? 'up' : f.pe_ratio > 40 ? 'down' : ''}>
                {fmt(f.pe_ratio)}x
              </strong>
            </div>
            <div className="kv"><span>Price / Book</span><strong>{fmt(f.price_to_book)}x</strong></div>
            <div className="kv"><span>EPS (TTM)</span><strong>₹{fmt(f.eps)}</strong></div>
            <div className="kv">
              <span>Beta</span>
              <strong className={f.beta > 1.3 ? 'down' : f.beta < 0.8 ? 'up' : ''}>
                {fmt(f.beta)}
              </strong>
            </div>
          </div>
        </div>

        <div className="info-card">
          <h3 className="info-card__title">Income & Growth</h3>
          <div className="info-card__rows">
            <div className="kv"><span>Revenue TTM</span><strong>{fmtCr(f.revenue_ttm)}</strong></div>
            <div className="kv">
              <span>Revenue Growth</span>
              <strong className={f.revenue_growth > 0 ? 'up' : f.revenue_growth < 0 ? 'down' : ''}>
                {f.revenue_growth != null ? `${f.revenue_growth > 0 ? '+' : ''}${fmt(f.revenue_growth)}%` : '—'}
              </strong>
            </div>
            <div className="kv">
              <span>Earnings Growth</span>
              <strong className={f.earnings_growth > 0 ? 'up' : f.earnings_growth < 0 ? 'down' : ''}>
                {f.earnings_growth != null ? `${f.earnings_growth > 0 ? '+' : ''}${fmt(f.earnings_growth)}%` : '—'}
              </strong>
            </div>
            <div className="kv">
              <span>Dividend Yield</span>
              <strong>{f.dividend_yield ? `${fmt(f.dividend_yield)}%` : '—'}</strong>
            </div>
            <div className="kv">
              <span>Debt / Equity</span>
              <strong className={f.debt_to_equity > 1 ? 'down' : f.debt_to_equity < 0.3 ? 'up' : ''}>
                {fmt(f.debt_to_equity)}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Margin visualization */}
      <div className="margin-bar-wrap">
        <h4>Profitability Margins</h4>
        <div className="margin-bar">
          <MarginRow label="Gross Margin"   value={f.gross_margin}    color="var(--up)"    max={100} />
          <MarginRow label="Net Margin"     value={f.net_margin}      color="#5B9CF6"      max={60}  />
          <MarginRow label="Return on Equity" value={f.return_on_equity} color="var(--accent)" max={60} />
        </div>
      </div>

      {/* 52W range */}
      {f.week52_high && f.week52_low && (
        <div className="info-card">
          <h3 className="info-card__title">52-Week Range</h3>
          <div className="range-bar">
            <div className="range-bar__fill" style={{ width: '100%' }} />
          </div>
          <div className="range-labels">
            <span className="down">₹{fmt(f.week52_low)}</span>
            <span className="up">₹{fmt(f.week52_high)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
