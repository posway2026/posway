import { Router } from 'express';
import { readData, writeData, nextId } from '../db/store.js';
import { authRequired } from '../middleware/auth.js';
import { logStockMovement } from '../lib/stockMovements.js';
import { computeItemsValue, processReturnItems, computeReturnFinancials, applyReturnToSale, logRefundCashMovement } from '../lib/returns.js';

const router = Router();

router.post('/', authRequired, (req, res) => {
  const { customer_id, items, paid_amount, payment_type, discount_type, discount_value, paid_naqd, paid_karta, due_date } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Mahsulot tanlanmagan' });

  const data = readData();

  for (const it of items) {
    const p = data.products.find((pp) => pp.id == it.product_id);
    if (!p) return res.status(400).json({ error: `Mahsulot topilmadi (ID: ${it.product_id})` });
    if (p.quantity < it.quantity) {
      return res.status(400).json({ error: `"${p.name}" dan yetarli qoldiq yo'q (bor: ${p.quantity})` });
    }
  }

  // (2) Tovar darajasidagi chegirma allaqachon `unit_price` ichida keladi
  // (frontend savatda narxni to'g'ridan-to'g'ri tahrirlaydi). Bu yerda
  // qo'shimcha ravishda umumiy chek chegirmasini (foiz yoki aniq summa)
  // qo'llaymiz — subtotal_amount dan ayirib, yakuniy total_amount ni
  // hosil qilamiz. Chegirma hech qachon subtotal'dan oshib, manfiy
  // summa hosil qilmasligi uchun cheklanadi.
  const subtotal_amount = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);
  let discount_amount = 0;
  if (discount_type === 'percent') {
    discount_amount = (subtotal_amount * (Number(discount_value) || 0)) / 100;
  } else if (discount_type === 'fixed') {
    discount_amount = Number(discount_value) || 0;
  }
  discount_amount = Math.min(subtotal_amount, Math.max(0, discount_amount));
  const total_amount = subtotal_amount - discount_amount;

  // (34) Aralash to'lov: "hozir to'langan" summa endi naqd va karta
  // o'rtasida bo'linishi mumkin (masalan 100,000 so'mlik chekni 70,000
  // naqd + 30,000 karta qilib to'lash). Yangi frontend buni to'g'ridan-
  // to'g'ri paid_naqd/paid_karta sifatida yuboradi — qarzga sotishda ham
  // (hozir to'langan qismi bo'lsa) xuddi shunday. Agar ikkalasi ham
  // yuborilmagan bo'lsa (eski, hali yangilanmagan frontend so'rovi) —
  // avvalgi xatti-harakatni aynan takrorlaymiz: hammasi bitta turga
  // ('karta' bo'lsa kartaga, aks holda naqdga) tegishli bo'ladi.
  let paidNaqd = Number(paid_naqd) || 0;
  let paidKarta = Number(paid_karta) || 0;
  if (paid_naqd === undefined && paid_karta === undefined) {
    const legacyPaid = Number(paid_amount ?? total_amount) || 0;
    if (payment_type === 'karta') paidKarta = legacyPaid;
    else paidNaqd = legacyPaid;
  }
  paidNaqd = Math.max(0, paidNaqd);
  paidKarta = Math.max(0, paidKarta);
  let paid = paidNaqd + paidKarta;
  if (paid > total_amount && paid > 0) {
    // Xato/ortiqcha kiritilgan bo'lsa, nisbatni saqlagan holda umumiy
    // summaga cheklaymiz — manfiy yoki haddan tashqari qiymat chiqmasin.
    paidNaqd = Math.round(paidNaqd * (total_amount / paid));
    paidKarta = total_amount - paidNaqd;
    paid = total_amount;
  }
  const debt_amount = Math.max(0, total_amount - paid);

  // Sotuvning umumiy "turi" — hisobotlarda va chekda ko'rsatish uchun.
  // Qarz qoldig'i bo'lsa har doim 'qarz' (upfront qismning naqd/karta
  // bo'linishidan qat'iy nazar); to'liq to'langan bo'lsa va ikkala tur
  // ham ishlatilgan bo'lsa — 'aralash'.
  let resolvedPaymentType;
  if (debt_amount > 0) resolvedPaymentType = 'qarz';
  else if (paidNaqd > 0 && paidKarta > 0) resolvedPaymentType = 'aralash';
  else if (paidKarta > 0) resolvedPaymentType = 'karta';
  else resolvedPaymentType = 'naqd';

  // (22) Sotuv vaqtida tan narxni "qulflab qo'yamiz" — mahsulotning
  // keyinchalik narxi o'zgarsa ham, shu sotuvning marjasi (foydasi)
  // o'zgarmay qoladi. debt_remaining boshida to'liq qarz summasiga teng,
  // mijoz qarzni to'lagan sari (customers.js/:id/pay) kamayib boradi.
  // Chegirma (tovar yoki chek darajasida) total_amount orqali marjaga
  // avtomatik ta'sir qiladi — tan narx (cost_amount) o'zgarmaydi, faqat
  // foyda kamayadi, bu to'g'ri: chegirma foydadan "yeydi", tan narxdan emas.
  const cost_amount = items.reduce((sum, it) => {
    const product = data.products.find((pp) => pp.id == it.product_id);
    const unitCost = Number(product?.costPrice ?? product?.purchase_price ?? 0) || 0;
    return sum + unitCost * Number(it.quantity || 0);
  }, 0);
  const margin = total_amount - cost_amount;

  const saleId = nextId(data, 'sales');
  data.sales.push({
    id: saleId,
    customer_id: customer_id || null,
    user_id: req.user.id,
    subtotal_amount,
    discount_type: discount_amount > 0 ? (discount_type === 'percent' ? 'percent' : 'fixed') : null,
    discount_value: discount_amount > 0 ? Number(discount_value) || 0 : 0,
    discount_amount,
    total_amount,
    paid_amount: paid,
    paid_naqd: paidNaqd,
    paid_karta: paidKarta,
    debt_amount,
    debt_remaining: debt_amount,
    // (1) Qarzga sotishda kassadan to'g'ridan-to'g'ri to'lov muddatini
    // belgilash mumkin (keyinroq Mijozlar → Tarix'dan ham o'zgartirish
    // mumkin) — faqat haqiqatan ham qarz qolganda saqlanadi.
    due_date: debt_amount > 0 && due_date ? String(due_date).slice(0, 10) : null,
    cost_amount,
    margin,
    payment_type: resolvedPaymentType,
    created_at: new Date().toISOString(),
  });

  const customerName = customer_id ? data.customers.find((c) => c.id == customer_id)?.full_name || null : null;

  for (const it of items) {
    const itemId = nextId(data, 'sale_items');
    data.sale_items.push({
      id: itemId,
      sale_id: saleId,
      product_id: it.product_id,
      product_name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      total_price: it.quantity * it.unit_price,
      // (37) "Kafolat" — savatning shu qatoriga qo'yilgan kafolat kun soni
      // (ixtiyoriy, standart 0 = kafolatsiz). Faqat chekda ko'rsatish uchun —
      // moliyaviy hisob-kitoblarga (foyda, qarz va h.k.) ta'sir qilmaydi.
      warranty_days: Math.max(0, Math.round(Number(it.warranty_days) || 0)),
    });
    const p = data.products.find((pp) => pp.id == it.product_id);
    p.quantity -= it.quantity;
    p.sold_count = Number(p.sold_count || 0) + Number(it.quantity || 0);
    p.sales_count = Number(p.sales_count || 0) + Number(it.quantity || 0);
    // (27) "Uzoq vaqt sotilmagan" filtri uchun — har bir mahsulot oxirgi
    // marta qachon sotilganini kuzatib boramiz.
    p.last_sold_at = new Date().toISOString();

    // (32/42) Har bir sotilgan band harakatlar jurnaliga yoziladi — bu
    // yozuv sotuv keyinchalik qaytarilib/o'chirilib ketsa ham O'ZGARMAY
    // qoladi, shuning uchun mahsulot va umumiy tarix hech qachon "sotuv
    // bo'lgan edi" izini yo'qotmaydi.
    logStockMovement(data, {
      product_id: it.product_id,
      product_name: it.product_name,
      type: 'sotuv',
      quantity_delta: -Number(it.quantity || 0),
      unit_price: it.unit_price,
      payment_type: resolvedPaymentType,
      customer_name: customerName,
      source_type: 'sale',
      source_id: saleId,
      performed_by: req.user?.full_name,
    });
  }

  writeData(data);
  res.json({
    id: saleId,
    subtotal_amount,
    discount_amount,
    total_amount,
    paid_amount: paid,
    paid_naqd: paidNaqd,
    paid_karta: paidKarta,
    debt_amount,
    payment_type: resolvedPaymentType,
  });
});

router.get('/', authRequired, (req, res) => {
  const { from, to } = req.query;
  const data = readData();
  let rows = data.sales;
  if (from && to) {
    rows = rows.filter((s) => {
      const day = s.created_at.slice(0, 10);
      return day >= from && day <= to;
    });
  }
  rows = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!(from && to)) rows = rows.slice(0, 200);

  const withNames = rows.map((s) => ({
    ...s,
    customer_name: data.customers.find((c) => c.id == s.customer_id)?.full_name || null,
    seller_name: data.users.find((u) => u.id == s.user_id)?.full_name || '',
  }));
  res.json(withNames);
});

router.get('/:id', authRequired, (req, res) => {
  const data = readData();
  const sale = data.sales.find((s) => s.id == req.params.id);
  if (!sale) return res.status(404).json({ error: 'Topilmadi' });
  const items = data.sale_items.filter((it) => it.sale_id == req.params.id);
  res.json({ sale, items });
});

// (29/33/39) Sotuvni to'liq yoki QISMAN qaytarish. `returnItemIds` orqali
// chekdagi faqat BA'ZI mahsulotlarni tanlab qaytarish mumkin (yuborilmasa —
// eski xatti-harakat: barcha bandlar qaytariladi). Har bir band uchun
// holatini tanlash mumkin — `itemConditions: { [sale_item_id]: 'defective' }`
// ('defective' bo'lsa qoldiqqa qaytarilmay, avtomatik hisobdan chiqariladi).
// Qaytarilgan qismning summasi AVVAL shu chekning qarz qoldig'idan
// yechiladi (bu pul hali yig'ib olinmagan edi); undan ORTIG'I esa
// ALLAQACHON naqd/karta orqali yig'ib olingan hisoblanadi va mijozga
// jismonan qaytarib berilishi SHART — buni qanday (necha so'm naqd / necha
// so'm karta) qaytarganini `refund: { naqd, karta }` orqali ko'rsatish
// kerak, aks holda so'rov 400 xatolik bilan aniq kerakli summani qaytaradi.
// Bu alohida, aniq Kassa harakati sifatida yoziladi (foyda hisobotida ikki
// marta hisoblanmasligi uchun belgilanadi — lib/returns.js'ga qarang).
// Agar tanlangan bandlar chekning BARCHA joriy bandlarini qamrab olsa —
// bu TO'LIQ qaytarish, chek butunlay o'chiriladi (avvalgidek); aks holda
// chek saqlanib qoladi, faqat summalari mos ravishda kamayadi va
// `return_history`ga yozuv qo'shiladi (tarixiy shaffoflik uchun).
router.delete('/:id', authRequired, (req, res) => {
  const data = readData();
  const sale = data.sales.find((s) => s.id == req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sotuv topilmadi' });

  const allItems = data.sale_items.filter((item) => item.sale_id == req.params.id);
  const requestedIds = Array.isArray(req.body?.returnItemIds)
    ? req.body.returnItemIds.map(Number)
    : allItems.map((i) => i.id);
  const itemsToReturn = allItems.filter((i) => requestedIds.includes(i.id));
  const remainingItems = allItems.filter((i) => !requestedIds.includes(i.id));
  const isFullReturn = remainingItems.length === 0;

  if (allItems.length > 0 && itemsToReturn.length === 0) {
    return res.status(400).json({ error: 'Qaytarish uchun kamida bitta mahsulot tanlang' });
  }

  const itemConditions = (req.body && typeof req.body.itemConditions === 'object' && req.body.itemConditions) || {};
  const now = new Date().toISOString();
  const customerName = sale.customer_id ? data.customers.find((c) => c.id == sale.customer_id)?.full_name || null : null;

  // MUHIM: avval PUL hisob-kitobini (o'zgartirmasdan) tekshiramiz, faqat
  // shundan keyingina omborni o'zgartiruvchi processReturnItems() chaqiriladi
  // — aks holda 400 bilan to'xtasak ham ombor allaqachon o'zgargan bo'lardi
  // (readData() jonli obyekt qaytaradi).
  const { returnedSubtotal, returnedCost } = computeItemsValue(data, itemsToReturn);
  const financials = computeReturnFinancials(sale, returnedSubtotal, returnedCost);

  const refundInput = (req.body && typeof req.body.refund === 'object' && req.body.refund) || {};
  const refund = { naqd: Math.max(0, Number(refundInput.naqd) || 0), karta: Math.max(0, Number(refundInput.karta) || 0) };
  const providedRefund = refund.naqd + refund.karta;

  if (financials.remainderNeedingRefund > 0 && Math.abs(providedRefund - financials.remainderNeedingRefund) > 1) {
    return res.status(400).json({
      error: `Mijoz bu mahsulot(lar) uchun allaqachon ${Math.round(financials.remainderNeedingRefund).toLocaleString('uz-UZ')} so'm to'lagan — qaytarishni yakunlash uchun buni naqd/karta bo'yicha qanday qaytarib berganingizni ko'rsating.`,
      remainderNeedingRefund: financials.remainderNeedingRefund,
    });
  }

  const { writtenOff, returnedSummary } = processReturnItems(data, {
    saleItems: itemsToReturn,
    itemConditions,
    customerName,
    performedBy: req.user?.full_name,
    saleId: sale.id,
    now,
    restockNote: "Sotuv qaytarildi — qoldiqqa qaytarildi",
    writeoffNote: 'Sotuv qaytarildi — mahsulot yaroqsiz, hisobdan chiqarildi',
    writeoffReason: 'qaytarish_yaroqsiz',
  });

  const { refundNaqd, refundKarta } = applyReturnToSale(sale, financials, refund);

  if (refundNaqd > 0 || refundKarta > 0) {
    const refundNote = `Chek #${sale.id}${customerName ? ' — ' + customerName : ''} qaytarildi: ${returnedSummary.map((r) => `${r.product_name} x${r.quantity}`).join(', ')}`;
    if (refundNaqd > 0) logRefundCashMovement(data, { amount: refundNaqd, payment_method: 'naqd', note: refundNote, user: req.user });
    if (refundKarta > 0) logRefundCashMovement(data, { amount: refundKarta, payment_method: 'karta', note: refundNote, user: req.user });
  }

  if (isFullReturn) {
    data.sale_items = data.sale_items.filter((item) => item.sale_id != req.params.id);
    data.sales = data.sales.filter((s) => s.id != req.params.id);
  } else {
    const returnedIds = new Set(itemsToReturn.map((i) => i.id));
    data.sale_items = data.sale_items.filter((item) => !(item.sale_id == req.params.id && returnedIds.has(item.id)));
    if (!Array.isArray(sale.return_history)) sale.return_history = [];
    sale.return_history.push({
      at: now,
      by: req.user?.full_name || null,
      kind: 'partial_return',
      items: returnedSummary,
      returnedValue: financials.returnedValue,
      refund: { naqd: refundNaqd, karta: refundKarta },
    });
  }

  writeData(data);
  res.json({ success: true, writtenOff, partial: !isFullReturn, refunded: { naqd: refundNaqd, karta: refundKarta } });
});

// (yangi/39) Qarzni yopish — mijoz to'lamay qolgan (masalan mijoz
// o'chirilishidan oldin) sotuvning qarz qoldig'ini yopish uchun.
// Yuqoridagi DELETE /:id (29/33) dan farqli o'laroq, bu chekni YO'Q
// QILMAYDI — sotuv yozuvi tarix uchun saqlanib qoladi, faqat: (1) har bir
// tovar-band uchun holati bo'yicha — 'sellable' bo'lsa qoldiqqa
// qaytariladi, 'defective' bo'lsa hisobdan chiqariladi (stock_writeoffs),
// (2) mahsulotlar chekdan olib tashlanadi (aks holda /profit hisoboti
// ularning tan narxini noto'g'ri hisoblab qolaveradi) va (3) sotuvning
// barcha summalari (subtotal/chegirma/jami/tan narx/marja/qarz) nolga
// tushiriladi. Agar mijoz bu chek uchun OLDINDAN biroz naqd/karta to'lagan
// bo'lsa-yu, endi tovar qaytarib olinayotgan bo'lsa — o'sha to'langan
// qismni ham mijozga jismonan qaytarib berish SHART (DELETE /:id dagi bilan
// bir xil `refund: { naqd, karta }` mexanizmi). Mahsulotsiz (qo'lda
// kiritilgan eski qarz, is_manual_debt) sotuvlarda sale_items bo'lmaydi —
// bunday holda hech qanday tovar/pul harakati yo'q, shunchaki qarz
// kechiriladi.
router.post('/:id/close-debt', authRequired, (req, res) => {
  const data = readData();
  const sale = data.sales.find((s) => s.id == req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sotuv topilmadi' });

  const remaining = Number(sale.debt_remaining ?? sale.debt_amount ?? 0);
  if (remaining <= 0) return res.status(400).json({ error: "Bu xariddan qarz qoldig'i yo'q" });

  const now = new Date().toISOString();
  const allItems = data.sale_items.filter((item) => item.sale_id == sale.id);

  if (allItems.length === 0) {
    sale.debt_remaining = 0;
    sale.debt_closed_at = now;
    sale.debt_closed_by = req.user.id;
    sale.debt_resolution = 'forgiven';
    writeData(data);
    return res.json({ success: true, writtenOff: [], resolution: 'forgiven', refunded: { naqd: 0, karta: 0 } });
  }

  const itemConditions = (req.body && typeof req.body.itemConditions === 'object' && req.body.itemConditions) || {};
  const customerName = sale.customer_id ? data.customers.find((c) => c.id == sale.customer_id)?.full_name || null : null;

  // MUHIM: avval PUL hisob-kitobini (o'zgartirmasdan) tekshiramiz — DELETE
  // /:id dagi bilan bir xil sabab (yuqoridagi izohga qarang).
  const { returnedSubtotal, returnedCost } = computeItemsValue(data, allItems);
  const financials = computeReturnFinancials(sale, returnedSubtotal, returnedCost);

  const refundInput = (req.body && typeof req.body.refund === 'object' && req.body.refund) || {};
  const refund = { naqd: Math.max(0, Number(refundInput.naqd) || 0), karta: Math.max(0, Number(refundInput.karta) || 0) };
  const providedRefund = refund.naqd + refund.karta;

  if (financials.remainderNeedingRefund > 0 && Math.abs(providedRefund - financials.remainderNeedingRefund) > 1) {
    return res.status(400).json({
      error: `Mijoz bu xarid uchun allaqachon ${Math.round(financials.remainderNeedingRefund).toLocaleString('uz-UZ')} so'm to'lagan — mahsulot(lar) qaytarib olinayotgani uchun buni naqd/karta bo'yicha qanday qaytarib berganingizni ko'rsating.`,
      remainderNeedingRefund: financials.remainderNeedingRefund,
    });
  }

  const { writtenOff, returnedSummary, restockedCount, writtenOffCount } = processReturnItems(data, {
    saleItems: allItems,
    itemConditions,
    customerName,
    performedBy: req.user?.full_name,
    saleId: sale.id,
    now,
    restockNote: "Qarz yopildi — qoldiqqa qaytarildi",
    writeoffNote: 'Qarz yopildi — mahsulot yaroqsiz, hisobdan chiqarildi',
    writeoffReason: 'qarz_yopish',
  });

  const { refundNaqd, refundKarta } = applyReturnToSale(sale, financials, refund);

  data.sale_items = data.sale_items.filter((item) => item.sale_id != sale.id);

  if (refundNaqd > 0 || refundKarta > 0) {
    const refundNote = `Chek #${sale.id}${customerName ? ' — ' + customerName : ''} qarzi yopildi, oldindan to'langan qism qaytarildi`;
    if (refundNaqd > 0) logRefundCashMovement(data, { amount: refundNaqd, payment_method: 'naqd', note: refundNote, user: req.user });
    if (refundKarta > 0) logRefundCashMovement(data, { amount: refundKarta, payment_method: 'karta', note: refundNote, user: req.user });
  }

  sale.debt_remaining = 0;
  sale.debt_closed_at = now;
  sale.debt_closed_by = req.user.id;
  sale.debt_resolution = writtenOffCount > 0 && restockedCount > 0
    ? 'mixed'
    : writtenOffCount > 0
      ? 'writeoff'
      : restockedCount > 0
        ? 'restock'
        : 'forgiven';

  if (!Array.isArray(sale.return_history)) sale.return_history = [];
  sale.return_history.push({
    at: now,
    by: req.user?.full_name || null,
    kind: 'close_debt',
    items: returnedSummary,
    returnedValue: financials.returnedValue,
    refund: { naqd: refundNaqd, karta: refundKarta },
  });

  writeData(data);
  res.json({ success: true, writtenOff, resolution: sale.debt_resolution, refunded: { naqd: refundNaqd, karta: refundKarta } });
});

export default router;
