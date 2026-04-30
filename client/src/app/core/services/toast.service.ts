import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);
  private _next = 0;

  show(message: string, type: Toast['type'] = 'info', detail?: string, durationMs = 5000) {
    const id = ++this._next;
    this.toasts.update(t => [...t, { id, message, type, detail }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  dismiss(id: number) {
    this.toasts.update(t => t.filter(x => x.id !== id));
  }
}
