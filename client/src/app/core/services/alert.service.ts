import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

export interface PriceAlert {
  id?: number;
  symbol: string;
  name: string;
  condition: 'above' | 'below';
  target_price: number;
  triggered?: number;
  triggered_at?: number;
  created_at?: number;
  // local-only flag (not logged in)
  local?: boolean;
}

export interface TriggeredAlert extends PriceAlert {
  current_price: number;
}

const LS_KEY = 'sp_alerts_local';

@Injectable({ providedIn: 'root' })
export class AlertService {
  private api = inject(ApiService);

  alerts = signal<PriceAlert[]>(this._loadLocal());

  private _loadLocal(): PriceAlert[] {
    try {
      const s = localStorage.getItem(LS_KEY);
      return s ? JSON.parse(s) : [];
    } catch { return []; }
  }

  private _saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify(this.alerts()));
  }

  /** Add alert — persists to backend if authed, else localStorage only */
  add(alert: Omit<PriceAlert, 'id'>, isAuthed: boolean): Observable<unknown> {
    if (isAuthed) {
      return this.api.post<{ ok: boolean; id: number }>('/alerts', alert).pipe(
        tap(r => {
          if (r?.ok) {
            this.alerts.update(list => [...list, { ...alert, id: r.id }]);
          }
        })
      );
    }
    // local-only
    const local: PriceAlert = {
      ...alert,
      id: Date.now(),
      local: true,
      created_at: Math.floor(Date.now() / 1000),
    };
    this.alerts.update(list => [...list, local]);
    this._saveLocal();
    return of({ ok: true });
  }

  /** Remove alert by id */
  remove(id: number, isAuthed: boolean): Observable<unknown> {
    this.alerts.update(list => list.filter(a => a.id !== id));
    this._saveLocal();
    if (isAuthed) {
      return this.api.delete(`/alerts/${id}`).pipe(catchError(() => of(null)));
    }
    return of({ ok: true });
  }

  /** Fetch alerts from server (when logged in) */
  fetchFromServer(): Observable<unknown> {
    return this.api.getRaw<{ ok: boolean; alerts: PriceAlert[] }>('/alerts').pipe(
      tap((r: any) => {
        if (r?.ok && r.alerts) {
          const localOnly = this.alerts().filter(a => a.local);
          this.alerts.set([...(r.alerts as PriceAlert[]), ...localOnly]);
          this._saveLocal();
        }
      }),
      catchError(() => of(null))
    );
  }

  /** Given current quote map { symbol → price }, return newly triggered alerts */
  checkTriggered(quotes: Record<string, number>): TriggeredAlert[] {
    const triggered: TriggeredAlert[] = [];
    this.alerts.update(list =>
      list.map(a => {
        if (a.triggered) return a;
        const price = quotes[a.symbol];
        if (price == null) return a;
        const hit =
          (a.condition === 'above' && price >= a.target_price) ||
          (a.condition === 'below' && price <= a.target_price);
        if (hit) {
          triggered.push({ ...a, current_price: price });
          return { ...a, triggered: 1, triggered_at: Math.floor(Date.now() / 1000) };
        }
        return a;
      })
    );
    if (triggered.length) this._saveLocal();
    return triggered;
  }

  activeAlerts(): PriceAlert[] {
    return this.alerts().filter(a => !a.triggered);
  }

  alertsForSymbol(symbol: string): PriceAlert[] {
    return this.alerts().filter(a => a.symbol === symbol && !a.triggered);
  }
}
