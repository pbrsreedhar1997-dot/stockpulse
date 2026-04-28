import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import {
  Quote, WatchlistItem, HistoryPoint, Profile,
  Financials, NewsArticle, PerformanceData, SearchResult
} from '../models/stock.model';
import { Observable, of } from 'rxjs';
import { tap, map } from 'rxjs/operators';

const DEFAULT_WATCHLIST: WatchlistItem[] = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries',       exchange: 'NSE' },
  { symbol: 'TCS.NS',      name: 'Tata Consultancy Services', exchange: 'NSE' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank',                 exchange: 'NSE' },
  { symbol: 'INFY.NS',     name: 'Infosys',                   exchange: 'NSE' },
  { symbol: 'WIPRO.NS',    name: 'Wipro',                     exchange: 'NSE' },
  { symbol: 'AAPL',        name: 'Apple Inc.',                 exchange: 'NASDAQ' },
  { symbol: 'MSFT',        name: 'Microsoft Corporation',      exchange: 'NASDAQ' },
];

@Injectable({ providedIn: 'root' })
export class StockService {
  private api = inject(ApiService);

  quotes   = new Map<string, Quote>();
  profiles = new Map<string, Profile>();
  fins     = new Map<string, Financials>();
  news     = new Map<string, NewsArticle[]>();

  loadDefaults(): WatchlistItem[] {
    return DEFAULT_WATCHLIST;
  }

  getQuote(symbol: string): Observable<Quote | null> {
    const cached = this.quotes.get(symbol);
    if (cached) return of(cached);
    return this.api.get<Quote>(`/quote/${encodeURIComponent(symbol)}`).pipe(
      tap(q => { if (q) this.quotes.set(symbol, q); })
    );
  }

  getBatchQuotes(symbols: string[]): Observable<Record<string, Quote> | null> {
    return this.api.getRaw<{ ok: boolean; data: Record<string, Quote> }>(
      `/quotes/batch?symbols=${symbols.map(encodeURIComponent).join(',')}`
    ).pipe(
      map(r => r?.data ?? null),
      tap(qs => {
        if (qs) Object.entries(qs).forEach(([s, q]) => this.quotes.set(s, q));
      })
    );
  }

  getHistory(symbol: string, range: string): Observable<HistoryPoint[] | null> {
    return this.api.get<HistoryPoint[]>(`/history/${encodeURIComponent(symbol)}?range=${range}`);
  }

  getProfile(symbol: string): Observable<Profile | null> {
    const cached = this.profiles.get(symbol);
    if (cached) return of(cached);
    return this.api.get<Profile>(`/profile/${encodeURIComponent(symbol)}`).pipe(
      tap(p => { if (p) this.profiles.set(symbol, p); })
    );
  }

  getFinancials(symbol: string): Observable<Financials | null> {
    const cached = this.fins.get(symbol);
    if (cached) return of(cached);
    return this.api.get<Financials>(`/financials/${encodeURIComponent(symbol)}`).pipe(
      tap(f => { if (f) this.fins.set(symbol, f); })
    );
  }

  getNews(symbol: string, name: string): Observable<NewsArticle[] | null> {
    const cached = this.news.get(symbol);
    if (cached?.length) return of(cached);
    return this.api.get<NewsArticle[]>(`/news/${encodeURIComponent(symbol)}?name=${encodeURIComponent(name)}`).pipe(
      tap(a => { if (a?.length) this.news.set(symbol, a); })
    );
  }

  getPerformance(symbol: string): Observable<PerformanceData | null> {
    return this.api.get<PerformanceData>(`/performance/${encodeURIComponent(symbol)}`);
  }

  getAiSummary(symbol: string): Observable<{ summary: string } | null> {
    return this.api.getRaw<{ ok: boolean; summary: string }>(
      `/ai-summary/${encodeURIComponent(symbol)}`
    ).pipe(map(r => r?.ok ? { summary: r.summary } : null));
  }

  search(query: string): Observable<SearchResult[] | null> {
    return this.api.get<SearchResult[]>(`/search?q=${encodeURIComponent(query)}`);
  }

  ping(): Observable<{ ok: boolean } | null> {
    return this.api.getRaw<{ ok: boolean }>('/ping');
  }
}
