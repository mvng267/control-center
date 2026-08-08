// Gọi API của server Node (cùng origin, cùng cổng 7799).
// Token: lấy từ ?t=... trên URL rồi lưu localStorage — giống hệt bản legacy để
// người dùng không phải nhập lại khi đổi giao diện.

let token = '';

export function initToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    const u = new URL(location.href);
    const fromUrl = u.searchParams.get('t');
    if (fromUrl) {
      localStorage.setItem('dashToken', fromUrl);
      u.searchParams.delete('t'); // dọn URL cho khỏi lộ token trong lịch sử/chia sẻ
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
    token = localStorage.getItem('dashToken') || '';
  } catch {}
  return token;
}

export function getToken() {
  if (!token && typeof window !== 'undefined') token = localStorage.getItem('dashToken') || '';
  return token;
}

export function setToken(t: string) {
  token = t;
  try { localStorage.setItem('dashToken', t); } catch {}
}

export class UnauthorizedError extends Error {}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  const t = getToken();
  if (t) headers['X-Dash-Token'] = t;
  if (init?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError('cần token truy cập');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// SSE: EventSource KHÔNG gửi được custom header -> token phải đi qua query string
export function streamUrl() {
  const t = getToken();
  return '/stream' + (t ? '?t=' + encodeURIComponent(t) : '');
}
