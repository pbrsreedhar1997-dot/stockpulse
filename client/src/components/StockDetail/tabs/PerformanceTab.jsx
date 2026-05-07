import React, { useEffect, useRef, useState } from 'react';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip } from 'chart.js';
import { useStocks } from '../../../hooks/useStocks';
import './tabs.scss';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

function fmt(n, dec = 1) { return n != null ? n.toFixed(dec) : null; }

export default function PerformanceTab({ symbol }) {
  const { fetchPerformance } = useStocks();
  const [perf, setPerf]     = useState(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  useEffect(() => {
    setLoading(true);
    setPerf(null);
    fetchPerformance(symbol)
      .then(d => setPerf(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    if (!perf?.annual_returns?.length || !canvasRef.current) return;
    chartRef.current?.destroy();

    const isDark    = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#8696AE' : '#4A5E7A';
    const gridColor = isDark ? 'rgba(99,130,195,0.1)' : 'rgba(99,130,195,0.15)';

    const years   = perf.annual_returns.map(r => r.year);
    const returns = perf.annual_returns.map(r => r.return_pct);

    chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
      type: 'bar',
      data: {
        labels: years,
        datasets: [{
          data: returns,
          backgroundColor: returns.map(r => r >= 0
            ? 'rgba(0, 200, 150, 0.7)'
            : 'rgba(255, 69, 96, 0.7)'),
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.raw > 0 ? '+' : ''}${ctx.raw?.toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { family: "'JetBrains Mono'" } },
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { family: "'JetBrains Mono'" },
              callback: v => `${v}%`,
            },
          },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [perf]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
        <span className="spinner" style={{ display: 'block', margin: '0 auto 12px' }} />
        Loading performance data…
      </div>
    );
  }

  if (!perf) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'var(--text2)' }}>
        No performance data available.
      </div>
    );
  }

  const cagr1Pos = perf.cagr_1y >= 0;
  const cagr5Pos = perf.cagr_5y >= 0;

  return (
    <div className="tab-panel">
      <div className="perf-grid">
        <div className="perf-card">
          <div className="perf-card__label">1-Year Return</div>
          <div className={`perf-card__value ${cagr1Pos ? 'up' : 'down'}`}>
            {perf.cagr_1y != null
              ? `${cagr1Pos ? '+' : ''}${fmt(perf.cagr_1y)}%`
              : '—'}
          </div>
        </div>
        <div className="perf-card">
          <div className="perf-card__label">5-Year CAGR</div>
          <div className={`perf-card__value ${cagr5Pos ? 'up' : 'down'}`}>
            {perf.cagr_5y != null
              ? `${cagr5Pos ? '+' : ''}${fmt(perf.cagr_5y)}%`
              : '—'}
          </div>
        </div>
      </div>

      {perf.annual_returns?.length > 0 && (
        <div className="returns-chart-wrap">
          <h4>Annual Returns</h4>
          <canvas ref={canvasRef} />
        </div>
      )}
    </div>
  );
}
