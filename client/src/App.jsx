import React, { useEffect, useRef, useState } from 'react';
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

/* ── Icons ─────────────────────────────────────────────────────────────────── */
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

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

/* Mobile nav icons */
const NavStockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
);
const NavListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);
const NavScreenerIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);
const NavChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

/* ── Right panel watchlist (desktop only) ──────────────────────────────────── */
function StockRightPanel() {
  const { state, dispatch } = useAppContext();
  const { watchlist, quotes, currentSymbol } = state;

  const pick   = (symbol) => dispatch({ type: 'SET_CURRENT_SYMBOL', payload: symbol });
  const moveUp = (e, symbol) => { e.stopPropagation(); dispatch({ type: 'MOVE_WATCHLIST_ITEM', payload: { symbol, direction: 'up' } }); };
  const moveDn = (e, symbol) => { e.stopPropagation(); dispatch({ type: 'MOVE_WATCHLIST_ITEM', payload: { symbol, direction: 'down' } }); };

  if (watchlist.length === 0) return null;

  return (
    <aside className="stock-right-panel">
      <div className="stock-right-panel__header">
        <span>Watchlist</span>
        <span className="stock-right-panel__count">{watchlist.length}</span>
      </div>
      <div className="stock-right-panel__list">
        {watchlist.map((s, idx) => {
          const q   = quotes[s.symbol];
          const up  = (q?.change_pct ?? 0) >= 0;
          const active = s.symbol === currentSymbol;
          return (
            <div
              key={s.symbol}
              className={`srp-row ${active ? 'srp-row--active' : ''}`}
              onClick={() => pick(s.symbol)}
            >
              <div className="srp-row__order">
                <button
                  className="srp-row__mv"
                  disabled={idx === 0}
                  onClick={e => moveUp(e, s.symbol)}
                  title="Move up"
                >▲</button>
                <button
                  className="srp-row__mv"
                  disabled={idx === watchlist.length - 1}
                  onClick={e => moveDn(e, s.symbol)}
                  title="Move down"
                >▼</button>
              </div>
              <div className="srp-row__info">
                <span className="srp-row__sym">{s.symbol.replace(/\.(NS|BO)$/i, '')}</span>
                <span className="srp-row__name">{s.name}</span>
              </div>
              {q ? (
                <div className="srp-row__price">
                  <span className="srp-row__val">₹{q.price?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className={`srp-row__chg ${up ? 'up' : 'down'}`}>
                    {up ? '+' : ''}{q.change_pct?.toFixed(2)}%
                  </span>
                </div>
              ) : (
                <div className="skeleton" style={{ width: 60, height: 14 }} />
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ── Mobile search overlay ─────────────────────────────────────────────────── */
function MobileSearchOverlay({ onClose }) {
  return (
    <div className="mob-search-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="mob-search-box">
        <Search />
        <button className="mob-search-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

/* ── Mobile bottom nav ─────────────────────────────────────────────────────── */
const MOBILE_TABS = [
  { v: 'stock',    label: 'Stock',     Icon: NavStockIcon   },
  { v: 'mylist',   label: 'Watchlist', Icon: NavListIcon    },
  { v: 'screener', label: 'Picks',     Icon: NavScreenerIcon},
  { v: 'chat',     label: 'AI Chat',   Icon: NavChatIcon    },
];

function MobileNav({ view, setView }) {
  return (
    <nav className="mobile-nav">
      {MOBILE_TABS.map(({ v, label, Icon }) => (
        <button
          key={v}
          className={`mobile-nav__tab ${view === v ? 'mobile-nav__tab--active' : ''}`}
          onClick={() => setView(v)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ── Main App ──────────────────────────────────────────────────────────────── */
export default function App() {
  const { state, dispatch } = useAppContext();
  const { watchlist, syncFromServer } = useWatchlist();
  const { fetchQuote, fetchProfile, fetchFinancials: fetchFin } = useStocks();
  const { logout } = useAuth();
  const { fetchPortfolio, portfolio } = usePortfolio();
  useStopLossAlert({ portfolio, quotes: state.quotes });

  const [mobSearchOpen, setMobSearchOpen] = useState(false);

  const symbols        = watchlist.map(s => s.symbol);
  const wakeRetries    = useRef(0);
  const wakeRetryTimer = useRef(null);
  const pingInterval   = useRef(null);
  const backendWasOk   = useRef(false);

  useLivePrice(symbols);

  function refreshAll(syms) {
    syms.forEach(sym => fetchQuote(sym));
    const cur = sessionStorage.getItem('sp_sym');
    if (cur) { fetchProfile(cur); fetchFin(cur); }
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
          if (!backendWasOk.current) { backendWasOk.current = true; refreshAll(syms); }
        } else { backendWasOk.current = false; }
      })
      .catch(() => { dispatch({ type: 'SET_BACKEND_OK', payload: false }); backendWasOk.current = false; });
  }

  function scheduleWakeRetry(syms) {
    if (wakeRetries.current >= WAKE_RETRY_LIMIT) return;
    wakeRetries.current++;
    wakeRetryTimer.current = setTimeout(() => {
      if (state.backendOk !== true) { checkBackend(syms); scheduleWakeRetry(syms); }
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
    return () => { clearInterval(pingInterval.current); clearTimeout(wakeRetryTimer.current); };
  }, [watchlist.length]);

  const setView = v => dispatch({ type: 'SET_VIEW', payload: v });
  const toggleTheme = () => dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' });

  const statusLabel = state.backendOk === null ? 'Waking…' : state.backendOk ? 'Live' : 'Reconnecting…';
  const statusCls   = state.backendOk === true ? 'pill--ok' : 'pill--waking';
  const isLive      = state.backendOk === true;

  return (
    <div className="app">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="header__logo">
          <div className="header__logo-mark"><ChartIcon /></div>
          <span>StockPulse</span>
        </div>

        {/* Desktop search */}
        <div className="header__search-wrap header__search-wrap--desktop">
          <Search />
        </div>

        <div className="header__spacer" />

        <nav className="header__actions">
          <span className={`be-pill ${statusCls}`}>
            {isLive && <span className="be-pill__dot" />}
            {statusLabel}
          </span>

          {/* Desktop nav buttons */}
          {([
            { v: 'stock',    label: 'Stock'                },
            { v: 'mylist',   label: 'Watchlist & Portfolio' },
            { v: 'screener', label: 'Value Picks'           },
            { v: 'chat',     label: 'AI Chat'               },
          ]).map(({ v, label }) => (
            <button
              key={v}
              className={`nav-btn nav-btn--desktop ${state.view === v ? 'nav-btn--active' : ''}`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}

          {/* Mobile search icon */}
          <button className="icon-btn mob-search-btn" onClick={() => setMobSearchOpen(true)} title="Search">
            <SearchIcon />
          </button>

          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">
            {state.theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {state.user ? (
            <div className="user-chip" onClick={logout} title="Click to logout">
              <div className="user-chip__avatar">
                {state.user.name?.[0]?.toUpperCase() || 'U'}
              </div>
              <span className="user-chip__name">{state.user.name?.split(' ')[0]}</span>
            </div>
          ) : (
            <div className="auth-btns">
              <button className="auth-btn auth-btn--login"
                onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}>Log in</button>
              <button className="auth-btn auth-btn--signup"
                onClick={() => dispatch({ type: 'TOGGLE_AUTH_MODAL' })}>Sign up</button>
            </div>
          )}
        </nav>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="body">
        <main className="main-content">
          {state.view === 'screener' && <Screener />}
          {state.view === 'mylist'   && <WatchlistPortfolio />}
          {state.view === 'chat'     && <Chat />}
          {state.view === 'stock' && (
            state.currentSymbol
              ? (
                <div className="stock-layout">
                  <div className="stock-layout__main">
                    <StockDetail symbol={state.currentSymbol} />
                  </div>
                  <StockRightPanel />
                </div>
              )
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

      {/* ── Mobile bottom nav ──────────────────────────────────────────────── */}
      <MobileNav view={state.view} setView={setView} />

      {/* ── Mobile search overlay ──────────────────────────────────────────── */}
      {mobSearchOpen && <MobileSearchOverlay onClose={() => setMobSearchOpen(false)} />}

      {state.authModalOpen && <AuthModal />}
      <Toast />
    </div>
  );
}
