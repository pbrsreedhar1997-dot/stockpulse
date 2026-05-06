import { useEffect, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';

export function useLivePrice(symbols) {
  const { dispatch } = useAppContext();
  const esRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    if (!symbols || symbols.length === 0) return;

    const connect = () => {
      const url = `/api/stream/prices?symbols=${symbols.join(',')}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.symbol && data.price) {
            dispatch({ type: 'SET_QUOTE', payload: { symbol: data.symbol, data } });
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        retryRef.current = setTimeout(connect, 30000);
      };
    };

    connect();

    return () => {
      esRef.current?.close();
      clearTimeout(retryRef.current);
    };
  }, [symbols?.join(',')]);
}
