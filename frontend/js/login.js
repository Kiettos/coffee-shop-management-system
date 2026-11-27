(function () {
  const form = document.getElementById('login-form');
  const errBox = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const params = new URLSearchParams(location.search);

  const HOME = { admin: '/dashboard.html', manager: '/dashboard.html', cashier: '/order.html', barista: '/orders.html' };

  const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
  if (params.get('expired')) showErr('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.');

  // Đã đăng nhập -> vào thẳng
  if (Api.token && Api.user && !params.get('expired')) location.href = params.get('next') || HOME[Api.user.role] || '/order.html';

  document.querySelectorAll('.demo-accounts code').forEach((c) => {
    c.onclick = () => { form.username.value = c.dataset.u; form.password.value = c.dataset.p; form.password.focus(); };
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) return showErr('Vui lòng nhập tên đăng nhập và mật khẩu');
    btn.disabled = true;
    btn.textContent = 'Đang đăng nhập...';
    try {
      const { token, user } = await Api.post('/api/auth/login', { username, password });
      Api.saveSession(token, user);
      const next = params.get('next');
      location.href = next && next !== '/index.html' ? next : HOME[user.role] || '/order.html';
    } catch (err) {
      showErr(err.network ? 'Không kết nối được máy chủ. Kiểm tra mạng / máy chủ rồi thử lại.' : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
