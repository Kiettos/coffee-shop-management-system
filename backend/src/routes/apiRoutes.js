/**
 * Phân quyền:
 *  - admin, manager : toàn quyền (báo cáo, kho, sản phẩm, nhân viên)
 *  - cashier        : bán hàng, xem đơn trong ngày, xem kho
 *  - barista        : xem đơn, xem kho, hủy món
 */
const router = require('express').Router();
const { wrap } = require('../middleware/errorHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const product = require('../controllers/productController');
const inventory = require('../controllers/inventoryController');
const employee = require('../controllers/employeeController');
const order = require('../controllers/orderController');
const report = require('../controllers/reportController');
const system = require('../controllers/systemController');

const MANAGE = requireRole('admin', 'manager');
const SELL = requireRole('admin', 'manager', 'cashier');

router.get('/health', wrap(system.health));

router.use(requireAuth);

// Danh mục & sản phẩm
router.get('/categories', wrap(product.listCategories));
router.post('/categories', MANAGE, wrap(product.createCategory));
router.put('/categories/:id', MANAGE, wrap(product.updateCategory));
router.delete('/categories/:id', MANAGE, wrap(product.deleteCategory));
router.get('/products', wrap(product.listProducts));
router.post('/products', MANAGE, wrap(product.createProduct));
router.put('/products/:id', MANAGE, wrap(product.updateProduct));
router.delete('/products/:id', MANAGE, wrap(product.deleteProduct));

// Kho
router.get('/ingredients', wrap(inventory.list));
router.post('/ingredients', MANAGE, wrap(inventory.create));
router.put('/ingredients/:id', MANAGE, wrap(inventory.update));
router.delete('/ingredients/:id', MANAGE, wrap(inventory.remove));
router.post('/inventory/import', MANAGE, wrap(inventory.importStock));
router.post('/inventory/waste', wrap(inventory.waste));
router.post('/inventory/count', MANAGE, wrap(inventory.stockCount));
router.get('/inventory/transactions', wrap(inventory.transactions));
router.get('/inventory/counts', wrap(inventory.counts));

// Nhân viên
router.get('/employees', MANAGE, wrap(employee.list));
router.post('/employees', MANAGE, wrap(employee.create));
router.put('/employees/:id', MANAGE, wrap(employee.update));

// Đơn hàng
router.get('/orders', wrap(order.list));
router.post('/orders', SELL, wrap(order.create));
router.post('/orders/sync', SELL, wrap(order.sync));
router.get('/orders/:id', wrap(order.get));
router.get('/orders/:id/qr', SELL, wrap(order.qr));
router.post('/orders/:id/pay', SELL, wrap(order.pay));
router.post('/orders/:id/cancel', wrap(order.cancel));
router.post('/orders/:id/items/:itemId/cancel', wrap(order.cancelItem));

// Báo cáo & phân tích
router.get('/reports/:name', MANAGE, wrap(report.report));
router.get('/export/report.xlsx', MANAGE, wrap(report.exportExcel));
router.get('/export/report.pdf', MANAGE, wrap(report.exportPdf));
router.post('/forecast/supply', MANAGE, wrap(report.supply));

// Hệ thống
router.get('/errors', MANAGE, wrap(system.listErrors));
router.post('/errors/client', wrap(system.reportClientError));
router.post('/errors/resolve-all', MANAGE, wrap(system.resolveAll));
router.post('/errors/:id/resolve', MANAGE, wrap(system.resolveError));
router.get('/settings', wrap(system.getSettings));
router.put('/settings', MANAGE, wrap(system.updateSettings));

module.exports = router;
