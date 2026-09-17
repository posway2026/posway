const BASE = 'https://posway-api.onrender.com/api';

function getToken() {
  return localStorage.getItem('posway_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Xatolik yuz berdi");
  return data;
}

export const api = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  createUser: (payload) => request('/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  listUsers: () => request('/auth/users'),

  listProducts: (search, includeDeleted) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (includeDeleted) params.set('includeDeleted', 'true');
    const qs = params.toString();
    return request(`/products${qs ? `?${qs}` : ''}`);
  },
  lowStock: () => request('/products/low-stock'),
  createProduct: (payload) => request('/products', { method: 'POST', body: JSON.stringify(payload) }),
  updateProduct: (id, payload) => request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  productKirimSummary: (id) => request(`/products/${id}/kirim-summary`),
  deleteProduct: (id, action) => request(`/products/${id}`, { method: 'DELETE', body: JSON.stringify(action ? { action } : {}) }),
  restoreProduct: (id) => request(`/products/${id}/restore`, { method: 'POST' }),
  stockIn: (id, payload) => request(`/products/${id}/kirim`, { method: 'POST', body: JSON.stringify(payload) }),
  productMovements: (id) => request(`/products/${id}/movements`),
  // (6) Shtrix-kod skaneri uchun aniq mos mahsulotni topish, va eski
  // (hali kodsiz) mahsulotga bittasini avtomatik yaratib berish.
  getProductByBarcode: (code) => request(`/products/barcode/${encodeURIComponent(code)}`),
  generateProductBarcode: (id) => request(`/products/${id}/generate-barcode`, { method: 'POST' }),

  listCustomers: () => request('/customers'),
  getCustomer: (id) => request(`/customers/${id}`),
  createCustomer: (payload) => request('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: 'DELETE' }),
  restoreCustomer: (id) => request(`/customers/${id}/restore`, { method: 'POST' }),
  payDebt: (id, payload) => request(`/customers/${id}/pay`, { method: 'POST', body: JSON.stringify(payload) }),
  addOldDebt: (id, payload) => request(`/customers/${id}/old-debt`, { method: 'POST', body: JSON.stringify(payload) }),

  listSupplierDebts: () => request('/supplier-debts'),
  supplierDebtEntries: (name) => request(`/supplier-debts/${encodeURIComponent(name)}/entries`),
  paySupplierDebt: (payload) => request('/supplier-debts/pay', { method: 'POST', body: JSON.stringify(payload) }),
  cancelSupplierDebtPayment: (id) => request(`/supplier-debts/payments/${id}/cancel`, { method: 'POST' }),
  addSupplierOldDebt: (payload) => request('/supplier-debts/debt', { method: 'POST', body: JSON.stringify(payload) }),
  addSupplierKirim: (supplierName, payload) => request(`/supplier-debts/${encodeURIComponent(supplierName)}/kirim`, { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplierDebtEntry: (id, payload) => request(`/supplier-debts/debt/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteSupplierDebtEntry: (id) => request(`/supplier-debts/debt/${id}`, { method: 'DELETE' }),
  getKirimDocument: (id) => request(`/supplier-debts/kirim-document/${id}`),
  deleteKirimDocument: (id) => request(`/supplier-debts/kirim-document/${id}`, { method: 'DELETE' }),

  listSales: (from, to) => request(`/sales${from && to ? `?from=${from}&to=${to}` : ''}`),
  getSale: (id) => request(`/sales/${id}`),
  createSale: (payload) => request('/sales', { method: 'POST', body: JSON.stringify(payload) }),
  // (29/39) `payload` endi { itemConditions, returnItemIds, refund } ko'rinishida
  // bo'lishi mumkin — returnItemIds bilan chekdagi faqat ba'zi mahsulotlarni
  // tanlab qaytarish, refund bilan esa mijozga naqd/karta qanday qaytarib
  // berilganini ko'rsatish mumkin (agar kerak bo'lsa).
  deleteSale: (id, payload) => request(`/sales/${id}`, { method: 'DELETE', body: JSON.stringify(payload || {}) }),
  closeSaleDebt: (id, payload) => request(`/sales/${id}/close-debt`, { method: 'POST', body: JSON.stringify(payload || {}) }),

  listCashMovements: () => request('/cash-movements'),
  createCashMovement: (payload) => request('/cash-movements', { method: 'POST', body: JSON.stringify(payload) }),
  updateCashMovement: (id, payload) => request(`/cash-movements/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCashMovement: (id) => request(`/cash-movements/${id}`, { method: 'DELETE' }),

  dashboard: () => request('/reports/dashboard'),
  dailyReport: () => request('/reports/daily'),
  profitReport: (period = 'daily') => request(`/reports/profit?period=${encodeURIComponent(period)}`),

  listStockMovements: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/stock-movements${qs ? `?${qs}` : ''}`);
  },

  expectedCashClose: () => request('/cash-closes/expected'),
  listCashCloses: () => request('/cash-closes'),
  createCashClose: (payload) => request('/cash-closes', { method: 'POST', body: JSON.stringify(payload) }),
  updateCashClose: (id, payload) => request(`/cash-closes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCashClose: (id) => request(`/cash-closes/${id}`, { method: 'DELETE' }),
};

export { getToken };
