import React, { useEffect, useRef } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import { useAppContext } from '../../../contexts/AppContext';
import './tabs.scss';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

function fmt(n, dec = 2) { if (n == null) return '—'; return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function fmtCr(n) {
  if (!n) return '—';
  const cr = n / 1e7;
  if (cr >= 1e5) return `₹${(cr / 1e5).toFixed(2)}L Cr`;
  if (cr >= 1e3) return `₹${(cr / 1e3).toFixed(2)}K Cr`;
  return `₹${cr.toFixed(0)} Cr`;
}

export default function FinancialsTab({ symbol }) {
  const { state } = useAppContext();
  const f = state.financials[symbol];
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!f || !canvasRef.current) return;
    chartRef.current?.destroy();

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#a0a0b8' : '#6b7280';

    const quarters = ['3 Qtrs ago', '2 Qtrs ago', 'Last Qtr', 'TTM'];
    const revenues = [f.revenue_q_prev || 0, f.revenue_q || 0, f.revenue_q || 0, f.revenue_ttm || 0];
    const netIncomes = [0, 0, 0, f.net_income_ttm || 0];

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: quarters,
        datasets: [
          {
            label: 'Revenue',
            data: revenues.map(v => v / 1e7),
            backgroundColor: 'rgba(0, 212, 170, 0.7)',
          },
          {
            label: 'Net Income',
            data: netIncomes.map(v => v / 1e7),
            backgroundColor: 'rgba(255, 77, 109, 0.7)',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ₹${ctx.raw?.toFixed(0)} Cr`,
            },
          },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `₹${v}Cr` } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [f]);

  if (!f) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Loading financials...</div>;

  return (
    <div className="tab-panel">
      <div className="card-grid" style={{ marginBottom: 16 }}>
        <div className="info-card">
          <h3 className="info-card__title">Revenue</h3>
          <div className="info-card__rows">
            <div className="kv"><span>Revenue TTM</span><strong>{fmtCr(f.revenue_ttm)}</strong></div>
            <div className="kv"><span>Revenue (Qtr)</span><strong>{fmtCr(f.revenue_q)}</strong></div>
            <div className="kv"><span>Net Income TTM</span><strong>{fmtCr(f.net_income_ttm)}</strong></div>
            <div className="kv"><span>Gross Margin</span><strong className={f.gross_margin > 40 ? 'up' : ''}>{f.gross_margin ? fmt(f.gross_margin) + '%' : '—'}</strong></div>
          </div>
        </div>
        <div className="info-card">
          <h3 className="info-card__title">Valuation</h3>
          <div className="info-card__rows">
            <div className="kv"><span>Market Cap</span><strong>{fmtCr(f.market_cap)}</strong></div>
            <div className="kv"><span>P/E Ratio</span><strong className={f.pe_ratio < 15 ? 'up' : f.pe_ratio > 40 ? 'down' : ''}>{fmt(f.pe_ratio)}</strong></div>
            <div className="kv"><span>EPS</span><strong>₹{fmt(f.eps)}</strong></div>
            <div className="kv"><span>Beta</span><strong>{fmt(f.beta)}</strong></div>
            <div className="kv"><span>Dividend Yield</span><strong>{f.dividend_yield ? fmt(f.dividend_yield) + '%' : '—'}</strong></div>
          </div>
        </div>
      </div>

      <div className="fin-chart-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
