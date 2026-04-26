"""
wsgi.py — Gunicorn entry point for Render deployment.
Loads stock-server.py (hyphenated name) via importlib so gunicorn
can reference it cleanly as `wsgi:app`.
"""
import importlib.util, os

_spec   = importlib.util.spec_from_file_location(
    'stock_server',
    os.path.join(os.path.dirname(__file__), 'stock-server.py')
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

app = _module.app
