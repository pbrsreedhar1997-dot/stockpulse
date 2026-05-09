import { useState, useCallback, useRef, useEffect } from 'react';
import { useApi } from './useApi';

export function useScreener() {
  const api = useApi();
  const [stocks,     setStocks]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [scanning,   setScanning]   = useState(false);
  const [scanStatus, setScanStatus] = useState(null); // { done, total, found }
  const [error,      setError]      = useState(null);

  const pollRef     = useRef(null);
  const scanPollRef = useRef(null);
  const mountedRef  = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(pollRef.current);
      clearTimeout(scanPollRef.current);
    };
  }, []);

  // ── Fetch all stocks from DB (additive — no time cutoff) ──────────────────
  const fetchAllStocks = useCallback(async () => {
    try {
      const res = await api.get('/api/screener/all-stocks');
      if (!mountedRef.current) return;
      if (Array.isArray(res.data)) {
        setStocks(res.data);
      }
      setScanning(res.scanning || false);
      setScanStatus(res.scanStatus || null);
    } catch (e) {
      if (mountedRef.current) setError(e.message);
    }
  }, [api]);

  // ── Poll scan status while a scan is running ──────────────────────────────
  const pollScanStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/screener/scan-status');
      if (!mountedRef.current) return;
      setScanStatus({ done: res.done, total: res.total, found: res.found });
      if (res.running) {
        // Re-fetch stocks every ~20s while scan runs to pick up new additions
        await fetchAllStocks();
        scanPollRef.current = setTimeout(pollScanStatus, 20000);
      } else {
        // Scan finished — do one final fetch and clear poll
        await fetchAllStocks();
        setScanning(false);
        setLoading(false);
      }
    } catch {
      // silently stop polling on error
    }
  }, [api, fetchAllStocks]);

  // ── Main load ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    clearTimeout(pollRef.current);
    clearTimeout(scanPollRef.current);

    try {
      // 1. Trigger value-picks to ensure background scan is running if needed
      const vp = await api.get('/api/screener/value-picks');
      if (!mountedRef.current) return;

      // 2. Fetch ALL stocks from DB immediately (may be empty on cold start)
      await fetchAllStocks();
      if (!mountedRef.current) return;

      if (vp.status === 'loading' || vp.scanning) {
        // Scan is in progress — start polling for progress updates
        setScanning(true);
        scanPollRef.current = setTimeout(pollScanStatus, 15000);
      } else {
        setLoading(false);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e.message);
      setLoading(false);
    }
  }, [api, fetchAllStocks, pollScanStatus]);

  // ── Manual refresh — clears cache and restarts scan ───────────────────────
  const refresh = useCallback(async () => {
    clearTimeout(pollRef.current);
    clearTimeout(scanPollRef.current);
    setLoading(true);
    setScanning(true);
    setScanStatus(null);
    try {
      await api.post('/api/screener/refresh', {});
      // Wait briefly then start polling
      scanPollRef.current = setTimeout(async () => {
        await fetchAllStocks();
        scanPollRef.current = setTimeout(pollScanStatus, 15000);
      }, 3000);
    } catch (e) {
      setError(e.message);
      setLoading(false);
      setScanning(false);
    }
  }, [api, fetchAllStocks, pollScanStatus]);

  return { stocks, loading, scanning, scanStatus, error, load, refresh };
}
