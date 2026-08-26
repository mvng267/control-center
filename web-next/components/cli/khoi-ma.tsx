'use client';

import { useMemo } from 'react';
import { toMau, ngonNgu, LOP } from '@/lib/to-mau';

/* Khối mã có tô màu. Dùng chung cho panel xem file và khối code trong khung chat —
   trước đây hai nơi tự dựng <pre> riêng, nên sửa màu một chỗ thì chỗ kia vẫn trắng. */

export function KhoiMa({
  ma, duong, lang, soDong, className,
}: {
  ma: string;
  /** đường dẫn file — dùng để đoán ngôn ngữ theo đuôi */
  duong?: string;
  /** ngôn ngữ khai tường minh (khối ```ts trong markdown), thắng `duong` */
  lang?: string;
  /** hiện cột số dòng bên trái */
  soDong?: boolean;
  className?: string;
}) {
  const nn = lang ? chuanHoa(lang) : ngonNgu(duong || '');

  /* useMemo BẮT BUỘC: quét lại toàn file mỗi lần render là chuyện thật sẽ xảy ra —
     panel xem file nằm trong cây có SSE nhịp 2 giây, không memo thì cứ 2 giây quét lại
     một file vài nghìn dòng. */
  const tokens = useMemo(() => toMau(ma, nn), [ma, nn]);
  const dong = useMemo(() => (soDong ? ma.split('\n') : []), [ma, soDong]);

  const noiDung = (
    <>
      {tokens.map((t, i) => (
        t.t === 'thuong'
          ? t.s
          : <span key={i} className={LOP[t.t]}>{t.s}</span>
      ))}
    </>
  );

  if (!soDong) {
    return (
      <pre className={className} data-testid="file-content" data-lang={nn || 'thuong'}>
        {noiDung}
      </pre>
    );
  }

  return (
    /* Số dòng ở CỘT RIÊNG có nền và viền: để chung một chuỗi với nội dung thì cuộn
       ngang làm số dòng trôi mất khỏi màn hình. `sticky left-0` giữ nó lại. */
    <div className="flex font-mono text-[12px] leading-[1.55]">
      <div className="sticky left-0 z-10 shrink-0 select-none border-r border-border bg-muted/40 px-2 py-2 text-right text-muted-foreground">
        {dong.map((_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-3 py-2"
        data-testid="file-content" data-lang={nn || 'thuong'}>
        {noiDung}
      </pre>
    </div>
  );
}

/** Tên ngôn ngữ trong khối ```… của markdown -> họ ngôn ngữ của to-mau.ts */
function chuanHoa(l: string): string {
  const d = l.toLowerCase().trim();
  const bang: Record<string, string> = {
    javascript: 'js', typescript: 'js', jsx: 'js', tsx: 'js', ts: 'js', js: 'js',
    node: 'js', python: 'py', py: 'py', bash: 'sh', shell: 'sh', sh: 'sh', zsh: 'sh',
    console: 'sh', json: 'json', css: 'css', scss: 'css', html: 'html', xml: 'html',
    svg: 'html', vue: 'html', yaml: 'yaml', yml: 'yaml', go: 'go', rust: 'go',
    rs: 'go', java: 'go', c: 'go', cpp: 'go',
  };
  return bang[d] || '';
}
