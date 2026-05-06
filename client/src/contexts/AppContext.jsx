import React, { createContext, useContext, useReducer, useEffect } from 'react';

const initialState = {
  theme: localStorage.getItem('sp_theme') || 'dark',
  user: (() => { try { return JSON.parse(localStorage.getItem('sp_user')); } catch { return null; } })(),
  token: localStorage.getItem('sp_token') || null,
  watchlist: (() => { try { return JSON.parse(localStorage.getItem('sp_watchlist')) || []; } catch { return []; } })(),
  currentSymbol: null,
  quotes: {},
  profiles: {},
  financials: {},
  view: 'stock',
  chatOpen: false,
  authModalOpen: false,
  toasts: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'SET_USER':
      return { ...state, user: action.payload.user, token: action.payload.token };
    case 'LOGOUT':
      return { ...state, user: null, token: null };
    case 'SET_WATCHLIST':
      return { ...state, watchlist: action.payload };
    case 'ADD_TO_WATCHLIST':
      if (state.watchlist.find(s => s.symbol === action.payload.symbol)) return state;
      return { ...state, watchlist: [...state.watchlist, action.payload] };
    case 'REMOVE_FROM_WATCHLIST':
      return { ...state, watchlist: state.watchlist.filter(s => s.symbol !== action.payload) };
    case 'SET_CURRENT_SYMBOL':
      return { ...state, currentSymbol: action.payload };
    case 'SET_QUOTE':
      return { ...state, quotes: { ...state.quotes, [action.payload.symbol]: action.payload.data } };
    case 'SET_PROFILE':
      return { ...state, profiles: { ...state.profiles, [action.payload.symbol]: action.payload.data } };
    case 'SET_FINANCIALS':
      return { ...state, financials: { ...state.financials, [action.payload.symbol]: action.payload.data } };
    case 'SET_VIEW':
      return { ...state, view: action.payload };
    case 'TOGGLE_CHAT':
      return { ...state, chatOpen: !state.chatOpen };
    case 'SET_CHAT_OPEN':
      return { ...state, chatOpen: action.payload };
    case 'TOGGLE_AUTH_MODAL':
      return { ...state, authModalOpen: !state.authModalOpen };
    case 'ADD_TOAST': {
      const id = Date.now() + Math.random();
      return { ...state, toasts: [...state.toasts, { id, ...action.payload }] };
    }
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter(t => t.id !== action.payload) };
    default:
      return state;
  }
}

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    localStorage.setItem('sp_theme', state.theme);
    document.documentElement.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  useEffect(() => {
    localStorage.setItem('sp_watchlist', JSON.stringify(state.watchlist));
  }, [state.watchlist]);

  useEffect(() => {
    if (state.user) {
      localStorage.setItem('sp_user', JSON.stringify(state.user));
    } else {
      localStorage.removeItem('sp_user');
    }
    if (state.token) {
      localStorage.setItem('sp_token', state.token);
    } else {
      localStorage.removeItem('sp_token');
    }
  }, [state.user, state.token]);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
