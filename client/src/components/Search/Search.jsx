import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppContext } from '../../contexts/AppContext';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useStocks } from '../../hooks/useStocks';
import './Search.scss';

const NSE_STOCKS = [
  { symbol: 'RELIANCE.NS', name: 'Reliance Industries', exchange: 'NSE' },
  { symbol: 'TCS.NS', name: 'Tata Consultancy Services', exchange: 'NSE' },
  { symbol: 'HDFCBANK.NS', name: 'HDFC Bank', exchange: 'NSE' },
  { symbol: 'INFY.NS', name: 'Infosys', exchange: 'NSE' },
  { symbol: 'ICICIBANK.NS', name: 'ICICI Bank', exchange: 'NSE' },
  { symbol: 'HINDUNILVR.NS', name: 'Hindustan Unilever', exchange: 'NSE' },
  { symbol: 'ITC.NS', name: 'ITC Limited', exchange: 'NSE' },
  { symbol: 'SBIN.NS', name: 'State Bank of India', exchange: 'NSE' },
  { symbol: 'BAJFINANCE.NS', name: 'Bajaj Finance', exchange: 'NSE' },
  { symbol: 'BHARTIARTL.NS', name: 'Bharti Airtel', exchange: 'NSE' },
  { symbol: 'WIPRO.NS', name: 'Wipro', exchange: 'NSE' },
  { symbol: 'HCLTECH.NS', name: 'HCL Technologies', exchange: 'NSE' },
  { symbol: 'ASIANPAINT.NS', name: 'Asian Paints', exchange: 'NSE' },
  { symbol: 'MARUTI.NS', name: 'Maruti Suzuki', exchange: 'NSE' },
  { symbol: 'ULTRACEMCO.NS', name: 'UltraTech Cement', exchange: 'NSE' },
  { symbol: 'TITAN.NS', name: 'Titan Company', exchange: 'NSE' },
  { symbol: 'KOTAKBANK.NS', name: 'Kotak Mahindra Bank', exchange: 'NSE' },
  { symbol: 'SUNPHARMA.NS', name: 'Sun Pharmaceutical', exchange: 'NSE' },
  { symbol: 'NESTLEIND.NS', name: 'Nestle India', exchange: 'NSE' },
  { symbol: 'BAJAJFINSV.NS', name: 'Bajaj Finserv', exchange: 'NSE' },
  { symbol: 'ADANIENT.NS', name: 'Adani Enterprises', exchange: 'NSE' },
  { symbol: 'ADANIPORTS.NS', name: 'Adani Ports', exchange: 'NSE' },
  { symbol: 'ONGC.NS', name: 'ONGC', exchange: 'NSE' },
  { symbol: 'NTPC.NS', name: 'NTPC', exchange: 'NSE' },
  { symbol: 'POWERGRID.NS', name: 'Power Grid Corp', exchange: 'NSE' },
  { symbol: 'COALINDIA.NS', name: 'Coal India', exchange: 'NSE' },
  { symbol: 'TATAMOTORS.NS', name: 'Tata Motors', exchange: 'NSE' },
  { symbol: 'TATASTEEL.NS', name: 'Tata Steel', exchange: 'NSE' },
  { symbol: 'JSWSTEEL.NS', name: 'JSW Steel', exchange: 'NSE' },
  { symbol: 'HINDALCO.NS', name: 'Hindalco Industries', exchange: 'NSE' },
  { symbol: 'DRREDDY.NS', name: "Dr. Reddy's Laboratories", exchange: 'NSE' },
  { symbol: 'CIPLA.NS', name: 'Cipla', exchange: 'NSE' },
  { symbol: 'DIVISLAB.NS', name: "Divi's Laboratories", exchange: 'NSE' },
  { symbol: 'APOLLOHOSP.NS', name: 'Apollo Hospitals', exchange: 'NSE' },
  { symbol: 'BAJAJ-AUTO.NS', name: 'Bajaj Auto', exchange: 'NSE' },
  { symbol: 'HEROMOTOCO.NS', name: 'Hero MotoCorp', exchange: 'NSE' },
  { symbol: 'EICHERMOT.NS', name: 'Eicher Motors', exchange: 'NSE' },
  { symbol: 'M&M.NS', name: 'Mahindra & Mahindra', exchange: 'NSE' },
  { symbol: 'TECHM.NS', name: 'Tech Mahindra', exchange: 'NSE' },
  { symbol: 'LT.NS', name: 'Larsen & Toubro', exchange: 'NSE' },
  { symbol: 'INDUSINDBK.NS', name: 'IndusInd Bank', exchange: 'NSE' },
  { symbol: 'AXISBANK.NS', name: 'Axis Bank', exchange: 'NSE' },
  { symbol: 'BPCL.NS', name: 'BPCL', exchange: 'NSE' },
  { symbol: 'IOC.NS', name: 'Indian Oil Corporation', exchange: 'NSE' },
  { symbol: 'GRASIM.NS', name: 'Grasim Industries', exchange: 'NSE' },
  { symbol: 'SHREECEM.NS', name: 'Shree Cement', exchange: 'NSE' },
  { symbol: 'DABUR.NS', name: 'Dabur India', exchange: 'NSE' },
  { symbol: 'MARICO.NS', name: 'Marico', exchange: 'NSE' },
  { symbol: 'PIDILITIND.NS', name: 'Pidilite Industries', exchange: 'NSE' },
  { symbol: 'HAVELLS.NS', name: 'Havells India', exchange: 'NSE' },
  { symbol: 'BERGEPAINT.NS', name: 'Berger Paints', exchange: 'NSE' },
  { symbol: 'BRITANNIA.NS', name: 'Britannia Industries', exchange: 'NSE' },
  { symbol: 'COLPAL.NS', name: 'Colgate-Palmolive India', exchange: 'NSE' },
  { symbol: 'GODREJCP.NS', name: 'Godrej Consumer Products', exchange: 'NSE' },
  { symbol: 'TATACONSUM.NS', name: 'Tata Consumer Products', exchange: 'NSE' },
  { symbol: 'VBL.NS', name: 'Varun Beverages', exchange: 'NSE' },
  { symbol: 'ZOMATO.NS', name: 'Zomato', exchange: 'NSE' },
  { symbol: 'PAYTM.NS', name: 'Paytm (One97 Communications)', exchange: 'NSE' },
  { symbol: 'NYKAA.NS', name: 'Nykaa (FSN E-Commerce)', exchange: 'NSE' },
  { symbol: 'DMART.NS', name: 'Avenue Supermarts (DMart)', exchange: 'NSE' },
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ' },
  { symbol: 'META', name: 'Meta Platforms', exchange: 'NASDAQ' },
  { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ' },
];

export default function Search() {
  const { dispatch } = useAppContext();
  const { add } = useWatchlist();
  const { fetchQuote, fetchProfile, search: apiSearch } = useStocks();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const localSearch = useCallback((q) => {
    const lower = q.toLowerCase();
    return NSE_STOCKS.filter(s =>
      s.symbol.toLowerCase().includes(lower) ||
      s.name.toLowerCase().includes(lower)
    ).slice(0, 8);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }

    const localResults = localSearch(query);
    if (localResults.length > 0) {
      setResults(localResults);
      setOpen(true);
    }

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (query.length < 2) return;
      setLoading(true);
      try {
        const data = await apiSearch(query);
        if (data?.results?.length) {
          setResults(data.results.slice(0, 10));
          setOpen(true);
        }
      } catch {}
      finally { setLoading(false); }
    }, 400);
  }, [query]);

  const pick = async (stock) => {
    setQuery('');
    setOpen(false);
    await add(stock.symbol, stock.name || stock.symbol, stock.exchange || 'NSE');
    dispatch({ type: 'SET_CURRENT_SYMBOL', payload: stock.symbol });
    dispatch({ type: 'SET_VIEW', payload: 'stock' });
    fetchQuote(stock.symbol);
    fetchProfile(stock.symbol);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="search">
      <div className="search__input-wrap">
        <span className="search__icon">🔍</span>
        <input
          ref={inputRef}
          className="search__input"
          type="text"
          placeholder="Search stocks (e.g. RELIANCE, TCS, AAPL)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
        {loading && <span className="search__spinner" />}
      </div>

      {open && results.length > 0 && (
        <div className="search__dropdown">
          {results.map(r => (
            <div key={r.symbol} className="search__item" onClick={() => pick(r)}>
              <span className="search__item-symbol">{r.symbol.replace('.NS', '').replace('.BO', '')}</span>
              <span className="search__item-name">{r.name}</span>
              <span className="search__item-exchange">{r.exchange}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
