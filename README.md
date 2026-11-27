# ☕ Coffee Manager — Hệ thống quản lý quán cafe

Ứng dụng web quản lý quán cafe: **bán hàng (POS), đơn hàng, kho nguyên liệu, sản phẩm & công thức pha chế, nhân viên**,
**báo cáo – phân tích dữ liệu** (xuất Excel/PDF) và các tính năng nâng cao: **bắt lỗi hệ thống** (không order được, thanh toán lỗi,
mất mạng), **dự báo ngày hết hàng**, **dự báo nguồn cung bằng AI**, **tỷ lệ hủy / hết nguyên liệu**, **heatmap giờ cao điểm**.

Chạy được trên **máy tính, tablet, điện thoại** (giao diện responsive, cài được như ứng dụng — PWA, dùng được khi mất mạng).

---

## 1. Cài đặt & chạy

Yêu cầu: **Node.js ≥ 22.13** (khuyến nghị bản LTS 24 tại https://nodejs.org). Không cần cài MySQL/SQL Server —
CSDL là SQLite có sẵn trong Node.

```bash
cd backend
npm install        # cài thư viện (lần đầu)
npm start          # chạy server -> http://localhost:3000
```

Trên Windows có thể bấm đúp **`start.bat`** ở thư mục gốc.

Lần chạy đầu hệ thống tự tạo CSDL `backend/data/coffee.db` kèm **~75 ngày dữ liệu mẫu** (≈6.000 đơn) để các báo cáo có số liệu ngay.

| Vai trò | Tài khoản | Mật khẩu | Quyền |
|---|---|---|---|
| Quản trị | `admin` | `admin123` | Toàn quyền |
| Quản lý | `quanly` | `quanly123` | Toàn quyền (trừ tạo tài khoản quản trị) |
| Thu ngân | `thungan1`, `thungan2`, `thungan3` | `123456` | Bán hàng, đơn trong ngày, xem kho |
| Pha chế | `phache1` | `123456` | Xem đơn, hủy món, xem kho, báo hủy hàng hỏng |

**Dùng trên điện thoại / tablet:** kết nối cùng Wi-Fi với máy chạy server, mở địa chỉ `http://<IP-máy-chủ>:3000`
(địa chỉ LAN được in ra khi khởi động). Trên trình duyệt chọn "Thêm vào màn hình chính" để cài như ứng dụng.

Các lệnh khác (trong `backend/`):

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy và tự khởi động lại khi sửa code |
| `npm run seed` | Xóa dữ liệu, tạo lại dữ liệu mẫu |
| `npm test` | Chạy 13 bài kiểm thử tích hợp API (dùng CSDL tạm trong bộ nhớ) |
| `node scripts/make-testcases.js` | Tạo lại `docs/TestCase.xlsx` |

Cấu hình trong `backend/.env`: cổng (`PORT`), khóa ký phiên (`JWT_SECRET` — **đổi khi triển khai thật**), đường dẫn CSDL,
thông tin tài khoản ngân hàng in trên mã QR, và `ANTHROPIC_API_KEY` (tùy chọn, cho dự báo AI).

---

## 2. Chức năng

### Bắt buộc
| Yêu cầu | Ở đâu |
|---|---|
| Quản lý **kho**: nguyên liệu, nhập hàng (giá vốn bình quân), hủy hàng hỏng, kiểm kê, lịch sử nhập/xuất | Menu **Kho nguyên liệu** |
| Quản lý **sản phẩm**: danh mục, món, giá, **công thức pha chế** → tự tính giá vốn & biên lợi nhuận | **Sản phẩm & công thức** |
| Quản lý **nhân viên**: thêm, phân quyền, khóa tài khoản, đổi mật khẩu | **Nhân viên** |
| Quản lý **order**: POS chọn món, ghi chú, giảm giá, tiền mặt (tính tiền thối) / QR, in hóa đơn, đơn chờ, hủy món/đơn | **Bán hàng**, **Đơn hàng** |
| **UI web đa nền tảng** | Responsive máy tính / tablet / điện thoại + PWA |
| **Báo cáo cơ bản** + **xuất Excel, PDF** | **Báo cáo** → nút *Xuất Excel* / *Xuất PDF* |
| Lý thuyết vs thực tế (chênh lệch = thất thoát) | Báo cáo → tab *Kho & thất thoát* |
| Nguyên liệu tiêu hao theo kỳ | Báo cáo → tab *Kho & thất thoát* |
| Theo ngày/tuần/tháng, % tăng/giảm so với kỳ trước | Báo cáo → ô chỉ số + tab *Doanh thu* (chọn *Theo ngày/tuần/tháng*) |
| Theo phương thức thanh toán (tiền mặt / QR) | Báo cáo → tab *Doanh thu* |
| Theo ca, theo nhân viên thu ngân | Báo cáo → tab *Ca & thu ngân* |
| Top món bán chạy / bán chậm | Báo cáo → tab *Sản phẩm & lợi nhuận* |
| Lợi nhuận theo món (giá bán − giá vốn từ công thức) | Báo cáo → tab *Sản phẩm & lợi nhuận* |
| Theo danh mục (cafe, trà, đá xay, bánh…) | Báo cáo → tab *Doanh thu* |

### Nâng cao
| Yêu cầu | Cách xử lý |
|---|---|
| **Không order được** | Kiểm tra tồn kho theo công thức trước khi tạo đơn; báo nguyên liệu thiếu, cho bỏ món khỏi giỏ; ghi *sự kiện hết nguyên liệu* + nhật ký lỗi. Món hết hàng được đánh dấu ngay trên thực đơn. |
| **Thanh toán không được** | Giao dịch QR lỗi được ghi lại, đơn giữ trạng thái *chờ*, có nút *Thử lại* / *Chuyển sang tiền mặt* / *Thanh toán sau*; chống thanh toán 2 lần. Giả lập lỗi tại *Bắt lỗi hệ thống* (tỷ lệ lỗi) hoặc ô tick trong hộp thoại QR. |
| **Mất mạng** | Service worker giữ giao diện + thực đơn; đơn tiền mặt lưu trên trình duyệt (mã `OFF-…`), tự đồng bộ khi có mạng, chống trùng bằng `client_uuid`; banner + trạng thái mạng; mỗi sự cố mất mạng được ghi 1 lần kèm thời lượng. |
| Nhật ký lỗi tập trung | **Bắt lỗi hệ thống**: thống kê theo loại, đánh dấu đã xử lý; lỗi máy chủ & lỗi trình duyệt được tự động ghi. |
| Dự báo ngày hết hàng | Tốc độ tiêu thụ trung bình (lấy mức cao hơn giữa cả kỳ và nửa kỳ gần nhất) → số ngày còn đủ, ngày hết dự kiến, gợi ý lượng nhập đủ 14 ngày. |
| Dự báo nguồn cung bằng AI (tin tức, MXH) | Lấy tiêu đề Google News (giá cà phê, sữa, đường, trà) + văn bản người dùng dán (bài báo, bài đăng MXH). Có `ANTHROPIC_API_KEY` → Claude (`claude-opus-5-5`) nhận diện xu hướng; không có / mất mạng → bộ phân tích từ khóa nội bộ. Kết hợp tồn kho để đưa khuyến nghị nhập. |
| Tỷ lệ món bị hủy, món hết nguyên liệu | Báo cáo → tab *Phân tích nâng cao* (kèm lý do hủy). |
| Heatmap giờ cao điểm (giờ × thứ) | Báo cáo → tab *Phân tích nâng cao* (theo số đơn hoặc doanh thu). |

---

## 3. Cách tính các chỉ số

- **Doanh thu / lợi nhuận** chỉ tính đơn *đã thanh toán*. Giá vốn mỗi món được chốt tại thời điểm bán (theo công thức × giá vốn nguyên liệu lúc đó).
- **Kỳ trước** = khoảng thời gian cùng độ dài liền trước kỳ đang xem (VD: 30 ngày gần nhất so với 30 ngày trước đó).
- **Ca:** sáng 06–12h, chiều 12–18h, tối 18–24h (theo giờ tạo đơn).
- **Lý thuyết** = nguyên liệu phải dùng theo công thức của các món đã bán (đã trừ phần hoàn kho khi hủy).
  **Thực tế** = lý thuyết + hủy/hỏng đã khai báo + phần thiếu phát hiện khi kiểm kê. **Thất thoát** = thực tế − lý thuyết.
- **Tỷ lệ hết nguyên liệu** = số lần khách gọi mà hết NL / (số món đã gọi + số lần hết NL).
- **Giá vốn nhập hàng** cập nhật theo bình quân gia quyền.

---

## 4. Cấu trúc thư mục

```
coffee-shop-management-system/
├── backend/                     Node.js + Express + SQLite (node:sqlite)
│   ├── src/
│   │   ├── server.js            khởi tạo app, phục vụ API + giao diện
│   │   ├── config/db.js         kết nối CSDL, transaction
│   │   ├── db/seed.js           dữ liệu mẫu mô phỏng 75 ngày
│   │   ├── middleware/          xác thực JWT, phân quyền, xử lý lỗi tập trung
│   │   ├── models/NhanVien.js   nhân viên + băm mật khẩu (scrypt)
│   │   ├── controllers/         đăng nhập, sản phẩm, kho, nhân viên, đơn hàng, báo cáo, hệ thống
│   │   ├── services/            nghiệp vụ đơn hàng, báo cáo, xuất Excel/PDF, dự báo AI, giá vốn
│   │   └── routes/              authRoutes, apiRoutes
│   ├── test/api.test.js         kiểm thử tích hợp
│   └── scripts/make-testcases.js
├── frontend/                    HTML/CSS/JS thuần (không cần build)
│   ├── index.html               đăng nhập
│   ├── order.html               bán hàng (POS)
│   ├── orders.html              đơn hàng
│   ├── dashboard.html           báo cáo & phân tích
│   ├── forecast.html            dự báo & AI
│   ├── inventory.html           kho
│   ├── products.html            sản phẩm & công thức
│   ├── employees.html           nhân viên
│   ├── system.html              bắt lỗi hệ thống & cấu hình
│   ├── sw.js, manifest.webmanifest   PWA / chạy offline
│   └── js/, css/, img/
├── database/schema.sql          lược đồ CSDL
└── docs/TestCase.xlsx           31 test case
```

## 5. API chính

Tất cả API (trừ đăng nhập, `/api/health`) cần header `Authorization: Bearer <token>`.

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập |
| GET/POST/PUT/DELETE | `/api/products`, `/api/categories` | Sản phẩm, danh mục, công thức |
| GET/POST/PUT/DELETE | `/api/ingredients` | Nguyên liệu |
| POST | `/api/inventory/import` · `/waste` · `/count` | Nhập hàng · hủy hàng · kiểm kê |
| GET | `/api/inventory/transactions` · `/counts` | Lịch sử kho |
| GET/POST/PUT | `/api/employees` | Nhân viên |
| GET/POST | `/api/orders` | Danh sách / tạo đơn |
| POST | `/api/orders/sync` | Đồng bộ đơn offline |
| GET | `/api/orders/:id/qr` | Mã QR chuyển khoản |
| POST | `/api/orders/:id/pay` · `/cancel` · `/items/:itemId/cancel` | Thanh toán · hủy đơn · hủy món |
| GET | `/api/reports/:name` | `summary, timeseries, payment, shift, cashier, top, profit, category, usage, loss, forecast, cancel, heatmap, full` — tham số `from`, `to` (YYYY-MM-DD), `group` (day/week/month) |
| GET | `/api/export/report.xlsx` · `/report.pdf` | Xuất báo cáo |
| POST | `/api/forecast/supply` | Dự báo nguồn cung (`{ text, fetch }`) |
| GET/POST | `/api/errors` … | Nhật ký lỗi |
| GET/PUT | `/api/settings` | Cấu hình quán, giả lập lỗi thanh toán |
