import { Component, OnInit, OnDestroy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { StockDetailComponent } from './features/stock-detail/stock-detail.component';
import { ChatComponent } from './features/chat/chat.component';
import { ScreenerComponent } from './features/screener/screener.component';
import { AuthModalComponent } from './features/auth/auth-modal.component';
import { WatchlistService } from './core/services/watchlist.service';
import { StockService } from './core/services/stock.service';
import { AuthService } from './core/services/auth.service';
import { ApiService } from './core/services/api.service';

type View = 'stocks' | 'chat' | 'screener';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, SidebarComponent, StockDetailComponent, ChatComponent, ScreenerComponent, AuthModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  private wl     = inject(WatchlistService);
  private stocks = inject(StockService);
  protected auth = inject(AuthService);
  private api    = inject(ApiService);

  view        = signal<View>('stocks');
  selectedSym = signal('');
  showAuth    = signal(false);
  backendOk   = signal<boolean | null>(null);
  showMobile  = signal(false);
  theme       = signal<'dark' | 'light'>(
    (localStorage.getItem('sp_theme') as 'dark' | 'light') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );

  private intervals: ReturnType<typeof setInterval>[] = [];

  ngOnInit() {
    this.applyTheme(this.theme());
    this.checkBackend();

    if (!this.wl.items().length) this.wl.set(this.stocks.loadDefaults());
    if (this.wl.items().length) this.selectedSym.set(this.wl.items()[0].symbol);

    if (this.auth.token()) {
      this.api.getRaw<{ ok: boolean; user: any }>('/auth/me').subscribe(r => {
        if (r?.ok) { this.auth.setUser(r.user); this.syncWatchlist(); }
        else this.auth.logout();
      });
    }

    this.refreshQuotes();
    this.intervals.push(setInterval(() => this.refreshQuotes(), 60000));
    this.intervals.push(setInterval(() => this.checkBackend(), 30000));
  }

  ngOnDestroy() { this.intervals.forEach(id => clearInterval(id)); }

  private checkBackend() {
    this.api.getRaw<{ ok: boolean }>('/ping').subscribe(r => {
      const ok = !!r?.ok;
      const prev = this.backendOk();
      this.backendOk.set(ok);
      if (ok && prev === false) this.refreshQuotes();
    });
  }

  refreshQuotes() {
    const syms = this.wl.items().map(i => i.symbol);
    if (!syms.length) return;
    this.stocks.getBatchQuotes(syms).subscribe();
  }

  syncWatchlist() {
    this.wl.fetchFromServer().subscribe(list => {
      if (list?.length) {
        this.wl.set(list);
        if (!this.selectedSym() && list.length) this.selectedSym.set(list[0].symbol);
        this.refreshQuotes();
      }
    });
  }

  onAuthSuccess() { this.syncWatchlist(); }

  selectStock(sym: string) {
    this.selectedSym.set(sym);
    this.view.set('stocks');
    this.showMobile.set(false);
  }

  switchView(v: View) {
    this.view.set(v);
    this.showMobile.set(false);
  }

  toggleTheme() {
    const t = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(t);
    localStorage.setItem('sp_theme', t);
    this.applyTheme(t);
  }

  private applyTheme(t: 'dark' | 'light') {
    document.documentElement.setAttribute('data-theme', t);
  }

  logout() {
    this.api.post('/auth/logout', {}).subscribe();
    this.auth.logout();
    this.wl.set(this.stocks.loadDefaults());
    this.refreshQuotes();
  }
}
