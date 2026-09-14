import { Router } from 'express';
import { readData, writeData, nextId } from '../db/store.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

router.post('/', authRequired, (req, res) => {
  const { customer_id, items, paid_amount, payment_type, discount_type, discount_value, paid_naqd, paid_karta } = req.body;
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
    cost_amount,
    margin,
    payment_type: resolvedPaymentType,
    created_at: new Date().toISOString(),
  });

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
    });
    const p = data.products.find((pp) => pp.id == it.product_id);
    p.quantity -= it.quantity;
    p.sold_count = Number(p.sold_count || 0) + Number(it.quantity || 0);
    p.sales_count = Number(p.sales_count || 0) + Number(it.quantity || 0);
    // (27) "Uzoq vaqt sotilmagan" filtri uchun — har bir mahsulot oxirgi
    // marta qachon sotilganini kuzatib boramiz.
    p.last_sold_at = new Date().toISOString();
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

// (33) Sotuvni qaytarish/bekor qilish. Har bir mahsulot uchun holatini
// tanlash mumkin — frontend `itemConditions: { [sale_item_id]: 'defective' }`
// ko'rinishida yuboradi (ko'rsatilmagan yoki 'sellable' bo'lgan har qanday
// band — standart, eski xatti-harakat bilan bir xil: qoldiqqa qaytariladi).
// 'defective' deb belgilangan band esa QOLDIQQA QAYTARILMAYDI — o'rniga
// bitta amal ichida, qo'shimcha qadamsiz, avtomatik hisobdan chiqariladi
// (stock_writeoffs jadvaliga yoziladi).
router.delete('/:id', authRequired, (req, res) => {
  const data = readData();
  const sale = data.sales.find((s) => s.id == req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sotuv topilmadi' });

  const itemConditions = (req.body && typeof req.body.itemConditions === 'object' && req.body.itemConditions) || {};
  if (!Array.isArray(data.stock_writeoffs)) data.stock_writeoffs = [];
  const now = new Date().toISOString();
  const writtenOff = [];

  for (const it of data.sale_items.filter((item) => item.sale_id == req.params.id)) {
    const product = data.products.find((p) => p.id == it.product_id);
    const isDefective = itemConditions[it.id] === 'defective';

    if (product) {
      product.sold_count = Math.max(0, Number(product.sold_count || 0) - Number(it.quantity || 0));
      product.sales_count = Math.max(0, Number(product.sales_count || 0) - Number(it.quantity || 0));

      if (!isDefective) {
        product.quantity += Number(it.quantity || 0);
      } else {
        const unitCost = Number(product.costPrice ?? product.purchase_price ?? 0) || 0;
        const quantity = Number(it.quantity || 0);
        const writeoffId = nextId(data, 'stock_writeoffs');
        data.stock_writeoffs.push({
          id: writeoffId,
          sale_id: sale.id,
          sale_item_id: it.id,
          product_id: product.id,
          product_name: it.product_name || product.name,
          quantity,
          unit_cost: unitCost,
          total_cost: unitCost * quantity,
          reason: 'qaytarish_yaroqsiz',
          user_id: req.user.id,
          created_at: now,
        });
        writtenOff.push({ product_name: it.product_name || product.name, quantity });
      }
    }
  }

  data.sale_items = data.sale_items.filter((item) => item.sale_id != req.params.id);
  data.sales = data.sales.filter((s) => s.id != req.params.id);
  writeData(data);
  res.json({ success: true, writtenOff });
});

// (yangi) Qarzni yopish — mijoz to'lamay qolgan (masalan mijoz
// o'chirilishidan oldin) sotuvning qarz qoldig'ini yopish uchun.
// Yuqoridagi DELETE /:id (33) dan farqli o'laroq, bu YO'Q QILMAYDI —
// sotuv yozuvi va uning tarixi (chek, summalar) butunlay saqlanib
// qoladi, faqat: (1) har bir tovar-band uchun holati bo'yicha —
// 'sellable' bo'lsa qoldiqqa qaytariladi, 'defective' bo'lsa
// hisobdan chiqariladi (stock_writeoffs) — ombor to'g'irlanadi, va
// (2) sotuvning debt_remaining'i nolga tushiriladi (shu bilan
// "kutilayotgan foyda" hisobidan ham avtomatik chiqib ketadi, chunki
// /profit formulasi margin * debt_remaining/total_amount ko'rinishida).
// Mahsulotsiz (qo'lda kiritilgan eski qarz, is_manual_debt) sotuvlarda
// sale_items bo'lmaydi — bunday holda shunchaki qarz kechiriladi.
router.post('/:id/close-debt', authRequired, (req, res) => {
  const data = readData();
  const sale = data.sales.find((s) => s.id == req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sotuv topilmadi' });

  const remaining = Number(sale.debt_remaining ?? sale.debt_amount ?? 0);
  if (remaining <= 0) return res.status(400).json({ error: "Bu xariddan qarz qoldig'i yo'q" });

  const itemConditions = (req.body && typeof req.body.itemConditions === 'object' && req.body.itemConditions) || {};
  if (!Array.isArray(data.stock_writeoffs)) data.stock_writeoffs = [];
  const now = new Date().toISOString();
  const writtenOff = [];
  let restockedCount = 0;
  let writtenOffCount = 0;

  for (const it of data.sale_items.filter((item) => item.sale_id == sale.id)) {
    const product = data.products.find((p) => p.id == it.product_id);
    const isDefective = itemConditions[it.id] === 'defective';
    if (!product) continue;

    if (!isDefective) {
      product.quantity += Number(it.quantity || 0);
      restockedCount++;
    } else {
      const unitCost = Number(product.costPrice ?? product.purchase_price ?? 0) || 0;
      const quantity = Number(it.quantity || 0);
      const writeoffId = nextId(data, 'stock_writeoffs');
      data.stock_writeoffs.push({
        id: writeoffId,
        sale_id: sale.id,
        sale_item_id: it.id,
        product_id: product.id,
        product_name: it.product_name || product.name,
        quantity,
        unit_cost: unitCost,
        total_cost: unitCost * quantity,
        reason: 'qarz_yopish',
        user_id: req.user.id,
        created_at: now,
      });
      writtenOff.push({ product_name: it.product_name || product.name, quantity });
      writtenOffCount++;
    }
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

  writeData(data);
  res.json({ success: true, writtenOff, resolution: sale.debt_resolution });
});

export default router;
