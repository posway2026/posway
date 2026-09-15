import { nextId } from '../db/store.js';

// ---------------------------------------------------------------------
// (31/32/42) UMUMIY HARAKATLAR JURNALI
//
// Bu — mahsulot miqdoriga ta'sir qiluvchi (yoki tarixiy ahamiyatga ega)
// HAR BIR voqeani (kirim, sotuv, qaytarish, hisobdan chiqarish, tuzatish)
// bitta umumiy joyda, DOIMIY va O'ZGARMAS holda yozib boradigan jurnal.
//
// Muhim: sotuv yoki kirim yozuvi keyinchalik o'chirilsa/tahrirlansa ham
// (masalan sotuv qaytarilganda sale/sale_items butunlay o'chiriladi),
// shu yerdagi yozuv O'ZGARMAY qoladi — shuning uchun (32) umumiy tarix va
// (42) mahsulot tarixi har doim to'liq va ishonchli bo'ladi, "voqea sodir
// bo'lgan edi" degan izni hech qachon yo'qotmaydi.
//
// Chaqiruvchi funksiya bu yordamchini FAQAT product.quantity allaqachon
// yangilangandan KEYIN chaqirishi kerak — chunki balance_after aynan shu
// mahsulotning JORIY (yangilangan) qoldig'idan olinadi.
// ---------------------------------------------------------------------

export function logStockMovement(data, {
  product_id,
  product_name = null,
  type, // 'kirim' | 'sotuv' | 'qaytarish' | 'hisobdan_chiqarish' | 'tuzatish' | 'kirim_bekor'
  quantity_delta = 0,
  unit_cost = null,
  unit_price = null,
  payment_type = null,
  supplier_name = null,
  customer_name = null,
  source_type = null, // 'supplier_debt' | 'kirim_document' | 'sale' | 'stock_writeoff' | 'manual' | 'product_delete'
  source_id = null,
  performed_by = "Noma'lum",
  note = '',
  created_at = null,
} = {}) {
  if (!Array.isArray(data.stock_movements)) data.stock_movements = [];
  const product = (data.products || []).find((p) => p.id == product_id);
  const id = nextId(data, 'stock_movements');
  const entry = {
    id,
    product_id: product_id ?? null,
    product_name: product_name || product?.name || null,
    type,
    quantity_delta: Number(quantity_delta) || 0,
    balance_after: product ? Number(product.quantity) || 0 : null,
    unit_cost: unit_cost !== null && unit_cost !== undefined ? Number(unit_cost) || 0 : null,
    unit_price: unit_price !== null && unit_price !== undefined ? Number(unit_price) || 0 : null,
    payment_type: payment_type || null,
    supplier_name: supplier_name || null,
    customer_name: customer_name || null,
    source_type: source_type || null,
    source_id: source_id ?? null,
    performed_by: performed_by || "Noma'lum",
    note: note || '',
    created_at: created_at || new Date().toISOString(),
  };
  data.stock_movements.push(entry);
  return entry;
}
