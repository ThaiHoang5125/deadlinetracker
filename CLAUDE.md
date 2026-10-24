# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tổng quan

"Deadline Tracker" (`vn.deadline.tracker`): app Electron trên máy tính để ghi việc cần làm và nhắc trước deadline, đồng bộ qua một Google Apps Script web app sang Google Calendar và Google Sheets. Toàn bộ chuỗi giao diện và comment trong code đều bằng tiếng Việt.

Mã nguồn được dựng lại từ bản build `DeadlineTracker-1.0.0-portable.exe` (giải nén exe -> `app-64.7z` -> `resources/app.asar`), không phải từ repo gốc. Phần server Apps Script không có trong repo này. `HUONG-DAN.md` mà giao diện nhắc tới cũng chưa có.

## Lệnh

- `npm install` cài electron và electron-builder.
- `npm start` chạy app.
- `npm test` chạy test (`node --test "test/*.test.js"`). Phải truyền glob, Node 24 không nhận thư mục.
- `npm run dist` build vào `dist/`: bản portable và bản cài NSIS. Chưa cấu hình ký số.
- Không có linter.

## Cấu trúc

```
package.json          main: src/main.js; cấu hình electron-builder nằm trong khóa "build"
assets/icon.{png,ico} asarUnpack để Windows đọc được cho khay hệ thống và cửa sổ
src/main.js           tiến trình chính của Electron
src/engine.js         dữ liệu, đồng bộ và nhắc việc (không phụ thuộc Electron)
src/core.js           logic thuần JS dùng chung (UMD)
src/preload.js        API contextBridge, lộ ra dưới tên window.api
src/renderer/         index.html + app.js (cửa sổ chính), quick.html/js (nhập nhanh), card.html/js (thẻ nhắc),
                      quick-menu.js (menu xổ xuống khi gõ "!" và "#", dùng chung cho hai ô nhập)
apps-script/          nguồn của backend Google Apps Script + trang web điện thoại (xem mục Apps Script)
test/                 test cho core.js, engine.js và Code.gs
```

## Kiến trúc

**`core.js`**
- Module UMD, không phụ thuộc Node, Electron hay DOM. Được nạp bởi Node (`main.js`, `engine.js`) và bởi renderer qua `<script src="../core.js">`. Cùng file này cũng dùng cho một web app điện thoại riêng.
- Chứa `parseQuick` (phân tích câu nhập nhanh tiếng Việt, bỏ dấu để so khớp), logic mốc nhắc tính bằng phút trước hạn, phân nhóm theo hạn (`bucketOf`), sắp xếp, định dạng ngày giờ và `mergeServer`.
- Ưu tiên là số 1-5 (1 = cao nhất, mặc định 3), mỗi mức có bộ mốc nhắc riêng trong `OFFSETS_BY_PRIORITY`. Mức 3: 1 tuần, 3 ngày, 1 ngày, 3 giờ, đúng hạn. Dữ liệu cũ dạng chữ (`high/normal/low`) được `normPriority` đổi thành 1/3/5, kể cả dữ liệu từ server.
- Cú pháp nhập nhanh: `#nhóm`, `#"nhóm nhiều từ"` (cũng nhận `[...]`, `(...)`), `#a bc` (thẻ một từ gom thêm tối đa 3 từ tự do đứng liền sau, dừng ở ngày/giờ/ưu tiên), `!1`..`!5` hoặc `!cao/!tb/!thap`. Gõ `!` thì ô nhập hiện menu xổ xuống dưới dấu `!` (`quick-menu.js`, dữ liệu từ `bangTyping`/`priorityOptions`; gõ `#` gợi ý nhóm đã có qua `hashTyping`/`groupStats`). Chọn bằng ↑↓ + Enter/Tab hoặc chuột.
- Cảnh báo đỏ "Có công việc trùng" khi hạn vừa nhập (ô nhập nhanh và form) trùng đến phút với một việc đang mở: `findDuplicates`/`dupText` trong `core.js`. Chỉ cảnh báo, vẫn cho thêm.
- Cửa sổ nhập nhanh không resizable: trên Windows `setSize` không thu nhỏ được, phải dùng `setBounds` (xem `quick:resize` trong `main.js`).
- Giữ phong cách ES5 (`var`, `function`) và không phụ thuộc môi trường. Đừng thêm `require` hay gọi DOM vào file này.

**`engine.js`** (`Engine extends EventEmitter`)
- Quản lý kho JSON cục bộ: tasks theo id, config, settings, `fired` (mốc đã nhắc), `snoozes`, `digestDate`.
- `file`, `now`, `fetch` được truyền vào từ ngoài nên kiểm thử được mà không cần Electron (xem `test/engine.test.js`).
- Vòng tick 20 giây phát sự kiện `reminders` và bản tóm tắt buổi sáng `digest` (bỏ qua nếu mở máy sau 12:00).
- Đồng bộ chạy mỗi 3 phút và theo yêu cầu qua `requestSync()` (debounce 2 giây). POST JSON dạng `text/plain` tới URL `/exec` với `{action, key, ...}`. Task thay đổi cục bộ (`_dirty`) gửi theo lô 25, tối đa 12 vòng. Danh sách từ server được gộp bằng `Core.mergeServer`. Xóa là xóa mềm (cờ `deleted`).
- Sau đồng bộ, việc đã xóa mềm bị gỡ hẳn khỏi máy (`_applyServer`). Vì vậy `deleteTask` giữ một bản trong `_trash` 60 giây để `restoreTask` (nút Hoàn tác) còn dùng được. Đừng bỏ cơ chế này.
- Thẻ nhắc dùng `markDone` (đặt thẳng `done`), không dùng `toggleDone`, để không đảo ngược việc đã xong ở thiết bị khác.
- `parseLink` chỉ chấp nhận `https://script.google.com/macros/.../s/<id>/exec`, để khóa bảo mật không bị gửi tới nơi khác. Giữ nguyên ràng buộc này.

**`main.js`**
- Tạo bốn thành phần: cửa sổ chính, cửa sổ nhập nhanh, thẻ nhắc việc và biểu tượng khay hệ thống.
- Phím tắt toàn cục: `Ctrl/Cmd+Alt+N` để nhập nhanh, `Ctrl/Cmd+Alt+L` để mở danh sách.
- Đóng cửa sổ chính chỉ ẩn đi; app chỉ thoát qua khay hệ thống.
- Khóa single-instance; đặt `DEADLINE_TEST=1` để bỏ qua khóa này khi kiểm thử.
- Tăng tốc phần cứng bị tắt có chủ đích, vì một số máy Windows hiện cửa sổ trắng.
- Hỗ trợ tự khởi động cùng Windows và cờ `--hidden`. Bản portable lấy đường dẫn exe từ `PORTABLE_EXECUTABLE_FILE`.
- Log chẩn đoán ghi vào `debug.log` trong `userData`.
- Các handler IPC đăng ký qua `handle(channel, fn)` và trả về `{ok, data}` hoặc `{ok:false, error}`.

**`preload.js`**
- Lộ `window.api`. Mỗi lời gọi bóc lớp `{ok, data}` và ném lỗi khi thất bại.
- Khi thêm tính năng: thêm kênh trong `setupIpc()` ở `main.js` và hàm bọc tương ứng trong `preload.js`.

**Renderer**
- Các cửa sổ dùng `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- CSP chặt: `default-src 'none'; script-src 'self'`. Không script inline, không tài nguyên từ xa, không `eval`.
- Điều hướng và `window.open` bị chặn trong `lockNavigation`.

## Apps Script (server + điện thoại)

- `apps-script/server.src.gs` (API, Sheet, Calendar) + `apps-script/mobile.src.html` (trang điện thoại) + `src/core.js` được `apps-script/build.js` ghép thành `apps-script/Code.gs`. Chạy `npm run build:gas`. Đừng sửa `Code.gs` trực tiếp.
- `core.js` chỉ có một bản (`src/core.js`), được nhúng nguyên văn vào trang điện thoại. Đổi `core.js` thì phải build lại và deploy lại Apps Script.
- Triển khai: dán toàn bộ `Code.gs` vào trình soạn thảo Apps Script, rồi Deploy > Manage deployments > Edit > Version: New version (giữ nguyên URL `/exec`). Không cần chạy lại `setup()`: khóa, `SHEET_ID`, `CAL_ID` nằm trong Script Properties.
- Server chấp nhận ưu tiên cả dạng chữ cũ (`high/normal/low` đổi thành 1/3/5) lẫn số 1-5, và luôn trả về số. Mốc nhắc trên Calendar tối đa 5 mốc gần hạn nhất còn ở tương lai.
- `test/gas.test.js` nạp `Code.gs` vào sandbox `vm` (không có dịch vụ Google), chỉ kiểm tra logic thuần.

## Vấn đề đã biết

- Gộp xung đột khi đồng bộ theo kiểu ghi sau thắng trên cả task (dựa `updatedAt` của từng máy). Gộp theo từng trường cần sửa cả server Apps Script.
- `parseQuick` có thể hiểu nhầm số trong tiêu đề (ví dụ "Bài 3/4" thành ngày 3/4).
- Khóa bảo mật lưu dạng văn bản thường trong `deadline-data.json`.
