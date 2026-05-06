import { useState, useCallback, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAppContext } from '../contexts/AppContext';

export function useChat() {
  const { state } = useAppContext();
  const { emit, on } = useWebSocket();
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const chatIdRef = useRef(null);
  // Keep messages ref so callbacks always see latest without re-registering
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const unsubDelta = on('chat_delta', (msg) => {
      if (msg.id !== chatIdRef.current) return;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: last.content + msg.text };
        }
        return updated;
      });
    });

    const unsubDone = on('chat_done', (msg) => {
      if (msg.id !== chatIdRef.current) return;
      setStreaming(false);
      chatIdRef.current = null;
    });

    const unsubError = on('chat_error', (msg) => {
      if (msg.id !== chatIdRef.current) return;
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' };
        return updated;
      });
      setStreaming(false);
      chatIdRef.current = null;
    });

    return () => { unsubDelta(); unsubDone(); unsubError(); };
  }, [on]);

  const send = useCallback((question) => {
    if (!question?.trim() || streaming) return;

    const id = `chat-${Date.now()}`;
    chatIdRef.current = id;

    const userMsg      = { role: 'user',      content: question };
    const assistantMsg = { role: 'assistant',  content: '' };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const symbols = state.currentSymbol
      ? [state.currentSymbol]
      : state.watchlist.slice(0, 3).map(s => s.symbol);
    const history = messagesRef.current.slice(-8).map(m => ({ role: m.role, content: m.content }));

    emit({ type: 'chat', id, question, symbols, history, token: state.token });
  }, [streaming, state.currentSymbol, state.watchlist, state.token, emit]);

  const stop = useCallback(() => {
    if (chatIdRef.current) {
      emit({ type: 'chat_stop', id: chatIdRef.current });
    }
    setStreaming(false);
    chatIdRef.current = null;
  }, [emit]);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, streaming, send, stop, clear };
}
