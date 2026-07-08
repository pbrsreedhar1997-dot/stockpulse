# Scheduled fundamentals refresh

Yahoo blocks stock **fundamentals** from datacenter IPs (Render), so the deployed
app can't fetch P/E, margins, ROE, etc. live. This job runs the screener from a
**non-datacenter IP** (your Mac) — where Yahoo works — and writes fresh
fundamentals to the shared Postgres DB, which Render then reads for the
Financials / Company / Insights tabs.

## Files
- `refresh-fundamentals.mjs` — one-shot scan of the screener universe → DB.
- `com.stockpulse.fundamentals.plist` — launchd schedule (every 6h + on login).

## Run manually
```bash
node server/scripts/refresh-fundamentals.mjs
```

## Install / manage the scheduled job (macOS launchd)
```bash
# install
cp server/scripts/com.stockpulse.fundamentals.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.stockpulse.fundamentals.plist

# status / logs
launchctl list | grep stockpulse
tail -f server/scripts/refresh.log

# run it right now
launchctl start com.stockpulse.fundamentals

# stop / uninstall
launchctl unload ~/Library/LaunchAgents/com.stockpulse.fundamentals.plist
```

## Notes
- Runs every 6 hours, and once shortly after you log in. If the Mac is asleep at
  the scheduled time, it runs on the next wake. If the Mac is **off**, it simply
  refreshes at the next opportunity — the app keeps serving the last good data.
- Requires `stockpulse.env` (for `DATABASE_URL`) — resolved relative to the repo,
  so it works regardless of the working directory.
- To cover more tickers, add them to `STOCK_UNIVERSE` in `services/screener.js`;
  the next run picks them up. Renamed/delisted symbols (e.g. ZOMATO→ETERNAL) just
  get skipped.
