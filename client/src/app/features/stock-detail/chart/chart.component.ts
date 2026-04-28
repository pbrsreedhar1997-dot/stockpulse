import {
  Component, OnChanges, OnDestroy, input, output,
  ElementRef, viewChild, AfterViewInit, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';
import { HistoryPoint } from '../../../core/models/stock.model';

Chart.register(...registerables);

const RANGES = ['1d','5d','1mo','3mo','6mo','1y','2y','5y'];

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="chart-wrap">
      <div class="chart-ranges">
        @for (r of ranges; track r) {
          <button class="rng-btn" [class.active]="activeRange() === r" (click)="rangeChange.emit(r)">{{r}}</button>
        }
      </div>
      <div class="chart-area">
        @if (loading()) {
          <div class="chart-overlay"><div class="spin"></div></div>
        }
        <canvas #canvas></canvas>
      </div>
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
  }

  private buildChart() {
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    this.chart?.destroy();
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridCol = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
    const tickCol = isDark ? '#64748b' : '#94a3b8';
    const col = this.color();

    this.chart = new Chart(el, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [], borderColor: col, borderWidth: 2, tension: .35,
          fill: true, backgroundColor: this.makeGradient(el, col),
          pointRadius: 0, pointHoverRadius: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y?.toFixed(2)}` } } },
        scales: {
          x: { grid: { color: gridCol }, ticks: { color: tickCol, maxTicksLimit: 7, maxRotation: 0, font: { size: 10 } } },
          y: { position: 'right', grid: { color: gridCol }, ticks: { color: tickCol, font: { size: 10 } } }
        }
      }
    });
    this.updateData();
  }

  private makeGradient(el: HTMLCanvasElement, col: string): CanvasGradient {
    const ctx = el.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 200);
    // Build rgba from hex
    const r = parseInt(col.slice(1, 3), 16);
    const gv = parseInt(col.slice(3, 5), 16);
    const b = parseInt(col.slice(5, 7), 16);
    g.addColorStop(0, `rgba(${r},${gv},${b},0.25)`);
    g.addColorStop(1, `rgba(${r},${gv},${b},0.0)`);
    return g;
  }

  private updateData() {
    if (!this.chart) return;
    const pts = this.points();
    const labels = pts.map(p => {
      const d = new Date(p.ts * 1000);
      return this.activeRange() === '1d' || this.activeRange() === '5d'
        ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    });
    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = pts.map(p => p.close);
    this.chart.update('active');
  }

  ngOnDestroy() { this.chart?.destroy(); }
}
