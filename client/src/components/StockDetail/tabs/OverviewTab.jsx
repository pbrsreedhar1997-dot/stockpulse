import React from 'react';
import { useAppContext } from '../../../contexts/AppContext';
import PriceChart from '../Chart/PriceChart';
import './tabs.scss';

function fmt(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export default function OverviewTab({ symbol }) {
  const { state } = useAppContext();
  const q = state.quotes[symbol];
  const f = state.financials[symbol];

  return (
    <div className="tab-panel">
      <PriceChart symbol={symbol} />

      <div className="card-grid">
        <div className="info-card">
          <h3 className="info-card__title">Key Metrics</h3>
          <div className="info-card__rows">
            <div className="kv"><span>P/E Ratio</span><strong>{fmt(f?.pe_ratio)}</strong></div>
            <div className="kv"><span>EPS</span><strong>₹{fmt(f?.eps)}</strong></div>
            <div className="kv"><span>Beta</span><strong>{fmt(f?.beta)}</strong></div>
            <div className="kv"><span>Dividend Yield</span><strong>{f?.dividend_yield ? fmt(f.dividend_yield) + '%' : '—'}</strong></div>
            <div className="kv"><span>Avg Volume</span><strong>{f?.avg_volume ? (f.avg_volume / 1e5).toFixed(2) + 'L' : '—'}</strong></div>
          </div>
        </div>

        <div className="info-card">
          <h3 className="info-card__title">52W Range</h3>
          {f?.week52_high && f?.week52_low && q?.price ? (
            <>
              <div className="range-bar">
                <div
                  className="range-bar__fill"
                  style={{
                    left: 0,
                    width: `${((q.price - f.week52_low) / (f.week52_high - f.week52_low)) * 100}%`,
                  }}
                />
                <div
                  className="range-bar__dot"
                  style={{
                    left: `${((q.price - f.week52_low) / (f.week52_high - f.week52_low)) * 100}%`,
                  }}
                />
              </div>
              <div className="range-labels">
                <span className="down">₹{fmt(f.week52_low)}</span>
                <span className="up">₹{fmt(f.week52_high)}</span>
              </div>
            </>
          ) : <div className="skeleton" style={{ height: 40 }} />}
        </div>
      </div>
    </div>
  );
}
