import React, { useEffect, useRef, useState } from 'react';
import {
  Chart,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
} from 'chart.js';
import { CandlestickController, CandlestickElement, OhlcController, OhlcElement } from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';
import { useStocks } from '../../../hooks/useStocks';
import './PriceChart.scss';

Chart.register(
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  CandlestickController,
  CandlestickElement,
  OhlcController,
  OhlcElement
);

const RANGES = [
  { label: '1D', value: '1d' },
  { label: '5D', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '1Y', value: '1y' },
  { label: '5Y', value: '5y' },
];

export default function PriceChart({ symbol }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const [range, setRange] = useState('1mo');
  const [loading, setLoading] = useState(false);
  const { fetchHistory } = useStocks();

  useEffect(() => {
    loadChart();
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [symbol, range]);

  async function loadChart() {
    setLoading(true);
    chartRef.current?.destroy();
    try {
      const data = await fetchHistory(symbol, range);
      if (!data?.candles?.length) return;
      drawChart(data.candles);
    } catch (e) {
      console.error('Chart error', e);
    } finally {
      setLoading(false);
    }
  }

  function drawChart(candles) {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');

    const ohlcData = candles.map(c => ({
      x: new Date(c.t).getTime(),
      o: c.o,
      h: c.h,
      l: c.l,
      c: c.c,
    }));

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#a0a0b8' : '#6b7280';

    chartRef.current = new Chart(ctx, {
      type: 'candlestick',
      data: {
        datasets: [{
          label: symbol,
          data: ohlcData,
          color: {
            up: '#00d4aa',
            down: '#ff4d6d',
            unchanged: '#a0a0b8',
          },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1a1a2e' : '#fff',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            titleColor: textColor,
            bodyColor: textColor,
            callbacks: {
              label(ctx) {
                const { o, h, l, c } = ctx.raw;
                return [`O: ₹${o?.toFixed(2)}`, `H: ₹${h?.toFixed(2)}`, `L: ₹${l?.toFixed(2)}`, `C: ₹${c?.toFixed(2)}`];
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: {
              unit: range === '1d' ? 'hour' : range === '5d' ? 'day' : range === '1mo' || range === '3mo' ? 'week' : 'month',
            },
            grid: { color: gridColor },
            ticks: { color: textColor, maxTicksLimit: 8 },
          },
          y: {
            position: 'right',
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              callback: v => `₹${v.toLocaleString('en-IN')}`,
            },
          },
        },
      },
    });
  }

  return (
    <div className="price-chart">
      <div className="price-chart__ranges">
        {RANGES.map(r => (
          <button
            key={r.value}
            className={`range-btn ${range === r.value ? 'range-btn--active' : ''}`}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="price-chart__canvas-wrap">
        {loading && <div className="price-chart__loading"><span className="spinner" /></div>}
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
