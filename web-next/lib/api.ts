// Gọi API của server Node (cùng origin, cùng cổng 7799).
// Token: lấy từ ?t=... trên URL rồi lưu localStorage — giống hệt bản legacy để
// người dùng không phải nhập lại khi đổi giao diện.

let token = '';

/* Nạp token từ ?t= vào localStorage. Gọi TRONG LÚC RENDER (useState initializer) để
   useStream có token ngay ở lần render đầu — trước đây gọi trong useEffect nên
   EventSource mở /stream KHÔNG có token và trả 401.
   KHÔNG đụng vào URL ở đây: history.replaceState là side effect, chạy lúc render thì
   Next.js hydrate xong ghi đè lại, URL vẫn còn ?t=. Việc dọn URL để donDepUrl() lo. */
export function initToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromUrl = new URL(location.href).searchParams.get('t');
    if (fromUrl) localStorage.setItem('dashToken', fromUrl);
    token = localStorage.getItem('dashToken') || '';
  } catch {}
  return token;
}

/* Xoá ?t= khỏi thanh địa chỉ — token không nên nằm trong lịch sử duyệt hay bị chia
   sẻ nhầm khi copy link. Phải gọi trong useEffect (sau hydrate), không phải lúc render. */
export function donDepUrl() {
  if (typeof window === 'undefined') return;
  try {
    const u = new URL(location.href);
    if (!u.searchParams.get('t')) return;
    u.searchParams.delete('t');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch {}
}

export function getToken() {
  if (!token && typeof window !== 'undefined') token = localStorage.getItem('dashToken') || '';
  return token;
}

export function setToken(t: string) {
  token = t;
  try { localStorage.setItem('dashToken', t); } catch {}
}

/* Header token cho những chỗ phải gọi fetch() THẲNG thay vì qua api() — ví dụ màn
   nhập mã khoá, nơi api() ném lỗi ở 401/429 nên không xử lý được "mã sai".
   Quên gắn nó thì cổng token chặn trước cổng mã khoá: /api/passcode/verify trả 401
   và không bao giờ mở khoá được. Không lộ ở localhost vì loopback được miễn token. */
export function dauToken(): Record<string, string> {
  const t = getToken();
  return t ? { 'X-Dash-Token': t } : {};
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

/* URL ảnh cho <img src>. Cùng hạn chế với EventSource: thẻ <img> KHÔNG gửi được
   header X-Dash-Token, nên token phải đi qua query string.
   Đã đo từ máy khác: /api/toolimg không kèm token -> HTTP 401, ảnh vỡ hết; thêm ?t=
   -> 200 image/png. Không lộ ở localhost vì loopback được server miễn token — đúng
   loại lỗi chỉ hiện khi vào từ iPhone. */
export function imgUrl(duong: string) {
  const t = getToken();
  return duong + (t ? (duong.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(t) : '');
}
