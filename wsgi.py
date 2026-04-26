"""
wsgi.py — Gunicorn entry point for Render deployment.
Uses absolute path resolution so gunicorn's working-directory
doesn't affect the import of the hyphenated stock-server.py.
"""
import importlib.util
import os

_BASE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    'stock_server',
    os.path.join(_BASE, 'stock-server.py'),
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

app = _module.app
