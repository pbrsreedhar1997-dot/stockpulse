import { useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';

export function useStocks() {
  const { state, dispatch } = useAppContext();
  const api = useApi();

  const fetchQuote = useCallback(async (symbol) => {
    try {
      const data = await api.get(`/api/quote/${symbol}`);
      dispatch({ type: 'SET_QUOTE', payload: { symbol, data } });
      return data;
    } catch (e) {
      console.error('fetchQuote', symbol, e);
      return null;
    }
  }, [api, dispatch]);

  const fetchProfile = useCallback(async (symbol) => {
    if (state.profiles[symbol]) return state.profiles[symbol];
    try {
      const data = await api.get(`/api/profile/${symbol}`);
      dispatch({ type: 'SET_PROFILE', payload: { symbol, data } });
      return data;
    } catch (e) {
      console.error('fetchProfile', symbol, e);
      return null;
    }
  }, [api, dispatch, state.profiles]);

  const fetchFinancials = useCallback(async (symbol) => {
    if (state.financials[symbol]) return state.financials[symbol];
    try {
      const data = await api.get(`/api/financials/${symbol}`);
      dispatch({ type: 'SET_FINANCIALS', payload: { symbol, data } });
      return data;
    } catch (e) {
      console.error('fetchFinancials', symbol, e);
      return null;
    }
  }, [api, dispatch, state.financials]);

  const fetchHistory = useCallback(async (symbol, range = '1mo') => {
    return api.get(`/api/history/${symbol}?range=${range}`);
  }, [api]);

  const fetchNews = useCallback(async (symbol) => {
    return api.get(`/api/news/${symbol}`);
  }, [api]);

  const fetchPerformance = useCallback(async (symbol) => {
    return api.get(`/api/performance/${symbol}`);
  }, [api]);

  const search = useCallback(async (query) => {
    return api.get(`/api/search?q=${encodeURIComponent(query)}`);
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
