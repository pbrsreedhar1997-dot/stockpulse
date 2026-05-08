import React, { useEffect } from 'react';
import { useAppContext } from '../../../contexts/AppContext';
import { useStocks } from '../../../hooks/useStocks';
import PriceChart from '../Chart/PriceChart';
import MetricInfo from '../../shared/MetricInfo';
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
  const pe   = f?.pe_ratio    ?? q?.pe_ratio;
  const eps  = f?.eps         ?? q?.eps;

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
            <MetricInfo metricKey="pe_ratio">
              <span>P/E Ratio</span>
              <strong className={pe < 15 ? 'up' : pe > 45 ? 'down' : ''}>
                {pe != null ? `${fmt(pe)}x` : '—'}
              </strong>
            </MetricInfo>
            <MetricInfo metricKey="eps">
              <span>EPS (TTM)</span>
              <strong className={eps > 0 ? 'up' : eps < 0 ? 'down' : ''}>
                {eps != null ? `₹${fmt(eps)}` : '—'}
              </strong>
            </MetricInfo>
            <MetricInfo metricKey="gross_margin">
              <span>Gross Margin</span>
              <strong className={f?.gross_margin > 40 ? 'up' : f?.gross_margin < 15 ? 'down' : ''}>
                {f?.gross_margin != null ? `${fmt(f.gross_margin)}%` : '—'}
              </strong>
            </MetricInfo>
            <MetricInfo metricKey="net_margin">
              <span>Net Margin</span>
              <strong className={f?.net_margin > 8 ? 'up' : f?.net_margin < 0 ? 'down' : ''}>
                {f?.net_margin != null ? `${fmt(f.net_margin)}%` : '—'}
              </strong>
            </MetricInfo>
            <MetricInfo metricKey="dividend_yield">
              <span>Dividend Yield</span>
              <strong>{f?.dividend_yield ? `${fmt(f.dividend_yield)}%` : '—'}</strong>
            </MetricInfo>
            <MetricInfo metricKey="beta">
              <span>Beta</span>
              <strong className={f?.beta < 0.8 ? 'up' : f?.beta > 1.5 ? 'down' : ''}>
                {fmt(f?.beta)}
              </strong>
            </MetricInfo>
          </div>
        </div>

        <div className="info-card">
          <h3 className="info-card__title">52-Week Range</h3>
          {w52h && w52l && q?.price ? (
            <>
              <div className="range-bar">
                <div
                  className="range-bar__fill"
                  style={{ width: `${((q.price - w52l) / (w52h - w52l)) * 100}%` }}
                />
                <div
                  className="range-bar__dot"
                  style={{ left: `${((q.price - w52l) / (w52h - w52l)) * 100}%` }}
                />
              </div>
              <div className="range-labels">
                <MetricInfo metricKey="week52_low">
                  <span className="down">₹{fmt(w52l)}</span>
                </MetricInfo>
                <span>Current: ₹{fmt(q.price)}</span>
                <MetricInfo metricKey="week52_high">
                  <span className="up">₹{fmt(w52h)}</span>
                </MetricInfo>
              </div>
            </>
          ) : (
            <div className="skeleton" style={{ height: 40, marginTop: 12 }} />
          )}

          <div className="info-card__rows" style={{ marginTop: 16 }}>
            <MetricInfo metricKey="volume">
              <span>Avg Volume</span>
              <strong>{f?.avg_volume ? `${(f.avg_volume / 1e5).toFixed(2)}L` : '—'}</strong>
            </MetricInfo>
            <MetricInfo metricKey="return_on_equity">
              <span>Return on Equity</span>
              <strong className={f?.return_on_equity > 15 ? 'up' : f?.return_on_equity < 0 ? 'down' : ''}>
                {f?.return_on_equity != null ? `${fmt(f.return_on_equity)}%` : '—'}
              </strong>
            </MetricInfo>
            <MetricInfo metricKey="debt_to_equity">
              <span>Debt / Equity</span>
              <strong className={f?.debt_to_equity > 1 ? 'down' : f?.debt_to_equity < 0.3 ? 'up' : ''}>
                {fmt(f?.debt_to_equity)}
              </strong>
            </MetricInfo>
          </div>
        </div>
      </div>
    </div>
  );
}
