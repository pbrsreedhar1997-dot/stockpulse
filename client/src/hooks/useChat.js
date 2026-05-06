import { useState, useCallback, useRef } from 'react';
import { useAppContext } from '../contexts/AppContext';

export function useChat() {
  const { state } = useAppContext();
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef(null);

  const send = useCallback(async (question) => {
    if (!question.trim() || streaming) return;

    const userMsg = { role: 'user', content: question };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);

    const assistantMsg = { role: 'assistant', content: '' };
    setMessages(prev => [...prev, assistantMsg]);

    const symbols = state.currentSymbol ? [state.currentSymbol] : state.watchlist.slice(0, 3).map(s => s.symbol);
    const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({ question, symbols, chat_history: history }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error('Chat request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === 'delta') {
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: updated[updated.length - 1].content + ev.text,
                };
                return updated;
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: 'Sorry, an error occurred. Please try again.' };
          return updated;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, state.currentSymbol, state.watchlist, state.token, streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, streaming, send, stop, clear };
}
