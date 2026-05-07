import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', 'stockpulse.env') });

const raw = process.env.DATABASE_URL || '';
export const DATABASE_URL = raw.startsWith('postgres://')
  ? 'postgresql://' + raw.slice('postgres://'.length)
  : raw;

export const PORT            = parseInt(process.env.PORT || '5000', 10);
export const REDIS_URL       = process.env.REDIS_URL       || '';
export const GROQ_API_KEY    = process.env.GROQ_API_KEY    || '';
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const FINNHUB_API_KEY    = process.env.FINNHUB_API_KEY    || '';
export const UPSTOX_ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN || '';
export const NODE_ENV           = process.env.NODE_ENV           || 'development';
export const IS_RENDER          = !!process.env.RENDER;
