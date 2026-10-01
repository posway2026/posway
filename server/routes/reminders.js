// ---------------------------------------------------------------------
// (24) Qarz to'lov muddati haqida mijozlarga avtomatik SMS eslatma.
//
// Bu endpoint oddiy JWT (authRequired) orqali EMAS, balki alohida
// "umumiy sir" (CRON_SECRET) orqali himoyalangan — chunki uni chaqiradigan
// tomon mijoz brauzeri emas, balki tashqi jadval xizmati (cron-job.org)
// bo'ladi, u esa foydalanuvchi login/parolini bilmaydi.
//
// Rejim (standart, hozircha qattiq kodlangan — kerak bo'lsa keyinchalik
// sozlamaga chiqarish mumkin):
//  - Muddati ERTAGA tugaydigan qarz uchun — BIR MARTA eslatma.
//  - Muddati O'TGAN qarz uchun — har 3 kunda bir marta takroriy eslatma
//    (spam bo'lib ketmasligi uchun kundalik emas).
// Har bir sotuv o'zining due_reminder_sent_at / overdue_reminder_sent_at
// maydonlarida oxirgi yuborilgan vaqtni saqlaydi — shu orqali bir xil
// eslatma qayta-qayta yuborilib ketmaydi.
// ---------------------------------------------------------------------

import { Router } from 'express';
import { readData, writeData } from '../db/store.js';
import { sendSms } from '../lib/sms.js';

const router = Router();

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}.${m}.${y}`;
}

function checkSecret(req, res, next) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return res.status(500).json({
      error: "Eslatmalar funksiyasi hali sozlanmagan — serverga CRON_SECRET qo'shilishi kerak (Render → Environment).",
    });
  }
  const provided = req.headers['x-cron-secret'] || req.query.secret;
  if (provided !== expected) {
    return res.status(401).json({ error: "Noto'g'ri yoki yo'q CRON_SECRET" });
  }
  next();
}

async function runReminders(req, res) {
  const data = readData();
  const todayISO = new Date().toISOString().slice(0, 10);
  const OVERDUE_REPEAT_DAYS = 3;

  const customerById = {};
  for (const c of data.customers) customerById[c.id] = c;

  const summary = { checked: 0, sentDueSoon: 0, sentOverdue: 0, skippedNoPhone: 0, skippedAlreadySent: 0, failed: 0, errors: [] };
  let dirty = false;

  for (const sale of data.sales) {
    const remaining = Number(sale.debt_remaining ?? sale.debt_amount ?? 0);
    if (remaining <= 0 || !sale.due_date) continue;
    summary.checked++;

    const customer = customerById[sale.customer_id];
    if (!customer || customer.is_deleted) continue;

    const dueTomorrow = sale.due_date > todayISO && sale.due_date <= addDaysISO(todayISO, 1);
    const isOverdue = sale.due_date < todayISO;
    if (!dueTomorrow && !isOverdue) continue;

    const phone = customer.phone;
    if (!phone) {
      summary.skippedNoPhone++;
      continue;
    }

    let kind = null;
    let message = null;

    if (dueTomorrow && !sale.due_reminder_sent_at) {
      kind = 'due';
      message = `Hurmatli ${customer.full_name}, sizning ${money(remaining)} qarzingizni to'lash muddati ertaga (${fmtDate(sale.due_date)}) tugaydi. Iltimos, o'z vaqtida to'lang.`;
    } else if (isOverdue) {
      const lastSent = sale.overdue_reminder_sent_at ? new Date(sale.overdue_reminder_sent_at) : null;
      const daysSinceLast = lastSent ? (Date.now() - lastSent.getTime()) / 86400000 : Infinity;
      if (daysSinceLast >= OVERDUE_REPEAT_DAYS) {
        kind = 'overdue';
        message = `Hurmatli ${customer.full_name}, sizning ${money(remaining)} qarzingizni to'lash muddati ${fmtDate(sale.due_date)} da o'tgan. Iltimos, imkon qadar tezroq to'lang.`;
      }
    }

    if (!kind) {
      summary.skippedAlreadySent++;
      continue;
    }

    try {
      await sendSms(phone, message);
      if (kind === 'due') {
        sale.due_reminder_sent_at = new Date().toISOString();
        summary.sentDueSoon++;
      } else {
        sale.overdue_reminder_sent_at = new Date().toISOString();
        summary.sentOverdue++;
      }
      dirty = true;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ customer: customer.full_name, phone, error: err.message });
    }
  }

  if (dirty) writeData(data);

  res.json(summary);
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

router.get('/run', checkSecret, runReminders);
router.post('/run', checkSecret, runReminders);

export default router;
