import React, { useEffect, useRef, useState } from 'react';
import {
  Chart,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  LineController,
  LineElement,
  PointElement,
} from 'chart.js';
import { CandlestickController, CandlestickElement, OhlcController, OhlcElement } from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';
import { useStocks } from '../../../hooks/useStocks';
import './PriceChart.scss';

Chart.register(
  CategoryScale, LinearScale, TimeScale,
  Tooltip, Legend,
  LineController, LineElement, PointElement,
  CandlestickController, CandlestickElement,
  OhlcController, OhlcElement,
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
  const [chartType, setChartType] = useState('candlestick');
  const [loading, setLoading] = useState(false);
  const [candles, setCandles] = useState(null);
  const { fetchHistory } = useStocks();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCandles(null);
    fetchHistory(symbol, range)
      .then(data => {
        if (!cancelled && data?.candles?.length) setCandles(data.candles);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, range]);

  useEffect(() => {
    chartRef.current?.destroy();
    chartRef.current = null;
    if (!candles?.length || !canvasRef.current) return;
    drawChart(candles, chartType, range);
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [candles, chartType]);

  function drawChart(data, type, rng) {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const textColor = isDark ? '#a0a0b8' : '#6b7280';

    const xUnit = rng === '1d' ? 'hour'
      : rng === '5d' ? 'day'
      : rng === '1mo' || rng === '3mo' ? 'week'
      : 'month';

    let dataset, tooltipCb, chartTypeName;
    if (type === 'line') {
      const gradient = ctx.createLinearGradient(0, 0, 0, 280);
      gradient.addColorStop(0, 'rgba(0,212,170,0.25)');
      gradient.addColorStop(1, 'rgba(0,212,170,0)');
      dataset = {
        label: symbol,
        data: data.map(c => ({ x: c.t, y: c.c })),
        borderColor: '#00d4aa',
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.2,
      };
      tooltipCb = { label: c => `₹${c.raw.y?.toFixed(2)}` };
      chartTypeName = 'line';
    } else {
      dataset = {
        label: symbol,
        data: data.map(c => ({ x: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
        color: { up: '#00d4aa', down: '#ff4d6d', unchanged: '#a0a0b8' },
      };
      tooltipCb = {
        label(c) {
          const { o, h, l, c: cl } = c.raw;
          return [`O: ₹${o?.toFixed(2)}`, `H: ₹${h?.toFixed(2)}`, `L: ₹${l?.toFixed(2)}`, `C: ₹${cl?.toFixed(2)}`];
        },
      };
      chartTypeName = 'candlestick';
    }

    chartRef.current = new Chart(ctx, {
      type: chartTypeName,
      data: { datasets: [dataset] },
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
            callbacks: tooltipCb,
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: xUnit },
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
      <div className="price-chart__controls">
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
        <div className="price-chart__type-toggle">
          <button
            className={`range-btn ${chartType === 'candlestick' ? 'range-btn--active' : ''}`}
            onClick={() => setChartType('candlestick')}
            title="Candlestick chart"
          >
            Candles
          </button>
          <button
            className={`range-btn ${chartType === 'line' ? 'range-btn--active' : ''}`}
            onClick={() => setChartType('line')}
            title="Line chart"
          >
            Line
          </button>
        </div>
      </div>
      <div className="price-chart__canvas-wrap">
        {loading && <div className="price-chart__loading"><span className="spinner" /></div>}
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
