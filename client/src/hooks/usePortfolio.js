import { useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';

export function usePortfolio() {
  const { state, dispatch } = useAppContext();
  const api = useApi();

  const fetchPortfolio = useCallback(async () => {
    if (!state.token) return;
    try {
      const res = await api.get('/api/portfolio');
      if (res?.ok) dispatch({ type: 'SET_PORTFOLIO', payload: res.data });
    } catch {}
  }, [api, dispatch, state.token]);

  const addHolding = useCallback(async ({ symbol, name, shares, avg_price, notes }) => {
    await api.post('/api/portfolio', { symbol, name, shares: Number(shares), avg_price: Number(avg_price), notes });
    await fetchPortfolio();
  }, [api, fetchPortfolio]);

  const updateHolding = useCallback(async (symbol, { shares, avg_price, notes }) => {
    await api.put(`/api/portfolio/${symbol}`, { shares: Number(shares), avg_price: Number(avg_price), notes });
    await fetchPortfolio();
  }, [api, fetchPortfolio]);

  const removeHolding = useCallback(async (symbol) => {
    await api.del(`/api/portfolio/${symbol}`);
    dispatch({
      type: 'SET_PORTFOLIO',
      payload: state.portfolio
        ? {
            ...state.portfolio,
            holdings: state.portfolio.holdings.filter(h => h.symbol !== symbol),
          }
        : null,
    });
    await fetchPortfolio();
  }, [api, dispatch, fetchPortfolio, state.portfolio]);

  const getHolding = useCallback((symbol) => {
    return state.portfolio?.holdings?.find(h => h.symbol === symbol) ?? null;
  }, [state.portfolio]);

  return { portfolio: state.portfolio, fetchPortfolio, addHolding, updateHolding, removeHolding, getHolding };
}
