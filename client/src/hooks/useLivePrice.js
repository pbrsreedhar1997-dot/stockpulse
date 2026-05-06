import { useEffect } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAppContext } from '../contexts/AppContext';

export function useLivePrice(symbols) {
  const { emit, on } = useWebSocket();
  const { dispatch } = useAppContext();

  useEffect(() => {
    if (!symbols?.length) return;

    // Subscribe to live price stream
    emit({ type: 'subscribe', symbols });

    // Handle incoming price updates
    const unsub = on('price', (msg) => {
      if (msg.symbol && msg.price != null) {
        dispatch({ type: 'SET_QUOTE', payload: { symbol: msg.symbol, data: msg } });
      }
    });

    return () => {
      emit({ type: 'unsubscribe', symbols });
      unsub();
    };
  }, [symbols?.join(',')]);
}
