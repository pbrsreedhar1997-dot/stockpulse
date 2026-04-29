import {
  Component, OnChanges, OnDestroy, input, output,
  ElementRef, viewChild, AfterViewInit, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables, TooltipItem } from 'chart.js';
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
  if (rangeKey === '1d') {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  if (rangeKey === '5d') {
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) + ' '
         + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (rangeKey === '1mo' || rangeKey === '3mo') {
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  }
  if (rangeKey === '6mo' || rangeKey === '1y') {
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: '2-digit' });
  }
  // 2y, 5y — month + year is enough
  return d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

function maxTicks(rangeKey: string): number {
  return { '1d': 8, '5d': 6, '1mo': 8, '3mo': 8, '6mo': 7, '1y': 8, '2y': 8, '5y': 8 }[rangeKey] ?? 8;
}

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap">
      <!-- Stats bar -->
      <div class="chart-stats" [class.pos]="isPositive()" [class.neg]="!isPositive()">
        <span class="stat-price">{{ currentPrice() }}</span>
        <span class="stat-change">{{ changeStr() }}</span>
        <span class="stat-pct">{{ changePct() }}</span>
        <span class="stat-range-label">{{ rangeLabel() }}</span>
      </div>

      <!-- Range buttons -->
      <div class="chart-ranges">
        @for (r of ranges; track r.key) {
          <button class="rng-btn" [class.active]="activeRange() === r.key" (click)="rangeChange.emit(r.key)">
            {{ r.label }}
          </button>
        }
      </div>

      <!-- Chart canvas -->
      <div class="chart-area">
        @if (loading()) {
          <div class="chart-overlay">
            <div class="spin"></div>
            <span class="loading-text">Loading {{ activeRangeLabel() }}…</span>
          </div>
        }
        @if (!loading() && points().length === 0) {
          <div class="chart-empty">
            <span class="empty-icon">📊</span>
            <span>No data for {{ activeRangeLabel() }}</span>
          </div>
        }
        <canvas #canvas></canvas>
      </div>

      <!-- Mini OHLV info bar -->
      @if (points().length > 0) {
        <div class="chart-meta">
          <span class="meta-item"><span class="meta-lbl">O</span> {{ fmt(points()[0]?.open) }}</span>
          <span class="meta-item"><span class="meta-lbl">H</span> {{ fmt(periodHigh()) }}</span>
          <span class="meta-item"><span class="meta-lbl">L</span> {{ fmt(periodLow()) }}</span>
          <span class="meta-item"><span class="meta-lbl">Vol</span> {{ fmtVol(latestVol()) }}</span>
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

  canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  ranges = RANGES;
  private chart?: Chart;

  ngAfterViewInit() { this.buildChart(); }

  ngOnChanges(c: SimpleChanges) {
    if (c['points'] && !c['points'].firstChange) this.updateData();
    if (c['color'] && !c['color'].firstChange) this.buildChart();
    if (c['activeRange'] && !c['activeRange'].firstChange) this.updateData();
  }

  activeRangeLabel(): string {
    return RANGES.find(r => r.key === this.activeRange())?.label ?? this.activeRange();
  }

  rangeLabel(): string {
    const labels: Record<string, string> = {
      '1d': 'Today', '5d': '5 Days', '1mo': '1 Month', '3mo': '3 Months',
      '6mo': '6 Months', '1y': '1 Year', '2y': '2 Years', '5y': '5 Years'
    };
    return labels[this.activeRange()] ?? this.activeRange();
  }

  currentPrice(): string {
    const pts = this.points();
    if (!pts.length) return '—';
    return '₹' + (pts[pts.length - 1].close).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  isPositive(): boolean {
    const pts = this.points();
    if (pts.length < 2) return true;
    return pts[pts.length - 1].close >= pts[0].close;
  }

  changeStr(): string {
    const pts = this.points();
    if (pts.length < 2) return '';
    const diff = pts[pts.length - 1].close - pts[0].close;
    return (diff >= 0 ? '+' : '') + diff.toFixed(2);
  }

  changePct(): string {
    const pts = this.points();
    if (pts.length < 2) return '';
    const pct = ((pts[pts.length - 1].close - pts[0].close) / pts[0].close) * 100;
    return '(' + (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%)';
  }

  periodHigh(): number { return Math.max(...this.points().map(p => p.high ?? p.close)); }
  periodLow():  number { return Math.min(...this.points().map(p => p.low  ?? p.close)); }
  latestVol():  number {
    const pts = this.points();
    return pts.length ? (pts[pts.length - 1].volume ?? 0) : 0;
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

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridCol = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const tickCol = isDark ? '#475569' : '#94a3b8';
    const col = this.color();
    const pos = this.isPositive();
    const lineCol = pos ? '#00d4aa' : '#f87171';

    this.chart = new Chart(el, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: lineCol,
          borderWidth: 1.5,
          tension: 0.2,
          fill: true,
          backgroundColor: this.makeGradient(el, lineCol),
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: lineCol,
          pointHoverBorderColor: '#fff',
          pointHoverBorderWidth: 2,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#fff',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            titleColor: isDark ? '#94a3b8' : '#64748b',
            bodyColor: isDark ? '#f1f5f9' : '#1e293b',
            padding: 10,
            displayColors: false,
            callbacks: {
              title: (items: TooltipItem<'line'>[]) => {
                const pts = this.points();
                const idx = items[0]?.dataIndex ?? 0;
                if (!pts[idx]) return '';
                return fmtLabel(pts[idx].ts, this.activeRange());
              },
              label: (item: TooltipItem<'line'>) => {
                const pts = this.points();
                const p = pts[item.dataIndex];
                if (!p) return '';
                const lines = [`Close  ₹${p.close.toFixed(2)}`];
                if (p.open)   lines.push(`Open   ₹${p.open.toFixed(2)}`);
                if (p.high)   lines.push(`High   ₹${p.high.toFixed(2)}`);
                if (p.low)    lines.push(`Low    ₹${p.low.toFixed(2)}`);
                if (p.volume) lines.push(`Vol    ${this.fmtVol(p.volume)}`);
                return lines;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridCol, drawTicks: false },
            border: { display: false },
            ticks: {
              color: tickCol,
              maxTicksLimit: maxTicks(this.activeRange()),
              maxRotation: 0,
              font: { size: 10, family: 'inherit' },
              padding: 6,
            }
          },
          y: {
            position: 'right',
            grid: { color: gridCol, drawTicks: false },
            border: { display: false, dash: [4, 4] },
            ticks: {
              color: tickCol,
              font: { size: 10, family: 'inherit' },
              padding: 8,
              callback: (v: number | string) => '₹' + Number(v).toLocaleString('en-IN'),
            }
          }
        }
      }
    });
    this.updateData();
  }

  private makeGradient(el: HTMLCanvasElement, col: string): CanvasGradient {
    const ctx = el.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 260);
    const r = parseInt(col.slice(1, 3), 16);
    const gv = parseInt(col.slice(3, 5), 16);
    const b = parseInt(col.slice(5, 7), 16);
    g.addColorStop(0, `rgba(${r},${gv},${b},0.18)`);
    g.addColorStop(0.6, `rgba(${r},${gv},${b},0.04)`);
    g.addColorStop(1, `rgba(${r},${gv},${b},0.0)`);
    return g;
  }

  private updateData() {
    if (!this.chart) return;
    const pts = this.points();
    const rng = this.activeRange();
    const labels = pts.map(p => fmtLabel(p.ts, rng));

    // Recolor line based on direction
    const pos = pts.length >= 2 ? pts[pts.length - 1].close >= pts[0].close : true;
    const lineCol = pos ? '#00d4aa' : '#f87171';
    const el = this.canvas()?.nativeElement;
    if (el) {
      this.chart.data.datasets[0].borderColor = lineCol;
      this.chart.data.datasets[0].backgroundColor = this.makeGradient(el, lineCol);
      (this.chart.data.datasets[0] as any).pointHoverBackgroundColor = lineCol;
    }

    (this.chart.options.scales!['x'] as any).ticks.maxTicksLimit = maxTicks(rng);
    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = pts.map(p => p.close);
    this.chart.update('active');
  }

  ngOnDestroy() { this.chart?.destroy(); }
}
