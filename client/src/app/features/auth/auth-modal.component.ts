import { Component, inject, signal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal-box" (click)="$event.stopPropagation()">
        <button class="modal-close" (click)="close.emit()">✕</button>
        <div class="modal-logo">📈</div>
        <h2 class="modal-title">{{mode() === 'login' ? 'Welcome back' : 'Create account'}}</h2>

        @if (error()) {
          <div class="form-error">{{error()}}</div>
        }

        <form (ngSubmit)="submit()">
          @if (mode() === 'register') {
            <div class="form-group">
              <label>Name</label>
              <input type="text" [(ngModel)]="name" name="name" placeholder="Your name" autocomplete="name">
            </div>
          }
          <div class="form-group">
            <label>Email</label>
            <input type="email" [(ngModel)]="email" name="email" placeholder="you@example.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" [(ngModel)]="password" name="password" placeholder="••••••••" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn-primary" [disabled]="loading()">
            {{loading() ? 'Please wait…' : (mode() === 'login' ? 'Sign in' : 'Create account')}}
          </button>
        </form>

        <div class="modal-switch">
          {{mode() === 'login' ? "Don't have an account?" : 'Already have one?'}}
          <button (click)="toggleMode()">{{mode() === 'login' ? 'Sign up' : 'Sign in'}}</button>
        </div>
      </div>
    </div>
  `,
  styleUrl: './auth-modal.component.scss'
})
export class AuthModalComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);

  close   = output<void>();
  success = output<void>();

  mode    = signal<'login' | 'register'>('login');
  loading = signal(false);
  error   = signal('');

  email = ''; password = ''; name = '';

  toggleMode() { this.mode.update(m => m === 'login' ? 'register' : 'login'); this.error.set(''); }

  async submit() {
    if (!this.email || !this.password) { this.error.set('Email and password required'); return; }
    this.loading.set(true); this.error.set('');
    const path = this.mode() === 'login' ? '/auth/login' : '/auth/register';
    const body: Record<string, string> = { email: this.email, password: this.password };
    if (this.mode() === 'register') body['name'] = this.name;

    this.api.post<{ ok: boolean; token: string; user: { id: number; email: string; name: string }; error?: string }>(path, body)
      .subscribe(r => {
        this.loading.set(false);
        if (!r || !r.ok) { this.error.set((r as any)?.error || 'Request failed'); return; }
        this.auth.setSession(r.token, r.user);
        this.success.emit();
        this.close.emit();
      });
  }
}
