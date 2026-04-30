import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { AuthService } from './auth.service';
import { catchError, of, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private api  = inject(ApiService);
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  supported  = signal(false);
  subscribed = signal(false);
  status     = signal<'idle' | 'requesting' | 'granted' | 'denied'>('idle');

  constructor() {
    this.supported.set('serviceWorker' in navigator && 'PushManager' in window);
    this._checkCurrentStatus();
  }

  private _checkCurrentStatus() {
    if (!this.supported()) return;
    if (Notification.permission === 'granted') this.status.set('granted');
    if (Notification.permission === 'denied')  this.status.set('denied');
    // Check if already subscribed
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => this.subscribed.set(!!sub))
    ).catch(() => {});
  }

  /** Call after login — registers SW, asks permission, sends subscription to server */
  async enableAfterLogin(): Promise<void> {
    if (!this.supported() || !this.auth.token()) return;
    if (this.status() === 'denied') return;

    // Fetch VAPID public key
    let vapidKey: string;
    try {
      const r = await this.api.getRaw<{ ok: boolean; public_key: string }>('/push/vapid-key').toPromise();
      if (!r?.ok || !r.public_key) return;
      vapidKey = r.public_key;
    } catch { return; }

    // Register service worker
    let reg: ServiceWorkerRegistration;
    try {
      reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    } catch { return; }

    // Request permission (only shows prompt if 'default')
    if (Notification.permission === 'default') {
      this.status.set('requesting');
      const perm = await Notification.requestPermission();
      this.status.set(perm === 'granted' ? 'granted' : 'denied');
      if (perm !== 'granted') return;
    }

    // Already denied — bail
    if (Notification.permission !== 'granted') {
      this.status.set('denied');
      return;
    }

    // Subscribe
    try {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: this._urlBase64ToUint8Array(vapidKey),
      });
      this.subscribed.set(true);
      await this._saveSubscription(sub);
    } catch (e) {
      console.warn('Push subscribe failed:', e);
    }
  }

  async disable(): Promise<void> {
    if (!this.supported()) return;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    this.subscribed.set(false);
    this.api.post('/push/unsubscribe', { endpoint }).pipe(catchError(() => of(null))).subscribe();
  }

  private async _saveSubscription(sub: PushSubscription) {
    const token = this.auth.token();
    if (!token) return;
    const body = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: this._arrayBufferToBase64(sub.getKey('p256dh')!),
        auth:   this._arrayBufferToBase64(sub.getKey('auth')!),
      }
    };
    this.api.post('/push/subscribe', body).pipe(catchError(() => of(null))).subscribe();
  }

  private _urlBase64ToUint8Array(base64: string): ArrayBuffer {
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const raw    = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const arr    = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr.buffer;
  }

  private _arrayBufferToBase64(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
