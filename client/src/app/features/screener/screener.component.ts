import { Component, OnInit, OnDestroy, inject, signal, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScreenerService } from '../../core/services/screener.service';
import { WatchlistService } from '../../core/services/watchlist.service';
import { ScreenerPick } from '../../core/models/stock.model';

@Component({
  selector: 'app-screener',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './screener.component.html',
  styleUrl: './screener.component.scss'
})
export class ScreenerComponent implements OnInit, OnDestroy {
  private svc = inject(ScreenerService);
  private wl  = inject(WatchlistService);

  selectSym = output<string>();

  picks       = signal<ScreenerPick[]>([]);
  status      = signal<'loading' | 'ready' | 'refreshing' | 'error'>('loading');
  updatedAt   = signal('');
  sortKey     = signal<keyof ScreenerPick>('decline_pct');
  sortDir     = signal<1 | -1>(-1);
  filterSec   = signal('all');
  private pollTimer?: ReturnType<typeof setTimeout>;

  ngOnInit() { this.load(true); }
  ngOnDestroy() { clearTimeout(this.pollTimer); }

  load(force = false) {
    this.svc.getValuePicks().subscribe(r => {
      if (!r) { this.status.set('error'); return; }
      if (r.status === 'loading') {
        this.status.set('loading');
        this.pollTimer = setTimeout(() => this.load(), 6000);
        return;
      }
      this.picks.set(r.data || []);
      this.status.set(r.status as any);
      if (r.fetched_at) {
        const mins = Math.round((Date.now() / 1000 - r.fetched_at) / 60);
        this.updatedAt.set(mins < 2 ? 'Just updated' : `${mins}m ago`);
      }
      if (r.status === 'refreshing') this.pollTimer = setTimeout(() => this.load(), 10000);
    });
  }

  refresh() {
    this.status.set('loading');
    this.svc.refresh().subscribe(() => {
      this.pollTimer = setTimeout(() => this.load(), 6000);
    });
  }

  sort(key: keyof ScreenerPick) {
    if (this.sortKey() === key) this.sortDir.update(d => d === 1 ? -1 : 1);
    else { this.sortKey.set(key); this.sortDir.set(-1); }
  }

  get sectors(): string[] {
    const s = new Set(this.picks().map(p => p.sector));
    return ['all', ...s];
  }

  get filtered(): ScreenerPick[] {
    let list = this.picks();
    if (this.filterSec() !== 'all') list = list.filter(p => p.sector === this.filterSec());
    const key = this.sortKey(); const dir = this.sortDir();
    return [...list].sort((a, b) => {
      const av = (a as any)[key] ?? 0, bv = (b as any)[key] ?? 0;
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }

  isInWatchlist(symbol: string): boolean {
    return this.wl.items().some(i => i.symbol === symbol);
  }

  addToWatchlist(p: ScreenerPick, e: Event) {
    e.stopPropagation();
    if (this.isInWatchlist(p.symbol)) return;
    const item = { symbol: p.symbol, name: p.name, exchange: 'NSE' };
    this.wl.add(item);
    this.wl.addToServer(item).subscribe();
  }

  openStock(sym: string) {
    this.selectSym.emit(sym);
  }

  fmt(n: number | null | undefined, dec = 1): string {
    if (n == null) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: dec });
  }
  fmtCr(n: number | null | undefined): string {
    if (n == null) return '—';
    if (n >= 1e5) return (n / 1e5).toFixed(1) + 'L Cr';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K Cr';
    return n.toFixed(1) + ' Cr';
  }
}
