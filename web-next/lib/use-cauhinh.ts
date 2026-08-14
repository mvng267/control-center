'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

/* Cấu hình chung: tên hiển thị + tab nào bật.

   Dữ liệu TĨNH nên KHÔNG đi qua /stream (SSE đẩy snapshot mỗi 2 giây, đã đo 84KB/nhịp).
   Gọi một lần rồi giữ trong module — ba nơi cần tên người dùng (chân sidebar, mỗi lượt
   chat, mỗi thẻ phiên) mà mỗi nơi tự gọi thì thành ba request cho cùng một câu trả lời,
   và tệ hơn là ba lần render lệch nhau trong lúc chờ. */

export interface CauHinh {
  ok: boolean;
  nguoiDung: string;
  tabCo: Record<string, boolean>;
  tabBat: Record<string, boolean>;
}

/* Trước khi server trả lời, dùng chuỗi trung tính. KHÔNG để rỗng: nhãn "❯ " cụt trong
   khung chat trông như lỗi hiển thị, mà nhịp chờ này xảy ra mỗi lần mở app. */
const MAC_DINH: CauHinh = {
  ok: false,
  nguoiDung: 'Bạn',
  tabCo: { cli: true, hermes: true, agy: true, docker: true, stats: true },
  tabBat: { hermes: true, agy: true, docker: true, stats: true },
};

let cache: CauHinh | null = null;
let dangTai: Promise<CauHinh> | null = null;
const nghe = new Set<(c: CauHinh) => void>();

function bao(c: CauHinh) {
  cache = c;
  for (const f of nghe) f(c);
}

function tai(): Promise<CauHinh> {
  if (dangTai) return dangTai;
  dangTai = api<CauHinh>('/api/cauhinh')
    .then((c) => { bao(c); return c; })
    .catch(() => MAC_DINH)
    .finally(() => { dangTai = null; });
  return dangTai;
}

export function useCauHinh(): CauHinh {
  const [c, setC] = useState<CauHinh>(cache || MAC_DINH);
  useEffect(() => {
    nghe.add(setC);
    if (cache) setC(cache); else tai();
    return () => { nghe.delete(setC); };
  }, []);
  return c;
}

/* Lưu lựa chọn tab rồi báo cho MỌI nơi đang nghe — không cần tải lại trang.

   Đổi giao diện NGAY, đừng chờ server trả lời: bấm công tắc mà ô vuông đứng im cho
   tới khi mạng về thì người dùng tưởng bấm trượt và bấm lại. Qua Tailscale độ trễ đó
   thấy rõ. Hỏng thì trả về đúng trạng thái cũ và báo lỗi — sai một nhịp còn hơn đơ. */
export async function luuTabBat(tabBat: Record<string, boolean>) {
  const truoc = cache || MAC_DINH;
  bao({ ...truoc, tabBat });
  try {
    const r = await api<{ ok: boolean; tabBat: Record<string, boolean> }>('/api/cauhinh', {
      method: 'POST', body: JSON.stringify({ tabBat }),
    });
    if (r.ok) bao({ ...truoc, ok: true, tabBat: r.tabBat });
    else bao(truoc);
    return r;
  } catch (e) {
    bao(truoc);
    throw e;
  }
}

/** Chữ cái cho avatar tròn. */
export function chuDau(ten: string) {
  return (ten || '?').trim().charAt(0).toUpperCase();
}
