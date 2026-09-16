import { nextId } from '../db/store.js';
import { logStockMovement } from './stockMovements.js';

function round(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// (29/39) MUHIM: bu funksiya HECH NARSANI o'zgartirmaydi (faqat o'qiydi) —
// qaytarilayotgan bandlarning umumiy summasini va tan narxini (mahsulotning
// HOZIRGI costPrice/purchase_price asosida) oldindan hisoblash uchun.
// `readData()` har doim JONLI (klonlanmagan) obyektni qaytargani sabab,
// moliyaviy tekshiruv (refund summasi to'g'rimi) HALI o'tkazilmasdan turib
// omborni o'zgartiradigan processReturnItems() ni chaqirib yuborish xato:
// agar keyin 400 xatolik bilan to'xtasak ham, o'sha mutatsiya (masalan
// qoldiqqa qaytarish) allaqachon amalga oshgan bo'lib qoladi va yozib
// qo'yilmasa ham keyingi so'rovda qayta ko'rinaveradi. Shuning uchun:
// avval shu funksiya orqali PUL hisob-kitobini tekshiramiz, faqat
// tasdiqlangandan keyin processReturnItems() chaqiriladi.
export function computeItemsValue(data, saleItems) {
  let returnedSubtotal = 0;
  let returnedCost = 0;
  for (const it of saleItems) {
    const quantity = Number(it.quantity || 0);
    returnedSubtotal += Number(it.unit_price || 0) * quantity;
    const product = data.products.find((p) => p.id == it.product_id);
    if (product) {
      const unitCost = Number(product.costPrice ?? product.purchase_price ?? 0) || 0;
      returnedCost += unitCost * quantity;
    }
  }
  return { returnedSubtotal, returnedCost };
}

// Sotuvdan qaytarilayotgan bir yoki bir nechta bandni (mahsulotni) qayta
// ishlaydi: har birining holatiga qarab ('sellable' -> qoldiqqa,
// 'defective' -> hisobdan chiqarish) omborni to'g'irlaydi va harakatlar
// jurnaliga (stock_movements) yozadi. DIQQAT: bu funksiya OMBORNI
// O'ZGARTIRADI — shuning uchun faqat computeItemsValue() +
// computeReturnFinancials() orqali refund tekshiruvi MUVAFFAQIYATLI
// o'tgandan KEYIN chaqirilishi kerak (yuqoridagi izohga qarang).
export function processReturnItems(data, {
  saleItems,
  itemConditions = {},
  customerName,
  performedBy,
  saleId,
  now,
  restockNote,
  writeoffNote,
  writeoffReason,
}) {
  if (!Array.isArray(data.stock_writeoffs)) data.stock_writeoffs = [];
  let returnedSubtotal = 0;
  let returnedCost = 0;
  const writtenOff = [];
  const returnedSummary = [];
  let restockedCount = 0;
  let writtenOffCount = 0;

  for (const it of saleItems) {
    const product = data.products.find((p) => p.id == it.product_id);
    const isDefective = itemConditions[it.id] === 'defective';
    const quantity = Number(it.quantity || 0);
    const lineTotal = Number(it.unit_price || 0) * quantity;
    returnedSubtotal += lineTotal;

    if (!product) {
      returnedSummary.push({ product_name: it.product_name, quantity, condition: isDefective ? 'defective' : 'sellable' });
      continue;
    }

    const unitCost = Number(product.costPrice ?? product.purchase_price ?? 0) || 0;
    returnedCost += unitCost * quantity;

    product.sold_count = Math.max(0, Number(product.sold_count || 0) - quantity);
    product.sales_count = Math.max(0, Number(product.sales_count || 0) - quantity);

    if (!isDefective) {
      product.quantity += quantity;
      restockedCount++;
      logStockMovement(data, {
        product_id: product.id,
        product_name: it.product_name || product.name,
        type: 'qaytarish',
        quantity_delta: quantity,
        unit_price: it.unit_price,
        customer_name: customerName,
        source_type: 'sale',
        source_id: saleId,
        performed_by: performedBy,
        note: restockNote,
      });
    } else {
      const writeoffId = nextId(data, 'stock_writeoffs');
      data.stock_writeoffs.push({
        id: writeoffId,
        sale_id: saleId,
        sale_item_id: it.id,
        product_id: product.id,
        product_name: it.product_name || product.name,
        quantity,
        unit_cost: unitCost,
        total_cost: unitCost * quantity,
        reason: writeoffReason,
        created_at: now,
      });
      writtenOff.push({ product_name: it.product_name || product.name, quantity });
      writtenOffCount++;
      logStockMovement(data, {
        product_id: product.id,
        product_name: it.product_name || product.name,
        type: 'hisobdan_chiqarish',
        quantity_delta: 0,
        unit_cost: unitCost,
        customer_name: customerName,
        source_type: 'stock_writeoff',
        source_id: writeoffId,
        performed_by: performedBy,
        note: writeoffNote,
      });
    }
    returnedSummary.push({ product_name: it.product_name || product.name, quantity, condition: isDefective ? 'defective' : 'sellable' });
  }

  return { returnedSubtotal, returnedCost, writtenOff, returnedSummary, restockedCount, writtenOffCount };
}

// (39) Qaytarilgan qismning pul ta'sirini hisoblaydi. Chek darajasidagi
// chegirma qaytarilayotgan qismga MUTANOSIB RAVISHDA taqsimlanadi.
// Qaytarilgan summa AVVAL shu sotuvning joriy qarz qoldig'idan (debt_remaining)
// yechiladi — chunki bu pul hali umuman yig'ib olinmagan edi. Qolgan qismi
// esa ALLAQACHON naqd/karta orqali yig'ib olingan hisoblanadi va mijozga
// jismonan qaytarib berilishi kerak (remainderNeedingRefund).
export function computeReturnFinancials(sale, returnedSubtotal, returnedCost) {
  const subtotal = Number(sale.subtotal_amount || 0);
  const discount = Number(sale.discount_amount || 0);
  const discountShare = subtotal > 0 ? round((returnedSubtotal / subtotal) * discount) : 0;
  const returnedValue = Math.max(0, round(returnedSubtotal - discountShare));
  const debtRemaining = Number(sale.debt_remaining ?? sale.debt_amount ?? 0);
  const amountFromDebt = Math.min(returnedValue, debtRemaining);
  const remainderNeedingRefund = Math.max(0, round(returnedValue - amountFromDebt));
  return { returnedSubtotal: round(returnedSubtotal), discountShare, returnedValue, amountFromDebt, remainderNeedingRefund, returnedCost: round(returnedCost) };
}

// Hisoblangan moliyaviy ta'sirni sotuvning o'zига qo'llaydi: summalarni
// kamaytiradi, qarzni yechadi va (agar mijozga pul qaytarilgan bo'lsa)
// to'langan summalardan ham mos ravishda ayiradi. `refund` — mijozga
// jismonan naqd/karta orqali qaytarib berilgan summa (foydalanuvchi
// tomonidan kiritilgan/tasdiqlangan).
export function applyReturnToSale(sale, financials, refund = { naqd: 0, karta: 0 }) {
  const { returnedSubtotal, discountShare, returnedValue, amountFromDebt, returnedCost } = financials;
  sale.subtotal_amount = Math.max(0, round(Number(sale.subtotal_amount || 0) - returnedSubtotal));
  sale.discount_amount = Math.max(0, round(Number(sale.discount_amount || 0) - discountShare));
  sale.total_amount = Math.max(0, round(Number(sale.total_amount || 0) - returnedValue));
  sale.cost_amount = Math.max(0, round(Number(sale.cost_amount || 0) - returnedCost));
  sale.margin = round(Number(sale.total_amount || 0) - Number(sale.cost_amount || 0));
  sale.debt_remaining = Math.max(0, round(Number(sale.debt_remaining ?? sale.debt_amount ?? 0) - amountFromDebt));
  sale.debt_amount = Math.max(0, round(Number(sale.debt_amount || 0) - amountFromDebt));

  const refundNaqd = Math.max(0, Number(refund.naqd) || 0);
  const refundKarta = Math.max(0, Number(refund.karta) || 0);
  sale.paid_naqd = Math.max(0, round(Number(sale.paid_naqd || 0) - refundNaqd));
  sale.paid_karta = Math.max(0, round(Number(sale.paid_karta || 0) - refundKarta));
  sale.paid_amount = Math.max(0, round(Number(sale.paid_amount || 0) - refundNaqd - refundKarta));

  return { refundNaqd, refundKarta };
}

// (39) Mijozga jismonan qaytarib berilgan pulni alohida, aniq Kassa
// harakati sifatida qayd etadi (naqd va karta uchun alohida-alohida, agar
// ikkalasi ham bo'lsa). `is_inventory: true` bilan belgilanadi — bu pul
// kassadan chiqishini (cashOut/cardOut) TO'G'RI hisoblaydi, lekin GET
// /profit'ning "Jami xarajat"iga IKKI MARTA qo'shilib ketmasligi uchun
// undan chiqarib tashlaydi (chunki bu qaytarishning foydaga ta'siri
// allaqachon sale.total_amount/margin to'g'ridan-to'g'ri kamaytirilishi
// orqali hisobga olingan — bu yangi xarajat emas, oldingi tushumning
// bekor qilinishi).
export function logRefundCashMovement(data, { amount, payment_method, note, user }) {
  if (!Array.isArray(data.cash_movements)) data.cash_movements = [];
  const now = new Date().toISOString();
  const id = nextId(data, 'cash_movements');
  data.cash_movements.push({
    id,
    amount: round(amount),
    category: 'Mijozga pul qaytarish',
    description: note || '',
    recorded_by: user?.full_name || "Noma'lum",
    date_time: now,
    created_at: now,
    updated_at: now,
    payment_method: payment_method === 'karta' ? 'karta' : 'naqd',
    is_inventory: true,
  });
  return id;
}
