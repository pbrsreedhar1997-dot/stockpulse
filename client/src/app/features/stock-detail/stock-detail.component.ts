import { Component, OnInit, OnDestroy, inject, signal, input, effect, untracked, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { StockService } from '../../core/services/stock.service';
import { WatchlistService } from '../../core/services/watchlist.service';
import { LivePriceService } from '../../core/services/live-price.service';
import { ApiService } from '../../core/services/api.service';
import { Quote, Profile, Financials, NewsArticle, HistoryPoint, PerformanceData } from '../../core/models/stock.model';
import { ChartComponent } from './chart/chart.component';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type Tab = 'overview' | 'news' | 'financials' | 'performance';

/** Minimal markdown → safe HTML for AI summary display */
function simpleMd(md: string): string {
  let s = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  s = s.replace(/^### (.+)$/gm,'<h4>$1</h4>');
  s = s.replace(/^## (.+)$/gm,'<h3>$1</h3>');
  s = s.replace(/^---+$/gm,'<hr>');
  s = s.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g,'<em>$1</em>');
  s = s.replace(/`([^`]+)`/g,'<code>$1</code>');
  s = s.replace(/((?:^[-*] .+\n?)+)/gm, b => {
    const items = b.trim().split('\n').map(l => l.replace(/^[-*] /,'').trim());
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  });
  s = s.replace(/\n\n+/g,'</p><p>').replace(/\n(?!<)/g,'<br>');
  return '<p>' + s + '</p>';
}

@Component({
  selector: 'app-stock-detail',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  templateUrl: './stock-detail.component.html',
  styleUrl: './stock-detail.component.scss'
})
export class StockDetailComponent implements OnInit, OnDestroy {
  stocks       = inject(StockService);
  wl           = inject(WatchlistService);
  sanitizer    = inject(DomSanitizer);
  livePriceSvc = inject(LivePriceService);
  private api  = inject(ApiService);

  symbol = input<string>('');

  tab          = signal<Tab>('overview');
  quote        = signal<Quote | null>(null);
  profile      = signal<Profile | null>(null);
  fins         = signal<Financials | null>(null);
  news         = signal<NewsArticle[]>([]);
  history      = signal<HistoryPoint[]>([]);
  perf         = signal<PerformanceData | null>(null);
  aiSummary    = signal<string>('');
  aiHtml       = signal<string>('');
  range        = signal('1mo');
  loadingChart = signal(false);
  loadingNews  = signal(false);
  loadingFins  = signal(false);
  loadingPerf  = signal(false);
  loadingAI    = signal(false);
  showFullDesc = signal(false);
  newsCategory = signal('all');
  priceFlash   = signal<'up'|'dn'|''>('');
  loadFailed   = signal(false);

  /** True when the relevant market is outside trading hours */
  get marketClosed(): boolean {
    const sym = this.symbol();
    const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO');
    const now = new Date();
    // Weekends: no market is open
    if (now.getDay() === 0 || now.getDay() === 6) return true;
    if (isIndian) {
      // IST offset = UTC+5:30
      const istMs  = now.getTime() + (5 * 60 + 30) * 60 * 1000;
      const ist    = new Date(istMs);
      const mins   = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      return !(mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30);
    }
    // US stocks: NYSE 9:30-16:00 ET (UTC-4 or -5)
    const etOffset = this._isEDT(now) ? -4 : -5;
    const etMs     = now.getTime() + etOffset * 3600 * 1000;
    const et       = new Date(etMs);
    const minsEt   = et.getUTCHours() * 60 + et.getUTCMinutes();
    return !(minsEt >= 9 * 60 + 30 && minsEt <= 16 * 60);
  }

  private _isEDT(d: Date): boolean {
    // EDT (UTC-4) is observed roughly March to November
    const m = d.getUTCMonth() + 1;
    return m >= 3 && m <= 11;
  }

  private finsLoaded = false;
  private perfLoaded = false;
  private retried    = false;
  private autoRetryTimer?: ReturnType<typeof setTimeout>;
  protected readonly Math = Math;
  private destroy$  = new Subject<void>();
  private history$  = new Subject<void>();
  private news$     = new Subject<void>();
  private lastPrice: number | null = null;
  private flashTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Use untracked so only symbol() is tracked — NOT range(), profile(), or any
    // signal read inside load()/loadNews(). Without this, each API response that
    // sets a signal (profile, quote, etc.) re-triggers the effect and cascades
    // into duplicate requests.
    effect(() => {
      const sym = this.symbol();
      if (sym) untracked(() => this.load(sym));
    });
    // Reset retry flag whenever the symbol changes so a new stock always retries
    effect(() => {
      const sym = this.symbol();
      if (sym) untracked(() => { this.retried = false; });
    });
    // Auto-retry when backend comes back online AND load previously failed.
    // loadFailed() is read *outside* untracked so the effect re-runs when it flips.
    effect(() => {
      const ok     = this.api.backendOk();
      const sym    = this.symbol();
      const failed = this.loadFailed();
      if (ok && sym && failed) {
        untracked(() => {
          if (!this.retried) {
            this.retried = true;
            clearTimeout(this.autoRetryTimer);
            this.autoRetryTimer = setTimeout(() => {
              if (this.loadFailed()) this.load(sym);
            }, 3000);
          }
        });
      }
    });
    // Update quote in real-time from live price stream
    effect(() => {
      const sym = this.symbol();
      const lp  = this.livePriceSvc.quotes()[sym];
      if (!lp || !sym) return;
      untracked(() => {
        const prev = this.quote();
        this.animatePrice(lp.price);
        this.quote.set({
          symbol:     sym,
          price:      lp.price,
          change:     lp.change,
          change_pct: lp.change_pct,
          volume:     lp.volume ?? prev?.volume ?? null,
          currency:   lp.currency || prev?.currency || 'INR',
          open:       prev?.open       ?? null,
          high:       prev?.high       ?? null,
          low:        prev?.low        ?? null,
          prev_close: prev?.prev_close ?? null,
          mkt_cap:    prev?.mkt_cap    ?? null,
        });
      });
    });
  }

  ngOnInit() {}
  ngOnDestroy() {
    this.destroy$.next(); this.destroy$.complete();
    this.history$.complete(); this.news$.complete();
    clearTimeout(this.flashTimer);
    clearTimeout(this.autoRetryTimer);
  }

  load(sym: string) {
    this.quote.set(null); this.profile.set(null); this.fins.set(null);
    this.news.set([]); this.history.set([]); this.perf.set(null);
    this.aiSummary.set(''); this.aiHtml.set('');
    this.finsLoaded = false; this.perfLoaded = false;
    this.loadFailed.set(false);
    this.showFullDesc.set(false); this.newsCategory.set('all');
    this.lastPrice = null;

    this.stocks.getQuote(sym).pipe(takeUntil(this.destroy$)).subscribe(q => {
      this.animatePrice(q?.price ?? null);
      this.quote.set(q);
      if (!q) this.loadFailed.set(true);
    });
    this.stocks.getProfile(sym).pipe(takeUntil(this.destroy$)).subscribe(p => this.profile.set(p));
    this.range.set('1mo');
    this.loadHistory(sym, '1mo');
    this.loadNews(sym);
    // Pre-fetch financials so Overview key metrics load immediately
    this.loadFins(sym);
  }

  private animatePrice(newPrice: number | null) {
    if (this.lastPrice == null || newPrice == null) { this.lastPrice = newPrice; return; }
    if (newPrice === this.lastPrice) return;
    const dir: 'up'|'dn' = newPrice > this.lastPrice ? 'up' : 'dn';
    this.lastPrice = newPrice;
    this.priceFlash.set(dir);
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.priceFlash.set(''), 800);
  }

  loadHistory(sym: string, rng: string) {
    this.history$.next(); // cancel any in-flight history request
    this.loadingChart.set(true);
    this.stocks.getHistory(sym, rng)
      .pipe(takeUntil(this.history$), takeUntil(this.destroy$))
      .subscribe(h => { this.history.set(h || []); this.loadingChart.set(false); });
  }

  loadNews(sym: string) {
    this.news$.next(); // cancel any in-flight news request
    this.loadingNews.set(true);
    const name = untracked(() => this.profile()?.name) || sym;
    this.stocks.getNews(sym, name)
      .pipe(takeUntil(this.news$), takeUntil(this.destroy$))
      .subscribe(a => { this.news.set(a || []); this.loadingNews.set(false); });
  }

  loadFins(sym: string) {
    if (this.finsLoaded) return;
    this.finsLoaded = true;
    this.loadingFins.set(true);
    this.stocks.getFinancials(sym).pipe(takeUntil(this.destroy$))
      .subscribe(f => { this.fins.set(f); this.loadingFins.set(false); });
  }

  loadPerf(sym: string) {
    if (this.perfLoaded) return;
    this.perfLoaded = true;
    this.loadingPerf.set(true);
    this.stocks.getPerformance(sym).pipe(takeUntil(this.destroy$))
      .subscribe(p => { this.perf.set(p); this.loadingPerf.set(false); });
  }

  loadAI(sym: string) {
    if (this.aiSummary()) return;
    this.loadingAI.set(true);
    this.stocks.getAiSummary(sym).pipe(takeUntil(this.destroy$))
      .subscribe(r => {
        const txt = r?.summary || '';
        this.aiSummary.set(txt);
        this.aiHtml.set(this.sanitizer.sanitize(SecurityContext.HTML, simpleMd(txt)) ?? txt);
        this.loadingAI.set(false);
      });
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

  get filteredNews(): NewsArticle[] {
    const cat = this.newsCategory();
    if (cat === 'all') return this.news();
    return this.news().filter(a => (a.category || 'gen') === cat);
  }

  newsCategories(): string[] {
    const cats = new Set(this.news().map(a => a.category || 'gen'));
    return ['all', ...cats];
  }

  near52High(): boolean {
    const f = this.fins(); const q = this.quote();
    if (!f?.week52_high || !q?.price) return false;
    return (f.week52_high - q.price) / f.week52_high < 0.05;
  }
  near52Low(): boolean {
    const f = this.fins(); const q = this.quote();
    if (!f?.week52_low || !q?.price) return false;
    return (q.price - f.week52_low) / f.week52_low < 0.05;
  }

  fmt(n: number | null | undefined, dec = 2): string {
    if (n == null) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: dec });
  }
  fmtPct(n: number | null | undefined): string {
    if (n == null) return '—';
    return (n * 100).toFixed(2) + '%';
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
    const now = Date.now() / 1000;
    const diff = now - ts;
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return new Date(ts * 1000).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  }

  annualReturnEntries(): { year: string; ret: number }[] {
    const p = this.perf();
    if (!p?.annual_returns) return [];
    return Object.entries(p.annual_returns)
      .map(([year, ret]) => ({ year, ret: ret as number }))
      .sort((a, b) => b.year.localeCompare(a.year))
      .slice(0, 8);
  }

  maxAbsReturn(): number {
    const entries = this.annualReturnEntries();
    return entries.length ? Math.max(...entries.map(e => Math.abs(e.ret)), 1) : 1;
  }
}
