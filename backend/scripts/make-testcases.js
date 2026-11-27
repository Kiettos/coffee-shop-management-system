/** Tạo file docs/TestCase.xlsx - danh sách test case của hệ thống. Chạy: node scripts/make-testcases.js */
const path = require('path');
const ExcelJS = require('exceljs');

const CASES = [
  // [Mã, Chức năng, Kịch bản, Các bước, Kết quả mong đợi, Kiểm thử tự động]
  ['TC01', 'Đăng nhập', 'Đăng nhập đúng tài khoản', 'Nhập admin / admin123 → Đăng nhập', 'Vào trang Báo cáo, menu hiển thị đủ chức năng quản trị', ''],
  ['TC02', 'Đăng nhập', 'Sai mật khẩu', 'Nhập admin / sai → Đăng nhập', 'Báo "Sai tên đăng nhập hoặc mật khẩu"; sau 5 lần sai bị khóa 5 phút', 'api.test.js'],
  ['TC03', 'Phân quyền', 'Thu ngân truy cập báo cáo', 'Đăng nhập thungan1, mở /dashboard.html', 'Bị chuyển về màn hình Bán hàng; API trả 403', 'api.test.js'],
  ['TC04', 'Bán hàng', 'Tạo đơn tiền mặt', 'Chọn 2 Cà phê sữa đá → Tiền mặt → nhập 100.000 → Xác nhận', 'Tổng 58.000đ, tiền thối 42.000đ, in được hóa đơn, kho trừ 60ml sữa đặc', 'api.test.js'],
  ['TC05', 'Bán hàng', 'Khách đưa thiếu tiền', 'Thanh toán tiền mặt, nhập số tiền nhỏ hơn tổng', 'Nút xác nhận bị khóa, hiện "Thiếu ...đ"; API trả 400', 'api.test.js'],
  ['TC06', 'Bán hàng', 'Ghi chú món, giảm giá, số bàn', 'Thêm món, nhập ghi chú "ít đá", giảm 10.000đ, bàn 5', 'Đơn lưu đúng ghi chú, giảm giá, số bàn; hóa đơn hiển thị đúng', ''],
  ['TC07', 'Bán hàng', 'Lưu đơn thanh toán sau', 'Thêm món → "Lưu đơn, thanh toán sau" → mở "Đơn chờ thanh toán"', 'Đơn ở trạng thái Chờ thanh toán, thanh toán được sau bằng tiền mặt/QR', ''],
  ['TC08', 'Bắt lỗi - không order được', 'Món hết nguyên liệu', 'Đặt tồn Bột matcha = 0, gọi Matcha latte', 'Báo "Không đủ nguyên liệu", liệt kê NL thiếu, cho bỏ món khỏi giỏ; ghi sự kiện hết NL và nhật ký lỗi', 'api.test.js'],
  ['TC09', 'Bắt lỗi - thanh toán', 'Cổng QR lỗi', 'Thanh toán QR, tick "Giả lập cổng thanh toán bị lỗi" → Xác nhận', 'Báo thất bại, đơn vẫn Chờ thanh toán, có nút Thử lại / Chuyển sang tiền mặt; ghi giao dịch lỗi', 'api.test.js'],
  ['TC10', 'Bắt lỗi - thanh toán', 'Thanh toán 2 lần', 'Gọi thanh toán lại đơn đã thanh toán', 'Từ chối: "Đơn hàng đã được thanh toán trước đó"', 'api.test.js'],
  ['TC11', 'Bắt lỗi - mất mạng', 'Bán hàng khi mất mạng', 'Tắt máy chủ / Wi-Fi → bán đơn tiền mặt', 'Hiện banner mất mạng, đơn lưu trên máy (mã OFF-...), in được hóa đơn; QR bị chặn', 'Kiểm thử trình duyệt'],
  ['TC12', 'Bắt lỗi - mất mạng', 'Tải lại trang khi mất mạng', 'Đang offline, nhấn F5 trên màn hình Bán hàng', 'Giao diện và thực đơn vẫn hiển thị (service worker)', 'Kiểm thử trình duyệt'],
  ['TC13', 'Bắt lỗi - mất mạng', 'Có mạng trở lại', 'Bật lại máy chủ / Wi-Fi', 'Đơn offline tự đồng bộ, không bị trùng khi gửi lại; ghi 1 sự cố mất mạng kèm thời lượng', 'api.test.js + trình duyệt'],
  ['TC14', 'Đơn hàng', 'Hủy món trong đơn', 'Mở đơn chờ → Hủy món → lý do "Khách đổi ý", hoàn kho', 'Tổng tiền cập nhật, nguyên liệu được hoàn kho', 'api.test.js'],
  ['TC15', 'Đơn hàng', 'Hủy cả đơn sau khi đã hủy 1 món', 'Hủy 1 món rồi hủy cả đơn', 'Kho được hoàn đúng 1 lần, không dư', 'api.test.js'],
  ['TC16', 'Đơn hàng', 'Hủy món pha sai', 'Hủy món, lý do "Pha sai món" (không hoàn kho)', 'Nguyên liệu vẫn bị trừ, tính vào hao hụt', ''],
  ['TC17', 'Kho', 'Nhập hàng', 'Kho → Nhập hàng → 100g giá 20đ cho NL đang có 100g giá 10đ', 'Tồn = 200g, giá vốn bình quân = 15đ/g', 'api.test.js'],
  ['TC18', 'Kho', 'Kiểm kê phát hiện thất thoát', 'Kho → Kiểm kê → nhập số thực tế ít hơn hệ thống 500ml', 'Ghi chênh lệch -500ml, tồn điều chỉnh, hiện trong báo cáo thất thoát', 'api.test.js'],
  ['TC19', 'Kho', 'Hủy hàng hỏng', 'Kho → Hủy hỏng → 1000ml sữa tươi, "Hết hạn"', 'Tồn giảm, giao dịch loại Hủy, tính vào cột Hủy/hỏng của báo cáo', ''],
  ['TC20', 'Sản phẩm', 'Thêm món có công thức', 'Thêm món, công thức 3 nguyên liệu', 'Giá vốn & biên lợi nhuận tự tính; cảnh báo nếu biên < 50%', ''],
  ['TC21', 'Sản phẩm', 'Xóa món đã có lịch sử bán', 'Sửa món → Xóa', 'Món chuyển "Ngừng bán" (giữ dữ liệu báo cáo)', ''],
  ['TC22', 'Nhân viên', 'Thêm / khóa nhân viên', 'Thêm thu ngân mới, sau đó bỏ chọn "Đang làm việc"', 'Tài khoản bị khóa không đăng nhập được; không thể khóa admin cuối cùng', ''],
  ['TC23', 'Báo cáo', 'Doanh thu theo ngày/tuần/tháng + so kỳ trước', 'Báo cáo → 30 ngày → Theo tuần', 'Hiện % tăng/giảm so kỳ trước và so với tuần liền trước', 'api.test.js'],
  ['TC24', 'Báo cáo', 'Theo thanh toán, ca, thu ngân, danh mục', 'Mở các tab Doanh thu, Ca & thu ngân', 'Số liệu tiền mặt/QR, 3 ca, từng thu ngân, từng danh mục khớp tổng doanh thu', 'api.test.js'],
  ['TC25', 'Báo cáo', 'Top món bán chạy/chậm, lợi nhuận theo món', 'Tab Sản phẩm & lợi nhuận', 'Top 10 mỗi loại; LN/ly = giá bán - giá vốn theo công thức', 'api.test.js'],
  ['TC26', 'Báo cáo', 'Lý thuyết vs thực tế, NL tiêu hao', 'Tab Kho & thất thoát', 'Chênh lệch = hủy/hỏng + thiếu kiểm kê; cảnh báo > 3%', 'api.test.js'],
  ['TC27', 'Báo cáo', 'Xuất Excel / PDF', 'Bấm Xuất Excel, Xuất PDF', 'Tải về file .xlsx (14 sheet) và .pdf tiếng Việt đầy đủ', 'api.test.js'],
  ['TC28', 'Nâng cao', 'Dự báo ngày hết hàng', 'Mở Dự báo & AI', 'Liệt kê NL theo số ngày còn đủ, ngày hết dự kiến, gợi ý nhập', 'api.test.js'],
  ['TC29', 'Nâng cao', 'Dự báo nguồn cung bằng AI', 'Dán tin "Giá cà phê tăng mạnh do hạn hán" → Phân tích', 'Nhóm Cà phê xu hướng tăng; khuyến nghị nhập sớm', 'api.test.js'],
  ['TC30', 'Nâng cao', 'Heatmap giờ cao điểm, tỷ lệ hủy/hết NL', 'Tab Phân tích nâng cao', 'Heatmap 7 thứ × 18 giờ, chỉ ra giờ cao điểm; bảng tỷ lệ hủy & hết NL', 'api.test.js'],
  ['TC31', 'Đa nền tảng', 'Giao diện điện thoại / tablet', 'Mở trên điện thoại (cùng Wi-Fi) hoặc thu nhỏ trình duyệt', 'Menu thu gọn, giỏ hàng dạng ngăn kéo dưới; cài được như ứng dụng (PWA)', 'Kiểm thử trình duyệt'],
];

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Test case');
  ws.columns = [
    { header: 'Mã', width: 7 }, { header: 'Chức năng', width: 24 }, { header: 'Kịch bản', width: 32 },
    { header: 'Các bước thực hiện', width: 48 }, { header: 'Kết quả mong đợi', width: 58 },
    { header: 'Kiểm thử tự động', width: 22 }, { header: 'Kết quả thực tế', width: 16 }, { header: 'Ghi chú', width: 20 },
  ];
  CASES.forEach((c) => ws.addRow([...c, 'Đạt', '']));
  ws.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6F4E37' } };
  });
  ws.eachRow((row) => { row.alignment = { wrapText: true, vertical: 'top' }; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:H1';
  const out = path.resolve(__dirname, '..', '..', 'docs', 'TestCase.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('Đã tạo', out, `(${CASES.length} test case)`);
})();
