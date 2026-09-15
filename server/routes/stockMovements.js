import { Router } from 'express';
import { readData } from '../db/store.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// (32) Butun do'kon bo'yicha barcha kirim/sotuv/qaytarish/hisobdan
// chiqarish/tuzatish harakatlari — bitta umumiy tarix. Filtrlash uchun
// sana oralig'i, harakat turi, mahsulot va ta'minotchi/mijoz bo'yicha
// so'rov parametrlari qabul qilinadi. Sana oralig'i berilmasa, eng
// so'nggi 300 tasi qaytariladi (sales.js'dagi bilan bir xil pattern).
router.get('/', authRequired, (req, res) => {
  const { from, to, type, product_id, q } = req.query;
  const data = readData();
  let rows = [...(data.stock_movements || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (from && to) {
    rows = rows.filter((m) => {
      const day = m.created_at.slice(0, 10);
      return day >= from && day <= to;
    });
  }
  if (type) rows = rows.filter((m) => m.type === type);
  if (product_id) rows = rows.filter((m) => m.product_id == product_id);
  if (q) {
    const s = q.toLowerCase();
    rows = rows.filter(
      (m) =>
        (m.product_name || '').toLowerCase().includes(s) ||
        (m.supplier_name || '').toLowerCase().includes(s) ||
        (m.customer_name || '').toLowerCase().includes(s) ||
        (m.note || '').toLowerCase().includes(s)
    );
  }
  if (!(from && to)) rows = rows.slice(0, 300);

  res.json(rows);
});

export default router;
