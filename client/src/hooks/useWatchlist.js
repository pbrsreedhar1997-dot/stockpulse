import { useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';
import { useToast } from './useToast';

export function useWatchlist() {
  const { state, dispatch } = useAppContext();
  const api = useApi();
  const toast = useToast();

  const add = useCallback(async (symbol, name, exchange = 'NSE') => {
    dispatch({ type: 'ADD_TO_WATCHLIST', payload: { symbol, name, exchange } });
    if (state.token) {
      try { await api.post('/api/watchlist', { symbol, name, exchange }); } catch {}
    }
    toast(`Added ${symbol}`, 'success');
  }, [api, dispatch, state.token, toast]);

  const remove = useCallback(async (symbol) => {
    dispatch({ type: 'REMOVE_FROM_WATCHLIST', payload: symbol });
    if (state.token) {
      try { await api.del(`/api/watchlist/${symbol}`); } catch {}
    }
  }, [api, dispatch, state.token]);

  const syncFromServer = useCallback(async () => {
    if (!state.token) return;
    try {
      const data = await api.get('/api/watchlist');
      if (data?.watchlist) dispatch({ type: 'SET_WATCHLIST', payload: data.watchlist });
    } catch {}
  }, [api, dispatch, state.token]);

  return { watchlist: state.watchlist, add, remove, syncFromServer };
}
