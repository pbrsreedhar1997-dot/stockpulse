import { useAppContext } from '../contexts/AppContext';

export function useApi() {
  const { state } = useAppContext();

  async function request(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;

    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  function get(path) { return request(path); }

  function post(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body) });
  }

  function del(path) {
    return request(path, { method: 'DELETE' });
  }

  return { get, post, del, request };
}
