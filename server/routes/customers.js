import { Router } from 'express';
import { readData, writeData, nextId } from '../db/store.js';
import { authRequired, roleRequired } from '../middleware/auth.js';

const router = Router();

// (yangi) Mijozning joriy qarzini endi har bir sotuvning debt_remaining
// (FIFO to'lovlar orqali yangilanib boruvchi, joriy qoldiq) maydonlari
// yig'indisi sifatida hisoblaymiz. Avvalgi usul (debt_amount yig'indisi
// minus debt_payments yig'indisi) "Qarzni yopish" (hisobdan chiqarish
// yoki mahsulotni qaytarib olish) orqali yopilgan qarzni hisobga
// olmasdi — chunki bunday yopilish debt_payments jadvaliga yozuv
// qo'shmaydi, faqat tegishli sotuvning debt_remaining'ini to'g'ridan-
// to'g'ri nolga tushiradi (sales.js /:id/close-debt).
function currentDebtFor(data, customerId) {
  return data.sales
    .filter((s) => s.customer_id == customerId)
    .reduce((sum, s) => sum + Number(s.debt_remaining ?? s.debt_amount ?? 0), 0);
}

// (1) Qarzning to'lov muddati — har bir qarzli sotuv (yoki qo'lda
// kiritilgan eski qarz) o'zining ixtiyoriy due_date maydoniga ega
// bo'lishi mumkin. Mijozlar ro'yxatida eng yaqin muddatni va
// "muddati o'tganmi" belgisini ko'rsatish uchun bu yerda hisoblaymiz —
// haqiqiy tekshiruv har doim sana-string solishtirish orqali (soat
// mintaqasi muammosidan qochish uchun sanalar doim "YYYY-MM-DD" holida
// saqlanadi).
function debtDueSummary(data, customerId) {
  const todayISO = new Date().toISOString().slice(0, 10);
  const dueSales = data.sales.filter(
    (s) => s.customer_id == customerId && Number(s.debt_remaining ?? s.debt_amount ?? 0) > 0 && s.due_date
  );
  if (dueSales.length === 0) return { nearest_due_date: null, overdue_debt: false };
  const sorted = dueSales.slice().sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
  return { nearest_due_date: sorted[0].due_date, overdue_debt: sorted.some((s) => s.due_date < todayISO) };
}

function withDebt(data, c) {
  return { ...c, current_debt: currentDebtFor(data, c.id), ...debtDueSummary(data, c.id) };
}

router.get('/', authRequired, (req, res) => {
  const data = readData();
  // (yangi) "O'chirilgan" (is_deleted) mijozlar ham ro'yxatda ko'rsatiladi
  // (frontend ularni xiraroq va "O'chirilgan" belgisi bilan chizadi) —
  // shunda ularning avvalgi mavjudligi va tarixi ko'zdan yo'qolmaydi,
  // faqat ular bilan yangi ish (to'lov qabul qilish, eski qarz qo'shish)
  // qilib bo'lmaydi. Bazadan esa hech qachon fizik o'chirilmaydi.
  const rows = data.customers
    .map((c) => withDebt(data, c))
    .sort((a, b) => {
      if (!!a.is_deleted !== !!b.is_deleted) return a.is_deleted ? 1 : -1;
      return a.full_name.localeCompare(b.full_name);
    });
  res.json(rows);
});

router.get('/:id', authRequired, (req, res) => {
  const data = readData();
  const customer = data.customers.find((c) => c.id == req.params.id);
  if (!customer) return res.status(404).json({ error: 'Topilmadi' });
  const sales = data.sales
    .filter((s) => s.customer_id == req.params.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const payments = data.debt_payments
    .filter((p) => p.customer_id == req.params.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ customer, sales, payments });
});

router.post('/', authRequired, (req, res) => {
  const { full_name, phone, note } = req.body;
  if (!full_name) return res.status(400).json({ error: 'Ism majburiy' });
  const data = readData();
  const id = nextId(data, 'customers');
  data.customers.push({ id, full_name, phone: phone || '', note: note || '', created_at: new Date().toISOString() });
  writeData(data);
  res.json({ id });
});

router.put('/:id', authRequired, (req, res) => {
  const data = readData();
  const idx = data.customers.findIndex((c) => c.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  const { full_name, phone, note } = req.body;
  data.customers[idx] = { ...data.customers[idx], full_name, phone, note };
  writeData(data);
  res.json({ success: true });
});

router.post('/:id/pay', authRequired, (req, res) => {
  const { amount, note, payment_method } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: "Summani to'g'ri kiriting" });
  const data = readData();
  const customerId = +req.params.id;

  const id = nextId(data, 'debt_payments');
  data.debt_payments.push({
    id,
    customer_id: customerId,
    amount,
    note: note || '',
    payment_method: payment_method === 'karta' ? 'karta' : 'naqd',
    created_at: new Date().toISOString(),
  });

  // (22) To'lovni mijozning eng eski qarzli sotuvidan boshlab (FIFO)
  // taqsimlaymiz, har bir sotuvning debt_remaining qoldig'ini kamaytirib —
  // shunda "kutilayotgan foyda" har doim aniq (faqat to'lanmagan marja
  // qismini) ko'rsatadi.
  const customerSales = data.sales
    .filter((s) => s.customer_id == customerId && Number(s.debt_remaining || 0) > 0)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  let remaining = Number(amount);
  for (const sale of customerSales) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, Number(sale.debt_remaining || 0));
    sale.debt_remaining = Number(sale.debt_remaining || 0) - applied;
    remaining -= applied;
  }

  writeData(data);
  res.json({ success: true });
});

// (30) Ilovadan oldingi eski qarzlarni qo'lda kiritish. Bu haqiqiy sotuv
// emas, shuning uchun "sintetik" (mahsulotsiz) sotuv yozuvi sifatida
// yaratiladi: margin=0 va cost_amount=0 — ya'ni bu qarz hech qachon
// "kutilayotgan foyda"ga qo'shilmaydi (chunki tan narxi noma'lum, uni
// taxmin qilish xato hisobotga olib kelishi mumkin). Faqat qarz sifatida
// kuzatiladi, to'langanda esa oddiy naqt/karta tushumi hisoblanadi.
// `date` maydoni orqali eski sana tanlanishi mumkin, shunda bu "Jami
// savdo" statistikasida noto'g'ri ravishda "bugungi savdo" bo'lib
// ko'rinmaydi.
router.post('/:id/old-debt', authRequired, (req, res) => {
  const { amount, note, date, due_date } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: "Summani to'g'ri kiriting" });
  const data = readData();
  const customerId = +req.params.id;
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Mijoz topilmadi' });

  const created_at = date ? new Date(date).toISOString() : new Date().toISOString();
  const saleId = nextId(data, 'sales');
  data.sales.push({
    id: saleId,
    customer_id: customerId,
    user_id: req.user.id,
    subtotal_amount: Number(amount),
    discount_type: null,
    discount_value: 0,
    discount_amount: 0,
    total_amount: Number(amount),
    paid_amount: 0,
    debt_amount: Number(amount),
    debt_remaining: Number(amount),
    cost_amount: 0,
    margin: 0,
    is_manual_debt: true,
    note: note || "Ilovadan oldingi eski qarz",
    payment_type: 'qarz',
    // (1) Qarz to'lov muddati — ixtiyoriy, "YYYY-MM-DD" ko'rinishida saqlanadi.
    due_date: due_date ? String(due_date).slice(0, 10) : null,
    created_at,
  });
  writeData(data);
  res.json({ success: true, id: saleId });
});

// (1) Har qanday qarzli sotuv (oddiy xarid ham, qo'lda kiritilgan eski
// qarz ham) uchun to'lov muddatini keyinroq belgilash/o'zgartirish/
// tozalash. Faqat shu mijozga tegishli sotuvga ta'sir qilishini
// tekshiramiz (boshqa mijozning sotuvini tasodifan o'zgartirmaslik uchun).
router.put('/:id/sales/:saleId/due-date', authRequired, (req, res) => {
  const data = readData();
  const customerId = +req.params.id;
  const saleId = +req.params.saleId;
  const sale = data.sales.find((s) => s.id == saleId && s.customer_id == customerId);
  if (!sale) return res.status(404).json({ error: 'Qarz yozuvi topilmadi' });
  const { due_date } = req.body;
  sale.due_date = due_date ? String(due_date).slice(0, 10) : null;
  writeData(data);
  res.json({ success: true });
});

// (yangi) Mijozni o'chirish endi haqiqiy sotuv tarixini hech qachon
// yo'q qilmaydi. Agar qarzi bo'lsa — o'chirish taqiqlanadi (avval qarz
// to'liq yopilishi yoki hisobdan chiqarilishi kerak). Qarzi yo'q bo'lsa —
// yozuv bazadan o'chirilmaydi, faqat is_deleted=true qilib "yashiriladi":
// shu orqali barcha eski sotuvlari, chek tafsilotlari va Hisobotlar/foyda
// hisob-kitoblari o'zgarmay qoladi, faqat mijoz faol ro'yxatdan chiqib
// ketadi (avval bu yerda hammasi — hatto to'liq to'langan eski xaridlar
// ham — butunlay va qaytarib bo'lmaydigan tarzda o'chirilardi).
router.delete('/:id', authRequired, roleRequired('admin'), (req, res) => {
  const data = readData();
  const customerId = Number(req.params.id);
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return res.status(404).json({ error: 'Mijoz topilmadi' });

  const debt = currentDebtFor(data, customerId);
  if (debt > 0) {
    return res.status(400).json({
      error: `Bu mijozning ${Math.round(debt).toLocaleString('uz-UZ')} so'm qarzi bor — avval to'liq to'lov qabul qiling yoki "Tarix" oynasida har bir qarzli xarid uchun "Qarzni yopish" orqali (mahsulotni qoldiqqa qaytarish yoki hisobdan chiqarish) qarzni yoping, keyin o'chirishingiz mumkin.`,
    });
  }

  customer.is_deleted = true;
  customer.deleted_at = new Date().toISOString();

  writeData(data);
  res.json({ success: true });
});

// (yangi) Xato bosilgan yoki fikr o'zgargan "o'chirish"ni bekor qilish —
// mijozni qayta faollashtiradi, hech qanday tarix o'zgarmagan edi.
router.post('/:id/restore', authRequired, roleRequired('admin'), (req, res) => {
  const data = readData();
  const customer = data.customers.find((c) => c.id == req.params.id);
  if (!customer) return res.status(404).json({ error: 'Mijoz topilmadi' });
  customer.is_deleted = false;
  customer.deleted_at = null;
  writeData(data);
  res.json({ success: true });
});

export default router;
