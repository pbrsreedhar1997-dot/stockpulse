import { useState, useCallback, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useAppContext } from '../contexts/AppContext';

export function useChat() {
  const { state } = useAppContext();
  const { emit, on } = useWebSocket();
  const [messages,  setMessages]  = useState([]);
  const [streaming, setStreaming]  = useState(false);
  const [sessionId, setSessionId]  = useState(null);
  const chatIdRef    = useRef(null);
  const messagesRef  = useRef(messages);
  const sessionIdRef = useRef(null);

  useEffect(() => { messagesRef.current  = messages;  }, [messages]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  /* ── Auto-save to DB after each completed response ── */
  async function saveToDb(msgs) {
    if (!state.token || !msgs.length) return;
    const firstUser = msgs.find(m => m.role === 'user');
    const title = firstUser ? firstUser.content.slice(0, 72) : 'Chat';
    try {
      const r = await fetch('/api/chat/sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
        body:    JSON.stringify({ sessionId: sessionIdRef.current, title, messages: msgs }),
      });
      const data = await r.json();
      if (data.ok && data.sessionId && !sessionIdRef.current) {
        setSessionId(data.sessionId);
      }
    } catch { /* non-critical — ignore save errors */ }
  }

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
      /* Save after state settles */
      setTimeout(() => saveToDb(messagesRef.current), 100);
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
  }, [on, state.token]);

  const send = useCallback((question, opts = {}) => {
    if (!question?.trim() || streaming) return;

    const id = `chat-${Date.now()}`;
    chatIdRef.current = id;

    setMessages(prev => [
      ...prev,
      { role: 'user',      content: question },
      { role: 'assistant', content: '' },
    ]);
    setStreaming(true);

    const history = messagesRef.current.slice(-8).map(m => ({ role: m.role, content: m.content }));
    const symbols = opts.symbols ?? [];

    emit({ type: 'chat', id, question, symbols, history, token: state.token });
  }, [streaming, state.token, emit]);

  const stop = useCallback(() => {
    if (chatIdRef.current) emit({ type: 'chat_stop', id: chatIdRef.current });
    setStreaming(false);
    chatIdRef.current = null;
  }, [emit]);

  const clear = useCallback(() => {
    setMessages([]);
    setSessionId(null);
  }, []);

  /* Load an existing session from DB */
  const loadSession = useCallback(async (id) => {
    if (!state.token) return;
    try {
      const r = await fetch(`/api/chat/sessions/${id}`, {
        headers: { 'Authorization': `Bearer ${state.token}` },
      });
      const data = await r.json();
      if (data.ok) {
        setMessages(data.messages);
        setSessionId(id);
      }
    } catch {}
  }, [state.token]);

  /* Delete a session from DB */
  const deleteSession = useCallback(async (id) => {
    if (!state.token) return;
    await fetch(`/api/chat/sessions/${id}`, {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` },
    });
    if (sessionIdRef.current === id) clear();
  }, [state.token, clear]);

  return { messages, streaming, sessionId, send, stop, clear, loadSession, deleteSession };
}
