import React, { useEffect } from 'react';
import { useAppContext } from '../../../contexts/AppContext';
import { useStocks } from '../../../hooks/useStocks';
import PriceChart from '../Chart/PriceChart';
import './tabs.scss';

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function OverviewTab({ symbol }) {
  const { state }       = useAppContext();
  const { fetchFinancials } = useStocks();
  const q = state.quotes[symbol];
  const f = state.financials[symbol];

  const w52h = f?.week52_high || q?.week52_high;
  const w52l = f?.week52_low  || q?.week52_low;

  useEffect(() => {
    if (!f) fetchFinancials(symbol);
  }, [symbol]);

  return (
    <div className="tab-panel">
      <PriceChart symbol={symbol} />

      <div className="card-grid">
        <div className="info-card">
          <h3 className="info-card__title">Key Metrics</h3>
          <div className="info-card__rows">
            <div className="kv"><span>P/E Ratio</span><strong>{fmt(f?.pe_ratio)}x</strong></div>
            <div className="kv"><span>EPS (TTM)</span><strong>₹{fmt(f?.eps)}</strong></div>
            <div className="kv">
              <span>Gross Margin</span>
              <strong className={f?.gross_margin > 40 ? 'up' : ''}>
                {f?.gross_margin != null ? `${fmt(f.gross_margin)}%` : '—'}
              </strong>
            </div>
            <div className="kv">
              <span>Net Margin</span>
              <strong className={f?.net_margin > 0 ? 'up' : f?.net_margin < 0 ? 'down' : ''}>
                {f?.net_margin != null ? `${fmt(f.net_margin)}%` : '—'}
              </strong>
            </div>
            <div className="kv">
              <span>Dividend Yield</span>
              <strong>{f?.dividend_yield ? `${fmt(f.dividend_yield)}%` : '—'}</strong>
            </div>
            <div className="kv"><span>Beta</span><strong>{fmt(f?.beta)}</strong></div>
          </div>
        </div>

        <div className="info-card">
          <h3 className="info-card__title">52-Week Range</h3>
          {w52h && w52l && q?.price ? (
            <>
              <div className="range-bar">
                <div
                  className="range-bar__fill"
                  style={{
                    width: `${((q.price - w52l) / (w52h - w52l)) * 100}%`,
                  }}
                />
                <div
                  className="range-bar__dot"
                  style={{
                    left: `${((q.price - w52l) / (w52h - w52l)) * 100}%`,
                  }}
                />
              </div>
              <div className="range-labels">
                <span className="down">₹{fmt(w52l)}</span>
                <span>Current: ₹{fmt(q.price)}</span>
                <span className="up">₹{fmt(w52h)}</span>
              </div>
            </>
          ) : (
            <div className="skeleton" style={{ height: 40, marginTop: 12 }} />
          )}

          <div className="info-card__rows" style={{ marginTop: 16 }}>
            <div className="kv">
              <span>Avg Volume</span>
              <strong>{f?.avg_volume ? `${(f.avg_volume / 1e5).toFixed(2)}L` : '—'}</strong>
            </div>
            <div className="kv">
              <span>Return on Equity</span>
              <strong className={f?.return_on_equity > 15 ? 'up' : f?.return_on_equity < 0 ? 'down' : ''}>
                {f?.return_on_equity != null ? `${fmt(f.return_on_equity)}%` : '—'}
              </strong>
            </div>
            <div className="kv">
              <span>Debt / Equity</span>
              <strong className={f?.debt_to_equity > 1 ? 'down' : f?.debt_to_equity < 0.3 ? 'up' : ''}>
                {fmt(f?.debt_to_equity)}
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
