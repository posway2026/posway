import { Router } from 'express';
import { readData, writeData, nextId } from '../db/store.js';
import { authRequired, roleRequired } from '../middleware/auth.js';
import { logStockMovement } from '../lib/stockMovements.js';

const router = Router();

// (3/c) Ruxsat etilgan o'lchov birliklari — "dona" standart, qolganlari
// kasr (0.5, 1.25 va h.k.) miqdorda sotilishi mumkin.
export const VALID_UNITS = ['dona', 'kg', 'gramm', 'metr', 'litr'];

function normalizeProduct(product = {}) {
  const costPrice = Number(product.costPrice ?? product.purchase_price ?? 0) || 0;
  return {
    ...product,
    costPrice,
    purchase_price: costPrice,
    // (3/c) Eski mahsulotlarda bu maydonlar umuman bo'lmasligi mumkin —
    // shuning uchun har doim standart qiymat bilan qaytaramiz, frontend
    // formasi va Sotuv sahifasi hech qachon "undefined" bilan ishlamasin.
    unit: VALID_UNITS.includes(product.unit) ? product.unit : 'dona',
    dual_mode: !!product.dual_mode,
    whole_size: Number(product.whole_size || 0) || 0,
    whole_price: Number(product.whole_price || 0) || 0,
    whole_label: product.whole_label || '',
  };
}

function parseNumber(value) {
  return Number(value ?? 0) || 0;
}

// (3/c) Bitta mahsulot ikki xil rejimda sotilishi mumkin: "butun" holda
// (masalan bitta shisha, belgilangan qadoq-narxi bilan) yoki o'lchovga
// qarab bo'lib (masalan litrlab). Ikkalasi ham BITTA umumiy ombor
// qoldig'idan (asosiy o'lchov birligida, masalan litr) kamayadi. Shu
// sababli bu rejim yoqilganda whole_size (1 butunga necha baza-birlik
// to'g'ri kelishi) va whole_price (1 butun narxi) MAJBURIY — aks holda
// ombordan qancha ayirishni hisoblab bo'lmaydi.
export function validateUnitFields(body) {
  const unit = VALID_UNITS.includes(body.unit) ? body.unit : 'dona';
  const dual_mode = !!body.dual_mode;
  if (dual_mode) {
    const whole_size = parseNumber(body.whole_size);
    const whole_price = parseNumber(body.whole_price);
    if (whole_size <= 0 || whole_price <= 0) {
      return { error: "Ikki xil rejim uchun \"1 butunga necha " + unit + "\" va \"1 butun narxi\" to'g'ri kiritilishi kerak" };
    }
    return {
      unit,
      dual_mode: true,
      whole_size,
      whole_price,
      whole_label: String(body.whole_label || '').trim() || 'butun',
    };
  }
  return { unit, dual_mode: false, whole_size: 0, whole_price: 0, whole_label: '' };
}

// (6) Mahsulotda tayyor (ishlab chiqaruvchidan kelgan) shtrix-kod bo'lmasa,
// Posway o'zi ICHKI FOYDALANISH uchun ajratilgan EAN-13 prefiksi (20-29)
// asosida noyob shtrix-kod yaratib beradi — bu oraliq hech qachon haqiqiy
// mahsulot kodlari bilan to'qnashmaydi (xalqaro standart shunday belgilagan).
function generateBarcode(id) {
  const base = '20' + String(id).padStart(10, '0'); // 12 xonali asos
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    const digit = Number(base[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return base + String(check); // 13 xonali EAN-13
}

function barcodeTaken(data, code, excludeId) {
  const c = String(code || '').trim();
  if (!c) return false;
  return data.products.some((p) => !p.is_deleted && p.id != excludeId && String(p.barcode || '').trim() === c);
}

// (yangi) Bu mahsulotga tegishli barcha kirim/qarz yozuvlari — mahsulotni
// o'chirishda kassa/qarz ta'siri "shunchaki yo'q bo'lib qolmasligi" uchun.
function kirimEntriesFor(data, productId) {
  return (data.supplier_debts || []).filter((d) => d.product_id == productId);
}

function kirimSummaryFor(data, productId) {
  const entries = kirimEntriesFor(data, productId);
  const naqdKartaTotal = entries.filter((e) => e.payment_type !== 'nasiya').reduce((s, e) => s + Number(e.amount || 0), 0);
  const nasiyaTotal = entries.filter((e) => e.payment_type === 'nasiya').reduce((s, e) => s + Number(e.amount || 0), 0);
  return { count: entries.length, naqdKartaTotal, nasiyaTotal };
}

router.get('/', authRequired, (req, res) => {
  const { search, includeDeleted } = req.query;
  const data = readData();
  let rows = data.products.map(normalizeProduct);
  if (!includeDeleted) rows = rows.filter((p) => !p.is_deleted);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(s) ||
        (p.brand || '').toLowerCase().includes(s) ||
        (p.car_models || '').toLowerCase().includes(s) ||
        // (6) Shtrix-kod skaneri qidiruv maydoniga to'g'ridan-to'g'ri
        // raqamlarni "yozadi" — shuning uchun oddiy qidiruv ham shtrix-kod
        // bo'yicha moslikni topishi kerak (skaner uchun aniq mos yozuv
        // Pos.jsx'da alohida /products/barcode/:code orqali tekshiriladi).
        String(p.barcode || '').toLowerCase().includes(s)
    );
  }
  res.json([...rows].sort((a, b) => {
    if (!!a.is_deleted !== !!b.is_deleted) return a.is_deleted ? 1 : -1;
    return a.name.localeCompare(b.name);
  }));
});

router.get('/low-stock', authRequired, (req, res) => {
  const data = readData();
  const rows = data.products.map(normalizeProduct).filter((p) => !p.is_deleted && p.quantity <= p.min_quantity).sort((a, b) => a.quantity - b.quantity);
  res.json(rows);
});

// (6) Shtrix-kod skaneridan aniq (exact) moslikni topish uchun — skaner
// odatda juda tez klaviatura terish sifatida ishlaydi, shuning uchun
// Pos.jsx qidiruv maydoniga "Enter" bosilganda avval shu yo'l orqali aniq
// moslikni tekshiradi, topilmasa oddiy matn qidiruviga tushadi.
router.get('/barcode/:code', authRequired, (req, res) => {
  const data = readData();
  const code = String(req.params.code || '').trim();
  const product = data.products.find((p) => !p.is_deleted && String(p.barcode || '').trim() === code);
  if (!product) return res.status(404).json({ error: 'Bu shtrix-kod bo\'yicha mahsulot topilmadi' });
  res.json(normalizeProduct(product));
});

// (yangi) Mahsulotni o'chirishdan oldin — unga bog'liq kirim tarixi
// (naqt/karta orqali kassadan ketgan pul, yoki ta'minotchiga nasiya qarz)
// bor-yo'qligini ko'rsatadi, shunda frontend o'chirishdan oldin to'g'ri
// savol berishi mumkin ("bekor qilamizmi yoki tarix saqlansinmi").
router.get('/:id/kirim-summary', authRequired, (req, res) => {
  const data = readData();
  const product = data.products.find((p) => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Topilmadi' });
  res.json(kirimSummaryFor(data, product.id));
});

router.get('/:id', authRequired, (req, res) => {
  const data = readData();
  const row = data.products.find((p) => p.id == req.params.id);
  if (!row) return res.status(404).json({ error: 'Topilmadi' });
  res.json(normalizeProduct(row));
});

// (42) Shu mahsulotning to'liq harakatlar tarixi — kirim, sotuv,
// qaytarish, hisobdan chiqarish, tuzatish — barchasi bitta umumiy
// jurnaldan (stock_movements) olinadi, eng yangisidan boshlab.
router.get('/:id/movements', authRequired, (req, res) => {
  const data = readData();
  const product = data.products.find((p) => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Topilmadi' });
  const rows = (data.stock_movements || [])
    .filter((m) => m.product_id == product.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(rows);
});

// ---------- YANGI MAHSULOT YARATISH ----------
// Bog'liq: (13) — agar boshlang'ich miqdor (quantity) > 0 bo'lsa, bu ham
// "Kirim" bilan bir xil tan narx x miqdor summasini kassadan ayiradi
// (naqt/karta bo'lsa) yoki ta'minotchiga qarz sifatida yozadi (nasiya
// bo'lsa) — xuddi mavjud mahsulotga kirim qilingandagi kabi, chunki bu ham
// aylanma mablag' sarfi.
router.post('/', authRequired, roleRequired('admin', 'omborchi'), (req, res) => {
  const { name, brand, category, part_type, costPrice, purchase_price, sale_price, quantity, min_quantity, car_models, payment_type, supplier_name, note, barcode } = req.body;
  if (!name || !part_type) return res.status(400).json({ error: 'Nomi va turi majburiy' });
  const qty = parseNumber(quantity);
  const normalizedCostPrice = parseNumber(costPrice ?? purchase_price);

  // (3/c) O'lchov birligi va ikki xil rejim (butun/o'lchovga bo'lib sotish).
  const unitFields = validateUnitFields(req.body);
  if (unitFields.error) return res.status(400).json({ error: unitFields.error });

  // (6) Mahsulot o'zining tayyor shtrix-kodi bilan kelgan bo'lsa, shuni
  // ishlatamiz (boshqa mahsulotda takrorlanmasligi kerak); bo'sh qoldirilsa
  // pastda (id ma'lum bo'lgach) Posway o'zi noyob kod yaratib beradi.
  const trimmedBarcode = String(barcode || '').trim();

  // (31) Endi to'lov turidan qat'iy nazar (naqd, karta yoki nasiya) —
  // har qanday kirim ta'minotchiga bog'lanadi, shunda "qaysi tovar qaysi
  // ta'minotchidan kelgani" har doim aniq bo'ladi (avval bu faqat nasiya
  // uchun talab qilinardi).
  if (qty > 0 && normalizedCostPrice > 0) {
    if (!['naqd', 'karta', 'nasiya'].includes(payment_type)) {
      return res.status(400).json({ error: "To'lov turini tanlang" });
    }
    if (!supplier_name) {
      return res.status(400).json({ error: "Ta'minotchi nomini kiriting" });
    }
  }

  const data = readData();

  if (trimmedBarcode && barcodeTaken(data, trimmedBarcode)) {
    return res.status(400).json({ error: 'Bu shtrix-kod boshqa mahsulotda allaqachon ishlatilgan' });
  }

  const id = nextId(data, 'products');
  const now = new Date().toISOString();
  const newProduct = {
    id,
    name,
    brand: brand || '',
    category: category || '',
    part_type,
    costPrice: normalizedCostPrice,
    purchase_price: normalizedCostPrice,
    sold_count: 0,
    sales_count: 0,
    sale_price: parseNumber(sale_price),
    quantity: qty,
    min_quantity: parseNumber(min_quantity ?? 2),
    car_models: car_models || '',
    // (6) Tayyor kod bo'lsa o'shani, aks holda o'zimiz yaratgan noyob
    // shtrix-kodni saqlaymiz — hech qanday mahsulot shtrix-kodsiz qolmaydi.
    barcode: trimmedBarcode || generateBarcode(id),
    // (3/c) unit — asosiy o'lchov birligi (qoldiq shu birlikda saqlanadi).
    // dual_mode yoqilsa, sale_price "o'lchovga bo'lib" sotilganda 1 birlik
    // narxi bo'lib qoladi, whole_price esa "butun" holda sotilgandagi narx.
    unit: unitFields.unit,
    dual_mode: unitFields.dual_mode,
    whole_size: unitFields.whole_size,
    whole_price: unitFields.whole_price,
    whole_label: unitFields.whole_label,
    created_at: now,
    updated_at: now,
  };
  data.products.push(newProduct);

  if (qty > 0 && normalizedCostPrice > 0) {
    const totalAmount = qty * normalizedCostPrice;
    if (!Array.isArray(data.supplier_debts)) data.supplier_debts = [];
    const debtId = nextId(data, 'supplier_debts');
    const entry = {
      id: debtId,
      supplier_name,
      amount: totalAmount,
      product_id: id,
      product_name: newProduct.name,
      quantity: qty,
      unit_cost: normalizedCostPrice,
      payment_type,
      note: note || '',
      cash_movement_id: null,
      created_at: now,
    };
    if (payment_type !== 'nasiya') {
      if (!Array.isArray(data.cash_movements)) data.cash_movements = [];
      const movementId = nextId(data, 'cash_movements');
      data.cash_movements.push({
        id: movementId,
        amount: totalAmount,
        category: 'Mahsulot kirim (yuk)',
        description: `${newProduct.name} — ${qty} dona (yangi mahsulot, ${supplier_name})`,
        recorded_by: req.user?.full_name || "Noma'lum",
        date_time: now,
        created_at: now,
        updated_at: now,
        payment_method: payment_type,
        is_inventory: true,
        supplier_debt_id: debtId,
      });
      entry.cash_movement_id = movementId;
    }
    data.supplier_debts.push(entry);
    logStockMovement(data, {
      product_id: id,
      product_name: newProduct.name,
      type: 'kirim',
      quantity_delta: qty,
      unit_cost: normalizedCostPrice,
      payment_type,
      supplier_name,
      source_type: 'supplier_debt',
      source_id: debtId,
      performed_by: req.user?.full_name,
      note: note || '',
    });
  }

  writeData(data);
  res.json({ id, barcode: newProduct.barcode });
});

router.put('/:id', authRequired, roleRequired('admin', 'omborchi'), (req, res) => {
  const data = readData();
  const idx = data.products.findIndex((p) => p.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  const { name, brand, category, part_type, costPrice, purchase_price, sale_price, quantity, min_quantity, car_models, sold_count, sales_count, barcode } = req.body;
  const normalizedCostPrice = parseNumber(costPrice ?? purchase_price);

  // (3/c) O'lchov birligi va ikki xil rejim — tahrirlashda ham xuddi
  // yaratishdagi kabi tekshiriladi.
  const unitFields = validateUnitFields(req.body);
  if (unitFields.error) return res.status(400).json({ error: unitFields.error });

  // (6) Tahrirlashda shtrix-kod ham o'zgartirilishi mumkin — lekin
  // boshqa faol mahsulotda band qilingan kod bilan to'qnashmasligi kerak.
  // Bo'sh qoldirilsa, mahsulot shtrix-kodsiz qolib ketmasligi uchun avtomatik
  // yaratib beramiz (masalan eski, hali kodsiz mahsulot birinchi marta
  // tahrirlanayotganda).
  const trimmedBarcode = String(barcode ?? '').trim();
  if (trimmedBarcode && barcodeTaken(data, trimmedBarcode, data.products[idx].id)) {
    return res.status(400).json({ error: 'Bu shtrix-kod boshqa mahsulotda allaqachon ishlatilgan' });
  }
  const resolvedBarcode = trimmedBarcode || data.products[idx].barcode || generateBarcode(data.products[idx].id);
  const productSoldCount = Number(sold_count ?? sales_count ?? data.products[idx].sold_count ?? data.products[idx].sales_count ?? 0) || 0;
  const oldQuantity = Number(data.products[idx].quantity) || 0;
  const newQuantity = parseNumber(quantity);
  data.products[idx] = {
    ...data.products[idx],
    name,
    brand,
    category,
    part_type,
    costPrice: normalizedCostPrice,
    purchase_price: normalizedCostPrice,
    sold_count: productSoldCount,
    sales_count: productSoldCount,
    sale_price: parseNumber(sale_price),
    quantity: newQuantity,
    min_quantity: parseNumber(min_quantity ?? data.products[idx].min_quantity ?? 2),
    car_models,
    barcode: resolvedBarcode,
    unit: unitFields.unit,
    dual_mode: unitFields.dual_mode,
    whole_size: unitFields.whole_size,
    whole_price: unitFields.whole_price,
    whole_label: unitFields.whole_label,
    updated_at: new Date().toISOString(),
  };

  // (42) Mahsulotni tahrirlashda miqdor qo'lda o'zgartirilsa (kirim yoki
  // sotuv orqali emas) — bu ham tarixga "tuzatish" sifatida yoziladi,
  // shunda mahsulot tarixida qoldiq hech qachon "sababsiz" o'zgarib
  // qolmaydi.
  const delta = newQuantity - oldQuantity;
  if (delta !== 0) {
    logStockMovement(data, {
      product_id: data.products[idx].id,
      product_name: data.products[idx].name,
      type: 'tuzatish',
      quantity_delta: delta,
      source_type: 'manual',
      performed_by: req.user?.full_name,
      note: "Mahsulot tahrirlashda miqdor qo'lda o'zgartirildi",
    });
  }

  writeData(data);
  res.json({ success: true, barcode: resolvedBarcode });
});

// (6) Eski, hali shtrix-kodsiz mahsulotlar uchun — to'liq tahrirlash
// formasini ochmasdan, ro'yxatdan bittagina tugma bosib noyob shtrix-kod
// yaratib berish. Agar mahsulotda allaqachon kod bo'lsa, o'shani qaytaradi
// (tasodifan qayta-qayta bosilsa ham eskisi almashtirilmaydi).
router.post('/:id/generate-barcode', authRequired, roleRequired('admin', 'omborchi'), (req, res) => {
  const data = readData();
  const idx = data.products.findIndex((p) => p.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });
  if (!data.products[idx].barcode) {
    data.products[idx].barcode = generateBarcode(data.products[idx].id);
    data.products[idx].updated_at = new Date().toISOString();
    writeData(data);
  }
  res.json({ barcode: data.products[idx].barcode });
});

// (yangi) Mahsulotni o'chirish endi hech qachon uni bog'liq kirim tarixi
// (kassa harakati, ta'minotchiga qarz) bilan birga "shunchaki yo'q qilib
// yubormaydi" — bu avval jiddiy xato edi: naqt/karta orqali kirim qilingan
// mahsulot o'chirilsa, kassadan ketgan pul hech qachon qaytmasdi va
// hisobga hech qanday iz qoldirmasdi. Endi:
//  - Agar mahsulotga bog'liq kirim yozuvi umuman bo'lmasa — to'g'ridan-
//    to'g'ri (is_deleted=true) yashiriladi, savol berilmaydi.
//  - Aks holda, `action` majburiy: 'cancel_kirim' — bu xato kiritilgan
//    degani, shuning uchun BARCHA bog'liq kirim yozuvlari, ularning kassa
//    harakatlari VA mahsulot qoldig'iga qo'shgan miqdori ham to'liq bekor
//    qilinadi (xuddi Ta'minotchilarga qarzim'dagi bitta kirim yozuvini
//    o'chirish kabi, faqat shu mahsulotning barcha yozuvlari uchun); yoki
//    'keep_history' — kirim tarixi, kassa harakati va ta'minotchiga qarz
//    ATIGA O'ZGARISHSIZ qoladi (pul haqiqatda sarflangan/qarz haqiqiy —
//    faqat mahsulot faol ro'yxatdan chiqariladi).
router.delete('/:id', authRequired, roleRequired('admin'), (req, res) => {
  const data = readData();
  const product = data.products.find((p) => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Topilmadi' });

  const related = kirimEntriesFor(data, product.id);
  const action = req.body && req.body.action;

  if (related.length > 0) {
    if (!['cancel_kirim', 'keep_history'].includes(action)) {
      return res.status(400).json({
        error: 'confirmation_required',
        message: "Bu mahsulot uchun kirim tarixi bor — avval kassaga/qarzga ta'sirini tanlang.",
        ...kirimSummaryFor(data, product.id),
      });
    }
    if (action === 'cancel_kirim') {
      for (const entry of related) {
        if (entry.cash_movement_id) {
          data.cash_movements = (data.cash_movements || []).filter((m) => m.id !== entry.cash_movement_id);
        }
        product.quantity = Math.max(0, Number(product.quantity || 0) - Number(entry.quantity || 0));
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
          note: "Mahsulot o'chirilganda kirim tarixi bekor qilindi",
        });
      }
      const relatedIds = new Set(related.map((e) => e.id));
      const touchedDocIds = new Set(related.map((e) => e.kirim_document_id).filter(Boolean));
      data.supplier_debts = (data.supplier_debts || []).filter((d) => !relatedIds.has(d.id));
      // Endi bo'shab qolgan (boshqa mahsulot bandi qolmagan) kirim
      // hujjatlarini ham tozalaymiz.
      if (touchedDocIds.size > 0) {
        const stillUsedDocIds = new Set((data.supplier_debts || []).map((d) => d.kirim_document_id).filter(Boolean));
        data.kirim_documents = (data.kirim_documents || []).filter((doc) => !touchedDocIds.has(doc.id) || stillUsedDocIds.has(doc.id));
      }
    }
    // action === 'keep_history': supplier_debts/cash_movements yozuvlariga tegilmaydi.
  }

  product.is_deleted = true;
  product.deleted_at = new Date().toISOString();
  writeData(data);
  res.json({ success: true });
});

// (yangi) Xato bosilgan "o'chirish"ni bekor qilish — mahsulotni qayta
// faollashtiradi. Agar shu bilan birga kirim ham 'cancel_kirim' orqali
// bekor qilingan bo'lsa, o'sha kirim tarixi tiklanmaydi (chunki bu holda
// "kirim hech qachon bo'lmagan" deb hisoblanadi) — faqat mahsulotning
// o'zi qaytadan faol ro'yxatga chiqadi.
router.post('/:id/restore', authRequired, roleRequired('admin'), (req, res) => {
  const data = readData();
  const product = data.products.find((p) => p.id == req.params.id);
  if (!product) return res.status(404).json({ error: 'Topilmadi' });
  product.is_deleted = false;
  product.deleted_at = null;
  writeData(data);
  res.json({ success: true });
});

// ---------- YUK KIRIM (mahsulot kirim qilish, to'lov turi bilan) ----------
// Bog'liq: (13) — naqt/karta bo'lsa kassa balansidan ayiriladi (aylanma
// mablag' sifatida, alohida "is_inventory" belgisi bilan — foyda hisobidan
// ikki marta ayirilmasligi uchun, chunki tan narx allaqachon har bir
// sotuvda hisoblanadi); nasiya bo'lsa "Ta'minotchilarga qarzim" bo'limiga yoziladi.
router.post('/:id/kirim', authRequired, roleRequired('admin', 'omborchi'), (req, res) => {
  const { quantity, unit_cost, payment_type, supplier_name, note } = req.body;
  const qty = parseNumber(quantity);
  const cost = parseNumber(unit_cost);

  if (qty <= 0) return res.status(400).json({ error: "Miqdorni to'g'ri kiriting" });
  if (!['naqd', 'karta', 'nasiya'].includes(payment_type)) {
    return res.status(400).json({ error: "To'lov turini tanlang" });
  }
  if (!supplier_name) {
    return res.status(400).json({ error: "Ta'minotchi nomini kiriting" });
  }

  const data = readData();
  const idx = data.products.findIndex((p) => p.id == req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Topilmadi' });

  const totalAmount = qty * cost;
  const now = new Date().toISOString();

  data.products[idx] = {
    ...data.products[idx],
    quantity: parseNumber(data.products[idx].quantity) + qty,
    costPrice: cost || data.products[idx].costPrice,
    purchase_price: cost || data.products[idx].purchase_price,
    updated_at: now,
  };

  if (!Array.isArray(data.supplier_debts)) data.supplier_debts = [];
  const debtId = nextId(data, 'supplier_debts');
  const entry = {
    id: debtId,
    supplier_name,
    amount: totalAmount,
    product_id: data.products[idx].id,
    product_name: data.products[idx].name,
    quantity: qty,
    unit_cost: cost,
    payment_type,
    note: note || '',
    cash_movement_id: null,
    created_at: now,
  };

  if (payment_type !== 'nasiya') {
    if (!Array.isArray(data.cash_movements)) data.cash_movements = [];
    const movementId = nextId(data, 'cash_movements');
    data.cash_movements.push({
      id: movementId,
      amount: totalAmount,
      category: 'Mahsulot kirim (yuk)',
      description: `${data.products[idx].name} — ${qty} dona (${supplier_name})`,
      recorded_by: req.user?.full_name || "Noma'lum",
      date_time: now,
      created_at: now,
      updated_at: now,
      payment_method: payment_type,
      is_inventory: true,
      supplier_debt_id: debtId,
    });
    entry.cash_movement_id = movementId;
  }
  data.supplier_debts.push(entry);
  logStockMovement(data, {
    product_id: data.products[idx].id,
    product_name: data.products[idx].name,
    type: 'kirim',
    quantity_delta: qty,
    unit_cost: cost,
    payment_type,
    supplier_name,
    source_type: 'supplier_debt',
    source_id: debtId,
    performed_by: req.user?.full_name,
    note: note || '',
  });

  writeData(data);
  res.json({ success: true, product: normalizeProduct(data.products[idx]) });
});

export default router;
