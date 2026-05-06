import Groq from 'groq-sdk';
import { GROQ_API_KEY, ANTHROPIC_API_KEY } from '../config.js';
import { getQuote, getProfile, getNews } from './yahoo.js';
import log from '../log.js';

const groqClient = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const SYSTEM_PROMPT = `You are StockPulse AI, an expert financial analyst specializing in Indian and global stock markets. You provide data-driven insights, technical analysis, and investment recommendations.

EXPERTISE: NSE/BSE equities, fundamental & technical analysis, RBI policy impacts, FII/DII flows, sector rotation, portfolio management.

RESPONSE STYLE: Concise but comprehensive. Use specific numbers. Highlight risks and opportunities. Format with bullet points when helpful. Ground analysis in the real-time data provided.`;

async function buildContext(symbols) {
  if (!symbols?.length) return '';
  const parts = [];
  for (const sym of symbols.slice(0, 3)) {
    try {
      const [qR, pR, nR] = await Promise.allSettled([getQuote(sym), getProfile(sym), getNews(sym)]);
      const q = qR.status === 'fulfilled' ? qR.value : null;
      const p = pR.status === 'fulfilled' ? pR.value : null;
      const n = nR.status === 'fulfilled' ? nR.value : [];
      if (!q?.price) continue;

      const cur = q.currency === 'INR' ? '₹' : '$';
      let ctx = `\n=== ${sym} ===`;
      if (p?.name)   ctx += `\nCompany: ${p.name}`;
      if (p?.sector) ctx += ` | Sector: ${p.sector}`;
      ctx += `\nPrice: ${cur}${q.price.toFixed(2)} | Change: ${q.change?.toFixed(2) ?? '—'} (${q.change_pct?.toFixed(2) ?? '—'}%)`;
      if (q.mkt_cap) ctx += `\nMkt Cap: ${cur}${(q.mkt_cap / 1e7).toFixed(0)} Cr`;
      if (q.week52_high && q.week52_low) ctx += `\n52W: ${cur}${q.week52_low.toFixed(2)}–${cur}${q.week52_high.toFixed(2)}`;
      const news = (n || []).slice(0, 3).map(a => `  - ${a.title}`).join('\n');
      if (news) ctx += `\nNews:\n${news}`;
      parts.push(ctx);
    } catch {}
  }
  return parts.length ? `\n\nLIVE MARKET DATA:\n${parts.join('\n')}` : '';
}

export async function streamChat({ question, symbols = [], history = [], onDelta, onDone, onError }) {
  if (!groqClient && !ANTHROPIC_API_KEY) {
    onError('AI not configured — add GROQ_API_KEY to environment variables.');
    return;
  }
  if (!groqClient && ANTHROPIC_API_KEY) {
    return streamAnthropic({ question, symbols, history, onDelta, onDone, onError });
  }

  try {
    const context  = await buildContext(symbols);
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + context },
      ...history.slice(-10).map(m => ({ role: m.role, content: String(m.content) })),
      { role: 'user', content: question },
    ];

    const stream = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 1500,
      temperature: 0.7,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) onDelta(text);
    }
    onDone();
  } catch (e) {
    log.error('Chat (Groq):', e.message);
    onError(e.message || 'Chat failed');
  }
}

async function streamAnthropic({ question, symbols, history, onDelta, onDone, onError }) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client  = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const context = await buildContext(symbols);
    const messages = [
      ...history.slice(-10).map(m => ({ role: m.role, content: String(m.content) })),
      { role: 'user', content: question },
    ];

    const stream = await client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      system: SYSTEM_PROMPT + context,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) onDelta(event.delta.text);
    }
    onDone();
  } catch (e) {
    log.error('Chat (Anthropic):', e.message);
    onError(e.message || 'Chat failed');
  }
}
