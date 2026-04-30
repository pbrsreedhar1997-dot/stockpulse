import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-stack">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast-' + t.type" (click)="toast.dismiss(t.id)">
          <span class="toast-icon">{{ icons[t.type] }}</span>
          <div class="toast-body">
            <div class="toast-msg">{{ t.message }}</div>
            @if (t.detail) { <div class="toast-detail">{{ t.detail }}</div> }
          </div>
          <button class="toast-close">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-stack {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px; max-width: 340px;
    }
    .toast {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 12px 14px; border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,.35);
      cursor: pointer; animation: slide-in .2s ease;
      border: 1px solid rgba(255,255,255,.08);
    }
    @keyframes slide-in { from { transform: translateX(30px); opacity: 0; } }
    .toast-success { background: #0f2a1e; border-color: #00d4aa44; }
    .toast-warning { background: #2a1f0a; border-color: #f59e0b44; }
    .toast-error   { background: #2a0f0f; border-color: #ef444444; }
    .toast-info    { background: #0f1a2a; border-color: #3b82f644; }
    .toast-icon    { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .toast-body    { flex: 1; }
    .toast-msg     { font-size: 13px; font-weight: 600; color: #f1f5f9; }
    .toast-detail  { font-size: 11px; color: #94a3b8; margin-top: 2px; }
    .toast-close   { background: none; border: none; color: #64748b; cursor: pointer; font-size: 11px; padding: 0; flex-shrink: 0; }
  `]
})
export class ToastComponent {
  toast = inject(ToastService);
  icons: Record<string, string> = { success: '✅', warning: '🔔', error: '⚠️', info: 'ℹ️' };
}
