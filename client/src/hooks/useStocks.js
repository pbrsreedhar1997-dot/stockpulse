import { useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';

export function useStocks() {
  const { state, dispatch } = useAppContext();
  const api = useApi();

  // Quote: server → {ok, data: {price, change, ...}}
  const fetchQuote = useCallback(async (symbol) => {
    try {
      const res = await api.get(`/api/quote/${symbol}`);
      const data = res?.data ?? null;
      if (data) dispatch({ type: 'SET_QUOTE', payload: { symbol, data } });
      return data;
    } catch (e) {
      console.error('fetchQuote', symbol, e);
      return null;
    }
  }, [api, dispatch]);

  // Profile: server → {ok, data: {name, sector, ...}}
  const fetchProfile = useCallback(async (symbol) => {
    if (state.profiles[symbol]) return state.profiles[symbol];
    try {
      const res = await api.get(`/api/profile/${symbol}`);
      const data = res?.data ?? null;
      if (data) dispatch({ type: 'SET_PROFILE', payload: { symbol, data } });
      return data;
    } catch (e) {
      console.error('fetchProfile', symbol, e);
      return null;
    }
  }, [api, dispatch, state.profiles]);

  // Financials: server → {ok, data: {pe_ratio, eps, ...}}
  const fetchFinancials = useCallback(async (symbol) => {
    if (state.financials[symbol]) return state.financials[symbol];
    try {
      const res = await api.get(`/api/financials/${symbol}`);
      const data = res?.data ?? null;
      if (data) dispatch({ type: 'SET_FINANCIALS', payload: { symbol, data } });
      return data;
    } catch (e) {
      console.error('fetchFinancials', symbol, e);
      return null;
    }
  }, [api, dispatch, state.financials]);

  // History: server → {ok, data: [{ts, open, high, low, close, volume}, ...]}
  // Transform to candlestick format PriceChart expects: {candles: [{t, o, h, l, c}]}
  const fetchHistory = useCallback(async (symbol, range = '1mo') => {
    try {
      const res = await api.get(`/api/history/${symbol}?range=${range}`);
      const points = res?.data;
      if (!Array.isArray(points)) return null;
      const intraday = range === '1d';
      return {
        candles: points.map(p => ({
          // Daily bars: snap to UTC noon to avoid day-boundary drift across timezones
          t: intraday ? p.ts * 1000 : Math.floor(p.ts / 86400) * 86400 * 1000 + 43200000,
          o: p.open,
          h: p.high,
          l: p.low,
          c: p.close,
          v: p.volume ?? 0,
        })),
      };
    } catch (e) {
      return null;
    }
  }, [api]);

  // News: server → {ok, data: [{title, url, source, published, ...}, ...]}
  // Return {news: [...]} so NewsTab can do d?.news
  const fetchNews = useCallback(async (symbol) => {
    try {
      const res = await api.get(`/api/news/${symbol}`);
      const articles = Array.isArray(res?.data) ? res.data : [];
      return { news: articles };
    } catch (e) {
      return { news: [] };
    }
  }, [api]);

  // Performance: server → {ok, data: {cagr_1y, cagr_5y, annual_returns, ...}}
  const fetchPerformance = useCallback(async (symbol) => {
    try {
      const res = await api.get(`/api/performance/${symbol}`);
      return res?.data ?? null;
    } catch (e) {
      return null;
    }
  }, [api]);

  // Search: server → {ok, data: [{symbol, name, exchange, type}, ...]}
  // Return {results: [...]} so Search component can do data?.results
  const search = useCallback(async (query) => {
    try {
      const res = await api.get(`/api/search?q=${encodeURIComponent(query)}`);
      return { results: Array.isArray(res?.data) ? res.data : [] };
    } catch (e) {
      return { results: [] };
    }
  }, [api]);

  return {
    quotes: state.quotes,
    profiles: state.profiles,
    financials: state.financials,
    fetchQuote,
    fetchProfile,
    fetchFinancials,
    fetchHistory,
    fetchNews,
    fetchPerformance,
    search,
  };
}
