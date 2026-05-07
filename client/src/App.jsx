import React, { useEffect, useRef } from 'react';
import { useAppContext } from './contexts/AppContext';
import { useWatchlist } from './hooks/useWatchlist';
import { useStocks } from './hooks/useStocks';
import { useLivePrice } from './hooks/useLivePrice';
import { useAuth } from './hooks/useAuth';
import StockDetail from './components/StockDetail/StockDetail';
import Screener from './components/Screener/Screener';
import Chat from './components/Chat/Chat';
import WatchlistPortfolio from './components/WatchlistPortfolio/WatchlistPortfolio';
import AuthModal from './components/Auth/AuthModal';
import Search from './components/Search/Search';
import Toast from './components/shared/Toast';
import { usePortfolio } from './hooks/usePortfolio';
import { useStopLossAlert } from './hooks/useStopLossAlert';
import './App.scss';

const PING_INTERVAL_MS = 30000;
const WAKE_RETRY_MS    = 5000;
const WAKE_RETRY_LIMIT = 24;

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
);

const EmptyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3"/>
    <path d="M7 16l3-4 3 3 3-5"/>
  </svg>
);

export default function App() {
  const { state, dispatch } = useAppContext();
  const { watchlist, syncFromServer } = useWatchlist();
  const { fetchQuote, fetchProfile, fetchFinancials: fetchFin } = useStocks();
  const { logout } = useAuth();
  const { fetchPortfolio, portfolio } = usePortfolio();
  useStopLossAlert({ portfolio, quotes: state.quotes });

  const symbols        = watchlist.map(s => s.symbol);
  const wakeRetries    = useRef(0);
  const wakeRetryTimer = useRef(null);
  const pingInterval   = useRef(null);
  const backendWasOk   = useRef(false);

  useLivePrice(symbols);

  function refreshAll(syms) {
    syms.forEach(sym => fetchQuote(sym));
    // Also re-fetch profile + financials for current symbol on recovery
    const cur = sessionStorage.getItem('sp_sym');
    if (cur) {
      fetchProfile(cur);
      fetchFin(cur);
    }
  }

  function checkBackend(syms) {
    fetch('/api/ping')
      .then(r => r.json())
      .then(json => {
        const ok = !!json?.ok;
        dispatch({ type: 'SET_BACKEND_OK', payload: ok });
        if (ok) {
          clearTimeout(wakeRetryTimer.current);
          wakeRetries.current = 0;
          if (!backendWasOk.current) {
            backendWasOk.current = true;
            refreshAll(syms);
          }
        } else {
          backendWasOk.current = false;
        }
      })
      .catch(() => {
        dispatch({ type: 'SET_BACKEND_OK', payload: false });
        backendWasOk.current = false;
      });
  }

  function scheduleWakeRetry(syms) {
    if (wakeRetries.current >= WAKE_RETRY_LIMIT) return;
    wakeRetries.current++;
    wakeRetryTimer.current = setTimeout(() => {
      if (state.backendOk !== true) {
        checkBackend(syms);
        scheduleWakeRetry(syms);
      }
    }, WAKE_RETRY_MS);
  }

  useEffect(() => { syncFromServer(); }, [state.token]);
  useEffect(() => { if (state.token) fetchPortfolio(); }, [state.token]);

  useEffect(() => {
    if (!state.currentSymbol && watchlist.length) {
      dispatch({ type: 'SET_CURRENT_SYMBOL', payload: watchlist[0].symbol });
    }
  }, [watchlist.length, state.currentSymbol]);

  useEffect(() => {
    if (symbols.length) {
      symbols.forEach(sym => fetchQuote(sym));
      checkBackend(symbols);
      scheduleWakeRetry(symbols);
    }
    pingInterval.current = setInterval(() => checkBackend(symbols), PING_INTERVAL_MS);
    return () => {
      clearInterval(pingInterval.current);
      clearTimeout(wakeRetryTimer.current);
    };
  }, [watchlist.length]);

  const setView = v => dispatch({ type: 'SET_VIEW', payload: v });
  const toggleTheme = () =>
    dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' });

  const statusLabel = state.backendOk === null ? 'Waking…'
    : state.backendOk ? 'Live' : 'Reconnecting…';
  const statusCls = state.backendOk === true ? 'pill--ok' : 'pill--waking';
  const isLive = state.backendOk === true;

  return (
    <div className="app">
      <header className="header">
        <div className="header__logo">
          <div className="header__logo-mark"><ChartIcon /></div>
          <span>StockPulse</span>
        </div>

        <div className="header__search-wrap">
          <Search />
        </div>

        <div className="header__spacer" />

        <nav className="header__actions">
          <span className={`be-pill ${statusCls}`}>
            {isLive && <span className="be-pill__dot" />}
            {statusLabel}
          </span>

          {([
            { v: 'stock',    label: 'Stock'              },
            { v: 'mylist',   label: 'Watchlist & Portfolio' },
            { v: 'screener', label: 'Value Picks'         },
            { v: 'chat',     label: 'AI Chat'             },
          ]).map(({ v, label }) => (
            <button
              key={v}
              className={`nav-btn ${state.view === v ? 'nav-btn--active' : ''}`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}

          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
            {state.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {state.user ? (
            <div className="user-chip" onClick={logout} title="Click to logout">
              <div className="user-chip__avatar">
                {state.user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <span>{state.user.name?.split(' ')[0]}</span>
            </div>
          ) : (
            <>
              <button className="auth-btn auth-btn--login"
                onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}>
                Log in
              </button>
              <button className="auth-btn auth-btn--signup"
                onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}>
                Sign up
              </button>
            </>
          )}
        </nav>
      </header>

      <div className="body">
        <main className="main-content">
          {state.view === 'screener' && <Screener />}
          {state.view === 'mylist'   && <WatchlistPortfolio />}
          {state.view === 'chat'     && <Chat />}
          {state.view === 'stock' && (
            state.currentSymbol
              ? <StockDetail symbol={state.currentSymbol} />
              : (
                <div className="empty-state">
                  <div className="empty-state__icon"><EmptyIcon /></div>
                  <div className="empty-state__title">Welcome to StockPulse</div>
                  <div className="empty-state__sub">
                    Search for a stock or select one from your watchlist to get started.
                  </div>
                </div>
              )
          )}
        </main>
      </div>

      {state.authModalOpen && <AuthModal />}
      <Toast />
    </div>
  );
}
