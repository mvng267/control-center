/* Tô màu cú pháp — TỰ VIẾT, không thêm package.

   Vì sao không dùng thư viện: `highlight.js` bản core + vài ngôn ngữ đã ~1 MB, `shiki`
   còn nặng hơn (nó nhúng cả grammar TextMate). Mở app hiện tại tốn 539 KB gzip cho
   TOÀN BỘ giao diện — thêm một thư viện to hơn cả app để tô màu vài file thì hỏng mất
   thứ đang có. recharts 1 MB đã phải chuyển sang nạp lười vì đúng lý do này.

   Đổi lại, bộ này chỉ hiểu 8 họ ngôn ngữ và không phân tích ngữ pháp thật. Đủ cho việc
   liếc code trên điện thoại, không phải để thay IDE.

   KHÔNG nhận diện regex literal của JS (`/abc/g`): phân biệt nó với phép chia cần biết
   ngữ cảnh trước đó, mà đoán sai thì cả phần còn lại của dòng bị nuốt thành một chuỗi.
   Để nguyên màu thường an toàn hơn nhiều so với tô sai. */

export type Loai =
  | 'chu-thich' | 'chuoi' | 'so' | 'tu-khoa'
  | 'ham' | 'kieu' | 'thuoc-tinh' | 'the' | 'thuong';

export type Token = { t: Loai; s: string };

type Luat = {
  t: Loai;
  re: RegExp;
  /** điều kiện thêm, xét ký tự đứng TRƯỚC vị trí khớp */
  khi?: (ma: string, i: number) => boolean;
};

/* Dùng cờ `y` (sticky) chứ không phải `g`: `y` chỉ khớp ĐÚNG tại `lastIndex`, nên
   không có chuyện luật nhảy cóc xuống dưới rồi nuốt mất đoạn ở giữa. */
const y = (nguon: string, them = '') => new RegExp(nguon, 'y' + them);

const TU_KHOA_JS = [
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'of', 'private',
  'protected', 'public', 'readonly', 'return', 'satisfies', 'set', 'static', 'super',
  'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'yield',
  'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
];

const TU_KHOA_PY = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
  'with', 'yield', 'True', 'False', 'None', 'self', 'cls',
];

const TU_KHOA_SH = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case',
  'esac', 'in', 'function', 'return', 'export', 'local', 'readonly', 'set', 'unset',
  'source', 'echo', 'cd', 'exit', 'break', 'continue', 'shift', 'trap',
];

const TU_KHOA_GO = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map',
  'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
  'nil', 'true', 'false',
];

const nhomTu = (ds: string[]) => y('(?:' + ds.join('|') + ')\\b');

/* Tên hàm = định danh đứng ngay trước `(`. Đặt SAU luật từ khoá trong danh sách, nếu
   không thì `if (`, `for (`, `while (` đều bị tô thành tên hàm. */
const HAM = y('[A-Za-z_$][\\w$]*(?=\\s*\\()');
/* Tên kiểu/lớp: viết hoa chữ đầu. Quy ước, không phải phân tích thật — `Math`, `JSON`
   cũng rơi vào đây, mà tô chúng như kiểu cũng không sai lệch gì khi đọc. */
const KIEU = y('[A-Z][A-Za-z0-9_$]*\\b');
const DINH_DANH = y('[A-Za-z_$][\\w$]*');
const SO = y('(?:0[xXbBoO][\\da-fA-F_]+|\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?)\\b');

/** đứng ngay sau dấu `.` -> thuộc tính, tô nhạt hơn định danh thường */
const sauCham = (ma: string, i: number) => i > 0 && ma[i - 1] === '.';

const CHUOI_JS = y(
  '"(?:[^"\\\\\\n]|\\\\.)*"' +
  "|'(?:[^'\\\\\\n]|\\\\.)*'" +
  '|`(?:[^`\\\\]|\\\\.)*`');

const LUAT: Record<string, Luat[]> = {
  js: [
    { t: 'chu-thich', re: y('//[^\\n]*|/\\*[\\s\\S]*?\\*/') },
    { t: 'chuoi', re: CHUOI_JS },
    { t: 'so', re: SO },
    { t: 'tu-khoa', re: nhomTu(TU_KHOA_JS) },
    { t: 'ham', re: HAM },
    { t: 'kieu', re: KIEU },
    { t: 'thuoc-tinh', re: DINH_DANH, khi: sauCham },
  ],
  py: [
    { t: 'chu-thich', re: y('#[^\\n]*') },
    // chuỗi ba nháy phải đứng TRƯỚC chuỗi một nháy, nếu không `"""` bị đọc thành `""` rỗng
    { t: 'chuoi', re: y('"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\'') },
    { t: 'so', re: SO },
    { t: 'tu-khoa', re: nhomTu(TU_KHOA_PY) },
    { t: 'ham', re: HAM },
    { t: 'kieu', re: KIEU },
    { t: 'thuoc-tinh', re: DINH_DANH, khi: sauCham },
  ],
  sh: [
    { t: 'chu-thich', re: y('#[^\\n]*') },
    { t: 'chuoi', re: y('"(?:[^"\\\\]|\\\\.)*"|\'[^\']*\'') },
    // $BIEN, ${BIEN}, $1 — tô như thuộc tính để tách khỏi chữ thường
    { t: 'thuoc-tinh', re: y('\\$\\{[^}]*\\}|\\$[A-Za-z_][\\w]*|\\$\\d') },
    { t: 'so', re: SO },
    { t: 'tu-khoa', re: nhomTu(TU_KHOA_SH) },
  ],
  json: [
    // khoá (chuỗi đứng trước dấu hai chấm) tô khác giá trị — đọc JSON lồng nhau dễ hơn hẳn
    { t: 'thuoc-tinh', re: y('"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)') },
    { t: 'chuoi', re: y('"(?:[^"\\\\]|\\\\.)*"') },
    { t: 'so', re: SO },
    { t: 'tu-khoa', re: y('(?:true|false|null)\\b') },
  ],
  css: [
    { t: 'chu-thich', re: y('/\\*[\\s\\S]*?\\*/') },
    { t: 'chuoi', re: y('"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'') },
    { t: 'the', re: y('@[A-Za-z-]+') },
    { t: 'thuoc-tinh', re: y('--[A-Za-z0-9-]+|[A-Za-z-]+(?=\\s*:)') },
    { t: 'so', re: y('#[0-9a-fA-F]{3,8}\\b|(?:\\d+(?:\\.\\d+)?)(?:px|rem|em|%|vh|vw|dvh|s|ms|fr|deg)?') },
    { t: 'ham', re: HAM },
  ],
  html: [
    { t: 'chu-thich', re: y('<!--[\\s\\S]*?-->') },
    { t: 'the', re: y('</?[A-Za-z][\\w:-]*|/?>') },
    { t: 'chuoi', re: y('"(?:[^"]*)"|\'(?:[^\']*)\'') },
    { t: 'thuoc-tinh', re: y('[A-Za-z-][\\w:-]*(?=\\s*=)') },
  ],
  yaml: [
    { t: 'chu-thich', re: y('#[^\\n]*') },
    { t: 'thuoc-tinh', re: y('[A-Za-z_][\\w.-]*(?=\\s*:)') },
    { t: 'chuoi', re: y('"(?:[^"\\\\]|\\\\.)*"|\'[^\']*\'') },
    { t: 'so', re: SO },
    { t: 'tu-khoa', re: y('(?:true|false|null|yes|no)\\b') },
  ],
  md: [
    // khối ``` phải đứng TRƯỚC mã inline `x`, nếu không ``` bị đọc thành `` rỗng + `
    { t: 'chuoi', re: y('```[\\s\\S]*?```|`[^`\\n]+`') },
    { t: 'tu-khoa', re: y('^#{1,6} [^\\n]*', 'm') },
    { t: 'the', re: y('^[ \\t]*(?:[-*+]|\\d+\\.) ', 'm') },
    { t: 'ham', re: y('\\[[^\\]\\n]*\\]\\([^)\\n]*\\)') },
    { t: 'kieu', re: y('\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__') },
    { t: 'chu-thich', re: y('^[ \\t]*> [^\\n]*', 'm') },
  ],
  go: [
    { t: 'chu-thich', re: y('//[^\\n]*|/\\*[\\s\\S]*?\\*/') },
    { t: 'chuoi', re: y('"(?:[^"\\\\\\n]|\\\\.)*"|`[^`]*`') },
    { t: 'so', re: SO },
    { t: 'tu-khoa', re: nhomTu(TU_KHOA_GO) },
    { t: 'ham', re: HAM },
    { t: 'kieu', re: KIEU },
    { t: 'thuoc-tinh', re: DINH_DANH, khi: sauCham },
  ],
};

/** Đuôi file -> họ ngôn ngữ. Đuôi lạ trả '' = không tô, hiện chữ thường. */
export function ngonNgu(duong: string): string {
  const d = (duong.split('.').pop() || '').toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts'].includes(d)) return 'js';
  if (['py', 'pyi'].includes(d)) return 'py';
  if (['sh', 'bash', 'zsh', 'fish'].includes(d)) return 'sh';
  if (d === 'json' || d === 'jsonl' || d === 'webmanifest') return 'json';
  if (['css', 'scss', 'less'].includes(d)) return 'css';
  if (['html', 'htm', 'xml', 'svg', 'vue'].includes(d)) return 'html';
  if (['yml', 'yaml'].includes(d)) return 'yaml';
  if (['md', 'markdown', 'mdx'].includes(d)) return 'md';
  if (['go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'kt', 'swift'].includes(d)) return 'go';
  return '';
}

/* Trần an toàn. Quét là O(n × số luật) nên file to vẫn chạy được, nhưng dựng vài chục
   nghìn <span> mới là thứ làm treo trình duyệt — không phải phần quét. */
const TRAN = 200_000;

/**
 * Cắt mã thành token để component tự dựng `<span>`.
 * KHÔNG trả chuỗi HTML: dựng HTML rồi nhét bằng dangerouslySetInnerHTML thì mọi file
 * người dùng mở đều thành đường tiêm mã — mà panel này mở được file bất kỳ trong dự án.
 */
export function toMau(ma: string, lang: string): Token[] {
  const luat = LUAT[lang];
  if (!luat || !ma || ma.length > TRAN) return [{ t: 'thuong', s: ma }];

  const ra: Token[] = [];
  let dem = '';   // chữ thường đang gom, đẩy ra khi gặp token có màu
  let i = 0;

  while (i < ma.length) {
    let khop: Token | null = null;
    for (const l of luat) {
      if (l.khi && !l.khi(ma, i)) continue;
      l.re.lastIndex = i;
      const m = l.re.exec(ma);
      if (m && m[0]) { khop = { t: l.t, s: m[0] }; break; }
    }
    if (khop) {
      if (dem) { ra.push({ t: 'thuong', s: dem }); dem = ''; }
      ra.push(khop);
      i += khop.s.length;
    } else {
      dem += ma[i];
      i += 1;
    }
  }
  if (dem) ra.push({ t: 'thuong', s: dem });
  return ra;
}

/** Lớp CSS cho từng loại token — màu khai trong globals.css, có bản sáng và tối. */
export const LOP: Record<Loai, string> = {
  'chu-thich': 'text-[var(--ma-chu-thich)] italic',
  'chuoi': 'text-[var(--ma-chuoi)]',
  'so': 'text-[var(--ma-so)]',
  'tu-khoa': 'text-[var(--ma-tu-khoa)]',
  'ham': 'text-[var(--ma-ham)]',
  'kieu': 'text-[var(--ma-kieu)]',
  'thuoc-tinh': 'text-[var(--ma-thuoc-tinh)]',
  'the': 'text-[var(--ma-the)]',
  'thuong': '',
};
