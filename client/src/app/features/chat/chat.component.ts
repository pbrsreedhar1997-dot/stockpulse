import { Component, inject, signal, ElementRef, viewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService, ChatMessage } from '../../core/services/chat.service';
import { WatchlistService } from '../../core/services/watchlist.service';

interface UIMessage { role: 'user' | 'ai'; text: string; time: string; streaming?: boolean; }

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements AfterViewChecked {
  private chatSvc = inject(ChatService);
  private wl      = inject(WatchlistService);

  messages  = signal<UIMessage[]>([]);
  history   = signal<ChatMessage[]>([]);
  question  = '';
  streaming = signal(false);
  messagesEl = viewChild<ElementRef<HTMLDivElement>>('msgs');

  private shouldScroll = false;

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      const el = this.messagesEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  get time() { return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }

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

    this.messages.update(m => { aiIdx = m.length; return [...m, { role: 'ai', text: '', time: this.time, streaming: true }]; });

    this.chatSvc.stream(q, symbols, this.history()).subscribe({
      next: evt => {
        if (evt.type === 'delta') {
          aiText += evt.text;
          this.messages.update(m => m.map((msg, i) => i === aiIdx ? { ...msg, text: aiText } : msg));
          this.shouldScroll = true;
        } else if (evt.type === 'done') {
          this.messages.update(m => m.map((msg, i) => i === aiIdx ? { ...msg, streaming: false } : msg));
          this.history.update(h => [...h, { role: 'assistant', content: aiText }]);
          this.streaming.set(false);
        } else if (evt.type === 'error') {
          this.messages.update(m => m.map((msg, i) => i === aiIdx ? { ...msg, text: '⚠️ ' + evt.message, streaming: false } : msg));
          this.streaming.set(false);
        }
      },
      error: err => {
        const msg = err.status === 503 ? '🔑 AI key not configured. Add GROQ_API_KEY to your server environment.' : '⚠️ Could not reach backend.';
        this.messages.update(m => m.map((msg2, i) => i === aiIdx ? { ...msg2, text: msg, streaming: false } : msg2));
        this.streaming.set(false);
      }
    });
  }

  onKey(e: KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } }

  quickAsk(q: string) { this.question = q; this.send(); }

  clear() { this.messages.set([]); this.history.set([]); }
}
