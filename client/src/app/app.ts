import { Component, OnInit, OnDestroy, signal, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from './features/sidebar/sidebar.component';
import { StockDetailComponent } from './features/stock-detail/stock-detail.component';
import { ChatComponent } from './features/chat/chat.component';
import { ScreenerComponent } from './features/screener/screener.component';
import { AuthModalComponent } from './features/auth/auth-modal.component';
import { ToastComponent } from './shared/components/toast/toast.component';
import { WatchlistService } from './core/services/watchlist.service';
import { StockService } from './core/services/stock.service';
import { AuthService } from './core/services/auth.service';
import { ApiService } from './core/services/api.service';
import { AlertService } from './core/services/alert.service';
import { ToastService } from './core/services/toast.service';
import { PushNotificationService } from './core/services/push-notification.service';
import { LivePriceService } from './core/services/live-price.service';

type View = 'stocks' | 'chat' | 'screener';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, SidebarComponent, StockDetailComponent, ChatComponent, ScreenerComponent, AuthModalComponent, ToastComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  private wl       = inject(WatchlistService);
  private stocks   = inject(StockService);
  protected auth   = inject(AuthService);
  private api      = inject(ApiService);
  private alertSvc = inject(AlertService);
  private toast        = inject(ToastService);
  protected push       = inject(PushNotificationService);
  protected livePriceSvc = inject(LivePriceService);

  view        = signal<View>((sessionStorage.getItem('sp_view') as View) || 'stocks');
  selectedSym = signal(sessionStorage.getItem('sp_sym') || '');
  showAuth    = signal(false);
  backendOk   = signal<boolean | null>(null);
  showMobile  = signal(false);
  theme       = signal<'dark' | 'light'>(
    (localStorage.getItem('sp_theme') as 'dark' | 'light') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );

  constructor() {
    effect(() => {
      const liveQ = this.livePriceSvc.quotes();
      if (!Object.keys(liveQ).length) return;
      // Update StockService quote cache with live prices
      for (const [sym, lp] of Object.entries(liveQ)) {
        const prev = this.stocks.quotes.get(sym);
        this.stocks.quotes.set(sym, {
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
      }
      // Check price alerts
      const priceMap: Record<string, number> = {};
      for (const [sym, lp] of Object.entries(liveQ)) {
        if (lp.price) priceMap[sym] = lp.price;
      }
      if (Object.keys(priceMap).length) {
        const fired = this.alertSvc.checkTriggered(priceMap);
        fired.forEach(a => {
          const sym = a.symbol.replace('.NS','').replace('.BO','');
          const dir = a.condition === 'above' ? '↑ Above' : '↓ Below';
          this.toast.show(
            `🔔 Alert: ${sym} ${dir} ₹${a.target_price}`,
            'warning',
            `Current price: ₹${a.current_price.toFixed(2)}`,
            8000
          );
        });
      }
    });
  }

  private intervals: ReturnType<typeof setInterval>[] = [];
  private hiddenAt = 0;
  private visibilityHandler = () => {
    if (document.visibilityState === 'hidden') {
      this.hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      if (this.hiddenAt && Date.now() - this.hiddenAt > 5 * 60 * 1000) {
        this.refreshQuotes();
        this.checkBackend();
      }
      this.hiddenAt = 0;
    }
  };

  ngOnInit() {
    this.applyTheme(this.theme());
    this.checkBackend();

    if (!this.wl.items().length) this.wl.set(this.stocks.loadDefaults());
    const savedSym = sessionStorage.getItem('sp_sym');
    const items = this.wl.items();
    if (savedSym && items.some(i => i.symbol === savedSym)) {
      this.selectedSym.set(savedSym);
    } else if (items.length) {
      this.selectedSym.set(items[0].symbol);
    }

    if (this.auth.token()) {
      this.api.getRaw<{ ok: boolean; user: any }>('/auth/me').subscribe(r => {
        if (r?.ok) {
          this.auth.setUser(r.user);
          this.syncWatchlist();
          this.alertSvc.fetchFromServer().subscribe();
          this.push.enableAfterLogin();
        } else { this.auth.logout(); }
      });
    }

    this.refreshQuotes();
    // Delay SSE connection so the initial batch of API calls (quote, profile,
    // history, financials, news) can claim threads before SSE occupies one.
    setTimeout(() => this.livePriceSvc.connect(this.wl.items().map(i => i.symbol)), 5000);
    this.intervals.push(setInterval(() => this.refreshQuotes(), 60000));
    this.intervals.push(setInterval(() => this.checkBackend(), 30000));
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ngOnDestroy() {
    this.intervals.forEach(id => clearInterval(id));
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.livePriceSvc.disconnect();
  }

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
    this.stocks.getBatchQuotes(syms).subscribe(quotes => {
      if (!quotes) return;
      // Build { symbol → price } map and check alerts
      const priceMap: Record<string, number> = {};
      for (const [sym, q] of Object.entries(quotes as Record<string, any>)) {
        if (q?.price) priceMap[sym] = q.price;
      }
      const fired = this.alertSvc.checkTriggered(priceMap);
      fired.forEach(a => {
        const sym  = a.symbol.replace('.NS','').replace('.BO','');
        const dir  = a.condition === 'above' ? '↑ Above' : '↓ Below';
        this.toast.show(
          `🔔 Alert: ${sym} ${dir} ₹${a.target_price}`,
          'warning',
          `Current price: ₹${a.current_price.toFixed(2)}`,
          8000
        );
      });
    });
  }

  syncWatchlist() {
    this.wl.fetchFromServer().subscribe(list => {
      if (list?.length) {
        this.wl.set(list);
        if (!this.selectedSym() && list.length) this.selectedSym.set(list[0].symbol);
        this.refreshQuotes();
        this.livePriceSvc.connect(this.wl.items().map(i => i.symbol));
      }
    });
  }

  onAuthSuccess() {
    this.syncWatchlist();
    this.alertSvc.fetchFromServer().subscribe();
    this.push.enableAfterLogin();
  }

  selectStock(sym: string) {
    this.selectedSym.set(sym);
    this.view.set('stocks');
    this.showMobile.set(false);
    sessionStorage.setItem('sp_sym', sym);
    sessionStorage.setItem('sp_view', 'stocks');
  }

  switchView(v: View) {
    this.view.set(v);
    this.showMobile.set(false);
    sessionStorage.setItem('sp_view', v);
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

  togglePush() {
    if (this.push.subscribed()) {
      this.push.disable().then(() =>
        this.toast.show('🔕 Notifications disabled', 'info', undefined, 3000)
      );
    } else if (this.push.status() === 'denied') {
      this.toast.show('Notifications blocked', 'warning', 'Allow them in your browser settings, then refresh.', 6000);
    } else {
      this.push.enableAfterLogin().then(() => {
        if (this.push.subscribed()) {
          this.toast.show('🔔 Notifications enabled!', 'success', 'You\'ll get alerts on this device.', 4000);
        }
      });
    }
  }

  logout() {
    this.api.post('/auth/logout', {}).subscribe();
    this.auth.logout();
    this.wl.set(this.stocks.loadDefaults());
    this.refreshQuotes();
  }
}
