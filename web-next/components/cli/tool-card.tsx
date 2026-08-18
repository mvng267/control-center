'use client';

import { useEffect, useState } from 'react';
import {
  ChevronDown, X, Copy, Circle, CornerDownRight, Square, SquareCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { imgUrl } from '@/lib/api';

/* Thẻ tool vẽ ĐÚNG như Claude CLI in ra terminal:

     ⏺ Bash(npm test)
       ⎿  5 tests passed
          … +12 dòng

   Không khung bo tròn, không nền, không icon riêng cho từng loại tool — terminal
   chỉ có một dấu chấm ⏺ và một dấu ngoặc ⎿. Trước đây mỗi tool là một thẻ có viền,
   nền và icon, xếp chồng nhau nhìn ra bảng log của một app quản trị chứ không phải
   bản chép lại phiên terminal. */

export interface ToolPart {
  t: 'tool';
  id: string;
  name: string;
  disp: string;
  summary: string;
  input: string;
  status: 'ok' | 'error' | 'running' | 'pending';
  result: string;
  images: { i: number; mt: string; bytes: number }[];
  // Server gửi {text, status} (extractTodos ở src/server/tools.js) — trước đây khai
  // là `content` nên checklist hiện ra TRỐNG TRƠN, chỉ thấy dấu ○ không có chữ.
  todos?: { text: string; status: string }[];
  // AskUserQuestion / ExitPlanMode — client vẽ thẻ riêng thay vì đổ JSON thô
  hoi?: { hoi: string; nhan: string; nhieu: boolean; chon: { nhan: string; mo: string }[] }[];
  ke?: string;
  /** đường dẫn bản .md của kế hoạch, lấy từ planFilePath của chính tool */
  keFile?: string;
}

/* Màu của dấu ⏺. Terminal dùng trắng cho bình thường, đỏ khi lỗi. Giữ một chút màu
   cho dòng tool để mắt tách được khỏi câu văn, nhưng không tô nền. */
const CHAM = {
  ok: 'text-tool-accent',
  error: 'text-status-error',
  running: 'text-status-run animate-pulse',
  pending: 'text-muted-foreground/50',
} as const;

/* Lỗi CHẶN QUYỀN của Claude CLI, dịch sang tiếng Việt kèm cách xử lý.

   Vì sao đáng dịch riêng: dashboard chạy `claude -p` với `stdio: ignore` nên KHÔNG có
   kênh để Claude hỏi quyền — lệnh cần duyệt thì chết ngay với một câu tiếng Anh trần.
   "Contains command_substitution" đọc lên không ai đoán được phải làm gì, mà đó lại là
   thứ hay gặp nhất: mọi lệnh có `$(...)` hay backtick đều dính.

   Không dịch máy móc cả câu — chỉ nhận đúng mấy mẫu CLI thật sự in ra, còn lại giữ
   nguyên văn. Đoán sai nghĩa một thông báo về quyền còn tệ hơn để nguyên tiếng Anh. */
function loiQuyen(s: string): string {
  const t = s.trim();
  if (/^Contains command_substitution/i.test(t)) {
    return 'Lệnh có $(…) hoặc dấu backtick — cần bạn duyệt. Dashboard không hỏi quyền được, chạy tay hoặc đổi chế độ quyền sang "Tự sửa file".';
  }
  if (/requires approval/i.test(t)) {
    return 'Lệnh này cần bạn duyệt. Dashboard không hỏi quyền được — chạy tay trên máy, hoặc đổi chế độ quyền ở cuối khung chat.';
  }
  if (/have permission to use|not allowed/i.test(t)) {
    return 'Lệnh không nằm trong danh sách cho phép. Thêm vào `.claude/settings.local.json` hoặc chạy tay.';
  }
  return '';
}

/** Dòng tóm tắt kết quả cho phần ⎿ — vài dòng đầu, phần còn lại đếm ra số. */
function tomTat(part: ToolPart): { dong: string[]; con: number } {
  if (part.status === 'running') return { dong: ['đang chạy…'], con: 0 };
  const dich = loiQuyen(String(part.result || ''));
  if (dich) return { dong: [dich], con: 0 };
  const raw = String(part.result || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!raw.length) {
    if (part.status === 'pending') return { dong: ['(bị ngắt, không có kết quả)'], con: 0 };
    return { dong: ['(trống)'], con: 0 };
  }
  return { dong: raw.slice(0, 2), con: Math.max(0, raw.length - 2) };
}

function KhoiChu({ nhan, text, error, lang }: { nhan: string; text: string; error?: boolean; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1">
      <div className={cn('mb-1 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide',
        error ? 'text-status-error' : 'text-muted-foreground/70')}>
        {nhan}
        {lang && <span className="text-muted-foreground/50">{lang}</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }).catch(() => {});
          }}
          className="ml-auto flex items-center gap-1 text-[12px] font-normal text-muted-foreground/60 hover:text-foreground">
          <Copy className="size-3" />{copied ? 'đã chép' : 'chép'}
        </button>
      </div>
      {/* Viền trái mảnh thay cho khung bo tròn — giống cách terminal thụt khối chữ */}
      <pre className={cn(
        'max-h-[220px] overflow-auto whitespace-pre border-l pl-3 text-[12px] leading-relaxed md:max-h-[300px]',
        error ? 'border-status-error/40 text-status-error/90' : 'border-border text-muted-foreground',
      )}>
        {text}
      </pre>
    </div>
  );
}

// Edit hiện dạng diff: dòng thêm xanh, dòng bớt đỏ
function KhoiDiff({ text }: { text: string }) {
  const lines = text.split('\n');
  let mode: 'del' | 'add' | '' = '';
  return (
    <div className="mt-1">
      <div className="mb-1 text-[12px] font-semibold tracking-wide text-muted-foreground/70">THAY ĐỔI</div>
      <pre className="max-h-[220px] overflow-auto border-l border-border text-[12px] leading-relaxed md:max-h-[300px]">
        {/* w-max min-w-full: mỗi dòng rộng bằng NỘI DUNG nhưng tối thiểu bằng khung.
            Thiếu nó thì dòng chỉ rộng bằng khung, nên khi cuộn ngang sang phải nền màu
            hết ngay ở mép — dòng thêm/bớt mất màu đúng lúc đang đọc phần dài. */}
        {lines.map((l, i) => {
          if (l === '--- old') { mode = 'del'; return <div key={i} className="w-max min-w-full px-3 text-[12px] font-semibold text-status-error">Trước</div>; }
          if (l === '+++ new') { mode = 'add'; return <div key={i} className="w-max min-w-full px-3 text-[12px] font-semibold text-status-ok">Sau</div>; }
          return (
            <div key={i} className={cn('w-max min-w-full whitespace-pre px-3',
              mode === 'del' && 'bg-status-error/12 text-status-error',
              mode === 'add' && 'bg-status-ok/12 text-status-ok')}>
              {l}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/* Nhãn ngôn ngữ theo đuôi file — port EXT_LANG/langOf (web/legacy/js/chat.js:117-128). */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css',
  scss: 'scss', sql: 'sql', md: 'markdown', txt: '', log: '',
};
function langOf(summary: string) {
  const f = String(summary || '').split(' ')[0].split(':')[0];
  const ext = f.indexOf('.') > 0 ? (f.split('.').pop() || '').toLowerCase() : '';
  return EXT_LANG[ext] || '';
}

/* Ảnh trong kết quả tool — mở overlay trong app, không bung ra trình duyệt ngoài. */
function ToolImage({ src, n, onZoom }: { src: string; n: number; onZoom: (s: string) => void }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-status-error">
        <X className="size-3.5" /> Không tải được ảnh {n}
      </div>
    );
  }
  return (
    <img data-testid="tool-image" src={src} alt={`ảnh kết quả ${n}`} loading="lazy"
      onError={() => setBad(true)}
      onClick={(e) => { e.stopPropagation(); onZoom(src); }}
      className="max-h-[260px] max-w-full cursor-zoom-in rounded border border-border object-contain" />
  );
}

// Overlay xem ảnh toàn màn — Esc hoặc chạm nền để đóng
export function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div data-testid="image-zoom" onClick={onClose}
      className="fixed inset-0 z-[140] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
      <img src={src} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
      <button onClick={onClose} title="Đóng"
        className="absolute right-4 top-4 rounded-full border border-border bg-card p-2">
        <X className="size-4" />
      </button>
    </div>
  );
}

/* Trạng thái mở/đóng do CHA giữ, khoá theo tool_use_id.
   Trước đây để useState ở đây: cứ 700ms poll một lần là React dựng lại cây, state cục
   bộ mất theo -> đang đọc kết quả lệnh thì thẻ TỰ ĐÓNG sau ~3 giây. */
export function ToolCard({ part, sid, open, onToggle }: {
  part: ToolPart; sid: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const isDiff = part.name === 'Edit' && part.input.startsWith('--- old');
  const isErr = part.status === 'error';
  const tt = tomTat(part);
  // lỗi quyền hiện chữ thường xuống dòng, không phải mã nên không cắt cụt
  const laLoiQuyen = !!loiQuyen(String(part.result || ''));
  const soTodo = part.todos?.length || 0;
  const xong = part.todos?.filter((t) => t.status === 'completed').length || 0;

  return (
    <div data-testid="tool-card" data-status={part.status} data-tid={part.id} data-open={open}
      className="w-full text-[14px] leading-relaxed">
      <button data-testid="tool-card-head"
        onClick={() => { onToggle(part.id); navigator.vibrate?.(10); }}
        aria-expanded={open}
        className="tap44 flex w-full items-start gap-2 text-left transition-colors md:hover:bg-accent/25">
        {/* Icon vector thay ký tự `⏺`. Ký tự vẽ hộp phụ thuộc font hệ thống nên trên
            iPhone nó mảnh và mờ; icon nét đậm rõ ở mọi cỡ chữ. Giữ nguyên testid và
            bảng màu CHAM — màu vẫn là thứ phân biệt tool đang chạy / xong / lỗi. */}
        <span className={cn('mt-[3px] shrink-0 select-none', CHAM[part.status] || CHAM.pending)}
          data-testid="tool-card-status">
          <Circle className="size-2.5 fill-current" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-mono font-medium">{part.disp || part.name}</span>
          {part.summary && (
            <span className="text-muted-foreground">({part.summary})</span>
          )}
        </span>
        <ChevronDown className={cn('mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-transform',
          open && 'rotate-180')} />
      </button>

      {/* Dòng ⎿ — luôn hiện, đúng như terminal: thấy ngay kết quả mà không phải bấm.
          Thụt vào cho ⎿ nằm DƯỚI CHỮ ĐẦU của tên tool, đúng như Claude CLI in ra.
          `pl-[3px]` cũ gần như không thụt nên ⎿ dính sát lề trái, ngang hàng với ⏺
          của lượt — nhìn ra hai thứ cùng cấp trong khi kết quả là con của tool. */}
      <div className="flex gap-2 pl-[18px]" data-testid="tool-ket-qua">
        <span className="mt-[3px] shrink-0 select-none text-muted-foreground/40">
          <CornerDownRight className="size-3" />
        </span>
        <div className={cn('min-w-0 flex-1 font-mono', isErr ? 'text-status-error/90' : 'text-muted-foreground')}>
          {soTodo ? (
            <span className="tabular-nums">{xong}/{soTodo} việc</span>
          ) : (
            <>
              {/* Lỗi quyền được XUỐNG DÒNG, không `truncate`: câu hướng dẫn dài hơn
                  một dòng, cắt cụt thì mất đúng phần nói phải làm gì. Kết quả thường
                  vẫn `truncate` — nó là dữ liệu, xem đủ thì bấm mở thẻ. */}
              {tt.dong.map((l, i) => (
                <div key={i} className={laLoiQuyen ? 'whitespace-pre-wrap break-words font-sans leading-relaxed' : 'truncate'}>
                  {l}
                </div>
              ))}
              {/* "… +12 dòng" MỞ ĐƯỢC (bấm đầu thẻ) nhưng trông như chữ chết nên
                  không ai bấm. Nói thẳng ra phải làm gì. */}
              {tt.con > 0 && (
                <div className="text-muted-foreground/60">
                  … +{tt.con} dòng{open ? '' : ' — bấm để xem'}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* min-w-0: thiếu nó thì khối này nở theo NỘI DUNG của <pre> bên trong (mặc định
          flex/grid item là min-width:auto), nên dòng kết quả dài đẩy cả thẻ rộng ra và
          làm khung chat cuộn ngang thay vì chỉ <pre> cuộn. Rõ nhất ở 390px. */}
      {open && (
        <div className="min-w-0 pl-[18px]">
          {soTodo ? (
            <div className="mt-1 flex flex-col gap-0.5">
              {part.todos!.map((t, i) => (
                <div key={i} className="flex items-start gap-2">
                  {/* Ô việc: icon vector thay `☒`/`☐`. Hai ký tự đó là thứ Claude CLI
                      in ra trên terminal, nhưng trên iPhone chúng nhỏ và nhoè. */}
                  <span className={cn('mt-[3px] shrink-0 select-none',
                    t.status === 'completed' ? 'text-status-ok'
                      : t.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground/60')}>
                    {t.status === 'completed'
                      ? <SquareCheck className="size-3.5" />
                      : <Square className="size-3.5" />}
                  </span>
                  <span className={cn(
                    t.status === 'completed' && 'text-muted-foreground line-through',
                    t.status === 'in_progress' && 'text-foreground',
                    t.status !== 'completed' && t.status !== 'in_progress' && 'text-muted-foreground')}>
                    {t.text}
                  </span>
                </div>
              ))}
            </div>
          ) : part.input ? (
            isDiff ? <KhoiDiff text={part.input} />
              : <KhoiChu nhan="INPUT" text={part.input} lang={langOf(part.summary)} />
          ) : null}

          {/* Khối kết quả đầy đủ. BỎ QUA khi dòng ⎿ đã nói hết: kết quả một dòng thì
              mở thẻ ra chỉ thấy đúng câu vừa đọc, in hai lần liền nhau — Vinh bắt được
              đúng chỗ này với "This command requires approval" hiện hai lần. */}
          {!soTodo && (part.result || part.status === 'ok' || isErr)
            && !(tt.con === 0 && tt.dong.length === 1 && String(part.result || '').trim() === tt.dong[0]) && (
            <KhoiChu nhan={isErr ? 'LỖI' : 'KẾT QUẢ'} text={part.result || '(trống)'} error={isErr} />
          )}
          {/* Lỗi quyền: dòng ⎿ đã hiện bản dịch, khối này hiện NGUYÊN VĂN của CLI —
              cần khi phải tra cứu hoặc báo lỗi, mà bản dịch thì không tra được. */}
          {!soTodo && isErr && !!loiQuyen(String(part.result || '')) && (
            <KhoiChu nhan="NGUYÊN VĂN" text={String(part.result)} error />
          )}

          {part.images?.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {part.images.map((_, idx) => (
                <ToolImage key={idx} src={imgUrl(`/api/toolimg/${sid}/${part.id}/${idx}`)} n={idx + 1}
                  onZoom={setZoom} />
              ))}
            </div>
          )}
        </div>
      )}

      {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
