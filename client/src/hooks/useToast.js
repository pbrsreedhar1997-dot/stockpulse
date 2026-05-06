import { useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';

export function useToast() {
  const { dispatch } = useAppContext();

  const toast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    dispatch({ type: 'ADD_TOAST', payload: { id, message, type } });
    setTimeout(() => dispatch({ type: 'REMOVE_TOAST', payload: id }), duration);
  }, [dispatch]);

  return toast;
}
