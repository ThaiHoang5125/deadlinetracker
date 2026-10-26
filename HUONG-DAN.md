# Hướng dẫn Deadline Tracker

## Cài đặt (Windows)

- **Bản cài đặt** (`Deadline Tracker Setup ….exe`): chạy file, không cần quyền quản trị.
- **Bản portable**: chạy thẳng file `.exe`, không cần cài.

Vì app chưa ký số, Windows SmartScreen có thể báo "Windows protected your PC". Chọn **More info > Run anyway**.

## Dùng ngay, không cần Google

Mở app là dùng được. Dữ liệu lưu riêng trên máy bạn, nhắc việc chạy cục bộ.

- `Ctrl+Alt+N`: nhập nhanh. `Ctrl+Alt+L`: mở danh sách.
- Cú pháp: `#nhóm`, `!1`..`!5` (1 = cao nhất), kèm ngày/giờ, ví dụ `Nộp báo cáo #công ty !2 17h thứ 6`.
- Đóng cửa sổ chỉ ẩn app; thoát qua biểu tượng ở khay hệ thống.

## Tùy chọn: nhắc qua Google Calendar và điện thoại

Mỗi người tự tạo backend riêng trong tài khoản Google của mình (không ai xem được dữ liệu của người khác).

1. Tạo một Google Sheet mới.
2. **Extensions > Apps Script**. Xóa mã mẫu, dán toàn bộ nội dung file `Code.gs` (bản cài đặt có sẵn trong thư mục `resources` cạnh file app; mở bằng cách bấm chuột phải biểu tượng app trong Start > Open file location; bản portable thì nhờ người gửi app đưa kèm).
3. Chọn hàm `setup`, bấm **Run**, cấp quyền khi được hỏi. Khóa bảo mật nằm trong tab **Config** của Sheet.
4. **Deploy > New deployment > Web app**: *Execute as* = **Me**, *Who has access* = **Anyone**. Sao chép link kết thúc bằng `/exec`.
5. Trong app: **Cài đặt > Nâng cao: kết nối Google**, dán link và khóa, bấm **Kết nối**.

Lưu ý: khóa bảo mật là lớp bảo vệ duy nhất của link, đừng chia sẻ. App lưu khóa dạng văn bản thường trong file dữ liệu trên máy.
