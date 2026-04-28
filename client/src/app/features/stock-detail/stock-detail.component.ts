import { Component, OnInit, OnDestroy, inject, signal, input, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StockService } from '../../core/services/stock.service';
import { WatchlistService } from '../../core/services/watchlist.service';
import { Quote, Profile, Financials, NewsArticle, HistoryPoint, PerformanceData } from '../../core/models/stock.model';
import { ChartComponent } from './chart/chart.component';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type Tab = 'overview' | 'news' | 'financials' | 'performance';

@Component({
  selector: 'app-stock-detail',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  templateUrl: './stock-detail.component.html',
  styleUrl: './stock-detail.component.scss'
})
export class StockDetailComponent implements OnInit, OnDestroy {
  stocks = inject(StockService);
  wl     = inject(WatchlistService);

  symbol = input<string>('');

  tab         = signal<Tab>('overview');
  quote       = signal<Quote | null>(null);
  profile     = signal<Profile | null>(null);
  fins        = signal<Financials | null>(null);
  news        = signal<NewsArticle[]>([]);
  history     = signal<HistoryPoint[]>([]);
  perf        = signal<PerformanceData | null>(null);
  aiSummary   = signal<string>('');
  range       = signal('1mo');
  loadingChart= signal(false);
  loadingNews = signal(false);
  loadingFins = signal(false);
  loadingPerf = signal(false);
  loadingAI   = signal(false);

  protected readonly Math = Math;
  private destroy$ = new Subject<void>();

  constructor() {
    effect(() => {
      const sym = this.symbol();
      if (sym) this.load(sym);
    });
  }

  ngOnInit() {}
  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  load(sym: string) {
    this.quote.set(null); this.profile.set(null); this.fins.set(null);
    this.news.set([]); this.history.set([]); this.perf.set(null); this.aiSummary.set('');

    this.stocks.getQuote(sym).pipe(takeUntil(this.destroy$)).subscribe(q => this.quote.set(q));
    this.stocks.getProfile(sym).pipe(takeUntil(this.destroy$)).subscribe(p => this.profile.set(p));
    this.loadHistory(sym, this.range());
    this.loadNews(sym);
  }

  loadHistory(sym: string, rng: string) {
    this.loadingChart.set(true);
    this.stocks.getHistory(sym, rng).pipe(takeUntil(this.destroy$))
      .subscribe(h => { this.history.set(h || []); this.loadingChart.set(false); });
  }

  loadNews(sym: string) {
    this.loadingNews.set(true);
    const name = this.profile()?.name || sym;
    this.stocks.getNews(sym, name).pipe(takeUntil(this.destroy$))
      .subscribe(a => { this.news.set(a || []); this.loadingNews.set(false); });
  }

  loadFins(sym: string) {
    if (this.fins()) return;
    this.loadingFins.set(true);
    this.stocks.getFinancials(sym).pipe(takeUntil(this.destroy$))
      .subscribe(f => { this.fins.set(f); this.loadingFins.set(false); });
  }

  loadPerf(sym: string) {
    if (this.perf()) return;
    this.loadingPerf.set(true);
    this.stocks.getPerformance(sym).pipe(takeUntil(this.destroy$))
      .subscribe(p => { this.perf.set(p); this.loadingPerf.set(false); });
  }

  loadAI(sym: string) {
    if (this.aiSummary()) return;
    this.loadingAI.set(true);
    this.stocks.getAiSummary(sym).pipe(takeUntil(this.destroy$))
      .subscribe(r => { this.aiSummary.set(r?.summary || ''); this.loadingAI.set(false); });
  }

  switchTab(t: Tab) {
    this.tab.set(t);
    const sym = this.symbol();
    if (t === 'financials') this.loadFins(sym);
    if (t === 'performance') { this.loadPerf(sym); this.loadAI(sym); }
  }

  onRangeChange(r: string) {
    this.range.set(r);
    this.loadHistory(this.symbol(), r);
  }

  get currency(): string { return this.quote()?.currency === 'INR' ? '₹' : '$'; }
  get chartColor(): string { return (this.quote()?.change_pct ?? 0) >= 0 ? '#00d4aa' : '#ef4444'; }

  fmt(n: number | null | undefined, dec = 2): string {
    if (n == null) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: dec });
  }
  fmtBig(n: number | null | undefined): string {
    if (n == null) return '—';
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e7)  return (n / 1e7).toFixed(2) + 'Cr';
    if (n >= 1e5)  return (n / 1e5).toFixed(2) + 'L';
    return n.toLocaleString();
  }
  fmtTime(ts: number | undefined): string {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const now = Date.now() / 1000;
    const diff = now - ts;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  }

  annualReturnEntries(): { year: string; ret: number }[] {
    const p = this.perf();
    if (!p?.annual_returns) return [];
    return Object.entries(p.annual_returns)
      .map(([year, ret]) => ({ year, ret }))
      .sort((a, b) => b.year.localeCompare(a.year))
      .slice(0, 8);
  }

  maxAbsReturn(): number {
    const entries = this.annualReturnEntries();
    return entries.length ? Math.max(...entries.map(e => Math.abs(e.ret))) : 1;
  }

  newsCategories(): string[] {
    const cats = new Set(this.news().map(a => a.category || 'gen'));
    return ['all', ...cats];
  }
}
