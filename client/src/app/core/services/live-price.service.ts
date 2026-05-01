import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

export interface LivePrice {
  price: number;
  change: number;
  change_pct: number;
  volume?: number;
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class LivePriceService implements OnDestroy {
  private api  = inject(ApiService);
  private zone = inject(NgZone);

  private es?: EventSource;

  quotes = signal<Record<string, LivePrice>>({});
  status = signal<'off' | 'connecting' | 'live' | 'error'>('off');

  connect(symbols: string[]) {
    this.disconnect();
    if (!symbols.length) return;
    this.status.set('connecting');

    const url = `${this.api.base}/stream/prices?symbols=${symbols.map(encodeURIComponent).join(',')}`;

    this.zone.runOutsideAngular(() => {
      this.es = new EventSource(url);

      this.es.onopen = () => this.zone.run(() => this.status.set('live'));

      this.es.onmessage = (e: MessageEvent) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg.type === 'snapshot' || msg.type === 'update') {
            this.zone.run(() => this.quotes.update(q => ({ ...q, ...(msg.quotes as Record<string, LivePrice>) })));
          }
        } catch { /* ignore parse errors */ }
      };

      this.es.onerror = () => this.zone.run(() => this.status.set('error'));
    });
  }

  disconnect() {
    this.es?.close();
    this.es = undefined;
    this.status.set('off');
  }

  ngOnDestroy() { this.disconnect(); }
}
