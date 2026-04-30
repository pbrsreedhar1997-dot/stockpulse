import {
  Component, OnChanges, OnDestroy, input, output,
  ElementRef, viewChild, AfterViewInit, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables, TooltipItem, Plugin } from 'chart.js';
import { HistoryPoint } from '../../../core/models/stock.model';

Chart.register(...registerables);

const RANGES = [
  { key: '1d',  label: '1D' },
  { key: '5d',  label: '5D' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '6mo', label: '6M' },
  { key: '1y',  label: '1Y' },
  { key: '2y',  label: '2Y' },
  { key: '5y',  label: '5Y' },
];

function fmtLabel(ts: number, rangeKey: string): string {
  const d = new Date(ts * 1000);
  if (rangeKey === '1d') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (rangeKey === '5d') {
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) + ' '
         + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (rangeKey === '1mo' || rangeKey === '3mo') return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  if (rangeKey === '6mo' || rangeKey === '1y')  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function maxTicks(rng: string): number {
  return ({ '1d': 8, '5d': 6, '1mo': 8, '3mo': 8, '6mo': 7, '1y': 8, '2y': 8, '5y': 8 } as Record<string,number>)[rng] ?? 8;
}

function computeSMA(data: number[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null;
    const slice = data.slice(i - window + 1, i + 1);
    return parseFloat((slice.reduce((s, v) => s + v, 0) / window).toFixed(2));
  });
}

const priceLinePlugin: Plugin<'line'> = {
  id: 'priceLine',
  afterDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const data = (chart.data.datasets[0]?.data ?? []) as number[];
    const last = data.filter(v => v != null).at(-1);
    if (last == null) return;
    const y = scales['y']?.getPixelForValue(last);
    if (y == null || y < chartArea.top || y > chartArea.bottom) return;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y); ctx.stroke();
    ctx.setLineDash([]);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const label  = '₹' + last.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    ctx.font = '10px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = isDark ? '#1e293b' : '#f8fafc';
    ctx.fillRect(chartArea.right + 1, y - 9, tw, 18);
    ctx.fillStyle = isDark ? '#94a3b8' : '#475569';
    ctx.textAlign = 'left';
    ctx.fillText(label, chartArea.right + 6, y + 4);
    ctx.restore();
  }
};
Chart.register(priceLinePlugin);

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap">
      <!-- Stats -->
      <div class="chart-stats" [class.pos]="isPos" [class.neg]="!isPos">
        <span class="stat-price">{{ curPrice }}</span>
        <span class="stat-change">{{ chgStr }}</span>
        <span class="stat-pct">{{ pctStr }}</span>
        <span class="stat-range-label">{{ periodName }}</span>
      </div>

      <!-- Range -->
      <div class="chart-ranges">
        @for (r of ranges; track r.key) {
          <button class="rng-btn" [class.active]="activeRange() === r.key" (click)="rangeChange.emit(r.key)">{{r.label}}</button>
        }
      </div>

      <!-- Indicator toggles -->
      <div class="chart-indicators">
        <button class="ind-btn" [class.on]="showSma20" (click)="toggleInd('sma20')">SMA 20</button>
        <button class="ind-btn" [class.on]="showSma50" (click)="toggleInd('sma50')">SMA 50</button>
        <button class="ind-btn" [class.on]="showVol"   (click)="toggleInd('vol')">Volume</button>
      </div>

      <!-- Canvas -->
      <div class="chart-area" [class.with-vol]="showVol">
        @if (loading()) {
          <div class="chart-overlay"><div class="spin"></div><span class="loading-text">Loading…</span></div>
        }
        @if (!loading() && points().length === 0) {
          <div class="chart-empty"><span class="empty-icon">📊</span><span>No data for {{ rangeLabel }}</span></div>
        }
        <canvas #canvas></canvas>
      </div>

      <!-- OHLV bar -->
      @if (points().length > 0) {
        <div class="chart-meta">
          <span class="meta-item"><span class="meta-lbl">O</span>{{ fmt(points()[0]?.open) }}</span>
          <span class="meta-item"><span class="meta-lbl">H</span>{{ fmt(hi) }}</span>
          <span class="meta-item"><span class="meta-lbl">L</span>{{ fmt(lo) }}</span>
          <span class="meta-item meta-chg" [class.pos]="isPos" [class.neg]="!isPos">{{ chgStr }} {{ pctStr }}</span>
          <span class="meta-item"><span class="meta-lbl">Vol</span>{{ fmtVol(latestVol) }}</span>
        </div>
      }
    </div>
  `,
  styleUrl: './chart.component.scss'
})
export class ChartComponent implements AfterViewInit, OnChanges, OnDestroy {
  points      = input<HistoryPoint[]>([]);
  activeRange = input<string>('1mo');
  loading     = input<boolean>(false);
  color       = input<string>('#00d4aa');
  rangeChange = output<string>();

  canvas  = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  ranges  = RANGES;

  // Indicator toggles — plain booleans, no signals needed
  showSma20 = true;
  showSma50 = false;
  showVol   = true;

  private chart?: Chart;

  // Computed display values (updated in updateData)
  isPos      = true;
  curPrice   = '—';
  chgStr     = '';
  pctStr     = '';
  periodName = '';
  rangeLabel = '';
  hi = 0; lo = 0; latestVol = 0;

  ngAfterViewInit() { this.buildChart(); }

  ngOnChanges(c: SimpleChanges) {
    if ((c['points'] || c['activeRange']) && !c['points']?.firstChange) this.updateData();
    if (c['color'] && !c['color'].firstChange) this.buildChart();
  }

  toggleInd(ind: 'sma20' | 'sma50' | 'vol') {
    if (ind === 'sma20') this.showSma20 = !this.showSma20;
    if (ind === 'sma50') this.showSma50 = !this.showSma50;
    if (ind === 'vol')   this.showVol   = !this.showVol;
    this.updateData();
  }

  fmt(v?: number): string {
    if (v == null || isNaN(v)) return '—';
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  fmtVol(v: number): string {
    if (!v) return '—';
    if (v >= 1e7) return (v / 1e7).toFixed(2) + 'Cr';
    if (v >= 1e5) return (v / 1e5).toFixed(2) + 'L';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toString();
  }

  private buildChart() {
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    this.chart?.destroy();

    const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridCol = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    const tickCol = isDark ? '#475569' : '#94a3b8';

    this.chart = new Chart(el, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#fff',
            borderColor: isDark ? '#334155' : '#e2e8f0', borderWidth: 1,
            titleColor: isDark ? '#94a3b8' : '#64748b',
            bodyColor: isDark ? '#f1f5f9' : '#1e293b',
            padding: 10, displayColors: true,
            callbacks: {
              title: (items: TooltipItem<'line'>[]) => {
                const pts = this.points();
                const idx = items[0]?.dataIndex ?? 0;
                return pts[idx] ? fmtLabel(pts[idx].ts, this.activeRange()) : '';
              },
              label: (item: TooltipItem<'line'>) => {
                if (item.dataset.label === 'Volume') {
                  return ` Vol  ${this.fmtVol(item.raw as number)}`;
                }
                if (item.datasetIndex !== 0) {
                  return ` ${item.dataset.label}  ₹${Number(item.raw).toFixed(2)}`;
                }
                const p = this.points()[item.dataIndex];
                if (!p) return ` ₹${Number(item.raw).toFixed(2)}`;
                const lines = [`Close  ₹${p.close.toFixed(2)}`];
                if (p.open) lines.push(`Open   ₹${p.open.toFixed(2)}`);
                if (p.high) lines.push(`High   ₹${p.high.toFixed(2)}`);
                if (p.low)  lines.push(`Low    ₹${p.low.toFixed(2)}`);
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridCol, drawTicks: false }, border: { display: false },
            ticks: { color: tickCol, maxRotation: 0, font: { size: 10 }, padding: 6, maxTicksLimit: 8 }
          },
          y: {
            position: 'right', grid: { color: gridCol, drawTicks: false }, border: { display: false },
            ticks: { color: tickCol, font: { size: 10 }, padding: 8,
              callback: (v: number | string) => '₹' + Number(v).toLocaleString('en-IN') }
          },
          yVol: { position: 'left', display: false, grid: { display: false }, min: 0 }
        }
      }
    });
    this.updateData();
  }

  private makeGradient(el: HTMLCanvasElement, col: string): CanvasGradient {
    const ctx = el.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 280);
    const r = parseInt(col.slice(1,3),16), gv = parseInt(col.slice(3,5),16), b = parseInt(col.slice(5,7),16);
    g.addColorStop(0,   `rgba(${r},${gv},${b},0.14)`);
    g.addColorStop(0.6, `rgba(${r},${gv},${b},0.03)`);
    g.addColorStop(1,   `rgba(${r},${gv},${b},0)`);
    return g;
  }

  private updateData() {
    if (!this.chart) return;
    const pts    = this.points();
    const rng    = this.activeRange();
    const labels = pts.map(p => fmtLabel(p.ts, rng));
    const closes = pts.map(p => p.close);
    const vols   = pts.map(p => p.volume ?? 0);

    // Compute display state
    this.isPos = pts.length >= 2 ? pts[pts.length-1].close >= pts[0].close : true;
    const last = pts[pts.length-1]?.close;
    this.curPrice   = last != null ? '₹' + last.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
    if (pts.length >= 2) {
      const diff = pts[pts.length-1].close - pts[0].close;
      const pct  = (diff / pts[0].close) * 100;
      this.chgStr = (diff >= 0 ? '+' : '') + diff.toFixed(2);
      this.pctStr = '(' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
    }
    this.hi = pts.length ? Math.max(...pts.map(p => p.high ?? p.close)) : 0;
    this.lo = pts.length ? Math.min(...pts.map(p => p.low  ?? p.close)) : 0;
    this.latestVol = pts[pts.length-1]?.volume ?? 0;
    this.periodName = ({ '1d':'Today','5d':'5 Days','1mo':'1 Month','3mo':'3 Months','6mo':'6 Months','1y':'1 Year','2y':'2 Years','5y':'5 Years' } as Record<string,string>)[rng] ?? rng;
    this.rangeLabel = this.periodName;

    const lineCol = this.isPos ? '#00d4aa' : '#f87171';
    const el = this.canvas()?.nativeElement;

    const datasets: any[] = [{
      type: 'line', label: 'Price', data: closes,
      borderColor: lineCol, borderWidth: 1.5, tension: 0.15,
      fill: true, backgroundColor: el ? this.makeGradient(el, lineCol) : 'transparent',
      pointRadius: 0, pointHoverRadius: 5,
      pointHoverBackgroundColor: lineCol, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      yAxisID: 'y', order: 1,
    }];

    if (this.showSma20 && pts.length >= 20) {
      datasets.push({
        type: 'line', label: 'SMA 20', data: computeSMA(closes, 20),
        borderColor: '#f59e0b', borderWidth: 1, borderDash: [3, 2],
        tension: 0.2, fill: false, pointRadius: 0, pointHoverRadius: 0,
        spanGaps: true, yAxisID: 'y', order: 2,
      });
    }

    if (this.showSma50 && pts.length >= 50) {
      datasets.push({
        type: 'line', label: 'SMA 50', data: computeSMA(closes, 50),
        borderColor: '#818cf8', borderWidth: 1, borderDash: [4, 3],
        tension: 0.2, fill: false, pointRadius: 0, pointHoverRadius: 0,
        spanGaps: true, yAxisID: 'y', order: 2,
      });
    }

    if (this.showVol && vols.some(v => v > 0)) {
      const maxVol = Math.max(...vols, 1);
      (this.chart.options.scales as any)['yVol'].max = maxVol * 4;
      datasets.push({
        type: 'bar', label: 'Volume', data: vols,
        backgroundColor: pts.map((p, i) =>
          i === 0 || p.close >= (pts[i-1]?.close ?? p.close)
            ? 'rgba(0,212,170,0.22)' : 'rgba(248,113,113,0.22)'
        ),
        borderColor: 'transparent',
        yAxisID: 'yVol', order: 3,
        barPercentage: 0.9, categoryPercentage: 1,
      });
    }

    (this.chart.options.scales as any)['x'].ticks.maxTicksLimit = maxTicks(rng);
    this.chart.data.labels   = labels;
    this.chart.data.datasets = datasets;
    this.chart.update('active');
  }

  ngOnDestroy() { this.chart?.destroy(); }
}
