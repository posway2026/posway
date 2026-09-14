import { Router } from 'express';
import { readData } from '../db/store.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', authRequired, (req, res) => {
  const data = readData();
  const { start: todayStart, end: todayEnd } = getPeriodRange('daily');
  const { start: monthStart, end: monthEnd } = getPeriodRange('monthly');

  const currentSales = Array.isArray(data.sales) ? data.sales : [];
  const currentSaleItems = Array.isArray(data.sale_items) ? data.sale_items : [];
  const currentSaleIds = new Set(currentSales.map((s) => Number(s.id)));

  const todaySalesArr = currentSales.filter((s) => {
    const d = new Date(s.created_at);
    return d >= todayStart && d <= todayEnd;
  });
  const monthSalesArr = currentSales.filter((s) => {
    const d = new Date(s.created_at);
    return d >= monthStart && d <= monthEnd;
  });

  const totalDebtRaw = currentSales.reduce((sum, s) => sum + Number(s.debt_amount || 0), 0);
  const totalPaidDebt = (data.debt_payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const lowStockCount = (data.products || []).filter((p) => Number(p.quantity || 0) <= Number(p.min_quantity || 0)).length;

  const validSaleItems = currentSaleItems.filter((it) => currentSaleIds.has(Number(it.sale_id)));
  const productAgg = {};
  for (const it of validSaleItems) {
    const productId = Number(it.product_id);
    const quantity = Number(it.quantity || 0);
    const totalPrice = Number(it.total_price || 0);
    if (!productAgg[productId]) productAgg[productId] = { product_name: it.product_name, total_qty: 0, total_sum: 0 };
    productAgg[productId].total_qty += quantity;
    productAgg[productId].total_sum += totalPrice;
  }

  const topProducts = Object.values(productAgg)
    .sort((a, b) => b.total_qty - a.total_qty)
    .slice(0, 5);

  // (34) Aralash to'lov tufayli bitta sotuv ham naqd, ham karta ulushiga
  // ega bo'lishi mumkin — shuning uchun payment_type bo'yicha filtrlash
  // o'rniga har bir sotuvning paid_naqd/paid_karta maydonlarini to'g'ridan-
  // to'g'ri yig'amiz (bu qarzga qisman to'langan sotuvlarning upfront
  // qismini ham to'g'ri hisobga oladi).
  const todayCash = todaySalesArr.reduce((s, x) => s + Number(x.paid_naqd || 0), 0);
  const todayCard = todaySalesArr.reduce((s, x) => s + Number(x.paid_karta || 0), 0);
  const todayDebt = todaySalesArr.reduce((s, x) => s + Number(x.debt_amount || 0), 0);

  // (17) Kassada real qancha naqt/karta pul borligi — barcha davr bo'yicha:
  // savdodan kelgan pul + qarz to'lovlaridan kelgan pul − xarajatlar
  // (shu jumladan mahsulot kirimiga ketgan pul, chunki bu ham kassadan
  // haqiqatda chiqib ketgan pul) − ta'minotchilarga qilingan to'lovlar.
  // (28) Ta'minotchiga to'lov — kassadan chiqadigan haqiqiy pul, shuning
  // uchun bu ham cashOut/cardOut hisobiga kiradi; bekor qilingan
  // to'lovlar (cancelled: true) esa hisobga olinmaydi.
  // (34) Sotuvdan kelgan naqt/karta ulushini endi payment_type bo'yicha
  // filtrlash o'rniga har bir sotuvning paid_naqd/paid_karta maydonidan
  // to'g'ridan-to'g'ri olamiz — bu aralash to'lovni va qarzga qisman
  // to'langan upfront qismning haqiqiy (naqd/karta) tarkibini to'g'ri
  // hisoblaydi (eski sotuvlar uchun store.js'dagi bir martalik migratsiya
  // shu maydonlarni orqaga qarab to'ldirib qo'ygan).
  const allSales = currentSales;
  const allCashMovements = Array.isArray(data.cash_movements) ? data.cash_movements : [];
  const allDebtPayments = Array.isArray(data.debt_payments) ? data.debt_payments : [];
  const allSupplierPayments = (Array.isArray(data.supplier_debt_payments) ? data.supplier_debt_payments : [])
    .filter((p) => !p.cancelled);

  const cashIn = allSales.reduce((s, x) => s + Number(x.paid_naqd || 0), 0)
    + allDebtPayments.filter((p) => (p.payment_method || 'naqd') === 'naqd').reduce((s, p) => s + Number(p.amount || 0), 0);
  const cashOut = allCashMovements.filter((m) => (m.payment_method || 'naqd') === 'naqd').reduce((s, m) => s + Number(m.amount || 0), 0)
    + allSupplierPayments.filter((p) => (p.payment_method || 'naqd') === 'naqd').reduce((s, p) => s + Number(p.amount || 0), 0);
  const cashOnHand = cashIn - cashOut;

  const cardIn = allSales.reduce((s, x) => s + Number(x.paid_karta || 0), 0)
    + allDebtPayments.filter((p) => p.payment_method === 'karta').reduce((s, p) => s + Number(p.amount || 0), 0);
  const cardOut = allCashMovements.filter((m) => m.payment_method === 'karta').reduce((s, m) => s + Number(m.amount || 0), 0)
    + allSupplierPayments.filter((p) => p.payment_method === 'karta').reduce((s, p) => s + Number(p.amount || 0), 0);
  const cardOnHand = cardIn - cardOut;

  res.json({
    todaySales: { total: todaySalesArr.reduce((s, x) => s + Number(x.total_amount || 0), 0), count: todaySalesArr.length },
    todayBreakdown: { naqd: todayCash, karta: todayCard, qarz: todayDebt },
    cashOnHand,
    cardOnHand,
    monthSales: { total: monthSalesArr.reduce((s, x) => s + Number(x.total_amount || 0), 0), count: monthSalesArr.length },
    totalDebt: totalDebtRaw - totalPaidDebt,
    lowStockCount,
    productTypeCount: (data.products || []).length,
    productUnitCount: (data.products || []).reduce((sum, p) => sum + (Number(p.quantity) || 0), 0),
    topProducts,
  });
});

router.get('/daily', authRequired, (req, res) => {
  const data = readData();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const recent = data.sales.filter((s) => new Date(s.created_at) >= cutoff);
  const byDay = {};
  for (const s of recent) {
    const day = s.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + s.total_amount;
  }
  const rows = Object.entries(byDay)
    .map(([day, total]) => ({ day, total }))
    .sort((a, b) => a.day.localeCompare(b.day));
  res.json(rows);
});

// Do'kon Toshkentda joylashgan (UTC+5, yozgi vaqtga o'tish yo'q).
// Render kabi hosting serverlari odatda UTC vaqt zonasida ishlaydi, shuning
// uchun "bugungi kun"ni server vaqtiga qarab hisoblasak, tunning boshlanish
// qismida (00:00-04:59 mahalliy vaqt) yozilgan yozuvlar noto'g'ri kunga
// tushib qolishi mumkin edi. Shu sababli kun chegaralarini doim Toshkent
// vaqtida hisoblaymiz.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

function getPeriodRange(period = 'daily') {
  // Hozirgi vaqtni Toshkent vaqtiga "siljitib" olamiz, shunda UTC
  // metodlar (setUTCHours va h.k.) aslida mahalliy kunni hisoblaydi.
  const nowLocal = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const startLocal = new Date(nowLocal);
  const endLocal = new Date(nowLocal);

  if (period === 'monthly') {
    startLocal.setUTCDate(1);
    startLocal.setUTCHours(0, 0, 0, 0);
    endLocal.setUTCMonth(endLocal.getUTCMonth() + 1, 0);
    endLocal.setUTCHours(23, 59, 59, 999);
  } else if (period === 'yearly') {
    startLocal.setUTCMonth(0, 1);
    startLocal.setUTCHours(0, 0, 0, 0);
    endLocal.setUTCMonth(11, 31);
    endLocal.setUTCHours(23, 59, 59, 999);
  } else {
    startLocal.setUTCHours(0, 0, 0, 0);
    endLocal.setUTCHours(23, 59, 59, 999);
  }

  // Mahalliy chegaralarni haqiqiy UTC vaqtiga qaytaramiz (taqqoslash uchun).
  const start = new Date(startLocal.getTime() - TASHKENT_OFFSET_MS);
  const end = new Date(endLocal.getTime() - TASHKENT_OFFSET_MS);

  return { start, end };
}

router.get('/profit', authRequired, (req, res) => {
  const { period = 'daily' } = req.query;
  const data = readData();
  const { start, end } = getPeriodRange(period);

  const salesInPeriod = (data.sales || []).filter((sale) => {
    const saleDate = new Date(sale.created_at);
    return saleDate >= start && saleDate <= end;
  });

  const saleIds = new Set(salesInPeriod.map((sale) => sale.id));
  const saleItemsInPeriod = (data.sale_items || []).filter((item) => saleIds.has(item.sale_id));

  const totalSales = salesInPeriod.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0);
  const totalCost = saleItemsInPeriod.reduce((sum, item) => {
    const product = (data.products || []).find((p) => Number(p.id) === Number(item.product_id));
    const unitCost = Number(product?.costPrice ?? product?.purchase_price ?? 0) || 0;
    const quantity = Number(item.quantity || 0);
    return sum + unitCost * quantity;
  }, 0);

  // (16) Mahsulot kirimiga (aylanma mablag'ga) ketgan pul xarajat sifatida
  // hisoblanmaydi — chunki tan narx allaqachon yuqorida totalCost orqali
  // har bir sotuvda hisobga olingan. Faqat haqiqiy, qaytmaydigan xarajatlar
  // (maosh, kommunalka va h.k.) "Jami xarajat"ga kiradi.
  const expensesInPeriod = (data.cash_movements || []).filter((item) => {
    const d = new Date(item.date_time || item.created_at || 0);
    return d >= start && d <= end && !item.is_inventory;
  });
  const totalExpenses = expensesInPeriod.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  // (11) Qarzga sotilgan mahsulotning foydasi mijoz qarzni to'lamaguncha
  // "real" hisoblanmaydi. Sotuv vaqtida faqat to'langan qism (paid_amount)
  // real tushum hisoblanadi; qarz to'langan payt (debt_payments) o'sha
  // davrning real foydasiga qo'shiladi, chunki tan narx allaqachon sotuv
  // vaqtida bir marta ayirilgan.
  const naqdKartaRevenue = salesInPeriod
    .filter((s) => s.payment_type !== 'qarz')
    .reduce((sum, s) => sum + Number(s.total_amount || 0), 0);
  const qarzSalesPaidNow = salesInPeriod
    .filter((s) => s.payment_type === 'qarz')
    .reduce((sum, s) => sum + Number(s.paid_amount || 0), 0);
  const debtCollectedInPeriod = (data.debt_payments || [])
    .filter((p) => {
      const d = new Date(p.created_at || 0);
      return d >= start && d <= end;
    })
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const realizedRevenue = naqdKartaRevenue + qarzSalesPaidNow + debtCollectedInPeriod;
  const kassaFoyda = realizedRevenue - totalCost - totalExpenses;

  // (22) "Kutilayotgan foyda" — hali to'lanmagan qarzlar ichida "qulflangan"
  // FOYDA (marja) qismi, qarzning to'liq summasi emas. Har bir sotuv o'z
  // marjasini (margin) va qarz qoldig'ini (debt_remaining) saqlaydi;
  // mijoz qarzni qisman to'lasa ham, mutanosib ravishda marja realizatsiya
  // qilingan hisoblanadi (bu allaqachon debt_remaining orqali /pay
  // endpointida hisobga olingan). Bu ko'rsatkich TANLANGAN DAVRGA
  // BOG'LIQ EMAS — har doim joriy umumiy holatni ko'rsatadi.
  const kutilayotganFoyda = (data.sales || []).reduce((sum, sale) => {
    const debtRemaining = Number(sale.debt_remaining ?? sale.debt_amount ?? 0);
    if (debtRemaining <= 0) return sum;
    const totalAmount = Number(sale.total_amount || 0);
    const margin = Number(sale.margin ?? 0);
    if (totalAmount <= 0) return sum;
    return sum + margin * (debtRemaining / totalAmount);
  }, 0);

  // Eski nom (netProfit) muvofiqlik uchun endi "kassaFoyda" bilan bir xil qiymatni bildiradi.
  const netProfit = kassaFoyda;

  res.json({
    period,
    start: start.toISOString(),
    end: end.toISOString(),
    totalSales,
    totalCost,
    totalExpenses,
    netProfit,
    kassaFoyda,
    kutilayotganFoyda,
    salesCount: salesInPeriod.length,
    expenseCount: expensesInPeriod.length,
  });
});

export default router;
