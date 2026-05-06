import React, { useEffect, useRef, useState } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { useStocks } from '../../../hooks/useStocks';
import './tabs.scss';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

function fmt(n, dec = 2) { if (n == null) return '—'; return n.toFixed(dec); }

export default function PerformanceTab({ symbol }) {
  const { fetchPerformance } = useStocks();
  const [perf, setPerf] = useState(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    fetchPerformance(symbol)
      .then(d => setPerf(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!perf?.annual_returns || !canvasRef.current) return;
    chartRef.current?.destroy();

    const years = perf.annual_returns.map(r => r.year);
    const returns = perf.annual_returns.map(r => r.return_pct);
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#a0a0b8' : '#6b7280';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: years,
        datasets: [{
          label: 'Annual Return %',
          data: returns,
          backgroundColor: returns.map(r => r >= 0 ? 'rgba(0, 212, 170, 0.7)' : 'rgba(255, 77, 109, 0.7)'),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => `${ctx.raw > 0 ? '+' : ''}${ctx.raw?.toFixed(1)}%` } },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `${v}%` } },
        },
      },
    });
    return () => chartRef.current?.destroy();
  }, [perf]);

  if (loading) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Loading performance data...</div>;
  if (!perf) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>No performance data available.</div>;

  return (
    <div className="tab-panel">
      <div className="perf-grid">
        <div className="perf-card">
          <div className="perf-card__label">5Y CAGR</div>
          <div className={`perf-card__value ${perf.cagr_5y >= 0 ? 'up' : 'down'}`}>
            {perf.cagr_5y != null ? `${perf.cagr_5y >= 0 ? '+' : ''}${fmt(perf.cagr_5y)}%` : '—'}
          </div>
        </div>
        <div className="perf-card">
          <div className="perf-card__label">Volatility</div>
          <div className="perf-card__value">{perf.volatility != null ? `${fmt(perf.volatility)}%` : '—'}</div>
        </div>
        <div className="perf-card">
          <div className="perf-card__label">Max Drawdown</div>
          <div className="perf-card__value down">{perf.max_drawdown != null ? `${fmt(perf.max_drawdown)}%` : '—'}</div>
        </div>
        <div className="perf-card">
          <div className="perf-card__label">Sharpe Ratio</div>
          <div className={`perf-card__value ${(perf.sharpe || 0) >= 1 ? 'up' : ''}`}>
            {perf.sharpe != null ? fmt(perf.sharpe) : '—'}
          </div>
        </div>
      </div>

      {perf.annual_returns?.length > 0 && (
        <div className="returns-chart-wrap">
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
