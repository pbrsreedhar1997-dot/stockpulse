#!/usr/bin/env python3
"""
migrate.py — One-time migration: SQLite → PostgreSQL for StockPulse.

Usage:
    export DATABASE_URL=postgresql://localhost:5433/stockpulse
    python3 migrate.py

The script copies all rows from stockpulse.db into PostgreSQL.
Existing PG rows are left intact (INSERT … ON CONFLICT DO NOTHING).
Embeddings are re-stored as pgvector vector(384) from the SQLite BLOB.

Run only once.  Safe to re-run — duplicates are skipped.
"""

import os
import sys
import sqlite3
import time
import numpy as np

DATABASE_URL = os.environ.get('DATABASE_URL', '')
if not DATABASE_URL:
    sys.exit('ERROR: DATABASE_URL is not set.\n'
             'Example: export DATABASE_URL=postgresql://localhost:5433/stockpulse')

DB_PATH = os.path.join(os.path.dirname(__file__), 'stockpulse.db')
if not os.path.exists(DB_PATH):
    sys.exit(f'ERROR: SQLite database not found at {DB_PATH}')

import psycopg2
import psycopg2.extras

def pg_connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn

def vec_to_pg(blob: bytes) -> str:
    arr = np.frombuffer(blob, dtype=np.float32)
    return '[' + ','.join(f'{v:.8f}' for v in arr.tolist()) + ']'

def migrate_table(sq, pg_cur, table, columns, conflict_col, extra_transform=None):
    placeholders = ','.join(['%s'] * len(columns))
    col_list     = ','.join(columns)
    rows = sq.execute(f'SELECT {col_list} FROM {table}').fetchall()
    if not rows:
        print(f'  {table}: 0 rows (skipped)')
        return 0

    data = [tuple(r) for r in rows]
    if extra_transform:
        data = [extra_transform(r) for r in data]

    psycopg2.extras.execute_batch(
        pg_cur,
        f'INSERT INTO {table} ({col_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING',
        data,
        page_size=500
    )
    print(f'  {table}: {len(data)} rows')
    return len(data)

def run():
    sq = sqlite3.connect(DB_PATH)
    sq.row_factory = sqlite3.Row
    pg = pg_connect()
    pg_cur = pg.cursor()

    print(f'Source : {DB_PATH}')
    print(f'Target : {DATABASE_URL}')
    print()

    total = 0

    # watchlist
    total += migrate_table(sq, pg_cur, 'watchlist',
        ['symbol','name','exchange','added_at'], 'symbol')

    # quotes
    total += migrate_table(sq, pg_cur, 'quotes',
        ['symbol','price','open','high','low','prev_close',
         'change','change_pct','volume','mkt_cap','currency','fetched_at'], 'symbol')

    # profiles
    total += migrate_table(sq, pg_cur, 'profiles',
        ['symbol','name','sector','industry','exchange','currency',
         'website','description','employees','country','logo_url','fetched_at'], 'symbol')

    # financials
    total += migrate_table(sq, pg_cur, 'financials',
        ['symbol','market_cap','revenue_ttm','revenue_q','revenue_q_prev',
         'net_income_ttm','gross_margin','pe_ratio','eps','dividend_yield',
         'beta','week52_high','week52_low','avg_volume','fetched_at'], 'symbol')

    # history  (no single-column PK — use ON CONFLICT DO NOTHING on unique constraint)
    hist_rows = sq.execute(
        'SELECT symbol,range_key,ts,open,high,low,close,volume FROM history'
    ).fetchall()
    if hist_rows:
        psycopg2.extras.execute_batch(
            pg_cur,
            '''INSERT INTO history (symbol,range_key,ts,open,high,low,close,volume)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
            [tuple(r) for r in hist_rows],
            page_size=500
        )
        print(f'  history: {len(hist_rows)} rows')
        total += len(hist_rows)

    # news
    news_rows = sq.execute(
        '''SELECT symbol,source,title,url,published,summary,relevance,
                  COALESCE(category,'gen'),fetched_at FROM news'''
    ).fetchall()
    if news_rows:
        psycopg2.extras.execute_batch(
            pg_cur,
            '''INSERT INTO news (symbol,source,title,url,published,summary,relevance,category,fetched_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING''',
            [tuple(r) for r in news_rows],
            page_size=500
        )
        print(f'  news: {len(news_rows)} rows')
        total += len(news_rows)

    # search_cache
    total += migrate_table(sq, pg_cur, 'search_cache',
        ['query','results','fetched_at'], 'query')

    # embeddings — convert BLOB → pgvector string
    emb_rows = sq.execute(
        'SELECT symbol,content,vector,source,article_url,ts FROM embeddings'
    ).fetchall()
    migrated_emb = 0
    skipped_emb  = 0
    for r in emb_rows:
        try:
            vec_str = vec_to_pg(r['vector'])
            pg_cur.execute(
                '''INSERT INTO embeddings (symbol,content,vector,source,article_url,ts)
                   VALUES (%s,%s,%s::vector,%s,%s,%s) ON CONFLICT DO NOTHING''',
                (r['symbol'], r['content'], vec_str,
                 r['source'], r['article_url'], r['ts'])
            )
            migrated_emb += 1
        except Exception as e:
            skipped_emb += 1
    if emb_rows:
        print(f'  embeddings: {migrated_emb} migrated, {skipped_emb} skipped')
        total += migrated_emb

    pg.commit()
    sq.close()
    pg.close()

    print()
    print(f'Done. {total} rows migrated to PostgreSQL.')

if __name__ == '__main__':
    run()
