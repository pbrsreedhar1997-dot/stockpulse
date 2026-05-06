import { useState, useCallback, useRef } from 'react';
import { useApi } from './useApi';

export function useScreener() {
  const api = useApi();
  const [stocks, setStocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const poll = async (delay = 6000) => {
      try {
        const data = await api.get('/api/screener/value-picks');
        if (data.status === 'loading') {
          pollRef.current = setTimeout(() => poll(Math.min(delay * 1.5, 30000)), delay);
          return;
        }
        setStocks(data.stocks || []);
        setLoading(false);
      } catch (e) {
        setError(e.message);
        setLoading(false);
      }
    };

    await poll();
  }, [api]);

  const refresh = useCallback(async () => {
    try { await api.post('/api/screener/refresh', {}); } catch {}
    clearTimeout(pollRef.current);
    load();
  }, [api, load]);

  return { stocks, loading, error, load, refresh };
}
