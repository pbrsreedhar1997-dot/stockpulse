export interface Quote {
  symbol: string;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  volume: number | null;
  mkt_cap: number | null;
  currency: string;
  fetched_at?: number;
  cached?: boolean;
  _source?: string;
}

export interface WatchlistItem {
  symbol: string;
  name: string;
  exchange?: string;
}

export interface HistoryPoint {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Profile {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  currency?: string;
  website?: string;
  description?: string;
  employees?: number;
  country?: string;
  logo_url?: string;
}

export interface Financials {
  symbol: string;
  market_cap?: number;
  revenue_ttm?: number;
  revenue_q?: number;
  revenue_q_prev?: number;
  net_income_ttm?: number;
  gross_margin?: number;
  pe_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  beta?: number;
  week52_high?: number;
  week52_low?: number;
  avg_volume?: number;
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  published: number;
  summary?: string;
  relevance?: string;
  category?: string;
}

export interface ScreenerPick {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  price: number;
  pe_ratio: number;
  eps: number;
  gross_margin: number;
  net_margin: number;
  mkt_cap_cr: number;
  revenue_cr: number;
  week52_high: number;
  week52_low: number;
  decline_pct: number;
  de_ratio: number;
  beta: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  type?: string;
}

export interface PerformanceData {
  annual_returns: { [year: string]: number };
  cagr_1y?: number;
  cagr_3y?: number;
  cagr_5y?: number;
  best_year?: { year: string; return: number };
  worst_year?: { year: string; return: number };
  max_drawdown?: number;
  volatility?: number;
}
