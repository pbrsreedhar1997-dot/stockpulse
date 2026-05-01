import { Component, inject, signal, ElementRef, viewChild, AfterViewChecked, OnInit, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { ChatService, ChatMessage } from '../../core/services/chat.service';
import { WatchlistService } from '../../core/services/watchlist.service';
import { ApiService } from '../../core/services/api.service';

interface UIMessage { role: 'user' | 'ai'; text: string; html?: string; time: string; streaming?: boolean; }

/** Lightweight markdown → safe HTML. Handles headings, bold, italic, tables, lists, code, hr. */
function mdToHtml(md: string): string {
  let s = md
    // Escape HTML first to prevent injection
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Block-level: headings
  s = s.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Horizontal rule
  s = s.replace(/^---+$/gm, '<hr>');

  // Tables — parse entire table blocks
  s = s.replace(/((?:^\|.+\|\n?)+)/gm, (block) => {
    const rows = block.trim().split('\n').filter(r => r.trim());
    if (rows.length < 2) return block;
    const isSep = (r: string) => /^\|[\s\-|:]+\|$/.test(r.trim());
    let html = '<table>';
    let headerDone = false;
    for (const row of rows) {
      if (isSep(row)) { html += '</thead><tbody>'; headerDone = true; continue; }
      const cells = row.split('|').slice(1, -1).map(c => c.trim());
      const tag = !headerDone ? 'th' : 'td';
      html += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
      if (!headerDone && !isSep(rows[rows.indexOf(row) + 1] || '')) { html += '<tbody>'; headerDone = true; }
    }
    html += '</tbody></table>';
    return html;
  });

  // Unordered lists — group consecutive - lines
  s = s.replace(/((?:^[-*] .+\n?)+)/gm, (block) => {
    const items = block.trim().split('\n').map(l => l.replace(/^[-*] /, '').trim());
    return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
  });

  // Inline: bold+italic, bold, italic, inline code
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Line breaks: double newline → paragraph break; single newline in non-block → <br>
  s = s.replace(/\n\n+/g, '</p><p>');
  s = s.replace(/\n(?!<\/?(h[2-4]|ul|ol|li|table|thead|tbody|tr|th|td|hr|p))/g, '<br>');

  return '<p>' + s + '</p>';
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements AfterViewChecked, OnInit {
  private chatSvc   = inject(ChatService);
  private wl        = inject(WatchlistService);
  private api       = inject(ApiService);
  private http      = inject(HttpClient);
  private sanitizer = inject(DomSanitizer);

  messages          = signal<UIMessage[]>([]);
  history           = signal<ChatMessage[]>([]);
  question          = '';
  streaming         = signal(false);
  ragTraining       = signal(false);
  ragStatus         = signal('');
  ragStatusMsg      = signal('');
  ragStatusOk       = signal(true);
  ragIndexedSymbols = signal<Set<string>>(new Set());
  messagesEl        = viewChild<ElementRef<HTMLDivElement>>('msgs');

  private shouldScroll = false;

  ngOnInit() { this.fetchRagStatus(); }

  fetchRagStatus() {
    this.api.getRaw<{ ok: boolean; total_chunks: number; symbols: Record<string, any> }>('/rag/status')
      .subscribe(r => {
        if (r?.ok) {
          const count = r.total_chunks;
          const syms  = Object.keys(r.symbols || {}).length;
          this.ragStatus.set(`${count} chunks · ${syms} symbols indexed`);
          this.ragIndexedSymbols.set(new Set(Object.keys(r.symbols || {})));
        }
      });
  }

  trainRag() {
    const symbols = this.wl.items().map(i => i.symbol);
    if (!symbols.length) { this.showRagMsg('Add stocks to your watchlist first', false); return; }
    this._doTrain({ symbols }, `Indexing ${symbols.length} watchlist stocks with 2-year history…`, 45000);
  }

  trainAllUniverse() {
    this._doTrain(
      { all_universe: true },
      'Downloading 2-year data for full Nifty 100 universe (~100 stocks). This takes 2–3 min…',
      180000
    );
  }

  private _doTrain(body: object, msg: string, waitMs: number) {
    this.ragTraining.set(true);
    this.showRagMsg(msg, true);
    this.http.post<{ ok: boolean; message: string; count?: number; error?: string }>(
      `${this.api.base}/rag/train`,
      body,
      { headers: new HttpHeaders({ 'Content-Type': 'application/json' }) }
    ).pipe(catchError(err => of({ ok: false, message: '', error: err?.error?.error || err?.message || 'Network error' })))
    .subscribe(r => {
      if (r?.ok) {
        const n = (r as any).count || '';
        this.showRagMsg(`⏳ Ingesting ${n} stocks — will update when ready…`, true);
        setTimeout(() => {
          this.fetchRagStatus();
          this.ragTraining.set(false);
          this.showRagMsg('✅ RAG training complete — 2-year history + earnings indexed', true);
        }, waitMs);
      } else {
        this.ragTraining.set(false);
        this.showRagMsg(`Training failed: ${r?.error || 'Unknown error'}`, false);
      }
    });
  }

  private showRagMsg(msg: string, ok: boolean) {
    this.ragStatusMsg.set(msg);
    this.ragStatusOk.set(ok);
    if (ok && !msg.startsWith('Indexing')) {
      setTimeout(() => this.ragStatusMsg.set(''), 6000);
    }
  }

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      const el = this.messagesEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  get time() { return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }

  get unindexedCount(): number {
    const indexed = this.ragIndexedSymbols();
    return this.wl.items().filter(i => !indexed.has(i.symbol)).length;
  }

  get hasUnindexed(): boolean { return this.unindexedCount > 0; }

  private renderMarkdown(text: string): string {
    const raw = mdToHtml(text);
    return this.sanitizer.sanitize(SecurityContext.HTML, raw) ?? text;
  }

  send() {
    const q = this.question.trim();
    if (!q || this.streaming()) return;
    this.question = '';

    this.messages.update(m => [...m, { role: 'user', text: q, time: this.time }]);
    this.history.update(h => [...h.slice(-9), { role: 'user', content: q }]);
    this.shouldScroll = true;
    this.streaming.set(true);

    const symbols = this.wl.items().map(i => i.symbol);
    let aiText = '';
    let aiIdx = -1;

    this.messages.update(m => { aiIdx = m.length; return [...m, { role: 'ai', text: '', html: '', time: this.time, streaming: true }]; });

    this.chatSvc.stream(q, symbols, this.history()).subscribe({
      next: evt => {
        if (evt.type === 'delta') {
          aiText += evt.text;
          const html = this.renderMarkdown(aiText);
          this.messages.update(m => m.map((msg, i) => i === aiIdx ? { ...msg, text: aiText, html } : msg));
          this.shouldScroll = true;
        } else if (evt.type === 'done') {
          const html = this.renderMarkdown(aiText);
          this.messages.update(m => m.map((msg, i) => i === aiIdx ? { ...msg, text: aiText, html, streaming: false } : msg));
          this.history.update(h => [...h, { role: 'assistant', content: aiText }]);
          this.streaming.set(false);
        } else if (evt.type === 'error') {
          this.messages.update(m => m.map((msg, i) => i === aiIdx ? { ...msg, text: '⚠️ ' + evt.message, html: '', streaming: false } : msg));
          this.streaming.set(false);
        }
      },
      error: err => {
        const msg = err.status === 503 ? '🔑 AI key not configured. Add GROQ_API_KEY to your server environment.' : '⚠️ Could not reach backend.';
        this.messages.update(m => m.map((msg2, i) => i === aiIdx ? { ...msg2, text: msg, html: '', streaming: false } : msg2));
        this.streaming.set(false);
      }
    });
  }

  onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }

  quickAsk(q: string) { this.question = q; this.send(); }

  clear() { this.messages.set([]); this.history.set([]); }
}
