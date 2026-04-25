# StockPulse 📈

Indian stock tracker (NSE/BSE + global) with live prices, news intelligence, and an AI-powered chatbot.

## Features
- Live NSE/BSE + US stock prices via yfinance
- Historical charts (1D / 5D / 1M / 3M / 1Y)
- News from 13 RSS sources — categorised as Contracts, Quarterly Results, Earnings, Acquisitions
- RAG-powered AI chatbot (Groq Llama 3.3 free / Anthropic Claude)
- Dark & light mode, fully mobile responsive

## Quick Start

**1. Install Python dependencies**
```bash
pip3 install flask flask-cors yfinance feedparser requests \
             sentence-transformers numpy groq anthropic
```

**2. Set up AI (free — takes 2 minutes)**
```bash
cp stockpulse.env.example stockpulse.env
# Edit stockpulse.env and paste your free Groq key
# Get key at: https://console.groq.com (no credit card)
```

**3. Launch**

Double-click `start-stockpulse.command`

Or manually:
```bash
export $(cat stockpulse.env | xargs)   # load API key
python3 stock-server.py &              # start backend on :5001
open Stock-tracker.html                # open frontend
```

## File Structure
```
stockpulse/
├── Stock-tracker.html        # Frontend (single-file — all HTML/CSS/JS)
├── stock-server.py           # Backend (Flask, port 5001)
├── start-stockpulse.command  # macOS double-click launcher
├── stockpulse.env.example    # API key template
├── stockpulse.env            # Your API keys (gitignored)
└── stockpulse.db             # SQLite database (auto-created, gitignored)
```

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ping` | Health check |
| GET | `/api/quote/:symbol` | Live quote |
| GET | `/api/history/:symbol?range=` | Price history |
| GET | `/api/profile/:symbol` | Company profile |
| GET | `/api/financials/:symbol` | Financial metrics |
| GET | `/api/news/:symbol` | News articles |
| GET | `/api/search?q=` | Stock search |
| POST | `/api/chat` | AI chat (SSE streaming) |
| GET | `/api/ai-summary/:symbol` | AI one-paragraph summary |
| GET | `/api/ai-status` | Active AI provider |
| GET/POST/DELETE | `/api/watchlist` | Watchlist management |
