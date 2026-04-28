import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  readonly base = environment.apiUrl;

  private headers(): HttpHeaders {
    const token = this.auth.token();
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  get<T>(path: string): Observable<T | null> {
    return this.http
      .get<{ ok: boolean; data: T; [k: string]: unknown }>(`${this.base}${path}`, { headers: this.headers() })
      .pipe(
        map(r => (r.ok ? (r.data as T) : null)),
        catchError(() => of(null))
      );
  }

  getRaw<T>(path: string): Observable<T | null> {
    return this.http
      .get<T>(`${this.base}${path}`, { headers: this.headers() })
      .pipe(catchError(() => of(null)));
  }

  post<T>(path: string, body: unknown): Observable<T | null> {
    return this.http
      .post<T>(`${this.base}${path}`, body, { headers: this.headers().set('Content-Type', 'application/json') })
      .pipe(catchError(() => of(null)));
  }

  delete<T>(path: string): Observable<T | null> {
    return this.http
      .delete<T>(`${this.base}${path}`, { headers: this.headers() })
      .pipe(catchError(() => of(null)));
  }
}
