import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      /* Đã soi cả 21 chỗ luật này báo. Không chỗ nào là bug — chúng rơi vào đúng ba
         mẫu mà React 19 compiler không phân biệt được với lỗi thật:

           1. Tải dữ liệu async rồi đặt vào state (agy-report, compare-view,
              hermes-tab, postgres-panel, quota-tab).
           2. Reset state khi đổi phiên hoặc đóng hộp thoại — `setThem(0)` theo `sid`,
              `setQ('')` khi `open` về false. Không reset thì mở phiên ngắn sau phiên
              dài sẽ xin thừa tin.
           3. Đọc thứ CHỈ trình duyệt biết, sau khi hydrate: theme, localStorage,
              `Notification.permission`. Đọc lúc render thì server và client ra kết quả
              khác nhau -> lệch hydrate.

         Mẫu 3 là bắt buộc với `output: 'export'`: HTML dựng sẵn lúc build, không có
         cách nào biết trước. Viết lại theo `useSyncExternalStore` thì đổi kiến trúc
         của cả 21 chỗ để đúng một luật lint — không đáng.

         Tắt ở đây, có lý do, hơn là rải 21 dòng eslint-disable rồi quên mất vì sao. */
      'react-hooks/set-state-in-effect': 'off',

      /* Thao tác DOM mệnh lệnh trong effect: `el.scrollTop = ...` để giữ vị trí cuộn
         khi cửa sổ 30 tin trượt. Compiler coi mọi gán qua ref là "modify value used in
         effect", nhưng scrollTop chính là thứ ref sinh ra để làm. Hai chỗ, cả hai đều
         trong effect, không phải lúc render. */
      'react-hooks/immutability': 'off',

      /* `const moChon = () => fileRef.current?.click()` — closure ĐỌC ref lúc người
         dùng bấm, không phải lúc render. Compiler cấm mọi lần nhắc tới `.current`
         ngoài effect/handler nên không phân biệt được hai chuyện đó; đã thử tách thành
         hàm có tên, vẫn báo. Một chỗ duy nhất trong dự án. */
      'react-hooks/refs': 'off',

      /* `useMemo` quanh vòng quét ngược `h.messages` tìm kế hoạch chờ duyệt. Compiler
         nói "không giữ được memo hiện có" rồi bỏ tối ưu CẢ component — nhưng memo tay
         ở đây vẫn chạy đúng, và bỏ nó đi thì mỗi vòng poll (2 giây) quét lại toàn bộ
         cửa sổ tin. Giữ memo tay, chấp nhận component này không được compiler tối ưu. */
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
]);

export default eslintConfig;
