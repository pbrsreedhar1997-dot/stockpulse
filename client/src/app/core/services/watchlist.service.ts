import { Injectable, inject, signal } from '@angular/core';
import { WatchlistItem } from '../models/stock.model';
import { ApiService } from './api.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class WatchlistService {
  private api = inject(ApiService);

  items = signal<WatchlistItem[]>(this._load());

  private _load(): WatchlistItem[] {
    try {
      const s = localStorage.getItem('sp3_wl');
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  }

  save() {
    localStorage.setItem('sp3_wl', JSON.stringify(this.items()));
  }

  set(list: WatchlistItem[]) {
    this.items.set(list);
    this.save();
  }

  add(item: WatchlistItem) {
    if (!this.items().find(i => i.symbol === item.symbol)) {
      this.items.update(l => [...l, item]);
      this.save();
    }
  }

  remove(symbol: string) {
    this.items.update(l => l.filter(i => i.symbol !== symbol));
    this.save();
  }

  hasSymbol(symbol: string): boolean {
    return this.items().some(i => i.symbol === symbol);
  }

  fetchFromServer(): Observable<WatchlistItem[] | null> {
    return this.api.get<WatchlistItem[]>('/watchlist').pipe(
      tap(list => { if (list?.length) this.set(list); })
    );
  }

  addToServer(item: WatchlistItem): Observable<unknown> {
    return this.api.post('/watchlist', item);
  }

  removeFromServer(symbol: string): Observable<unknown> {
    return this.api.delete(`/watchlist/${encodeURIComponent(symbol)}`);
  }
}
