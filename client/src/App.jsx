import React, { useEffect } from 'react';
import { useAppContext } from './contexts/AppContext';
import { useWatchlist } from './hooks/useWatchlist';
import { useStocks } from './hooks/useStocks';
import { useLivePrice } from './hooks/useLivePrice';
import { useAuth } from './hooks/useAuth';
import Sidebar from './components/Sidebar/Sidebar';
import StockDetail from './components/StockDetail/StockDetail';
import Screener from './components/Screener/Screener';
import Chat from './components/Chat/Chat';
import AuthModal from './components/Auth/AuthModal';
import Search from './components/Search/Search';
import Toast from './components/shared/Toast';
import './App.scss';

export default function App() {
  const { state, dispatch } = useAppContext();
  const { watchlist, syncFromServer } = useWatchlist();
  const { fetchQuote } = useStocks();
  const { logout } = useAuth();

  const symbols = watchlist.map(s => s.symbol);
  useLivePrice(symbols);

  useEffect(() => {
    syncFromServer();
  }, [state.token]);

  useEffect(() => {
    symbols.forEach(sym => fetchQuote(sym));
  }, [watchlist.length]);

  const setView = (v) => dispatch({ type: 'SET_VIEW', payload: v });

  return (
    <div className="app">
      <header className="header">
        <div className="header__logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
            <polyline points="16 7 22 7 22 13" />
          </svg>
          StockPulse
        </div>

        <div className="header__search-wrap">
          <Search />
        </div>

        <div className="header__spacer" />

        <nav className="header__actions">
          <button
            className={`nav-btn ${state.view === 'stock' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('stock')}
          >
            Dashboard
          </button>
          <button
            className={`nav-btn ${state.view === 'screener' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('screener')}
          >
            Value Picks
          </button>
          <button
            className={`nav-btn ${state.view === 'chat' ? 'nav-btn--active' : ''}`}
            onClick={() => setView('chat')}
          >
            AI Chat
          </button>

          <button
            className="icon-btn"
            onClick={() => dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' })}
            title="Toggle theme"
          >
            {state.theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {state.user ? (
            <div className="user-chip" onClick={logout} title="Click to logout">
              <div className="user-chip__avatar">
                {state.user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              {state.user.name?.split(' ')[0]}
            </div>
          ) : (
            <>
              <button
                className="auth-btn auth-btn--login"
                onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}
              >
                Log in
              </button>
              <button
                className="auth-btn auth-btn--signup"
                onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}
              >
                Sign up
              </button>
            </>
          )}
        </nav>
      </header>

      <div className="body">
        <Sidebar />

        <main className="main-content">
          {state.view === 'screener' && <Screener />}
          {state.view === 'chat' && <Chat />}
          {state.view === 'stock' && (
            state.currentSymbol ? (
              <StockDetail symbol={state.currentSymbol} />
            ) : (
              <div className="empty-state">
                <div className="empty-state__icon">📈</div>
                <div className="empty-state__title">Welcome to StockPulse</div>
                <div className="empty-state__sub">
                  Search for a stock above or add one from the watchlist to get started.
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
