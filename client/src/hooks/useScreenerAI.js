import { useState, useCallback, useRef } from 'react';

export function useScreenerAI() {
  const [text,   setText]   = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [cached, setCached] = useState(false);
  const [ageMin, setAgeMin] = useState(null);
  const readerRef = useRef(null);

  const generate = useCallback(async (forceRefresh = false) => {
    // Cancel any in-flight request
    try { readerRef.current?.cancel(); } catch {}
    readerRef.current = null;

    setText('');
    setCached(false);
    setAgeMin(null);
    setStatus('loading');

    try {
      const url = forceRefresh
        ? '/api/screener/ai-analysis?refresh=1'
        : '/api/screener/ai-analysis';

      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);

      const reader  = resp.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let   buf     = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // SSE lines are separated by double newline; process complete events
        const parts = buf.split('\n\n');
        buf = parts.pop(); // last incomplete chunk back into buffer

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());

            if (data.text) {
              setText(prev => prev + data.text);
            }
            if (data.done) {
              setStatus('done');
              setCached(!!data.cached);
              setAgeMin(data.ageMin ?? null);
              return;
            }
            if (data.error) {
              setStatus('error');
              setText(data.error);
              return;
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }

      // Stream ended without explicit done event — treat as done
      setStatus('done');
    } catch (e) {
      if (e.name === 'AbortError' || e.name === 'TypeError') return; // cancelled
      setStatus('error');
      setText(e.message || 'Failed to load analysis. Please try again.');
    }
  }, []);

  return { text, status, cached, ageMin, generate };
}
