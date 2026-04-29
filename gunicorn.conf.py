"""
gunicorn.conf.py — Production configuration for StockPulse on Render.

Key design decisions:
- worker_class gthread: allows multiple concurrent requests per worker (needed for
  SSE streaming + background DB writes at the same time).
- post_fork hook: loads the fastembed model INSIDE each worker process, after
  the fork.  Loading before fork causes the worker to inherit a locked
  threading.Lock, permanently deadlocking any later get_embed_model() call.
- timeout 300: yfinance calls and RAG training can take 60-120 s; 300 s gives
  a comfortable margin without Render killing healthy workers.
"""
import os
import threading

workers     = int(os.environ.get('WEB_CONCURRENCY', 1))
worker_class = 'gthread'
threads     = 4
timeout     = 300
keepalive   = 5
bind        = f"0.0.0.0:{os.environ.get('PORT', '10000')}"
accesslog   = '-'
errorlog    = '-'
loglevel    = 'info'


def post_fork(server, worker):
    """Start model loading in a background thread inside the forked worker."""
    def _warm():
        try:
            import sys
            mod = sys.modules.get('stock_server')
            if mod and hasattr(mod, 'get_embed_model'):
                mod.get_embed_model()
        except Exception as exc:
            server.log.warning(f'post_fork model warm-up failed: {exc}')
    threading.Thread(target=_warm, daemon=True).start()
