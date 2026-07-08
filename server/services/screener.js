import { getQuote, getFinancials, search as searchSymbol } from './yahoo.js';
import { get as cacheGet, set as cacheSet, del as cacheDel } from '../cache.js';
import { query } from '../db.js';
import log from '../log.js';

const CACHE_KEY  = 'screener7:value-picks';
const CACHE_TTL  = 3 * 3600; // 3 hours
const FRESH_SECS = 8 * 3600; // rows fresher than 8h count as "current scan"

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// SCAN STATE — shared across requests
// ─────────────────────────────────────────────────────────────────────────────
let scanState = {
  running:   false,
  total:     0,
  done:      0,
  found:     0,
  startedAt: null,
};

export function getScanStatus() {
  return { ...scanState };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB HELPERS
// ─────────────────────────────────────────────────────────────────────────────
async function saveOneToDB(p) {
  try {
    await query(`
      INSERT INTO screener_picks
        (symbol,name,sector,industry,theme,price,week52_high,week52_low,
         decline_pct,mkt_cap_cr,change_pct,pe_ratio,eps,net_margin,roe,
         gross_margin,revenue_cr,composite_score,category,
         revenue_growth,earnings_growth,scanned_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (symbol) DO UPDATE SET
        name=EXCLUDED.name, sector=EXCLUDED.sector, theme=EXCLUDED.theme,
        price=EXCLUDED.price, week52_high=EXCLUDED.week52_high, week52_low=EXCLUDED.week52_low,
        decline_pct=EXCLUDED.decline_pct, mkt_cap_cr=EXCLUDED.mkt_cap_cr,
        change_pct=EXCLUDED.change_pct, pe_ratio=EXCLUDED.pe_ratio, eps=EXCLUDED.eps,
        net_margin=EXCLUDED.net_margin, roe=EXCLUDED.roe, gross_margin=EXCLUDED.gross_margin,
        revenue_cr=EXCLUDED.revenue_cr, composite_score=EXCLUDED.composite_score,
        category=EXCLUDED.category, revenue_growth=EXCLUDED.revenue_growth,
        earnings_growth=EXCLUDED.earnings_growth, scanned_at=EXCLUDED.scanned_at
    `, [
      p.symbol, p.name, p.sector, p.industry, p.theme,
      p.price, p.week52_high, p.week52_low, p.decline_pct, p.mkt_cap_cr,
      p.change_pct, p.pe_ratio, p.eps, p.net_margin, p.roe,
      p.gross_margin, p.revenue_cr, p.composite_score, p.category,
      p.revenue_growth ?? null, p.earnings_growth ?? null,
      Math.floor(Date.now() / 1000),
    ]);
  } catch (e) {
    log.warn(`Screener DB save failed for ${p.symbol}:`, e.message);
  }
}

async function savePicksToDB(picks) {
  for (const p of picks) await saveOneToDB(p);
  log.info(`Screener: saved ${picks.length} picks to DB`);
}

// Loads stocks scanned within FRESH_SECS — for value-picks (fresh prices)
export async function loadPicksFromDB() {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - FRESH_SECS;
    const r = await query(
      `SELECT * FROM screener_picks WHERE scanned_at > $1 ORDER BY composite_score DESC`,
      [cutoff]
    );
    return r.rows.map(rowToObj);
  } catch (e) {
    log.warn('Screener DB load failed:', e.message);
    return [];
  }
}

// Loads ALL stocks ever stored in DB — no time cutoff — for "All Picks" view
export async function loadAllStocksFromDB() {
  try {
    const r = await query(
      `SELECT * FROM screener_picks ORDER BY composite_score DESC, scanned_at DESC`
    );
    return r.rows.map(rowToObj);
  } catch (e) {
    log.warn('Screener all-stocks load failed:', e.message);
    return [];
  }
}

function rowToObj(row) {
  return {
    symbol:          row.symbol,
    name:            row.name,
    sector:          row.sector    || '',
    industry:        row.industry  || '',
    theme:           row.theme     || '',
    price:           row.price        != null ? Number(row.price)         : null,
    week52_high:     row.week52_high  != null ? Number(row.week52_high)   : null,
    week52_low:      row.week52_low   != null ? Number(row.week52_low)    : null,
    decline_pct:     row.decline_pct  != null ? Number(row.decline_pct)  : null,
    mkt_cap_cr:      row.mkt_cap_cr   != null ? Number(row.mkt_cap_cr)   : null,
    change_pct:      row.change_pct   != null ? Number(row.change_pct)   : null,
    pe_ratio:        row.pe_ratio     != null ? Number(row.pe_ratio)      : null,
    eps:             row.eps          != null ? Number(row.eps)           : null,
    net_margin:      row.net_margin   != null ? Number(row.net_margin)    : null,
    roe:             row.roe          != null ? Number(row.roe)           : null,
    gross_margin:    row.gross_margin != null ? Number(row.gross_margin)  : null,
    revenue_cr:      row.revenue_cr   != null ? Number(row.revenue_cr)   : null,
    composite_score: row.composite_score != null ? Number(row.composite_score) : 0,
    category:        row.category    || 'value',
    revenue_growth:  row.revenue_growth  != null ? Number(row.revenue_growth)  : null,
    earnings_growth: row.earnings_growth != null ? Number(row.earnings_growth) : null,
    scanned_at:      row.scanned_at  != null ? Number(row.scanned_at)    : null,
  };
}

// ─── AI analysis DB helpers ───────────────────────────────────────────────────
const AI_CACHE_SECS = 3 * 3600;

export async function getRecentAnalysis(kind = 'value') {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - AI_CACHE_SECS;
    const r = await query(
      `SELECT analysis, picks_count, created_at FROM screener_ai_analysis
       WHERE created_at > $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
      [cutoff, kind]
    );
    if (!r.rows.length) return null;
    const row    = r.rows[0];
    const ageMin = Math.round((Date.now() / 1000 - Number(row.created_at)) / 60);
    return { analysis: row.analysis, picks_count: row.picks_count, ageMin };
  } catch (e) {
    log.warn('AI analysis load failed:', e.message);
    return null;
  }
}

export async function saveAnalysis(text, picksCount, kind = 'value') {
  try {
    await query(
      `INSERT INTO screener_ai_analysis (analysis, picks_count, kind, created_at) VALUES ($1,$2,$3,$4)`,
      [text, picksCount, kind, Math.floor(Date.now() / 1000)]
    );
  } catch (e) {
    log.warn('AI analysis save failed:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
export function buildAnalysisPrompt(picks) {
  const top = picks.slice(0, 24);  // keep prompt within Groq free-tier TPM

  // Group by category for richer context
  const value      = top.filter(s => s.category === 'value');
  const growth     = top.filter(s => s.category === 'growth');
  const turnaround = top.filter(s => s.category === 'turnaround');

  const fmt = s =>
    `${s.symbol.replace(/\.(NS|BO)$/i, '')} | ${s.sector || s.theme} | ` +
    `₹${s.price} | ${s.decline_pct != null ? `-${s.decline_pct}% from 52W high` : 'near 52W high'} | ` +
    `P/E ${s.pe_ratio ?? '—'}x | Score ${s.composite_score}/100` +
    (s.net_margin != null ? ` | Margin ${s.net_margin}%` : '') +
    (s.roe        != null ? ` | ROE ${s.roe}%`           : '') +
    (s.mkt_cap_cr != null ? ` | MCap ₹${s.mkt_cap_cr}Cr` : '');

  const section = (label, items) =>
    items.length ? `\n### ${label}\n${items.map(fmt).join('\n')}` : '';

  return `You are an institutional equity research analyst covering Indian markets (NSE/BSE). Today is ${new Date().toDateString()}.

Screener data — ${top.length} stocks across value/growth/turnaround categories, scored 0–100:
${section('Value Picks (profitable + discounted)', value)}
${section('Growth Compounders (high ROE + margins)', growth)}
${section('Turnaround Candidates (beaten-down large-caps)', turnaround)}

Provide a sharp, data-driven investor brief in EXACTLY this structure:

## 🎯 Top 3 Conviction Buys
For each: **SYMBOL** — 1-line thesis using actual metrics · 12-month target ₹X · Stop-loss ₹X · Key risk

## 🚀 Next-Boom Sectors (2–3 themes)
Best positioned sectors for 6–12 months. Reference India macro (capex cycle, PLI, exports, RBI cycle) and global tailwinds. Name specific catalysts + representative stocks.

## 🔄 Turnaround Watch (2 picks)
Large-caps beaten >20%. What triggers re-rating. Entry zone and timeline.

## 💎 Quality Compounders (2 picks)
High ROE + good margins. Buy-and-hold for 2–3 years even if near 52W high. Why they will compound.

## ⚠️ Avoid / Value Traps (1–2 names)
From this list only. Look cheap but aren't. Specific reason (deteriorating margins, high debt, structural headwind).

Use actual prices and metrics. Be direct. Under 500 words. No generic disclaimers.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIBAGGER AI PROMPT BUILDER
// ─────────────────────────────────────────────────────────────────────────────
export function buildMultibaggerPrompt(picks) {
  const top = picks.slice(0, 12);

  const fmt = s =>
    `${s.symbol.replace(/\.(NS|BO)$/i, '')} | ${s.sector || s.theme} | ₹${s.price} | ` +
    `MBscore ${s.multibagger_score}/100 | ROE ${s.roe ?? '—'}% | ` +
    `Margin ${s.net_margin ?? '—'}% | P/E ${s.pe_ratio ?? '—'}x | ` +
    `EPSg ${s.earnings_growth ?? '—'}% | Revg ${s.revenue_growth ?? '—'}% | ` +
    `MCap ₹${s.mkt_cap_cr ?? '—'}Cr`;

  return `You are a top-performing Indian equity analyst who specialises in identifying multibagger stocks — companies that can deliver 3–10x returns over 3–5 years. Today is ${new Date().toDateString()}.

Screened candidates (ranked by a quality-growth "multibagger score" 0–100 — high ROE, earnings & revenue growth, strong margins, room to compound):
${top.map(fmt).join('\n')}

Write a sharp, high-conviction multibagger brief in EXACTLY this structure:

## 🏆 Highest-Conviction Multibagger
The single best pick. Why it can multiply: the growth engine, moat, and runway. 1-yr target ₹X · 3-yr target ₹X · conviction (High/Medium) · key risk.

## 🚀 Top 5 Multibagger Candidates
For each: **SYMBOL** — 1-line thesis using its actual ROE/growth/margins · 3-yr potential (e.g. "2–3x") · entry zone ₹X · one key risk.

## 🧭 Why These Can Compound
2–3 sentences on the shared traits (high reinvestment ROE, sector tailwind, operating leverage) that make this basket multibagger-worthy. Reference India structural themes (capex, premiumisation, financialisation, manufacturing/PLI, digital) where relevant.

## ⚠️ Watch-outs
1–2 names from the list that look strong but carry elevated risk (rich valuation, cyclical earnings, concentration). Be specific.

Use the actual metrics provided. Be direct and quantitative. Under 450 words. No generic disclaimers, no "consult a financial advisor" boilerplate.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK UNIVERSE  — 180+ stocks across all major Indian sectors
// ─────────────────────────────────────────────────────────────────────────────
const STOCK_UNIVERSE = [
  // ── IT & Technology (AI / cloud / digital) ───────────────────────────────
  { s: 'TCS.NS',         theme: 'IT & Tech'      },
  { s: 'INFY.NS',        theme: 'IT & Tech'      },
  { s: 'WIPRO.NS',       theme: 'IT & Tech'      },
  { s: 'HCLTECH.NS',     theme: 'IT & Tech'      },
  { s: 'TECHM.NS',       theme: 'IT & Tech'      },
  { s: 'LTIM.NS',        theme: 'IT & Tech'      },
  { s: 'PERSISTENT.NS',  theme: 'IT & Tech'      },
  { s: 'MPHASIS.NS',     theme: 'IT & Tech'      },
  { s: 'COFORGE.NS',     theme: 'IT & Tech'      },
  { s: 'KPITTECH.NS',    theme: 'IT & Tech'      },
  { s: 'OFSS.NS',        theme: 'IT & Tech'      },
  { s: 'DIXON.NS',       theme: 'IT & Tech'      },
  { s: 'LTTS.NS',        theme: 'IT & Tech'      },
  { s: 'ZENSARTECH.NS',  theme: 'IT & Tech'      },
  { s: 'SONATSOFTW.NS',  theme: 'IT & Tech'      },
  { s: 'NEWGEN.NS',      theme: 'IT & Tech'      },
  { s: 'MAPMYINDIA.NS',  theme: 'IT & Tech'      },
  { s: 'KAYNES.NS',      theme: 'IT & Tech'      },

  // ── New-Age / Platform / Fintech ─────────────────────────────────────────
  { s: 'ZOMATO.NS',      theme: 'New-Age Tech'   },
  { s: 'NAUKRI.NS',      theme: 'New-Age Tech'   },
  { s: 'IRCTC.NS',       theme: 'New-Age Tech'   },
  { s: 'NYKAA.NS',       theme: 'New-Age Tech'   },
  { s: 'POLICYBZR.NS',   theme: 'New-Age Tech'   },
  { s: 'PAYTM.NS',       theme: 'New-Age Tech'   },

  // ── Banking ──────────────────────────────────────────────────────────────
  { s: 'HDFCBANK.NS',    theme: 'Banking'        },
  { s: 'ICICIBANK.NS',   theme: 'Banking'        },
  { s: 'KOTAKBANK.NS',   theme: 'Banking'        },
  { s: 'AXISBANK.NS',    theme: 'Banking'        },
  { s: 'SBIN.NS',        theme: 'Banking'        },
  { s: 'INDUSINDBK.NS',  theme: 'Banking'        },
  { s: 'BANKBARODA.NS',  theme: 'Banking'        },
  { s: 'PNB.NS',         theme: 'Banking'        },
  { s: 'CANBK.NS',       theme: 'Banking'        },
  { s: 'IDFCFIRSTB.NS',  theme: 'Banking'        },
  { s: 'BANDHANBNK.NS',  theme: 'Banking'        },
  { s: 'FEDERALBNK.NS',  theme: 'Banking'        },
  { s: 'KARURVYSYA.NS',  theme: 'Banking'        },
  { s: 'SOUTHBANK.NS',   theme: 'Banking'        },

  // ── NBFC & Fintech ───────────────────────────────────────────────────────
  { s: 'BAJFINANCE.NS',  theme: 'NBFC'           },
  { s: 'BAJAJFINSV.NS',  theme: 'NBFC'           },
  { s: 'CHOLAFIN.NS',    theme: 'NBFC'           },
  { s: 'SHRIRAMFIN.NS',  theme: 'NBFC'           },
  { s: 'RECLTD.NS',      theme: 'NBFC'           },
  { s: 'PFC.NS',         theme: 'NBFC'           },
  { s: 'IRFC.NS',        theme: 'NBFC'           },
  { s: 'MANAPPURAM.NS',  theme: 'NBFC'           },
  { s: 'MUTHOOTFIN.NS',  theme: 'NBFC'           },
  { s: 'M&MFIN.NS',      theme: 'NBFC'           },

  // ── Insurance ────────────────────────────────────────────────────────────
  { s: 'HDFCLIFE.NS',    theme: 'Insurance'      },
  { s: 'SBILIFE.NS',     theme: 'Insurance'      },
  { s: 'LICI.NS',        theme: 'Insurance'      },
  { s: 'ICICIPRULI.NS',  theme: 'Insurance'      },

  // ── Pharma & Healthcare ──────────────────────────────────────────────────
  { s: 'SUNPHARMA.NS',   theme: 'Pharma'         },
  { s: 'CIPLA.NS',       theme: 'Pharma'         },
  { s: 'DRREDDY.NS',     theme: 'Pharma'         },
  { s: 'DIVISLAB.NS',    theme: 'Pharma'         },
  { s: 'LUPIN.NS',       theme: 'Pharma'         },
  { s: 'AUROPHARMA.NS',  theme: 'Pharma'         },
  { s: 'TORNTPHARM.NS',  theme: 'Pharma'         },
  { s: 'ZYDUSLIFE.NS',   theme: 'Pharma'         },
  { s: 'ALKEM.NS',       theme: 'Pharma'         },
  { s: 'MANKIND.NS',     theme: 'Pharma'         },
  { s: 'GLENMARK.NS',    theme: 'Pharma'         },
  { s: 'LAURUSLABS.NS',  theme: 'Pharma'         },
  { s: 'IPCALAB.NS',     theme: 'Pharma'         },
  { s: 'AJANTPHARM.NS',  theme: 'Pharma'         },
  { s: 'NATCOPHARM.NS',  theme: 'Pharma'         },
  { s: 'APOLLOHOSP.NS',  theme: 'Healthcare'     },
  { s: 'MAXHEALTH.NS',   theme: 'Healthcare'     },
  { s: 'FORTIS.NS',      theme: 'Healthcare'     },

  // ── FMCG & Consumer Staples ──────────────────────────────────────────────
  { s: 'HINDUNILVR.NS',  theme: 'FMCG'           },
  { s: 'ITC.NS',         theme: 'FMCG'           },
  { s: 'NESTLEIND.NS',   theme: 'FMCG'           },
  { s: 'BRITANNIA.NS',   theme: 'FMCG'           },
  { s: 'MARICO.NS',      theme: 'FMCG'           },
  { s: 'DABUR.NS',       theme: 'FMCG'           },
  { s: 'GODREJCP.NS',    theme: 'FMCG'           },
  { s: 'COLPAL.NS',      theme: 'FMCG'           },
  { s: 'TATACONSUM.NS',  theme: 'FMCG'           },
  { s: 'VARUNBEV.NS',    theme: 'FMCG'           },
  { s: 'BIKAJI.NS',      theme: 'FMCG'           },

  // ── Automobile & EV ──────────────────────────────────────────────────────
  { s: 'MARUTI.NS',      theme: 'Auto'           },
  { s: 'TATAMOTORS.NS',  theme: 'Auto'           },
  { s: 'BAJAJ-AUTO.NS',  theme: 'Auto'           },
  { s: 'HEROMOTOCO.NS',  theme: 'Auto'           },
  { s: 'EICHERMOT.NS',   theme: 'Auto'           },
  { s: 'MOTHERSON.NS',   theme: 'Auto'           },
  { s: 'TVSMOTOR.NS',    theme: 'Auto'           },
  { s: 'ASHOKLEY.NS',    theme: 'Auto'           },
  { s: 'BOSCHLTD.NS',    theme: 'Auto'           },
  { s: 'BALKRISIND.NS',  theme: 'Auto'           },

  // ── Capital Goods & Manufacturing ─────────────────────────────────────────
  { s: 'LT.NS',          theme: 'Capital Goods'  },
  { s: 'ABB.NS',         theme: 'Capital Goods'  },
  { s: 'SIEMENS.NS',     theme: 'Capital Goods'  },
  { s: 'HAVELLS.NS',     theme: 'Capital Goods'  },
  { s: 'POLYCAB.NS',     theme: 'Capital Goods'  },
  { s: 'CUMMINSIND.NS',  theme: 'Capital Goods'  },
  { s: 'THERMAX.NS',     theme: 'Capital Goods'  },
  { s: 'BHEL.NS',        theme: 'Capital Goods'  },
  { s: 'APLAPOLLO.NS',   theme: 'Capital Goods'  },
  { s: 'KEI.NS',         theme: 'Capital Goods'  },
  { s: 'FINOLEX.NS',     theme: 'Capital Goods'  },
  { s: 'ELGIEQUIP.NS',   theme: 'Capital Goods'  },
  { s: 'GRINDWELL.NS',   theme: 'Capital Goods'  },
  { s: 'AMBER.NS',       theme: 'Capital Goods'  },
  { s: 'VOLTAS.NS',      theme: 'Capital Goods'  },
  { s: 'BLUESTAR.NS',    theme: 'Capital Goods'  },
  { s: 'CROMPTON.NS',    theme: 'Capital Goods'  },

  // ── Defence (Make-in-India + export orders) ───────────────────────────────
  { s: 'HAL.NS',         theme: 'Defence'        },
  { s: 'BEL.NS',         theme: 'Defence'        },
  { s: 'COCHINSHIP.NS',  theme: 'Defence'        },
  { s: 'MAZDOCK.NS',     theme: 'Defence'        },
  { s: 'BHARATFORG.NS',  theme: 'Defence'        },
  { s: 'BEML.NS',        theme: 'Defence'        },
  { s: 'SOLARINDS.NS',   theme: 'Defence'        },
  { s: 'MIDHANI.NS',     theme: 'Defence'        },
  { s: 'DATAPATTERNT.NS',theme: 'Defence'        },

  // ── Metals & Mining ───────────────────────────────────────────────────────
  { s: 'TATASTEEL.NS',   theme: 'Metals'         },
  { s: 'JSWSTEEL.NS',    theme: 'Metals'         },
  { s: 'HINDALCO.NS',    theme: 'Metals'         },
  { s: 'VEDL.NS',        theme: 'Metals'         },
  { s: 'NMDC.NS',        theme: 'Metals'         },
  { s: 'COALINDIA.NS',   theme: 'Metals'         },
  { s: 'HINDZINC.NS',    theme: 'Metals'         },
  { s: 'NATIONALUM.NS',  theme: 'Metals'         },

  // ── Energy & Oil ─────────────────────────────────────────────────────────
  { s: 'RELIANCE.NS',    theme: 'Energy'         },
  { s: 'NTPC.NS',        theme: 'Energy'         },
  { s: 'POWERGRID.NS',   theme: 'Energy'         },
  { s: 'ONGC.NS',        theme: 'Energy'         },
  { s: 'BPCL.NS',        theme: 'Energy'         },
  { s: 'IOC.NS',         theme: 'Energy'         },
  { s: 'GAIL.NS',        theme: 'Energy'         },
  { s: 'TORNTPOWER.NS',  theme: 'Energy'         },
  { s: 'CESC.NS',        theme: 'Energy'         },
  { s: 'IGL.NS',         theme: 'Energy'         },
  { s: 'MGL.NS',         theme: 'Energy'         },

  // ── Renewable Energy (green transition) ───────────────────────────────────
  { s: 'TATAPOWER.NS',   theme: 'Renewable'      },
  { s: 'ADANIGREEN.NS',  theme: 'Renewable'      },
  { s: 'ADANIENT.NS',    theme: 'Renewable'      },
  { s: 'SUZLON.NS',      theme: 'Renewable'      },
  { s: 'NHPC.NS',        theme: 'Renewable'      },
  { s: 'SJVN.NS',        theme: 'Renewable'      },
  { s: 'JSWENERGY.NS',   theme: 'Renewable'      },

  // ── Infrastructure ────────────────────────────────────────────────────────
  { s: 'ADANIPORTS.NS',  theme: 'Infrastructure' },
  { s: 'CONCOR.NS',      theme: 'Infrastructure' },
  { s: 'BLUEDART.NS',    theme: 'Infrastructure' },
  { s: 'DELHIVERY.NS',   theme: 'Infrastructure' },

  // ── Real Estate (housing boom) ────────────────────────────────────────────
  { s: 'DLF.NS',         theme: 'Real Estate'    },
  { s: 'GODREJPROP.NS',  theme: 'Real Estate'    },
  { s: 'OBEROIRLTY.NS',  theme: 'Real Estate'    },
  { s: 'PRESTIGE.NS',    theme: 'Real Estate'    },
  { s: 'BRIGADE.NS',     theme: 'Real Estate'    },
  { s: 'PHOENIXLTD.NS',  theme: 'Real Estate'    },

  // ── Consumer Discretionary & Retail ──────────────────────────────────────
  { s: 'TITAN.NS',       theme: 'Consumer Disc.' },
  { s: 'DMART.NS',       theme: 'Consumer Disc.' },
  { s: 'TRENT.NS',       theme: 'Consumer Disc.' },
  { s: 'JUBLFOOD.NS',    theme: 'Consumer Disc.' },
  { s: 'DEVYANI.NS',     theme: 'Consumer Disc.' },
  { s: 'INDHOTEL.NS',    theme: 'Consumer Disc.' },
  { s: 'INDIGO.NS',      theme: 'Consumer Disc.' },
  { s: 'KALYANKJIL.NS',  theme: 'Consumer Disc.' },
  { s: 'PAGEIND.NS',     theme: 'Consumer Disc.' },
  { s: 'METRO.NS',       theme: 'Consumer Disc.' },
  { s: 'BATA.NS',        theme: 'Consumer Disc.' },
  { s: 'BATAINDIA.NS',   theme: 'Consumer Disc.' },

  // ── Cement & Building Materials ───────────────────────────────────────────
  { s: 'ULTRACEMCO.NS',  theme: 'Cement'         },
  { s: 'AMBUJACEM.NS',   theme: 'Cement'         },
  { s: 'GRASIM.NS',      theme: 'Cement'         },
  { s: 'JKCEMENT.NS',    theme: 'Cement'         },
  { s: 'SHREECEM.NS',    theme: 'Cement'         },
  { s: 'DALMIACEM.NS',   theme: 'Cement'         },

  // ── Paints & Specialty Chemicals ─────────────────────────────────────────
  { s: 'ASIANPAINT.NS',  theme: 'Paints'         },
  { s: 'PIDILITIND.NS',  theme: 'Paints'         },
  { s: 'BERGEPAINT.NS',  theme: 'Paints'         },
  { s: 'KANSAINER.NS',   theme: 'Paints'         },

  // ── Chemicals ────────────────────────────────────────────────────────────
  { s: 'DEEPAKNTR.NS',   theme: 'Chemicals'      },
  { s: 'AARTIIND.NS',    theme: 'Chemicals'      },
  { s: 'PIIND.NS',       theme: 'Chemicals'      },
  { s: 'NAVINFLUOR.NS',  theme: 'Chemicals'      },
  { s: 'CLEAN.NS',       theme: 'Chemicals'      },

  // ── Telecom ───────────────────────────────────────────────────────────────
  { s: 'BHARTIARTL.NS',  theme: 'Telecom'        },
  { s: 'IDEA.NS',        theme: 'Telecom'        },

  // ── Diversified / Conglomerate ────────────────────────────────────────────
  { s: 'BAJAJHLDNG.NS',  theme: 'Conglomerate'   },
  { s: 'GODREJIND.NS',   theme: 'Conglomerate'   },
  { s: 'TATACHEM.NS',    theme: 'Conglomerate'   },

  // ── Expanded coverage — popular mid/small caps & new-age names ─────────────
  { s: 'CAMS.NS',        theme: 'New-Age Tech'   },
  { s: 'HAPPSTMNDS.NS',  theme: 'IT & Tech'      },
  { s: 'TATATECH.NS',    theme: 'IT & Tech'      },
  { s: 'CYIENT.NS',      theme: 'IT & Tech'      },
  { s: 'BSOFT.NS',       theme: 'IT & Tech'      },
  { s: 'TATAELXSI.NS',   theme: 'IT & Tech'      },
  { s: 'INTELLECT.NS',   theme: 'IT & Tech'      },
  { s: 'FIRSTCRY.NS',    theme: 'New-Age Tech'   },
  { s: 'SWIGGY.NS',      theme: 'New-Age Tech'   },
  { s: 'PBFINTECH.NS',   theme: 'New-Age Tech'   },
  { s: 'ANGELONE.NS',    theme: 'New-Age Tech'   },
  { s: 'CDSL.NS',        theme: 'New-Age Tech'   },
  { s: 'BSE.NS',         theme: 'New-Age Tech'   },
  { s: 'MCX.NS',         theme: 'New-Age Tech'   },
  { s: 'KFINTECH.NS',    theme: 'New-Age Tech'   },
  { s: 'JIOFIN.NS',      theme: 'NBFC'           },
  { s: 'SBICARD.NS',     theme: 'NBFC'           },
  { s: 'LTF.NS',         theme: 'NBFC'           },
  { s: 'ABCAPITAL.NS',   theme: 'NBFC'           },
  { s: 'IREDA.NS',       theme: 'NBFC'           },
  { s: 'PEL.NS',         theme: 'NBFC'           },
  { s: 'AUBANK.NS',      theme: 'Banking'        },
  { s: 'YESBANK.NS',     theme: 'Banking'        },
  { s: 'IDBI.NS',        theme: 'Banking'        },
  { s: 'UNIONBANK.NS',   theme: 'Banking'        },
  { s: 'INDIANB.NS',     theme: 'Banking'        },
  { s: 'RBLBANK.NS',     theme: 'Banking'        },
  { s: 'ZYDUSWELL.NS',   theme: 'FMCG'           },
  { s: 'PATANJALI.NS',   theme: 'FMCG'           },
  { s: 'RADICO.NS',      theme: 'FMCG'           },
  { s: 'UBL.NS',         theme: 'FMCG'           },
  { s: 'GODFRYPHLP.NS',  theme: 'FMCG'           },
  { s: 'MOTILALOFS.NS',  theme: 'NBFC'           },
  { s: 'POONAWALLA.NS',  theme: 'NBFC'           },
  { s: 'FIVESTAR.NS',    theme: 'NBFC'           },
  { s: 'MFSL.NS',        theme: 'Insurance'      },
  { s: 'STARHEALTH.NS',  theme: 'Insurance'      },
  { s: 'GICRE.NS',       theme: 'Insurance'      },
  { s: 'NIACL.NS',       theme: 'Insurance'      },
  { s: 'GLAND.NS',       theme: 'Pharma'         },
  { s: 'BIOCON.NS',      theme: 'Pharma'         },
  { s: 'ABBOTINDIA.NS',  theme: 'Pharma'         },
  { s: 'PPLPHARMA.NS',   theme: 'Pharma'         },
  { s: 'JBCHEPHARM.NS',  theme: 'Pharma'         },
  { s: 'GRANULES.NS',    theme: 'Pharma'         },
  { s: 'SYNGENE.NS',     theme: 'Healthcare'     },
  { s: 'LALPATHLAB.NS',  theme: 'Healthcare'     },
  { s: 'METROPOLIS.NS',  theme: 'Healthcare'     },
  { s: 'NH.NS',          theme: 'Healthcare'     },
  { s: 'ASTERDM.NS',     theme: 'Healthcare'     },
  { s: 'RVNL.NS',        theme: 'Infrastructure' },
  { s: 'IRCON.NS',       theme: 'Infrastructure' },
  { s: 'RAILTEL.NS',     theme: 'Infrastructure' },
  { s: 'GMRAIRPORT.NS',  theme: 'Infrastructure' },
  { s: 'IRB.NS',         theme: 'Infrastructure' },
  { s: 'KEC.NS',         theme: 'Capital Goods'  },
  { s: 'CGPOWER.NS',     theme: 'Capital Goods'  },
  { s: 'SUZLON.NS',      theme: 'Renewable'      },
  { s: 'INOXWIND.NS',    theme: 'Renewable'      },
  { s: 'HAL.NS',         theme: 'Defence'        },
  { s: 'ZENTEC.NS',      theme: 'Defence'        },
  { s: 'PARAS.NS',       theme: 'Defence'        },
  { s: 'GRSE.NS',        theme: 'Defence'        },
  { s: 'IEX.NS',         theme: 'Energy'         },
  { s: 'ADANIENSOL.NS',  theme: 'Energy'         },
  { s: 'NTPCGREEN.NS',   theme: 'Renewable'      },
  { s: 'OIL.NS',         theme: 'Energy'         },
  { s: 'PETRONET.NS',    theme: 'Energy'         },
  { s: 'GUJGASLTD.NS',   theme: 'Energy'         },
  { s: 'SAIL.NS',        theme: 'Metals'         },
  { s: 'JINDALSTEL.NS',  theme: 'Metals'         },
  { s: 'APLAPOLLO.NS',   theme: 'Metals'         },
  { s: 'RATNAMANI.NS',   theme: 'Metals'         },
  { s: 'LODHA.NS',       theme: 'Real Estate'    },
  { s: 'GODREJPROP.NS',  theme: 'Real Estate'    },
  { s: 'SOBHA.NS',       theme: 'Real Estate'    },
  { s: 'MAHLIFE.NS',     theme: 'Real Estate'    },
  { s: 'AARTIIND.NS',    theme: 'Chemicals'      },
  { s: 'SRF.NS',         theme: 'Chemicals'      },
  { s: 'ATUL.NS',        theme: 'Chemicals'      },
  { s: 'VINATIORGA.NS',  theme: 'Chemicals'      },
  { s: 'FLUOROCHEM.NS',  theme: 'Chemicals'      },
  { s: 'COROMANDEL.NS',  theme: 'Chemicals'      },
  { s: 'UPL.NS',         theme: 'Chemicals'      },
  { s: 'ASTRAL.NS',      theme: 'Capital Goods'  },
  { s: 'SUPREMEIND.NS',  theme: 'Capital Goods'  },
  { s: 'CAMPUS.NS',      theme: 'Consumer Disc.' },
  { s: 'VBL.NS',         theme: 'FMCG'           },
  { s: 'ITCHOTELS.NS',   theme: 'Consumer Disc.' },
  { s: 'NAUKRI.NS',      theme: 'New-Age Tech'   },
  { s: 'DELHIVERY.NS',   theme: 'New-Age Tech'   },
  { s: 'MANYAVAR.NS',    theme: 'Consumer Disc.' },
  { s: 'RAYMOND.NS',     theme: 'Consumer Disc.' },
  { s: 'ABFRL.NS',       theme: 'Consumer Disc.' },
  { s: 'VMART.NS',       theme: 'Consumer Disc.' },
  { s: 'JWL.NS',         theme: 'Capital Goods'  },
  { s: 'POLICYBZR.NS',   theme: 'New-Age Tech'   },
];

// Deduplicate by symbol
const UNIVERSE_DEDUPED = Array.from(
  new Map(STOCK_UNIVERSE.map(x => [x.s, x])).values()
);

const THEME_MAP = Object.fromEntries(UNIVERSE_DEDUPED.map(({ s, theme }) => [s, theme]));

const round1 = n => n != null ? Math.round(n * 10)  / 10  : null;
const round2 = n => n != null ? Math.round(n * 100) / 100 : null;

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE SCORE  (0–100)
// ─────────────────────────────────────────────────────────────────────────────
function computeScore(item) {
  const { decline_pct, pe_ratio, eps, net_margin, roe, mkt_cap_cr } = item;
  let s = 20; // base

  // Discount from 52W high — more discount = more upside potential (max 25)
  s += Math.min((decline_pct ?? 0) / 40 * 25, 25);

  // P/E valuation — lower is better value (max 20)
  if (pe_ratio != null && pe_ratio > 0 && pe_ratio < 80) {
    s += Math.max(0, (80 - pe_ratio) / 80 * 20);
  }

  // Profitability — EPS + net margin (max 20)
  if ((eps ?? 0) > 0) {
    s += 8;
    const nm = net_margin ?? 0;
    if (nm > 20)      s += 12;
    else if (nm > 10) s += 8;
    else if (nm > 5)  s += 4;
    else if (nm > 0)  s += 2;
  }

  // ROE quality (max 10)
  const r = roe ?? 0;
  if (r > 25)      s += 10;
  else if (r > 15) s += 6;
  else if (r > 8)  s += 3;

  // Size / safety (max 5)
  const cap = mkt_cap_cr ?? 0;
  if (cap > 100000)     s += 5;
  else if (cap > 50000) s += 4;
  else if (cap > 20000) s += 3;
  else if (cap > 5000)  s += 1;

  return Math.round(Math.min(100, Math.max(0, s)));
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY
// ─────────────────────────────────────────────────────────────────────────────
function getCategory(item) {
  const { decline_pct, pe_ratio, eps, net_margin, roe, mkt_cap_cr } = item;
  const profitable  = (eps       ?? 0) > 0;
  const qualityROE  = (roe       ?? 0) >= 16;
  const goodMargin  = (net_margin?? 0) >= 10;

  if ((decline_pct ?? 0) >= 25 && (mkt_cap_cr ?? 0) >= 15000 && (!profitable || (net_margin ?? 0) < 5))
    return 'turnaround';

  if (profitable && qualityROE && goodMargin && (pe_ratio == null || pe_ratio <= 60))
    return 'growth';

  if (profitable && (decline_pct ?? 0) >= 12)
    return 'value';

  return 'value';
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIBAGGER SCORE  (0–100) — growth-compounder lens (distinct from value score)
//   Favours: high ROE, strong margins, earnings/revenue growth, room to compound
//   (smaller cap), quality-at-a-fair-price. Penalises: losses, froth (>80x PE),
//   mega-cap saturation, and deep distress declines.
// ─────────────────────────────────────────────────────────────────────────────
function computeMultibaggerScore(item) {
  const { roe, net_margin, gross_margin, pe_ratio, eps,
          mkt_cap_cr, decline_pct, revenue_growth, earnings_growth } = item;

  // Loss-makers are not multibagger candidates under this lens
  if ((eps ?? 0) <= 0) return 0;

  let s = 10; // base

  // ROE — the single strongest long-term compounding signal (max 28)
  const r = roe ?? 0;
  if (r >= 30)      s += 28;
  else if (r >= 22) s += 23;
  else if (r >= 16) s += 17;
  else if (r >= 12) s += 11;
  else if (r >= 8)  s += 5;

  // Earnings growth (max 18) — persisted from Yahoo; null-safe
  const eg = earnings_growth ?? 0;
  if (eg >= 30)      s += 18;
  else if (eg >= 20) s += 14;
  else if (eg >= 12) s += 9;
  else if (eg >= 5)  s += 4;
  else if (eg < 0)   s -= 6; // shrinking earnings is a red flag

  // Revenue growth (max 12)
  const rg = revenue_growth ?? 0;
  if (rg >= 20)      s += 12;
  else if (rg >= 12) s += 8;
  else if (rg >= 6)  s += 4;
  else if (rg < 0)   s -= 4;

  // Margins / pricing power (max 14)
  const nm = net_margin ?? 0;
  if (nm >= 20)      s += 10;
  else if (nm >= 12) s += 7;
  else if (nm >= 6)  s += 3;
  if ((gross_margin ?? 0) >= 40) s += 4;

  // Valuation — quality at a fair price (max 12). Reward reasonable PE, penalise froth.
  if (pe_ratio != null && pe_ratio > 0) {
    if (pe_ratio <= 25)      s += 12;
    else if (pe_ratio <= 40) s += 8;
    else if (pe_ratio <= 60) s += 4;
    else if (pe_ratio <= 80) s += 1;
    else                     s -= 6; // >80x = priced for perfection
  }

  // Room to compound — smaller caps have more multibagger headroom (max 12)
  const cap = mkt_cap_cr ?? 0;
  if (cap >= 1000 && cap <= 15000)       s += 12;  // small/mid sweet spot
  else if (cap > 15000 && cap <= 50000)  s += 8;   // mid
  else if (cap > 50000 && cap <= 150000) s += 4;   // large
  else if (cap > 150000)                 s += 1;   // mega — hard to multi-bag

  // Distress penalty — a >45% drawdown signals structural trouble, not a bargain
  if ((decline_pct ?? 0) >= 45) s -= 8;

  return Math.round(Math.min(100, Math.max(0, s)));
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH ONE STOCK  — relaxed criteria: include ALL stocks with valid data
// ─────────────────────────────────────────────────────────────────────────────
async function fetchOne({ s: symbol, theme }) {
  try {
    const [q, f] = await Promise.all([
      getQuote(symbol).catch(() => null),
      getFinancials(symbol).catch(() => null),
    ]);

    const price  = q?.price;
    const w52h   = q?.week52_high  ?? f?.week52_high;
    const w52l   = q?.week52_low   ?? f?.week52_low;
    const mktCap = q?.mkt_cap      ?? f?.market_cap;
    const pe     = f?.pe_ratio     ?? q?.pe_ratio;
    const eps    = f?.eps          ?? q?.eps;
    const nm     = f?.net_margin   ?? null;
    const roe    = f?.return_on_equity ?? null;

    if (!price || !w52h || w52h <= 0) return null;

    const mktCapCr = mktCap ? mktCap / 1e7 : 0;

    // Minimum size: ₹1,000 Cr (includes quality mid-caps)
    if (mktCapCr < 1000) return null;

    // Exclude only wildly overvalued: P/E > 150 (not blocking negative P/E)
    if (pe != null && pe > 150) return null;

    const decline = ((w52h - price) / w52h) * 100;

    const item = {
      symbol,
      name:         q?.name || symbol,
      sector:       f?.sector   || '',
      industry:     f?.industry || '',
      theme:        theme || THEME_MAP[symbol] || '',
      price:        round2(price),
      week52_high:  round2(w52h),
      week52_low:   round2(w52l),
      decline_pct:  round1(decline),
      mkt_cap_cr:   mktCapCr ? Math.round(mktCapCr) : null,
      change_pct:   q?.change_pct ?? null,
      pe_ratio:     round1(pe),
      eps:          round2(eps),
      net_margin:   nm  != null ? round1(nm)  : null,
      roe:          roe != null ? round1(roe) : null,
      gross_margin: f?.gross_margin  ?? null,
      revenue_cr:   f?.revenue_ttm ? Math.round(f.revenue_ttm / 1e7) : null,
      revenue_growth:  f?.revenue_growth  != null ? round1(f.revenue_growth)  : null,
      earnings_growth: f?.earnings_growth != null ? round1(f.earnings_growth) : null,
    };

    item.composite_score = computeScore(item);
    item.category        = getCategory(item);

    return item;
  } catch (e) {
    log.warn(`Screener ${symbol}:`, e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREENER RUNNER  — scans universe, saves each stock to DB immediately
// ─────────────────────────────────────────────────────────────────────────────
let running = false;

// ─────────────────────────────────────────────────────────────────────────────
// TICKER RENAME RESOLVER — self-healing when a symbol is renamed/delisted
//   Hard rebrands where the old name is gone from search (e.g. Zomato→Eternal)
//   are handled by this seed map; softer changes are auto-discovered via search.
// ─────────────────────────────────────────────────────────────────────────────
const RENAMED_TICKERS = {
  'ZOMATO.NS': 'ETERNAL.NS',
};

async function getAliasMap() {
  const map = { ...RENAMED_TICKERS };
  try {
    const r = await query('SELECT old_symbol, new_symbol FROM ticker_aliases');
    for (const row of r.rows) map[row.old_symbol] = row.new_symbol;
  } catch { /* table may not exist yet */ }
  return map;
}

async function saveAlias(oldSym, newSym, note) {
  try {
    await query(`
      INSERT INTO ticker_aliases (old_symbol, new_symbol, note, resolved_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (old_symbol) DO UPDATE SET
        new_symbol=EXCLUDED.new_symbol, note=EXCLUDED.note, resolved_at=EXCLUDED.resolved_at`,
      [oldSym, newSym, note || null, Math.floor(Date.now() / 1000)]);
  } catch (e) { log.warn(`saveAlias ${oldSym}: ${e.message}`); }
}

// Best-effort: find the current ticker for a symbol that no longer returns data.
// Conservative — only accepts a candidate that shares the old root or a name token,
// so a failed lookup can't silently map to an unrelated company.
async function resolveRename(oldSymbol) {
  const root = oldSymbol.replace(/\.(NS|BO)$/i, '');
  let oldName = null;
  try {
    const r = await query('SELECT name FROM screener_picks WHERE symbol=$1', [oldSymbol]);
    oldName = r.rows?.[0]?.name || null;
  } catch { /* no prior row */ }

  const rootLc = root.toLowerCase();
  const nameLc = (oldName || '').toLowerCase();

  for (const q of [oldName, root].filter(Boolean)) {
    const results = await searchSymbol(q).catch(() => []);
    for (const cand of results) {
      const sym = cand.symbol;
      if (!/\.(NS|BO)$/i.test(sym)) continue;                    // Indian listing only
      if (sym.toUpperCase() === oldSymbol.toUpperCase()) continue;
      const quote = await getQuote(sym).catch(() => null);
      if (!quote?.price) continue;

      const candRoot = sym.replace(/\.(NS|BO)$/i, '').toLowerCase();
      const candName = (quote.name || '').toLowerCase();
      const shareRoot = candRoot.startsWith(rootLc.slice(0, 4)) || rootLc.startsWith(candRoot.slice(0, 4));
      const shareName = nameLc && nameLc.split(/\s+/).some(t => t.length > 3 && candName.includes(t));
      if (shareRoot || shareName) return { symbol: sym, name: quote.name };
    }
  }
  return null;
}

export async function runScreener() {
  // Apply known + discovered renames up front so we scan current tickers.
  const aliases  = await getAliasMap();
  const remapped = UNIVERSE_DEDUPED.map(u => aliases[u.s] ? { s: aliases[u.s], theme: u.theme } : u);
  const list     = Array.from(new Map(remapped.map(x => [x.s, x])).values());

  log.info(`Screener: scanning ${list.length} stocks…`);
  scanState = { running: true, total: list.length, done: 0, found: 0, startedAt: Date.now() };

  const results = [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) await sleep(350 + Math.random() * 250);
    const entry = list[i];
    let item = await fetchOne(entry);

    // No data — the ticker may have been renamed. Try to resolve + remember it.
    if (!item) {
      const resolved = await resolveRename(entry.s).catch(() => null);
      if (resolved && resolved.symbol !== entry.s) {
        log.info(`Auto-rename: ${entry.s} → ${resolved.symbol} (${resolved.name})`);
        await saveAlias(entry.s, resolved.symbol, 'auto-discovered');
        item = await fetchOne({ s: resolved.symbol, theme: entry.theme });
      }
    }

    scanState.done++;
    if (item) {
      results.push(item);
      scanState.found++;
      await saveOneToDB(item); // save immediately — available for /all-stocks queries
    }
  }

  results.sort((a, b) => b.composite_score - a.composite_score);
  scanState = { running: false, total: list.length, done: list.length, found: results.length, startedAt: scanState.startedAt };
  log.info(`Screener done: ${results.length} stocks stored`);
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
export async function getValuePicks() {
  // 1. In-memory / Redis cache (fastest)
  const cached = await cacheGet(CACHE_KEY);
  if (cached?.length) return { status: 'ready', data: cached, scanning: running };

  // 2. DB fallback — serve fresh-ish data while background scan runs
  const dbPicks = await loadPicksFromDB();
  if (dbPicks.length) {
    await cacheSet(CACHE_KEY, dbPicks, CACHE_TTL);
    if (!running) {
      running = true;
      runScreener()
        .then(async r => { await cacheSet(CACHE_KEY, r, CACHE_TTL); })
        .catch(e => log.error('Screener refresh failed:', e.message))
        .finally(() => { running = false; });
    }
    return { status: 'ready', data: dbPicks, scanning: running };
  }

  // 3. Cold start — kick off a scan
  if (running) return { status: 'loading', data: [], scanning: true };
  running = true;
  runScreener()
    .then(async r => { await cacheSet(CACHE_KEY, r, CACHE_TTL); })
    .catch(e => log.error('Screener failed:', e.message))
    .finally(() => { running = false; });

  return { status: 'loading', data: [], scanning: true };
}

// All stocks ever scanned — additive, no time cutoff
export async function getAllStocks() {
  return loadAllStocksFromDB();
}

export async function refreshScreener() {
  await cacheDel(CACHE_KEY);
  running = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// MOMENTUM PICKS  — scores existing screener_picks for short-term momentum
// Uses: 52W range position, today change%, composite quality, valuation
// ─────────────────────────────────────────────────────────────────────────────
export async function getMomentumPicks() {
  try {
    const { query } = await import('../db.js');
    const stale = Math.floor(Date.now() / 1000) - 86400 * 7;
    const result = await query(`
      SELECT *,
        GREATEST(0, LEAST(100,
          CASE
            WHEN decline_pct IS NOT NULL AND decline_pct < 5  THEN 30
            WHEN decline_pct IS NOT NULL AND decline_pct < 15 THEN 20
            WHEN decline_pct IS NOT NULL AND decline_pct < 30 THEN 10
            ELSE 0
          END
          + CASE
            WHEN change_pct >= 2  THEN 20
            WHEN change_pct >= 1  THEN 14
            WHEN change_pct >= 0  THEN 7
            ELSE 0
          END
          + CASE
            WHEN composite_score >= 75 THEN 25
            WHEN composite_score >= 60 THEN 16
            WHEN composite_score >= 50 THEN 8
            ELSE 0
          END
          + CASE
            WHEN pe_ratio > 0 AND pe_ratio <= 20 THEN 15
            WHEN pe_ratio > 0 AND pe_ratio <= 35 THEN 8
            WHEN pe_ratio > 0 AND pe_ratio <= 60 THEN 3
            ELSE 0
          END
          + CASE category
              WHEN 'growth'  THEN 10
              WHEN 'value'   THEN 6
              ELSE 4
            END
        )) AS momentum_score
      FROM screener_picks
      WHERE scanned_at > $1 AND price IS NOT NULL AND price > 0
      ORDER BY momentum_score DESC, change_pct DESC NULLS LAST
      LIMIT 30
    `, [stale]);
    return result.rows;
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIBAGGER PICKS — ranks stored screener_picks by the quality-growth lens
// ─────────────────────────────────────────────────────────────────────────────
export async function getMultibaggerPicks(limit = 20) {
  // Prefer fresh rows; fall back to all stored rows if nothing recent.
  let rows = await loadPicksFromDB();
  if (!rows.length) rows = await loadAllStocksFromDB();

  const scored = rows
    .map(s => ({ ...s, multibagger_score: computeMultibaggerScore(s) }))
    .filter(s => s.multibagger_score > 0)
    .sort((a, b) => b.multibagger_score - a.multibagger_score)
    .slice(0, limit);

  return scored;
}

