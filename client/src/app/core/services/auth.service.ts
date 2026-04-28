import { Injectable, signal, computed } from '@angular/core';

export interface AuthUser { id: number; email: string; name: string; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _token = signal<string>(localStorage.getItem('sp3_token') || '');
  private _user   = signal<AuthUser | null>(null);

  readonly token   = this._token.asReadonly();
  readonly user    = this._user.asReadonly();
  readonly isLoggedIn = computed(() => !!this._token());

  setSession(token: string, user: AuthUser) {
    this._token.set(token);
    this._user.set(user);
    localStorage.setItem('sp3_token', token);
  }

  setUser(user: AuthUser) { this._user.set(user); }

  logout() {
    this._token.set('');
    this._user.set(null);
    localStorage.removeItem('sp3_token');
  }
}
