"""
wsgi.py — Gunicorn entry point for Render deployment.
Uses absolute path resolution so gunicorn's working-directory
doesn't affect the import of the hyphenated stock-server.py.
"""
import importlib.util
import os

_BASE = os.path.dirname(os.path.abspath(__file__))

# Load local env file (stockpulse.env) when running locally.
# On Render, env vars are set in the dashboard and this file won't exist.
_env_file = os.path.join(_BASE, 'stockpulse.env')
if os.path.exists(_env_file):
    try:
        from dotenv import load_dotenv
        load_dotenv(_env_file)
    except ImportError:
        # dotenv not installed; parse manually
        with open(_env_file) as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith('#') and '=' in _line:
                    _k, _, _v = _line.partition('=')
                    os.environ.setdefault(_k.strip(), _v.strip())
_spec = importlib.util.spec_from_file_location(
    'stock_server',
    os.path.join(_BASE, 'stock-server.py'),
)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)

app = _module.app
