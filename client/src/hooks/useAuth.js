import { useCallback } from 'react';
import { useAppContext } from '../contexts/AppContext';
import { useApi } from './useApi';
import { useToast } from './useToast';

export function useAuth() {
  const { state, dispatch } = useAppContext();
  const api = useApi();
  const toast = useToast();

  const login = useCallback(async (email, password) => {
    const data = await api.post('/api/auth/login', { email, password });
    dispatch({ type: 'SET_USER', payload: { user: data.user, token: data.token } });
    toast('Logged in successfully', 'success');
    return data;
  }, [api, dispatch, toast]);

  const register = useCallback(async (name, email, password) => {
    const data = await api.post('/api/auth/register', { name, email, password });
    dispatch({ type: 'SET_USER', payload: { user: data.user, token: data.token } });
    toast('Account created!', 'success');
    return data;
  }, [api, dispatch, toast]);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout', {}); } catch {}
    dispatch({ type: 'LOGOUT' });
    toast('Logged out', 'info');
  }, [api, dispatch, toast]);

  return { user: state.user, token: state.token, login, register, logout };
}
