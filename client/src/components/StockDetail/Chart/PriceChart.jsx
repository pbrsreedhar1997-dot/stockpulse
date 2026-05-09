import React, { useEffect, useRef, useState } from 'react';
import {
  Chart, CategoryScale, LinearScale, TimeScale, Tooltip, Legend,
  LineController, LineElement, PointElement, BarController, BarElement,
} from 'chart.js';
import { CandlestickController, CandlestickElement } from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';
import { useStocks } from '../../../hooks/useStocks';
import { useAppContext } from '../../../contexts/AppContext';
import { fmtPrice } from '../../../utils/currency';
import './PriceChart.scss';

Chart.register(
  CategoryScale, LinearScale, TimeScale, Tooltip, Legend,
  LineController, LineElement, PointElement,
  BarController, BarElement,
  CandlestickController, CandlestickElement,
);

const RANGES = [
  { label: '1D', value: '1d'  },
  { label: '5D', value: '5d'  },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '1Y', value: '1y'  },
  { label: '2Y', value: '2y'  },
  { label: '3Y', value: '3y'  },
];

export default function PriceChart({ symbol }) {
  const lineRef      = useRef(null);
  const volRef       = useRef(null);
  const lineChart    = useRef(null);
  const volChart     = useRef(null);
  const [range, setRange]         = useState('1mo');
  const [chartType, setChartType] = useState('candlestick');
  const [loading, setLoading]     = useState(false);
  const [candles, setCandles]     = useState(null);
  const [stats, setStats]         = useState(null);
  const { fetchHistory } = useStocks();
  const { state } = useAppContext();
  const cur = state.quotes[symbol]?.currency || (symbol?.match(/\.(NS|BO)$/i) ? 'INR' : 'USD');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCandles(null);
    setStats(null);
    fetchHistory(symbol, range)
      .then(data => {
        if (!cancelled && data?.candles?.length) {
          setCandles(data.candles);
          computeStats(data.candles);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, range]);

  useEffect(() => {
    lineChart.current?.destroy(); lineChart.current = null;
    volChart.current?.destroy();  volChart.current  = null;
    if (!candles?.length || !lineRef.current) return;
    drawCharts(candles, chartType, range);
    return () => {
      lineChart.current?.destroy(); lineChart.current = null;
      volChart.current?.destroy();  volChart.current  = null;
    };
  }, [candles, chartType]);

  function computeStats(data) {
    if (!data?.length) return;
    const prices = data.map(c => c.c).filter(Boolean);
    const high   = Math.max(...data.map(c => c.h || c.c));
    const low    = Math.min(...data.map(c => c.l || c.c));
    const first  = data[0].c;
    const last   = data[data.length - 1].c;
    const chg    = last - first;
    const chgPct = (chg / first) * 100;
    setStats({ high, low, open: first, close: last, chg, chgPct });
  }

  function drawCharts(data, type, rng) {
    if (!lineRef.current) return;
    const isDark   = document.documentElement.getAttribute('data-theme') !== 'light';
    const grid     = isDark ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.055)';
    const txt      = isDark ? '#6b7a8d' : '#8693a4';
    const upColor  = '#00c896';
    const downColor = '#ff4560';

    const xUnit = rng === '1d'  ? 'minute'
                : rng === '5d'  ? 'day'
                : rng === '1mo' ? 'day'
                : rng === '3mo' ? 'week'
                : rng === '1y'  ? 'week'
                : 'month'; // 2y, 3y
    const xStepSize = rng === '1d' ? 30 : undefined;
    const maxTicks  = rng === '1d'  ? 10
                    : rng === '5d'  ? 5
                    : rng === '1mo' ? 22
                    : rng === '3mo' ? 13
                    : rng === '1y'  ? 13
                    : 24; // 2y / 3y

    const isUp  = data[data.length - 1].c >= data[0].c;
    const accent = isUp ? upColor : downColor;

    /* ── Main price chart ─────────────────────────────────────────────── */
    const ctx  = lineRef.current.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, lineRef.current.clientHeight || 380);
    grad.addColorStop(0,   isUp ? 'rgba(0,200,150,0.22)' : 'rgba(255,69,96,0.18)');
    grad.addColorStop(0.6, isUp ? 'rgba(0,200,150,0.05)' : 'rgba(255,69,96,0.04)');
    grad.addColorStop(1,   'rgba(0,0,0,0)');

    let priceDs, tooltipCbs, chartType2;
    if (type === 'line') {
      priceDs = {
        label: symbol,
        data:  data.map(c => ({ x: c.t, y: c.c })),
        borderColor: accent,
        borderWidth: 2,
        backgroundColor: grad,
        fill: true,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: accent,
        tension: 0.25,
      };
      tooltipCbs = {
        title: items => {
          const d = new Date(items[0].raw.x);
          return rng === '1d'
            ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: (rng === '2y' || rng === '3y' || rng === '5y') ? '2-digit' : undefined });
        },
        label: c => `₹${c.raw.y?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      };
      chartType2 = 'line';
    } else {
      priceDs = {
        label: symbol,
        data:  data.map(c => ({ x: c.t, o: c.o, h: c.h, l: c.l, c: c.c })),
        color: { up: upColor, down: downColor, unchanged: '#6b7a8d' },
        borderColor: { up: upColor, down: downColor, unchanged: '#6b7a8d' },
        backgroundColors: { up: upColor + '33', down: downColor + '33', unchanged: '#6b7a8d33' },
      };
      tooltipCbs = {
        title: items => {
          const x = items[0]?.raw?.x;
          if (!x) return '';
          const d = new Date(x);
          return rng === '1d'
            ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
            : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: (rng === '2y' || rng === '3y' || rng === '5y') ? '2-digit' : undefined });
        },
        label: c => {
          const { o, h, l, c: cl } = c.raw;
          const fmt = v => v?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return [`O: ₹${fmt(o)}`, `H: ₹${fmt(h)}`, `L: ₹${fmt(l)}`, `C: ₹${fmt(cl)}`];
        },
      };
      chartType2 = 'candlestick';
    }

    const tooltipStyle = {
      backgroundColor: isDark ? 'rgba(10,14,26,0.96)' : 'rgba(255,255,255,0.97)',
      borderColor:     isDark ? 'rgba(99,130,195,0.22)' : 'rgba(0,0,0,0.1)',
      borderWidth: 1,
      titleColor: isDark ? '#edf0f8' : '#0d1424',
      bodyColor:  txt,
      padding: 10,
      cornerRadius: 8,
      callbacks: tooltipCbs,
    };

    lineChart.current = new Chart(ctx, {
      type: chartType2,
      data: { datasets: [priceDs] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: tooltipStyle,
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: xUnit, ...(xStepSize ? { stepSize: xStepSize } : {}) },
            grid: { color: grid, drawBorder: false },
            ticks: { color: txt, maxTicksLimit: maxTicks, font: { size: 10.5, family: "'JetBrains Mono', monospace" } },
            border: { display: false },
          },
          y: {
            position: 'right',
            grid: { color: grid, drawBorder: false },
            ticks: {
              color: txt,
              font: { size: 10.5, family: "'JetBrains Mono', monospace" },
              callback: v => '₹' + v.toLocaleString('en-IN'),
            },
            border: { display: false },
          },
        },
      },
    });

    /* ── Volume chart ─────────────────────────────────────────────────── */
    if (!volRef.current) return;
    const vctx = volRef.current.getContext('2d');
    volChart.current = new Chart(vctx, {
      type: 'bar',
      data: {
        datasets: [{
          data: data.map((c, i) => ({
            x: c.t,
            y: c.v ?? 0,
          })),
          backgroundColor: data.map((c, i) => {
            const up = i === 0 ? true : c.c >= (data[i - 1]?.c ?? c.c);
            return up ? 'rgba(0,200,150,0.45)' : 'rgba(255,69,96,0.45)';
          }),
          borderWidth: 0,
          borderRadius: 1,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: c => {
                const v = c.raw.y;
                if (!v) return '—';
                if (v >= 1e7) return `Vol: ${(v / 1e7).toFixed(2)}Cr`;
                if (v >= 1e5) return `Vol: ${(v / 1e5).toFixed(2)}L`;
                return `Vol: ${v.toLocaleString('en-IN')}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: xUnit, ...(xStepSize ? { stepSize: xStepSize } : {}) },
            grid: { display: false },
            ticks: { display: false },
            border: { display: false },
          },
          y: {
            position: 'right',
            grid: { color: grid, drawBorder: false },
            ticks: {
              color: txt,
              font: { size: 9, family: "'JetBrains Mono', monospace" },
              maxTicksLimit: 3,
              callback: v => v >= 1e7 ? `${(v/1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v/1e5).toFixed(0)}L` : v.toLocaleString(),
            },
            border: { display: false },
          },
        },
      },
    });
  }

  const up = stats ? stats.chgPct >= 0 : true;

  return (
    <div className="price-chart">
      <div className="price-chart__toolbar">
        <div className="price-chart__ranges">
          {RANGES.map(r => (
            <button
              key={r.value}
              className={`range-btn ${range === r.value ? 'range-btn--active' : ''}`}
              onClick={() => setRange(r.value)}
            >{r.label}</button>
          ))}
          {stats && (
            <span className={`period-chg ${stats.chgPct >= 0 ? 'period-chg--up' : 'period-chg--down'}`}>
              {stats.chgPct >= 0 ? '+' : ''}{stats.chgPct?.toFixed(2)}%
            </span>
          )}
        </div>
        <div className="price-chart__type-toggle">
          <button className={`range-btn ${chartType === 'candlestick' ? 'range-btn--active' : ''}`}
            onClick={() => setChartType('candlestick')}>Candles</button>
          <button className={`range-btn ${chartType === 'line' ? 'range-btn--active' : ''}`}
            onClick={() => setChartType('line')}>Line</button>
        </div>
      </div>

      {stats && (
        <div className="price-chart__stats-bar">
          <div className="price-chart__stat">
            <span>Open</span>
            <strong>{fmtPrice(stats.open, cur)}</strong>
          </div>
          <div className="price-chart__stat">
            <span>High</span>
            <strong className="up">{fmtPrice(stats.high, cur)}</strong>
          </div>
          <div className="price-chart__stat">
            <span>Low</span>
            <strong className="down">{fmtPrice(stats.low, cur)}</strong>
          </div>
          <div className="price-chart__stat">
            <span>Close</span>
            <strong>{fmtPrice(stats.close, cur)}</strong>
          </div>
          <div className={`price-chart__stat price-chart__stat--chg ${up ? 'up' : 'down'}`}>
            <span>Period Chg</span>
            <strong>{up ? '+' : ''}{stats.chgPct?.toFixed(2)}%</strong>
          </div>
        </div>
      )}

      <div className="price-chart__canvas-wrap">
        {loading && <div className="price-chart__loading"><span className="spinner" /></div>}
        <canvas ref={lineRef} />
      </div>

      <div className="price-chart__vol-wrap">
        <div className="price-chart__vol-label">Volume</div>
        <canvas ref={volRef} />
      </div>
    </div>
  );
}
