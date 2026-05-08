import React, { createContext, useContext, useReducer, useEffect } from 'react';

const DEFAULT_WATCHLIST = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', exchange: 'NSE' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', exchange: 'NSE' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', exchange: 'NSE' },
  { symbol: 'INFY.NS', name: 'Infosys', exchange: 'NSE' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel', exchange: 'NSE' },
];

const _savedWatchlist = (() => {
  try { const s = JSON.parse(localStorage.getItem('sp_watchlist')); return Array.isArray(s) && s.length ? s : null; } catch { return null; }
})();

const _savedAlerts = (() => {
  try { const s = JSON.parse(localStorage.getItem('sp_alerts')); return Array.isArray(s) ? s : []; } catch { return []; }
})();

const initialState = {
  backendOk: null,
  theme: localStorage.getItem('sp_theme') || 'dark',
  user: (() => { try { return JSON.parse(localStorage.getItem('sp_user')); } catch { return null; } })(),
  token: localStorage.getItem('sp_token') || null,
  watchlist: _savedWatchlist ?? DEFAULT_WATCHLIST,
  currentSymbol: sessionStorage.getItem('sp_sym') || null,
  quotes: {},
  profiles: {},
  financials: {},
  portfolio: null,
  view: 'stock',
  chatOpen: false,
  authModalOpen: false,
  toasts: [],
  alerts: _savedAlerts,
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_BACKEND_OK':
      return { ...state, backendOk: action.payload };
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
    case 'MOVE_WATCHLIST_ITEM': {
      const { symbol, direction } = action.payload;
      const idx = state.watchlist.findIndex(s => s.symbol === symbol);
      if (idx === -1) return state;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= state.watchlist.length) return state;
      const next = [...state.watchlist];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return { ...state, watchlist: next };
    }
    case 'REORDER_WATCHLIST': {
      const { fromIdx, toIdx } = action.payload;
      if (fromIdx === toIdx) return state;
      const next = [...state.watchlist];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return { ...state, watchlist: next };
    }
    case 'SET_CURRENT_SYMBOL':
      sessionStorage.setItem('sp_sym', action.payload || '');
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
    case 'SET_PORTFOLIO':
      return { ...state, portfolio: action.payload };
    case 'ADD_ALERT': {
      const exists = state.alerts.find(a => a.id === action.payload.id);
      if (exists) return state;
      return { ...state, alerts: [...state.alerts, action.payload] };
    }
    case 'REMOVE_ALERT':
      return { ...state, alerts: state.alerts.filter(a => a.id !== action.payload) };
    case 'TRIGGER_ALERT':
      return { ...state, alerts: state.alerts.map(a => a.id === action.payload ? { ...a, triggered: true } : a) };
    case 'RESET_ALERT':
      return { ...state, alerts: state.alerts.map(a => a.id === action.payload ? { ...a, triggered: false } : a) };
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
    localStorage.setItem('sp_alerts', JSON.stringify(state.alerts));
  }, [state.alerts]);

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
