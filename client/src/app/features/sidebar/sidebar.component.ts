import { Component, inject, signal, output, input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WatchlistService } from '../../core/services/watchlist.service';
import { StockService } from '../../core/services/stock.service';
import { AlertService, PriceAlert } from '../../core/services/alert.service';
import { AuthService } from '../../core/services/auth.service';
import { Quote, WatchlistItem, SearchResult } from '../../core/models/stock.model';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent implements OnInit, OnDestroy {
  wl        = inject(WatchlistService);
  stocks    = inject(StockService);
  alertSvc  = inject(AlertService);
  auth      = inject(AuthService);

  selected   = input<string>('');
  selectSym  = output<string>();
  openAuth   = output<void>();

  searchQuery   = '';
  searchResults = signal<SearchResult[]>([]);
  searching     = signal(false);
  showSearch    = signal(false);

  // Alert panel state
  alertTarget   = signal<string | null>(null);   // symbol whose alert panel is open
  alertPrice    = signal('');
  alertCond     = signal<'above' | 'below'>('above');

  private destroy$ = new Subject<void>();
  private search$  = new Subject<string>();

  ngOnInit() {
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(q => { this.searching.set(true); return this.stocks.search(q); }),
      takeUntil(this.destroy$)
    ).subscribe(r => { this.searching.set(false); this.searchResults.set(r || []); });
  }

  ngOnDestroy() { this.destroy$.next(); this.destroy$.complete(); }

  onSearchInput() {
    if (this.searchQuery.trim().length > 0) {
      this.showSearch.set(true);
      this.search$.next(this.searchQuery.trim());
    } else {
      this.showSearch.set(false);
      this.searchResults.set([]);
    }
  }

  addFromSearch(r: SearchResult) {
    const item: WatchlistItem = { symbol: r.symbol, name: r.name, exchange: r.exchange };
    this.wl.add(item);
    this.wl.addToServer(item).subscribe();
    this.searchQuery = '';
    this.showSearch.set(false);
    this.selectSym.emit(r.symbol);
  }

  remove(sym: string, e: Event) {
    e.stopPropagation();
    this.wl.remove(sym);
    this.wl.removeFromServer(sym).subscribe();
    const items = this.wl.items();
    if (this.selected() === sym && items.length) this.selectSym.emit(items[0].symbol);
  }

  getQuote(sym: string): Quote | undefined { return this.stocks.quotes.get(sym); }

  fmtPrice(q: Quote | undefined): string {
    if (!q?.price) return '—';
    return (q.currency === 'INR' ? '₹' : '$') + q.price.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  fmtChg(q: Quote | undefined): string {
    if (q?.change_pct == null) return '—';
    return (q.change_pct >= 0 ? '+' : '') + q.change_pct.toFixed(2) + '%';
  }

  isUp(q: Quote | undefined): boolean { return (q?.change_pct ?? 0) >= 0; }

  // ── Alert helpers ────────────────────────────────────────────────────────
  toggleAlertPanel(sym: string, e: Event) {
    e.stopPropagation();
    if (this.alertTarget() === sym) {
      this.alertTarget.set(null);
    } else {
      this.alertTarget.set(sym);
      const q = this.getQuote(sym);
      this.alertPrice.set(q?.price ? q.price.toFixed(2) : '');
      this.alertCond.set('above');
    }
  }

  saveAlert(sym: string, e: Event) {
    e.stopPropagation();
    const price = parseFloat(this.alertPrice());
    if (!price || isNaN(price)) return;
    const item = this.wl.items().find(i => i.symbol === sym);
    this.alertSvc.add({
      symbol:       sym,
      name:         item?.name || sym,
      condition:    this.alertCond(),
      target_price: price,
    }, !!this.auth.token()).subscribe();
    this.alertTarget.set(null);
  }

  removeAlert(id: number, e: Event) {
    e.stopPropagation();
    this.alertSvc.remove(id, !!this.auth.token()).subscribe();
  }

  alertsFor(sym: string): PriceAlert[] {
    return this.alertSvc.alertsForSymbol(sym);
  }

  hasAlert(sym: string): boolean {
    return this.alertsFor(sym).length > 0;
  }

  condLabel(c: 'above' | 'below'): string { return c === 'above' ? '≥' : '≤'; }
}
