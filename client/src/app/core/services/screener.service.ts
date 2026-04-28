import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { ScreenerPick } from '../models/stock.model';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ScreenerService {
  private api = inject(ApiService);

  getValuePicks(): Observable<{ data: ScreenerPick[]; status: string; fetched_at?: number } | null> {
    return this.api.getRaw<{ ok: boolean; data: ScreenerPick[]; status: string; fetched_at?: number }>(
      '/screener/value-picks'
    ).pipe(map(r => r ? { data: r.data, status: r.status, fetched_at: r.fetched_at } : null));
  }

  refresh(): Observable<unknown> {
    return this.api.post('/screener/refresh', {});
  }
}
