// (40) Chek/hujjatlarni CHOP ETISH va PDF QILIB YUKLAB OLISH uchun umumiy,
// qayta ishlatiladigan modul — Sotuv (kassa), Hisobotlar, Mijozlar/Qarz va
// Ta'minotchilarga qarzim sahifalarining barchasida bir xil ishlaydi.
//
// PDF generatsiyasi uchun jsPDF kutubxonasi npm orqali EMAS, balki CDN
// orqali FAQAT KERAK BO'LGANDA (lazy) yuklanadi — shunda oddiy foydalanuvchi
// (faqat chop etadigan) uchun ilova og'irlashmaydi, va bu package.json /
// package-lock.json ga hech qanday o'zgartirish talab qilmaydi (GitHub web
// muharriri orqali qo'lda joylashda katta lockfile faylini almashtirish
// shart bo'lmaydi).

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

let jsPdfLoadPromise = null;
function loadJsPdf() {
  if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (jsPdfLoadPromise) return jsPdfLoadPromise;
  jsPdfLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error("PDF kutubxonasi yuklanmadi"));
    };
    script.onerror = () => {
      jsPdfLoadPromise = null;
      reject(new Error("PDF kutubxonasini yuklab bo'lmadi — internet aloqasini tekshiring"));
    };
    document.head.appendChild(script);
  });
  return jsPdfLoadPromise;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// data = {
//   title: string,
//   subtitleLines: string[],
//   columns: string[],
//   rows: (string|number)[][],
//   totals: { label, value, bold?, danger? }[],
//   footerLines?: string[],
// }
export function printReceipt(data) {
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) {
    alert("Chop etish oynasini ochib bo'lmadi — brauzeringiz popup oynalarni bloklagan bo'lishi mumkin.");
    return;
  }
  const rowsHtml = (data.rows || [])
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td style="${i === 0 ? '' : 'text-align:right'}">${escapeHtml(c)}</td>`)
          .join('')}</tr>`
    )
    .join('');
  const totalsHtml = (data.totals || [])
    .map(
      (t) => `
      <div style="display:flex;justify-content:space-between;margin:2px 0;${t.bold ? 'font-weight:700;' : ''}${
        t.danger ? 'color:#c0392b;' : ''
      }">
        <span>${escapeHtml(t.label)}</span><span>${escapeHtml(t.value)}</span>
      </div>`
    )
    .join('');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(data.title)}</title>
    <style>
      body{font-family: Arial, sans-serif; padding:16px; font-size:13px; color:#111;}
      h2{margin:0 0 4px 0; font-size:18px; text-align:center;}
      .sub{color:#555; font-size:12px; margin-bottom:4px; text-align:center;}
      table{width:100%; border-collapse:collapse; margin:12px 0 10px;}
      th,td{text-align:left; padding:4px 2px; border-bottom:1px solid #eee; font-size:12px;}
      .totals{border-top:1px solid #333; padding-top:6px; margin-top:6px;}
      .footer{margin-top:14px; font-size:11px; color:#777; text-align:center;}
    </style></head><body>
      <h2>${escapeHtml(data.title)}</h2>
      ${(data.subtitleLines || []).map((l) => `<div class="sub">${escapeHtml(l)}</div>`).join('')}
      ${
        (data.columns || []).length
          ? `<table><thead><tr>${(data.columns || [])
              .map((c, i) => `<th style="${i === 0 ? '' : 'text-align:right'}">${escapeHtml(c)}</th>`)
              .join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>`
          : ''
      }
      <div class="totals">${totalsHtml}</div>
      ${(data.footerLines || []).map((l) => `<div class="footer">${escapeHtml(l)}</div>`).join('')}
      <script>window.onload = function() { window.print(); };</script>
    </body></html>`);
  w.document.close();
}

export async function downloadReceiptPdf(data, filename) {
  let JsPdf;
  try {
    JsPdf = await loadJsPdf();
  } catch (e) {
    alert(e.message || "PDF yuklab bo'lmadi");
    return;
  }

  const pageWidth = 260;
  const margin = 16;
  const lineHeight = 14;
  const rows = data.rows || [];
  const totals = data.totals || [];
  const subtitleLines = data.subtitleLines || [];
  const footerLines = data.footerLines || [];
  const hasTable = (data.columns || []).length > 0;

  const estimatedHeight =
    margin * 2 +
    22 + // title
    subtitleLines.length * (lineHeight - 3) +
    10 +
    (hasTable ? lineHeight + 10 + rows.length * lineHeight + 16 : 0) +
    totals.length * lineHeight +
    10 +
    footerLines.length * (lineHeight - 4) +
    10;

  const doc = new JsPdf({ unit: 'pt', format: [pageWidth, Math.max(180, estimatedHeight)] });
  let y = margin;
  const leftX = margin;
  const rightX = pageWidth - margin;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(String(data.title || ''), pageWidth / 2, y, { align: 'center' });
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const line of subtitleLines) {
    doc.text(String(line), pageWidth / 2, y, { align: 'center' });
    y += lineHeight - 3;
  }
  y += 6;

  if (hasTable) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(String(data.columns[0]), leftX, y);
    doc.text(String(data.columns[data.columns.length - 1]), rightX, y, { align: 'right' });
    y += 10;
    doc.setLineWidth(0.5);
    doc.line(leftX, y, rightX, y);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    for (const r of rows) {
      const name = String(r[0] ?? '');
      const last = String(r[r.length - 1] ?? '');
      const mid = r.slice(1, -1).join('  x  ');
      doc.text(name, leftX, y, { maxWidth: pageWidth * 0.5 });
      doc.text(mid ? `${mid} = ${last}` : last, rightX, y, { align: 'right' });
      y += lineHeight;
    }
    y += 4;
    doc.line(leftX, y, rightX, y);
    y += 12;
  }

  doc.setFontSize(10);
  for (const t of totals) {
    doc.setFont('helvetica', t.bold ? 'bold' : 'normal');
    doc.text(String(t.label), leftX, y);
    doc.text(String(t.value), rightX, y, { align: 'right' });
    y += lineHeight;
  }

  if (footerLines.length) {
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    for (const line of footerLines) {
      doc.text(String(line), pageWidth / 2, y, { align: 'center' });
      y += lineHeight - 4;
    }
  }

  doc.save(filename || 'chek.pdf');
}

// Bitta sotuv (chek) uchun receipt.js formatiga mos ma'lumot tayyorlaydi.
export function buildSaleReceiptData(sale, items, { customerName, sellerName } = {}) {
  const subtitleLines = [new Date(sale.created_at).toLocaleString('uz-UZ')];
  if (customerName) subtitleLines.push(`Mijoz: ${customerName}`);
  if (sellerName) subtitleLines.push(`Sotuvchi: ${sellerName}`);

  const rows = (items || []).map((it) => [it.product_name, String(it.quantity), money(it.total_price ?? it.unit_price * it.quantity)]);

  const totals = [];
  totals.push({ label: 'Oraliq summa', value: money(sale.subtotal_amount) });
  if (Number(sale.discount_amount) > 0) totals.push({ label: 'Chegirma', value: '-' + money(sale.discount_amount), danger: true });
  totals.push({ label: 'Jami', value: money(sale.total_amount), bold: true });
  if (Number(sale.paid_naqd) > 0) totals.push({ label: "Naqd to'langan", value: money(sale.paid_naqd) });
  if (Number(sale.paid_karta) > 0) totals.push({ label: "Karta to'langan", value: money(sale.paid_karta) });
  const debtRemaining = Number(sale.debt_remaining ?? sale.debt_amount ?? 0);
  if (debtRemaining > 0) totals.push({ label: "Qarz qoldig'i", value: money(debtRemaining), danger: true });

  return {
    title: `Chek #${sale.id ?? ''}`,
    subtitleLines,
    columns: ['Mahsulot', 'Miqdor', 'Summa'],
    rows,
    totals,
    footerLines: ['Xaridingiz uchun rahmat!'],
  };
}

// Bitta kirim hujjati uchun receipt.js formatiga mos ma'lumot tayyorlaydi.
export function buildKirimReceiptData(doc) {
  const subtitleLines = [`Ta'minotchi: ${doc.supplier_name || ''}`, new Date(doc.date || doc.created_at).toLocaleDateString('uz-UZ')];
  if (doc.note) subtitleLines.push(`Izoh: ${doc.note}`);

  const rows = (doc.items || []).map((it) => [
    it.product_name || 'Eski qarz',
    it.quantity != null ? String(it.quantity) : '-',
    money(it.amount),
  ]);

  return {
    title: 'Kirim hujjati',
    subtitleLines,
    columns: ['Mahsulot', 'Soni', 'Summa'],
    rows,
    totals: [{ label: 'Jami', value: money(doc.total), bold: true }],
  };
}
