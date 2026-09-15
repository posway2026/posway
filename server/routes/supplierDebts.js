import { Router } from 'express';
import { readData, writeData, nextId } from '../db/store.js';
import { authRequired } from '../middleware/auth.js';
import { logStockMovement } from '../lib/stockMovements.js';

const router = Router();

// Ta'minotchilarga qarzim — do'kon ularga to'lashi kerak bo'lgan pul
// (mijozlar qarzidan farqli, bu yerda yo'nalish teskari).

function isDebtBearing(entry) {
  // Naqd/karta bilan olingan kirim darhol to'langan hisoblanadi (qarz
  // hosil qilmaydi). Nasiya, yoki eski (payment_type yozilmagan) yozuvlar
  // — hammasi qarz sifatida hisoblanadi.
  return entry.payment_type !== 'naqd' && entry.payment_type !== 'karta';
}

function summarize(data) {
  const debts = data.supplier_debts || [];
  const payments = (data.supplier_debt_payments || []).filter((p) => !p.cancelled);
  const names = new Set([...debts.map((d) => d.supplier_name), ...(data.supplier_debt_payments || []).map((p) => p.supplier_name)]);

  return [...names].map((name) => {
    const supplierDebts = debts.filter((d) => d.supplier_name === name);
    const totalPurchased = supplierDebts.reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalDebt = supplierDebts.filter(isDebtBearing).reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalPaid = payments.filter((p) => p.supplier_name === name).reduce((s, p) => s + Number(p.amount || 0), 0);
    return {
      supplier_name: name,
      total_purchased: totalPurchased,
      total_debt: totalDebt,
      total_paid: totalPaid,
      balance: totalDebt - totalPaid,
    };
  }).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
}

router.get('/', authRequired, (req, res) => {
  const data = readData();
  res.json(summarize(data));
});

// (14) Ta'minotchidan kelgan kirim yozuvlarini HUJJAT bo'yicha
// guruhlab qaytaradi — bir yetkazib berishda bir nechta mahsulot bo'lsa,
// ularning barchasi bitta "documents" elementida (sana, izoh, satrlar,
// jami summa) ko'rinadi. Hujjatga bog'lanmagan eski yozuvlar (agar
// migratsiyadan oldingi ma'lumot qolgan bo'lsa) alohida "hujjatsiz"
// qatorlar sifatida qo'shiladi, hech narsa yo'qolmasligi uchun.
function groupIntoDocuments(data, debts) {
  const docsById = {};
  for (const d of debts) {
    const docId = d.kirim_document_id || `legacy-${d.id}`;
    if (!docsById[docId]) {
      const doc = d.kirim_document_id
        ? (data.kirim_documents || []).find((k) => k.id === d.kirim_document_id)
        : null;
      docsById[docId] = {
        id: docId,
        is_legacy: !d.kirim_document_id,
        supplier_name: d.supplier_name,
        date: doc?.date || d.created_at,
        note: doc?.note || '',
        created_at: doc?.created_at || d.created_at,
        items: [],
        total: 0,
      };
    }
    docsById[docId].items.push(d);
    docsById[docId].total += Number(d.amount || 0);
  }
  return Object.values(docsById).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

router.get('/:supplier_name/entries', authRequired, (req, res) => {
  const data = readData();
  const name = decodeURIComponent(req.params.supplier_name);
  const debts = (data.supplier_debts || [])
    .filter((d) => d.supplier_name === name)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const payments = (data.supplier_debt_payments || [])
    .filter((p) => p.supplier_name === name)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ supplier_name: name, debts, payments, documents: groupIntoDocuments(data, debts) });
});

// (14) Bitta kirim hujjatini (barcha satrlari bilan) chek/invoys
// ko'rinishida ko'rsatish/chop etish uchun.
router.get('/kirim-document/:id', authRequired, (req, res) => {
  const data = readData();
  const idParam = req.params.id;
  const isLegacy = idParam.startsWith('legacy-');
  const debts = data.supplier_debts || [];
  let items;
  let doc;
  if (isLegacy) {
    const legacyId = Number(idParam.replace('legacy-', ''));
    items = debts.filter((d) => d.id === legacyId && !d.kirim_document_id);
    if (items.length === 0) return res.status(404).json({ error: 'Hujjat topilmadi' });
    doc = { id: idParam, supplier_name: items[0].supplier_name, date: items[0].created_at, note: '', created_at: items[0].created_at };
  } else {
    const docId = Number(idParam);
    doc = (data.kirim_documents || []).find((d) => d.id === docId);
    if (!doc) return res.status(404).json({ error: 'Hujjat topilmadi' });
    items = debts.filter((d) => d.kirim_document_id === docId);
  }
  const total = items.reduce((s, d) => s + Number(d.amount || 0), 0);
  res.json({ ...doc, items, total });
});

// (14/31) Ta'minotchi sahifasidan to'g'ridan-to'g'ri kirim qo'shish —
// mavjud mahsulotni tanlash yoki yangi mahsulot nomini kiritish mumkin.
// Bu kirim avtomatik ravishda umumiy Mahsulotlar ro'yxatiga qo'shiladi
// (yoki mavjud mahsulot miqdorini oshiradi), va to'lov turidan qat'iy
// nazar (naqd, karta yoki nasiya) shu ta'minotchi tarixida saqlanadi.
//
// (14) Bir yetkazib berishda bir nechdan ortiq mahsulot bo'lishi mumkin
// (masalan bitta kunda Mavlon akadan 8 xil mahsulot kelishi) — shuning
// uchun so'rov ikki shaklda qabul qilinadi: eski, yagona-mahsulot shakli
// (orqaga moslik uchun, o'zgarishsiz ishlayveradi) VA yangi
// `{ date, note, items: [...] }` shakli, bunda BARCHA satrlar bitta
// "kirim hujjati" (kirim_documents) ostida guruhlanadi — har biri alohida
// ta'minotchiga qarz (supplier_debts) yozuvi va kassa harakati sifatida
// saqlanishda davom etadi (hisob-kitob mantig'i o'zgarmaydi), faqat endi
// bittasi "bitta hujjat" ekanini bilib turadi.
// Mahsulot/kassa holatiga TEGMASDAN — faqat kirim satri to'g'ri
// kiritilganini tekshiradi. Barcha satrlar shu tekshiruvdan o'tgandan
// KEYINGINA haqiqiy o'zgarish (processKirimItem) boshlanadi — aks holda
// masalan 3 ta satrdan 2-chisi xato bo'lsa, 1-chisi allaqachon qo'llanib
// bo'lgan (lekin saqlanmagan) holatda qolib, keyingi so'rovlarda
// hisobni chalkashtirib yuborishi mumkin edi.
function validateKirimItem(item) {
  const { product_id, new_product_name, quantity, unit_cost, payment_type } = item;
  const qty = Number(quantity) || 0;
  const cost = Number(unit_cost) || 0;
  if (qty <= 0) return "Miqdorni to'g'ri kiriting";
  if (cost <= 0) return "Tan narxni to'g'ri kiriting";
  if (!['naqd', 'karta', 'nasiya'].includes(payment_type)) return "To'lov turini tanlang";
  if (!product_id && !new_product_name) return "Mahsulotni tanlang yoki yangi nom kiriting";
  return null;
}

function processKirimItem(data, { supplier_name, item, now, performed_by, document_id }) {
  const { product_id, new_product_name, new_product_brand, new_product_part_type, new_product_car_models, new_product_sale_price, new_product_min_quantity, quantity, unit_cost, payment_type, note } = item;
  const qty = Number(quantity) || 0;
  const cost = Number(unit_cost) || 0;

  let product;
  if (product_id) {
    product = data.products.find((p) => p.id == product_id);
    if (!product) return { error: 'Mahsulot topilmadi' };
    product.quantity = (Number(product.quantity) || 0) + qty;
    product.costPrice = cost;
    product.purchase_price = cost;
    product.updated_at = now;
  } else {
    // (31) Yangi mahsulot shu yerning o'zida TO'LIQ ma'lumot bilan
    // yaratiladi (Mahsulotlar sahifasidagi "Yangi mahsulot" formasi bilan
    // bir xil maydonlar) — shunda keyinchalik alohida tahrirlashga hojat
    // qolmaydi va sotish narxi 0 bo'lib qolib, sotib bo'lmay qolish xatosi
    // oldini oladi.
    const id = nextId(data, 'products');
    product = {
      id,
      name: new_product_name,
      brand: new_product_brand || '',
      category: '',
      part_type: new_product_part_type || 'original',
      costPrice: cost,
      purchase_price: cost,
      sold_count: 0,
      sales_count: 0,
      sale_price: Number(new_product_sale_price) || 0,
      quantity: qty,
      min_quantity: Number(new_product_min_quantity ?? 2) || 2,
      car_models: new_product_car_models || '',
      created_at: now,
      updated_at: now,
    };
    data.products.push(product);
  }

  const totalAmount = qty * cost;
  if (!Array.isArray(data.supplier_debts)) data.supplier_debts = [];
  const debtId = nextId(data, 'supplier_debts');
  const entry = {
    id: debtId,
    supplier_name,
    amount: totalAmount,
    product_id: product.id,
    product_name: product.name,
    quantity: qty,
    unit_cost: cost,
    payment_type,
    note: note || '',
    cash_movement_id: null,
    kirim_document_id: document_id || null,
    created_at: now,
  };

  if (payment_type !== 'nasiya') {
    if (!Array.isArray(data.cash_movements)) data.cash_movements = [];
    const cmId = nextId(data, 'cash_movements');
    data.cash_movements.push({
      id: cmId,
      amount: totalAmount,
      category: 'Mahsulot kirim (yuk)',
      description: `${product.name} — ${qty} dona (${supplier_name})`,
      recorded_by: performed_by || "Noma'lum",
      date_time: now,
      created_at: now,
      updated_at: now,
      payment_method: payment_type,
      is_inventory: true,
      supplier_debt_id: debtId,
    });
    entry.cash_movement_id = cmId;
  }

  data.supplier_debts.push(entry);
  logStockMovement(data, {
    product_id: product.id,
    product_name: product.name,
    type: 'kirim',
    quantity_delta: qty,
    unit_cost: cost,
    payment_type,
    supplier_name,
    source_type: 'supplier_debt',
    source_id: debtId,
    performed_by,
    note: note || '',
  });

  return { id: debtId, product };
}

router.post('/:supplier_name/kirim', authRequired, (req, res) => {
  const supplier_name = decodeURIComponent(req.params.supplier_name);
  const data = readData();
  const now = new Date().toISOString();
  const performed_by = req.user?.full_name;

  const isMultiItem = Array.isArray(req.body.items);
  const items = isMultiItem ? req.body.items : [req.body];
  if (items.length === 0) return res.status(400).json({ error: "Kamida bitta mahsulot kiriting" });

  // Avval BARCHA satrlarni tekshiramiz (hech narsani o'zgartirmasdan) —
  // shundagina birinchi satr xatoga uchraganda ham hech qanday yarim-
  // qo'llangan o'zgarish qolib ketmaydi.
  for (const item of items) {
    const err = validateKirimItem(item);
    if (err) return res.status(400).json({ error: err });
    if (item.product_id && !data.products.find((p) => p.id == item.product_id)) {
      return res.status(400).json({ error: 'Mahsulot topilmadi' });
    }
  }

  // (14) Har doim BITTA kirim hujjati yaratiladi (bitta mahsulot bo'lsa
  // ham) — shunda barcha kirimlar bir xil tarzda guruhlanadi va chek
  // qilib chiqarish mumkin bo'ladi.
  if (!Array.isArray(data.kirim_documents)) data.kirim_documents = [];
  const documentId = nextId(data, 'kirim_documents');

  const results = [];
  for (const item of items) {
    const result = processKirimItem(data, { supplier_name, item, now, performed_by, document_id: documentId });
    if (result.error) return res.status(400).json({ error: result.error });
    results.push(result);
  }

  data.kirim_documents.push({
    id: documentId,
    supplier_name,
    date: req.body.date ? new Date(req.body.date).toISOString() : now,
    note: req.body.note || '',
    created_by: performed_by,
    created_at: now,
  });

  writeData(data);
  res.json({ success: true, document_id: documentId, ids: results.map((r) => r.id) });
});

// (31) Kirim yozuvini tahrirlash — miqdor yoki narx o'zgarsa, bog'liq
// mahsulot qoldig'i farqga qarab to'g'irlanadi; to'lov turi/summasi
// o'zgarsa, bog'liq kassa harakati ham mos ravishda yangilanadi yoki
// yaratiladi/o'chiriladi.
router.put('/debt/:id', authRequired, (req, res) => {
  const data = readData();
  const id = Number(req.params.id);
  const entry = (data.supplier_debts || []).find((d) => Number(d.id) === id);
  if (!entry) return res.status(404).json({ error: 'Yozuv topilmadi' });

  const { quantity, unit_cost, payment_type, note } = req.body;

  // Mahsulotga bog'liq yozuv bo'lsa — miqdor/narx farqini qoldiqqa qo'llaymiz.
  if (entry.product_id) {
    const product = data.products.find((p) => p.id === entry.product_id);
    const newQty = quantity !== undefined ? Number(quantity) || 0 : entry.quantity;
    const newCost = unit_cost !== undefined ? Number(unit_cost) || 0 : entry.unit_cost;
    if (product) {
      const oldQty = Number(entry.quantity) || 0;
      product.quantity = Math.max(0, (Number(product.quantity) || 0) - oldQty + newQty);
      product.costPrice = newCost;
      product.purchase_price = newCost;
      product.updated_at = new Date().toISOString();
      const delta = newQty - oldQty;
      if (delta !== 0) {
        logStockMovement(data, {
          product_id: product.id,
          product_name: product.name,
          type: 'tuzatish',
          quantity_delta: delta,
          unit_cost: newCost,
          supplier_name: entry.supplier_name,
          source_type: 'supplier_debt',
          source_id: entry.id,
          performed_by: req.user?.full_name,
          note: 'Kirim yozuvi tahrirlandi',
        });
      }
    }
    entry.quantity = newQty;
    entry.unit_cost = newCost;
    entry.amount = newQty * newCost;
  }

  const newPaymentType = payment_type || entry.payment_type;
  const cashMovements = Array.isArray(data.cash_movements) ? data.cash_movements : [];
  const linkedCash = entry.cash_movement_id ? cashMovements.find((m) => m.id === entry.cash_movement_id) : null;

  if (newPaymentType === 'nasiya') {
    // Endi nasiyaga o'tdi — bog'liq kassa harakati bo'lsa, o'chiramiz.
    if (linkedCash) {
      data.cash_movements = cashMovements.filter((m) => m.id !== linkedCash.id);
      entry.cash_movement_id = null;
    }
  } else if (linkedCash) {
    // Naqd/karta bo'lib qoldi — mavjud kassa harakatini yangilaymiz.
    linkedCash.amount = entry.amount;
    linkedCash.payment_method = newPaymentType;
    linkedCash.description = `${entry.product_name} — ${entry.quantity} dona (${entry.supplier_name})`;
    linkedCash.updated_at = new Date().toISOString();
  } else {
    // Avval nasiya edi, endi naqd/karta bo'ldi — yangi kassa harakati yaratamiz.
    if (!Array.isArray(data.cash_movements)) data.cash_movements = [];
    const cmId = nextId(data, 'cash_movements');
    data.cash_movements.push({
      id: cmId,
      amount: entry.amount,
      category: 'Mahsulot kirim (yuk)',
      description: `${entry.product_name} — ${entry.quantity} dona (${entry.supplier_name})`,
      recorded_by: req.user?.full_name || "Noma'lum",
      date_time: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      payment_method: newPaymentType,
      is_inventory: true,
      supplier_debt_id: entry.id,
    });
    entry.cash_movement_id = cmId;
  }

  entry.payment_type = newPaymentType;
  if (note !== undefined) entry.note = note;

  writeData(data);
  res.json({ success: true });
});

// (31) Kirim yozuvini o'chirish — bog'liq mahsulot qoldig'i va kassa
// harakati ham mos ravishda qaytariladi (audit uchun emas, chunki bu
// haqiqatda xato kiritilgan yozuvni to'liq bekor qilish talabi).
router.delete('/debt/:id', authRequired, (req, res) => {
  const data = readData();
  const id = Number(req.params.id);
  const entry = (data.supplier_debts || []).find((d) => Number(d.id) === id);
  if (!entry) return res.status(404).json({ error: 'Yozuv topilmadi' });

  if (entry.product_id) {
    const product = data.products.find((p) => p.id === entry.product_id);
    if (product) {
      product.quantity = Math.max(0, (Number(product.quantity) || 0) - (Number(entry.quantity) || 0));
      product.updated_at = new Date().toISOString();
      logStockMovement(data, {
        product_id: product.id,
        product_name: product.name,
        type: 'kirim_bekor',
        quantity_delta: -(Number(entry.quantity) || 0),
        unit_cost: entry.unit_cost,
        payment_type: entry.payment_type,
        supplier_name: entry.supplier_name,
        source_type: 'supplier_debt',
        source_id: entry.id,
        performed_by: req.user?.full_name,
        note: "Kirim yozuvi o'chirildi",
      });
    }
  }
  if (entry.cash_movement_id) {
    data.cash_movements = (data.cash_movements || []).filter((m) => m.id !== entry.cash_movement_id);
  }
  data.supplier_debts = (data.supplier_debts || []).filter((d) => Number(d.id) !== id);

  // Bo'shab qolgan (boshqa satri qolmagan) kirim hujjatini ham tozalaymiz.
  if (entry.kirim_document_id) {
    const stillUsed = (data.supplier_debts || []).some((d) => d.kirim_document_id === entry.kirim_document_id);
    if (!stillUsed) {
      data.kirim_documents = (data.kirim_documents || []).filter((doc) => doc.id !== entry.kirim_document_id);
    }
  }

  writeData(data);
  res.json({ success: true });
});

// (14) Butun kirim hujjatini (barcha satrlari bilan) bir yo'la o'chirish —
// har bir satr uchun xuddi yuqoridagi bitta-satrni-o'chirish bilan bir xil
// qaytarish mantig'i qo'llaniladi (mahsulot qoldig'i va kassa balansi
// avtomatik to'g'irlanadi, harakat tarixiga "kirim_bekor" yoziladi).
router.delete('/kirim-document/:id', authRequired, (req, res) => {
  const data = readData();
  const docId = Number(req.params.id);
  const doc = (data.kirim_documents || []).find((d) => d.id === docId);
  if (!doc) return res.status(404).json({ error: 'Hujjat topilmadi' });

  const lines = (data.supplier_debts || []).filter((d) => d.kirim_document_id === docId);
  for (const entry of lines) {
    if (entry.product_id) {
      const product = data.products.find((p) => p.id === entry.product_id);
      if (product) {
        product.quantity = Math.max(0, (Number(product.quantity) || 0) - (Number(entry.quantity) || 0));
        product.updated_at = new Date().toISOString();
        logStockMovement(data, {
          product_id: product.id,
          product_name: product.name,
          type: 'kirim_bekor',
          quantity_delta: -(Number(entry.quantity) || 0),
          unit_cost: entry.unit_cost,
          payment_type: entry.payment_type,
          supplier_name: entry.supplier_name,
          source_type: 'kirim_document',
          source_id: docId,
          performed_by: req.user?.full_name,
          note: "Kirim hujjati butunlay o'chirildi",
        });
      }
    }
    if (entry.cash_movement_id) {
      data.cash_movements = (data.cash_movements || []).filter((m) => m.id !== entry.cash_movement_id);
    }
  }
  const lineIds = new Set(lines.map((l) => l.id));
  data.supplier_debts = (data.supplier_debts || []).filter((d) => !lineIds.has(d.id));
  data.kirim_documents = (data.kirim_documents || []).filter((d) => d.id !== docId);

  writeData(data);
  res.json({ success: true });
});

// (30) Ilovadan oldingi eski ta'minotchi qarzlarini qo'lda kiritish —
// mahsulot xaridiga bog'liq bo'lmagan, alohida qarz yozuvi sifatida.
router.post('/debt', authRequired, (req, res) => {
  const { supplier_name, amount, note, date } = req.body;
  if (!supplier_name || !amount || amount <= 0) {
    return res.status(400).json({ error: "Ta'minotchi va summani to'g'ri kiriting" });
  }
  const data = readData();
  if (!Array.isArray(data.supplier_debts)) data.supplier_debts = [];
  const id = nextId(data, 'supplier_debts');
  data.supplier_debts.push({
    id,
    supplier_name,
    amount: Number(amount) || 0,
    product_id: null,
    product_name: null,
    quantity: null,
    payment_type: 'nasiya',
    note: note || "Ilovadan oldingi eski qarz",
    created_at: date ? new Date(date).toISOString() : new Date().toISOString(),
  });
  writeData(data);
  res.json({ success: true, id });
});

router.post('/pay', authRequired, (req, res) => {
  const { supplier_name, amount, note, payment_method } = req.body;
  if (!supplier_name || !amount || amount <= 0) {
    return res.status(400).json({ error: "Ta'minotchi va summani to'g'ri kiriting" });
  }
  const data = readData();
  if (!Array.isArray(data.supplier_debt_payments)) data.supplier_debt_payments = [];
  const id = nextId(data, 'supplier_debt_payments');
  data.supplier_debt_payments.push({
    id,
    supplier_name,
    amount: Number(amount) || 0,
    note: note || '',
    payment_method: payment_method === 'karta' ? 'karta' : 'naqd',
    cancelled: false,
    created_at: new Date().toISOString(),
  });
  writeData(data);
  res.json({ success: true });
});

// (28) To'lovni bekor qilish — tugma bir necha marta bosilib, xato to'lov
// yuborilgan holatlar uchun (masalan bitta to'lov 6 marta yuborilib,
// hisob manfiy bo'lib qolgan voqea sodir bo'lgan edi). Yozuvni O'CHIRMAYMIZ
// — audit izi saqlanishi uchun faqat "cancelled: true" deb belgilaymiz.
// Bekor qilingan to'lov summarize() da hisobga olinmaydi, ya'ni qarz
// avtomatik tiklanadi.
router.post('/payments/:id/cancel', authRequired, (req, res) => {
  const data = readData();
  const id = Number(req.params.id);
  const payment = (data.supplier_debt_payments || []).find((p) => Number(p.id) === id);
  if (!payment) return res.status(404).json({ error: "To'lov topilmadi" });
  if (payment.cancelled) return res.status(400).json({ error: 'Bu to\'lov allaqachon bekor qilingan' });
  payment.cancelled = true;
  payment.cancelled_at = new Date().toISOString();
  writeData(data);
  res.json({ success: true });
});

export default router;
