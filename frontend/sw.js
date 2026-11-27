/* Service worker: cho phép mở ứng dụng & bán hàng khi mất mạng (PWA) */
const CACHE = 'csm-v2';
const SHELL = [
  '/', '/index.html', '/order.html', '/orders.html', '/dashboard.html', '/forecast.html', '/inventory.html',
  '/products.html', '/employees.html', '/system.html',
  '/css/style.css', '/js/api.js', '/js/layout.js', '/js/charts.js', '/js/login.js', '/js/order.js', '/js/orders.js',
  '/js/dashboard.js', '/js/forecast.js', '/js/inventory.js', '/js/products.js', '/js/employees.js', '/js/system.js',
  '/vendor/chart.umd.js', '/manifest.webmanifest', '/img/icon.svg',
];
// API được phép dùng bản lưu tạm khi offline (để vẫn hiện thực đơn)
const API_CACHEABLE = ['/api/products', '/api/categories', '/api/settings', '/api/auth/me'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const offlineResponse = () => new Response(JSON.stringify({ error: 'Mất kết nối mạng' }), {
  status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline': '1' },
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    const cacheable = e.request.method === 'GET' && API_CACHEABLE.some((p) => url.pathname === p);
    e.respondWith((async () => {
      try {
        const res = await fetch(e.request);
        if (cacheable && res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
        return res;
      } catch {
        if (cacheable) {
          const hit = await caches.match(e.request);
          if (hit) {
            // đánh dấu đây là dữ liệu lưu tạm -> trang biết đang offline
            const headers = new Headers(hit.headers);
            headers.set('X-Offline', 'cache');
            return new Response(await hit.blob(), { status: hit.status, headers });
          }
        }
        return offlineResponse();
      }
    })());
    return;
  }

  if (e.request.method !== 'GET') return;
  // Tài nguyên tĩnh: ưu tiên mạng (luôn bản mới), mất mạng thì dùng cache
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      return hit || caches.match('/index.html');
    }
  })());
});
