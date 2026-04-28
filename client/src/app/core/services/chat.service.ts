import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import { Observable } from 'rxjs';

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class ChatService {
  private auth = inject(AuthService);

  stream(question: string, symbols: string[], history: ChatMessage[]): Observable<ChatEvent> {
    return new Observable(observer => {
      const token = this.auth.token();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      fetch(`${environment.apiUrl}/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question, symbols, chat_history: history }),
      }).then(async resp => {
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          observer.error({ status: resp.status, message: err.error || 'Server error' });
          return;
        }
        const reader = resp.body!.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = dec.decode(value, { stream: true }).split('\n');
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const raw = line.slice(5).trim();
            if (!raw) continue;
            try {
              const evt: ChatEvent = JSON.parse(raw);
              observer.next(evt);
              if (evt.type === 'done' || evt.type === 'error') { observer.complete(); return; }
            } catch { /* skip */ }
          }
        }
        observer.complete();
      }).catch(err => observer.error(err));
    });
  }
}
