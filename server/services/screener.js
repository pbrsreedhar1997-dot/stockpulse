import { getQuote, getFinancials } from './yahoo.js';
import { get as cacheGet, set as cacheSet, del as cacheDel } from '../cache.js';
import log from '../log.js';

const CACHE_KEY = 'screener6:value-picks';
const CACHE_TTL = 3 * 3600; // 3 hours

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// STOCK UNIVERSE  — ~130 stocks across all major Indian sectors
// theme codes map to display labels in the UI
// ─────────────────────────────────────────────────────────────────────────────
const STOCK_UNIVERSE = [
  // IT & Technology (AI / cloud tailwinds)
  { s: 'TCS.NS',        theme: 'IT & Tech'      },
  { s: 'INFY.NS',       theme: 'IT & Tech'      },
  { s: 'WIPRO.NS',      theme: 'IT & Tech'      },
  { s: 'HCLTECH.NS',    theme: 'IT & Tech'      },
  { s: 'TECHM.NS',      theme: 'IT & Tech'      },
  { s: 'LTIM.NS',       theme: 'IT & Tech'      },
  { s: 'PERSISTENT.NS', theme: 'IT & Tech'      },
  { s: 'MPHASIS.NS',    theme: 'IT & Tech'      },
  { s: 'COFORGE.NS',    theme: 'IT & Tech'      },
  { s: 'KPITTECH.NS',   theme: 'IT & Tech'      },
  { s: 'OFSS.NS',       theme: 'IT & Tech'      },
  { s: 'DIXON.NS',      theme: 'IT & Tech'      },

  // New-Age / Platform
  { s: 'ZOMATO.NS',     theme: 'New-Age Tech'   },
  { s: 'NAUKRI.NS',     theme: 'New-Age Tech'   },
  { s: 'IRCTC.NS',      theme: 'New-Age Tech'   },

  // Banking
  { s: 'HDFCBANK.NS',   theme: 'Banking'        },
  { s: 'ICICIBANK.NS',  theme: 'Banking'        },
  { s: 'KOTAKBANK.NS',  theme: 'Banking'        },
  { s: 'AXISBANK.NS',   theme: 'Banking'        },
  { s: 'SBIN.NS',       theme: 'Banking'        },
  { s: 'INDUSINDBK.NS', theme: 'Banking'        },
  { s: 'BANKBARODA.NS', theme: 'Banking'        },
  { s: 'PNB.NS',        theme: 'Banking'        },
  { s: 'CANBK.NS',      theme: 'Banking'        },
  { s: 'IDFCFIRSTB.NS', theme: 'Banking'        },
  { s: 'BANDHANBNK.NS', theme: 'Banking'        },

  // NBFC & Fintech
  { s: 'BAJFINANCE.NS', theme: 'NBFC'           },
  { s: 'BAJAJFINSV.NS', theme: 'NBFC'           },
  { s: 'CHOLAFIN.NS',   theme: 'NBFC'           },
  { s: 'SHRIRAMFIN.NS', theme: 'NBFC'           },
  { s: 'RECLTD.NS',     theme: 'NBFC'           },
  { s: 'PFC.NS',        theme: 'NBFC'           },
  { s: 'IRFC.NS',       theme: 'NBFC'           },
  { s: 'MANAPPURAM.NS', theme: 'NBFC'           },
  { s: 'MUTHOOTFIN.NS', theme: 'NBFC'           },

  // Insurance
  { s: 'HDFCLIFE.NS',   theme: 'Insurance'      },
  { s: 'SBILIFE.NS',    theme: 'Insurance'      },
  { s: 'LICI.NS',       theme: 'Insurance'      },

  // Pharma & Healthcare (defensive + export play)
  { s: 'SUNPHARMA.NS',  theme: 'Pharma'         },
  { s: 'CIPLA.NS',      theme: 'Pharma'         },
  { s: 'DRREDDY.NS',    theme: 'Pharma'         },
  { s: 'DIVISLAB.NS',   theme: 'Pharma'         },
  { s: 'LUPIN.NS',      theme: 'Pharma'         },
  { s: 'AUROPHARMA.NS', theme: 'Pharma'         },
  { s: 'TORNTPHARM.NS', theme: 'Pharma'         },
  { s: 'ZYDUSLIFE.NS',  theme: 'Pharma'         },
  { s: 'ALKEM.NS',      theme: 'Pharma'         },
  { s: 'MANKIND.NS',    theme: 'Pharma'         },
  { s: 'APOLLOHOSP.NS', theme: 'Healthcare'     },

  // FMCG & Consumer Staples (defensive)
  { s: 'HINDUNILVR.NS', theme: 'FMCG'           },
  { s: 'ITC.NS',        theme: 'FMCG'           },
  { s: 'NESTLEIND.NS',  theme: 'FMCG'           },
  { s: 'BRITANNIA.NS',  theme: 'FMCG'           },
  { s: 'MARICO.NS',     theme: 'FMCG'           },
  { s: 'DABUR.NS',      theme: 'FMCG'           },
  { s: 'GODREJCP.NS',   theme: 'FMCG'           },
  { s: 'COLPAL.NS',     theme: 'FMCG'           },
  { s: 'TATACONSUM.NS', theme: 'FMCG'           },

  // Automobile & EV
  { s: 'MARUTI.NS',     theme: 'Auto'           },
  { s: 'TATAMOTORS.NS', theme: 'Auto'           },
  { s: 'BAJAJ-AUTO.NS', theme: 'Auto'           },
  { s: 'HEROMOTOCO.NS', theme: 'Auto'           },
  { s: 'EICHERMOT.NS',  theme: 'Auto'           },
  { s: 'MOTHERSON.NS',  theme: 'Auto'           },

  // Capital Goods & Manufacturing (infra boom)
  { s: 'LT.NS',         theme: 'Capital Goods'  },
  { s: 'ABB.NS',        theme: 'Capital Goods'  },
  { s: 'SIEMENS.NS',    theme: 'Capital Goods'  },
  { s: 'HAVELLS.NS',    theme: 'Capital Goods'  },
  { s: 'POLYCAB.NS',    theme: 'Capital Goods'  },
  { s: 'CUMMINSIND.NS', theme: 'Capital Goods'  },
  { s: 'THERMAX.NS',    theme: 'Capital Goods'  },
  { s: 'BHEL.NS',       theme: 'Capital Goods'  },
  { s: 'APLAPOLLO.NS',  theme: 'Capital Goods'  },

  // Defence (structural growth play — "Make in India" + global orders)
  { s: 'HAL.NS',        theme: 'Defence'        },
  { s: 'BEL.NS',        theme: 'Defence'        },
  { s: 'COCHINSHIP.NS', theme: 'Defence'        },
  { s: 'MAZDOCK.NS',    theme: 'Defence'        },
  { s: 'BHARATFORG.NS', theme: 'Defence'        },

  // Metals & Mining (global commodity cycle)
  { s: 'TATASTEEL.NS',  theme: 'Metals'         },
  { s: 'JSWSTEEL.NS',   theme: 'Metals'         },
  { s: 'HINDALCO.NS',   theme: 'Metals'         },
  { s: 'VEDL.NS',       theme: 'Metals'         },
  { s: 'NMDC.NS',       theme: 'Metals'         },
  { s: 'COALINDIA.NS',  theme: 'Metals'         },
  { s: 'HINDZINC.NS',   theme: 'Metals'         },

  // Energy & Oil (cash-rich PSUs + energy transition)
  { s: 'RELIANCE.NS',   theme: 'Energy'         },
  { s: 'NTPC.NS',       theme: 'Energy'         },
  { s: 'POWERGRID.NS',  theme: 'Energy'         },
  { s: 'ONGC.NS',       theme: 'Energy'         },
  { s: 'BPCL.NS',       theme: 'Energy'         },
  { s: 'IOC.NS',        theme: 'Energy'         },
  { s: 'GAIL.NS',       theme: 'Energy'         },

  // Renewable Energy (green transition)
  { s: 'TATAPOWER.NS',  theme: 'Renewable'      },
  { s: 'ADANIGREEN.NS', theme: 'Renewable'      },
  { s: 'ADANIENT.NS',   theme: 'Renewable'      },
  { s: 'ADANIPORTS.NS', theme: 'Infrastructure' },

  // Real Estate (housing boom)
  { s: 'DLF.NS',        theme: 'Real Estate'    },
  { s: 'GODREJPROP.NS', theme: 'Real Estate'    },
  { s: 'OBEROIRLTY.NS', theme: 'Real Estate'    },
  { s: 'PRESTIGE.NS',   theme: 'Real Estate'    },
  { s: 'BRIGADE.NS',    theme: 'Real Estate'    },

  // Consumer Discretionary (premiumisation + travel)
  { s: 'TITAN.NS',      theme: 'Consumer Disc.' },
  { s: 'DMART.NS',      theme: 'Consumer Disc.' },
  { s: 'TRENT.NS',      theme: 'Consumer Disc.' },
  { s: 'JUBLFOOD.NS',   theme: 'Consumer Disc.' },
  { s: 'DEVYANI.NS',    theme: 'Consumer Disc.' },
  { s: 'INDHOTEL.NS',   theme: 'Consumer Disc.' },
  { s: 'INDIGO.NS',     theme: 'Consumer Disc.' },
  { s: 'KALYANKJIL.NS', theme: 'Consumer Disc.' },

  // Cement & Building Materials (infra + housing)
  { s: 'ULTRACEMCO.NS', theme: 'Cement'         },
  { s: 'AMBUJACEM.NS',  theme: 'Cement'         },
  { s: 'GRASIM.NS',     theme: 'Cement'         },
  { s: 'JKCEMENT.NS',   theme: 'Cement'         },

  // Paints & Specialty (premiumisation)
  { s: 'ASIANPAINT.NS', theme: 'Paints'         },
  { s: 'PIDILITIND.NS', theme: 'Paints'         },
  { s: 'BERGEPAINT.NS', theme: 'Paints'         },

  // Chemicals (global supply-chain shift to India)
  { s: 'DEEPAKNTR.NS',  theme: 'Chemicals'      },
  { s: 'AARTIIND.NS',   theme: 'Chemicals'      },
  { s: 'PIIND.NS',      theme: 'Chemicals'      },

  // Telecom (5G rollout)
  { s: 'BHARTIARTL.NS', theme: 'Telecom'        },

  // Logistics & Infra
  { s: 'CONCOR.NS',     theme: 'Infrastructure' },
  { s: 'PAGEIND.NS',    theme: 'Consumer Disc.' },

  // Diversified / Conglomerate
  { s: 'BAJAJHLDNG.NS', theme: 'Conglomerate'   },
];

// Fast symbol → theme lookup
const THEME_MAP = Object.fromEntries(STOCK_UNIVERSE.map(({ s, theme }) => [s, theme]));

const round1 = n => n != null ? Math.round(n * 10)  / 10  : null;
const round2 = n => n != null ? Math.round(n * 100) / 100 : null;

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITE SCORE  (0–100) — investor-value heuristic
// Weights: value discount (25), profitability (30), size/safety (20), valuation (25)
// ─────────────────────────────────────────────────────────────────────────────
function computeScore(item) {
  const { decline_pct, pe_ratio, eps, net_margin, roe, mkt_cap_cr } = item;
  let s = 30;

  // Discount from 52W high — more discount = more upside potential (max 25)
  s += Math.min((decline_pct ?? 0) / 40 * 25, 25);

  // P/E valuation — lower is better value (max 20)
  if (pe_ratio > 0 && pe_ratio < 60) {
    s += Math.max(0, (60 - pe_ratio) / 60 * 20);
  }

  // Profitability (net margin + EPS positivity — max 20)
  if ((eps ?? 0) > 0) {
    s += 10;
    const nm = net_margin ?? 0;
    if (nm > 20) s += 10;
    else if (nm > 10) s += 6;
    else if (nm > 0)  s += 3;
  }

  // ROE quality (max 10)
  const r = roe ?? 0;
  if (r > 25) s += 10;
  else if (r > 15) s += 6;
  else if (r > 8)  s += 3;

  // Size / safety (large cap = lower risk, max 5)
  const cap = mkt_cap_cr ?? 0;
  if (cap > 100000) s += 5;
  else if (cap > 50000) s += 4;
  else if (cap > 20000) s += 3;
  else if (cap > 10000) s += 1;

  return Math.round(Math.min(100, Math.max(0, s)));
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY  — investor thesis for each pick
// ─────────────────────────────────────────────────────────────────────────────
function getCategory(item) {
  const { decline_pct, pe_ratio, eps, net_margin, roe, mkt_cap_cr } = item;
  const profitable = (eps ?? 0) > 0;
  const qualityROE = (roe ?? 0) >= 16;
  const goodMargin = (net_margin ?? 0) >= 10;

  // Turnaround: large company going through a rough patch — buy the dip
  if ((decline_pct ?? 0) >= 25 && (mkt_cap_cr ?? 0) >= 15000 && (!profitable || (net_margin ?? 0) < 5)) {
    return 'turnaround';
  }

  // Growth: strong quality metrics, positioned to compound long-term
  if (profitable && qualityROE && goodMargin && (pe_ratio == null || pe_ratio <= 60)) {
    return 'growth';
  }

  // Value: profitable + significant discount from peak = classic value pick
  if (profitable && (decline_pct ?? 0) >= 12) {
    return 'value';
  }

  // Default: value
  return 'value';
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH ONE STOCK
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

    // Minimum size: ₹5,000 Cr to avoid micro-caps with unreliable data
    if (mktCapCr < 5000) return null;

    const decline = ((w52h - price) / w52h) * 100;

    // INCLUSION RULES (two tracks):
    // Track A — Value/Growth: profitable, ≥8% below high
    // Track B — Turnaround: large-cap (≥15K Cr), ≥20% below high (even if EPS ≤ 0)
    const trackA = (eps ?? 0) > 0 && decline >= 8;
    const trackB = mktCapCr >= 15000 && decline >= 20;
    if (!trackA && !trackB) return null;

    // Skip wildly overvalued or deeply loss-making small caps
    if (pe != null && pe < 0 && mktCapCr < 15000) return null;
    if (pe != null && pe > 100) return null;

    const item = {
      symbol,
      name:        q?.name || symbol,
      sector:      f?.sector || '',
      industry:    f?.industry || '',
      theme:       theme || THEME_MAP[symbol] || '',
      price:       round2(price),
      week52_high: round2(w52h),
      week52_low:  round2(w52l),
      decline_pct: round1(decline),
      mkt_cap_cr:  mktCapCr ? Math.round(mktCapCr) : null,
      change_pct:  q?.change_pct ?? null,
      pe_ratio:    round1(pe),
      eps:         round2(eps),
      net_margin:  nm   != null ? round1(nm)  : null,
      roe:         roe  != null ? round1(roe) : null,
      gross_margin: f?.gross_margin  ?? null,
      revenue_cr:  f?.revenue_ttm ? Math.round(f.revenue_ttm / 1e7) : null,
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
// SCREENER RUNNER
// ─────────────────────────────────────────────────────────────────────────────
let running = false;

async function runScreener() {
  log.info(`Screener: scanning ${STOCK_UNIVERSE.length} stocks…`);
  const results = [];
  for (let i = 0; i < STOCK_UNIVERSE.length; i++) {
    if (i > 0) await sleep(400 + Math.random() * 300);
    const item = await fetchOne(STOCK_UNIVERSE[i]);
    if (item) results.push(item);
  }
  // Primary sort: composite score descending
  results.sort((a, b) => b.composite_score - a.composite_score);
  log.info(`Screener done: ${results.length} picks found`);
  return results;
}

export async function getValuePicks() {
  const cached = await cacheGet(CACHE_KEY);
  if (cached?.length) return { status: 'ready', data: cached };
  if (running) return { status: 'loading', data: [] };

  running = true;
  runScreener()
    .then(r => cacheSet(CACHE_KEY, r, CACHE_TTL))
    .catch(e => log.error('Screener failed:', e.message))
    .finally(() => { running = false; });

  return { status: 'loading', data: [] };
}

export async function refreshScreener() {
  await cacheDel(CACHE_KEY);
  running = false;
}
