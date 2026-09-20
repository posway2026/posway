import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { downloadReceiptPdf, buildKirimReceiptData } from '../lib/receipt.js';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

function emptyKirimLine(payment_type = 'naqd') {
  return {
    key: Math.random().toString(36).slice(2),
    isNew: false,
    product_id: '',
    new_product_name: '',
    new_product_brand: '',
    new_product_part_type: 'original',
    new_product_car_models: '',
    new_product_sale_price: '',
    new_product_min_quantity: 2,
    quantity: '',
    unit_cost: '',
    payment_type,
    note: '',
  };
}

export default function SupplierDebts() {
  const [suppliers, setSuppliers] = useState([]);
  const [payModal, setPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('naqd');
  const [detail, setDetail] = useState(null);
  const [oldDebtModal, setOldDebtModal] = useState(false);
  const [oldDebtSupplier, setOldDebtSupplier] = useState('');
  const [oldDebtAmount, setOldDebtAmount] = useState('');
  const [oldDebtDate, setOldDebtDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [oldDebtNote, setOldDebtNote] = useState('');
  const [products, setProducts] = useState([]);
  const [kirimModal, setKirimModal] = useState(false);
  // (14) Endi bitta kirim modali BIR NECHTA mahsulot-qatorini bir vaqtda
  // qo'shishga imkon beradi — bir yetkazib berishda kelgan barcha
  // mahsulotlar bitta "hujjat" sifatida saqlanadi.
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [docNote, setDocNote] = useState('');
  const [kirimLines, setKirimLines] = useState([emptyKirimLine()]);
  const [editingEntry, setEditingEntry] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', unit_cost: '', payment_type: 'naqd', note: '' });
  const [docView, setDocView] = useState(null);

  function load() {
    api.listSupplierDebts().then(setSuppliers);
  }
  useEffect(load, []);
  useEffect(() => {
    api.listProducts().then(setProducts).catch(() => {});
  }, []);

  async function openDetail(s) {
    const d = await api.supplierDebtEntries(s.supplier_name);
    setDetail(d);
  }

  async function refreshDetail() {
    if (detail) {
      const d = await api.supplierDebtEntries(detail.supplier_name);
      setDetail(d);
    }
  }

  async function handlePay(e) {
    e.preventDefault();
    await api.paySupplierDebt({ supplier_name: payModal.supplier_name, amount: +payAmount, payment_method: payMethod });
    setPayModal(null);
    setPayAmount('');
    setPayMethod('naqd');
    load();
  }

  // (28) Tugma bir necha marta bosilib, xato to'lov (masalan bir xil
  // to'lov 6 marta) yuborilib qo'yilishining oldini olish uchun — tarixdan
  // xato to'lovni bekor qilish imkoniyati. Yozuv o'chirilmaydi, faqat
  // "bekor qilingan" deb belgilanadi, qarz avtomatik tiklanadi.
  async function handleCancelPayment(paymentId) {
    if (!confirm("Bu to'lovni bekor qilishni xohlaysizmi? Qarz miqdori avtomatik tiklanadi.")) return;
    try {
      await api.cancelSupplierDebtPayment(paymentId);
      await refreshDetail();
      load();
    } catch (err) {
      alert(err.message || 'Bekor qilishda xatolik yuz berdi');
    }
  }

  // (30) Ilovadan oldingi eski ta'minotchi qarzlarini qo'lda qo'shish —
  // mahsulot xaridiga bog'lanmagan, alohida yozuv sifatida.
  async function handleAddOldDebt(e) {
    e.preventDefault();
    try {
      await api.addSupplierOldDebt({ supplier_name: oldDebtSupplier, amount: +oldDebtAmount, date: oldDebtDate, note: oldDebtNote });
      setOldDebtModal(false);
      setOldDebtSupplier('');
      setOldDebtAmount('');
      setOldDebtNote('');
      setOldDebtDate(new Date().toISOString().slice(0, 10));
      load();
    } catch (err) {
      alert(err.message || "Qarz qo'shishda xatolik yuz berdi");
    }
  }

  function openKirimModal() {
    setDocDate(new Date().toISOString().slice(0, 10));
    setDocNote('');
    setKirimLines([emptyKirimLine()]);
    setKirimModal(true);
  }

  function updateKirimLine(key, patch) {
    setKirimLines((lines) => lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addKirimLine() {
    setKirimLines((lines) => [...lines, emptyKirimLine(lines[lines.length - 1]?.payment_type || 'naqd')]);
  }

  function removeKirimLine(key) {
    setKirimLines((lines) => (lines.length > 1 ? lines.filter((l) => l.key !== key) : lines));
  }

  // (14) Ta'minotchi sahifasidan to'g'ridan-to'g'ri kirim qo'shish — bu
  // avtomatik ravishda umumiy Mahsulotlar ro'yxatiga qo'shiladi va, to'lov
  // turidan qat'iy nazar, aynan shu ta'minotchi tarixida saqlanadi. Bir
  // nechta mahsulot-qatori bo'lsa, hammasi BITTA kirim hujjati sifatida
  // (bir yetkazib berish) birga saqlanadi.
  async function handleAddKirim(e) {
    e.preventDefault();

    for (const line of kirimLines) {
      const salePrice = Number(line.new_product_sale_price) || 0;
      const costPrice = Number(line.unit_cost) || 0;
      if (line.isNew && salePrice > 0 && costPrice > 0 && salePrice < costPrice) {
        const productLabel = line.new_product_name || 'mahsulot';
        const ok = confirm(
          `Diqqat! "${productLabel}" uchun sotish narxi (${money(salePrice)}) tan narxdan (${money(costPrice)}) past.\n\n` +
          `Shunday davom etishga ishonchingiz komilmi?`
        );
        if (!ok) return;
      }
    }

    try {
      await api.addSupplierKirim(detail.supplier_name, {
        date: docDate,
        note: docNote,
        items: kirimLines.map((line) => ({
          product_id: line.isNew ? null : line.product_id || null,
          new_product_name: line.isNew ? line.new_product_name : null,
          new_product_brand: line.isNew ? line.new_product_brand : undefined,
          new_product_part_type: line.isNew ? line.new_product_part_type : undefined,
          new_product_car_models: line.isNew ? line.new_product_car_models : undefined,
          new_product_sale_price: line.isNew ? +line.new_product_sale_price : undefined,
          new_product_min_quantity: line.isNew ? +line.new_product_min_quantity : undefined,
          quantity: +line.quantity,
          unit_cost: +line.unit_cost,
          payment_type: line.payment_type,
          note: line.note,
        })),
      });
      setKirimModal(false);
      setKirimLines([emptyKirimLine()]);
      setDocNote('');
      await refreshDetail();
      load();
      api.listProducts().then(setProducts).catch(() => {});
    } catch (err) {
      alert(err.message || "Kirim qo'shishda xatolik yuz berdi");
    }
  }

  // (14) Kirim hujjatini chek/invoys ko'rinishida chop etish — yangi
  // oynada oddiy HTML sifatida ochiladi va avtomatik chop etish
  // dialogini chiqaradi.
  function printKirimDocument(doc) {
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return;
    const rows = doc.items.map((it) => `
      <tr>
        <td>${it.product_name || 'Eski qarz'}</td>
        <td style="text-align:center">${it.quantity ?? '-'}</td>
        <td style="text-align:right">${money(it.unit_cost || 0)}</td>
        <td style="text-align:right">${money(it.amount)}</td>
        <td style="text-align:center">${it.payment_type || ''}</td>
      </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kirim hujjati</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 13px; padding: 16px; color: #111; }
        h2 { margin: 0 0 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border-bottom: 1px solid #ccc; padding: 6px 4px; text-align: left; }
        .total { font-weight: bold; margin-top: 12px; text-align: right; font-size: 15px; }
      </style></head>
      <body>
        <h2>Kirim hujjati</h2>
        <div>Ta'minotchi: <b>${doc.supplier_name}</b></div>
        <div>Sana: ${new Date(doc.date).toLocaleDateString('uz-UZ')}</div>
        ${doc.note ? `<div>Izoh: ${doc.note}</div>` : ''}
        <table>
          <thead><tr><th>Mahsulot</th><th>Soni</th><th>Narx</th><th>Summa</th><th>To'lov</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="total">Jami: ${money(doc.total)}</div>
        <script>window.onload = function() { window.print(); };</script>
      </body></html>`);
    w.document.close();
  }

  async function openDocView(docSummaryRow) {
    try {
      const full = await api.getKirimDocument(docSummaryRow.id);
      setDocView(full);
    } catch (err) {
      alert(err.message || "Hujjatni ochishda xatolik yuz berdi");
    }
  }

  // Bitta satr o'chirilgandan keyin hujjat ko'rinishini yangilaydi — agar
  // shu o'chirilgan satr hujjatdagi OXIRGI mahsulot bo'lgan bo'lsa, hujjat
  // ham avtomatik o'chib ketadi (backend tomonidan), shunda modal
  // shunchaki yopiladi (xato ko'rsatilmaydi).
  async function refreshDocView(docId) {
    try {
      const full = await api.getKirimDocument(docId);
      setDocView(full);
    } catch (err) {
      setDocView(null);
    }
  }

  async function handleDeleteDocument(docId) {
    if (String(docId).startsWith('legacy-')) {
      // Eski, hujjatsiz yozuv — bitta satrni o'chirish bilan bir xil.
      const legacyEntryId = Number(String(docId).replace('legacy-', ''));
      await handleDeleteEntry(legacyEntryId);
      setDocView(null);
      return;
    }
    if (!confirm("Bu KIRIM HUJJATINI (undagi barcha mahsulotlar bilan) butunlay o'chirishni xohlaysizmi? Mahsulot qoldig'i va kassa balansi avtomatik to'g'irlanadi.")) return;
    try {
      await api.deleteKirimDocument(docId);
      setDocView(null);
      await refreshDetail();
      load();
      api.listProducts().then(setProducts).catch(() => {});
    } catch (err) {
      alert(err.message || "Hujjatni o'chirishda xatolik yuz berdi");
    }
  }

  function openEditEntry(d) {
    setEditingEntry(d);
    setEditForm({ quantity: d.quantity ?? '', unit_cost: d.unit_cost ?? '', payment_type: d.payment_type || 'nasiya', note: d.note || '' });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    try {
      await api.updateSupplierDebtEntry(editingEntry.id, {
        quantity: editingEntry.product_id ? +editForm.quantity : undefined,
        unit_cost: editingEntry.product_id ? +editForm.unit_cost : undefined,
        payment_type: editForm.payment_type,
        note: editForm.note,
      });
      setEditingEntry(null);
      await refreshDetail();
      load();
      api.listProducts().then(setProducts).catch(() => {});
    } catch (err) {
      alert(err.message || 'Tahrirlashda xatolik yuz berdi');
    }
  }

  async function handleDeleteEntry(id) {
    if (!confirm("Bu kirim yozuvini o'chirishni xohlaysizmi? Mahsulot qoldig'i va kassa balansi avtomatik to'g'irlanadi.")) return;
    try {
      await api.deleteSupplierDebtEntry(id);
      await refreshDetail();
      load();
      api.listProducts().then(setProducts).catch(() => {});
    } catch (err) {
      alert(err.message || "O'chirishda xatolik yuz berdi");
    }
  }

  function paymentBadge(type) {
    if (type === 'karta') return '💳 Karta';
    if (type === 'naqd') return '💵 Naqd';
    return '📒 Nasiya';
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Ta'minotchilarga qarzim</h2>
        <button className="btn" onClick={() => setOldDebtModal(true)}>+ Eski qarz qo'shish</button>
      </div>

      <div className="card" style={{ marginBottom: 16, color: 'var(--text-dim)', fontSize: 13 }}>
        Bu bo'lim — do'kon ta'minotchilarga to'lashi kerak bo'lgan pulni ko'rsatadi. Har bir ta'minotchining "Tarix" sahifasiga kirib, undan kelgan har qanday kirimni (naqd, karta yoki nasiya) qo'shishingiz mumkin.
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Ta'minotchi</th><th>Jami olingan</th><th>Qarz</th><th>To'langan</th><th>Qoldiq qarz</th><th></th></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.supplier_name}>
                <td>{s.supplier_name}</td>
                <td>{money(s.total_purchased)}</td>
                <td>{money(s.total_debt)}</td>
                <td>{money(s.total_paid)}</td>
                <td>
                  <span className={`badge ${s.balance > 0 ? 'red' : 'green'}`}>{money(s.balance)}</span>
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn secondary" onClick={() => openDetail(s)}>Tarix</button>
                  {s.balance > 0 && <button className="btn" onClick={() => setPayModal(s)}>To'lov qilish</button>}
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Ta'minotchilarga qarz yo'q</td></tr>}
          </tbody>
        </table>
      </div>

      {payModal && (
        <div className="modal-overlay" onClick={() => setPayModal(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handlePay}>
            <h3 style={{ marginTop: 0 }}>{payModal.supplier_name} — to'lov qilish</h3>
            <div className="form-row"><label>Qoldiq qarz: {money(payModal.balance)}</label></div>
            <div className="form-row"><label>To'lov summasi</label><input required type="number" value={payAmount} onFocus={(e) => e.target.select()} onChange={(e) => setPayAmount(e.target.value)} /></div>
            <div className="form-row">
              <label>Qanday to'landi?</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="naqd">💵 Naqd (kassadan ayiriladi)</option>
                <option value="karta">💳 Karta (kassadan ayiriladi)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setPayModal(null)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Tasdiqlash</button>
            </div>
          </form>
        </div>
      )}

      {oldDebtModal && (
        <div className="modal-overlay" onClick={() => setOldDebtModal(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAddOldDebt}>
            <h3 style={{ marginTop: 0 }}>Eski qarz qo'shish</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
              Bu ilovadan oldingi, mahsulot xaridiga bog'lanmagan qarzlar uchun.
            </div>
            <div className="form-row">
              <label>Ta'minotchi nomi *</label>
              <input required list="supplier-names-list-2" value={oldDebtSupplier} onChange={(e) => setOldDebtSupplier(e.target.value)} placeholder="Yangi yoki mavjud ta'minotchi nomi" />
            </div>
            <div className="form-row">
              <label>Qarz summasi *</label>
              <input required type="number" value={oldDebtAmount} onFocus={(e) => e.target.select()} onChange={(e) => setOldDebtAmount(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Qarz qachondan boshlangan?</label>
              <input type="date" value={oldDebtDate} onChange={(e) => setOldDebtDate(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Izoh (ixtiyoriy)</label>
              <input value={oldDebtNote} onChange={(e) => setOldDebtNote(e.target.value)} placeholder="Masalan: ilovadan oldingi qarz" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setOldDebtModal(false)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Qo'shish</button>
            </div>
          </form>
        </div>
      )}

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ marginTop: 0 }}>{detail.supplier_name} — tarix</h3>
              <button className="btn" onClick={openKirimModal}>+ Yangi kirim</button>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              <div>Jami olingan: <b>{money(detail.debts.reduce((s, d) => s + Number(d.amount || 0), 0))}</b></div>
            </div>

            {/* (14) Kirimlar endi HUJJAT bo'yicha guruhlangan — bir
                yetkazib berishda kelgan bir nechta mahsulot bitta qatorda
                ko'rinadi ("Ko'rish" orqali ichidagi mahsulotlarni ochish
                mumkin). */}
            <h4>Kirim hujjatlari</h4>
            <table>
              <thead><tr><th>Sana</th><th>Mahsulot(lar)</th><th>Jami summa</th><th>Izoh</th><th></th></tr></thead>
              <tbody>
                {(detail.documents || []).map((doc) => (
                  <tr key={doc.id}>
                    <td>{new Date(doc.date).toLocaleDateString('uz-UZ')}</td>
                    <td>
                      {doc.items.length === 1
                        ? (doc.items[0].product_name || <span style={{ color: 'var(--text-dim)' }}>Eski qarz</span>)
                        : `${doc.items.length} ta mahsulot`}
                    </td>
                    <td>{money(doc.total)}</td>
                    <td style={{ color: 'var(--text-dim)', fontSize: 12 }}>{doc.note}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => openDocView(doc)}>Ko'rish</button>
                    </td>
                  </tr>
                ))}
                {(!detail.documents || detail.documents.length === 0) && <tr><td colSpan={5} style={{ color: 'var(--text-dim)' }}>Kirim yo'q</td></tr>}
              </tbody>
            </table>
            <h4>To'lovlar</h4>
            <table>
              <thead><tr><th>Sana</th><th>Summa</th><th>Turi</th><th>Holati</th><th></th></tr></thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id} style={p.cancelled ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                    <td>{new Date(p.created_at).toLocaleDateString('uz-UZ')}</td>
                    <td>{money(p.amount)}</td>
                    <td>{p.payment_method === 'karta' ? '💳 Karta' : '💵 Naqd'}</td>
                    <td>{p.cancelled ? 'Bekor qilingan' : 'Faol'}</td>
                    <td>
                      {!p.cancelled && (
                        <button className="btn danger" style={{ textDecoration: 'none' }} onClick={() => handleCancelPayment(p.id)}>
                          Bekor qilish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {detail.payments.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-dim)' }}>To'lovlar yo'q</td></tr>}
              </tbody>
            </table>
            <button className="btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setDetail(null)}>Yopish</button>
          </div>
        </div>
      )}

      {/* (31) Muhim: bu ikkita modal "Tarix" oynasi (detail) USTIGA ochiladi,
          shuning uchun JSX'da ATAYLAB detail'dan KEYIN joylashtirilgan —
          aks holda "detail" oynasi keyinroq render bo'lganidan (DOM'da
          keyingi) ustiga chiqib, ularning tugmalarini bosib bo'lmay qolar edi. */}
      {/* (14) Bitta yetkazib berishda kelgan BIR NECHTA mahsulotni bitta
          hujjat sifatida qo'shish — har bir mahsulot o'z qatorida, "+ Yana
          mahsulot qo'shish" bilan istalgancha qator qo'shish mumkin. */}
      {kirimModal && detail && (
        <div className="modal-overlay" onClick={() => setKirimModal(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAddKirim} style={{ maxWidth: 760 }}>
            <h3 style={{ marginTop: 0 }}>{detail.supplier_name} — yangi kirim hujjati</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 8 }}>
              <div className="form-row">
                <label>Yetkazib berish sanasi</label>
                <input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Hujjat izohi (ixtiyoriy)</label>
                <input value={docNote} onChange={(e) => setDocNote(e.target.value)} placeholder="masalan: bozordan olingan yuk" />
              </div>
            </div>

            {kirimLines.map((line, idx) => (
              <div key={line.key} style={{ border: '1px solid var(--border, #333)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <b style={{ fontSize: 13 }}>{idx + 1}-mahsulot</b>
                  {kirimLines.length > 1 && (
                    <button type="button" className="btn danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => removeKirimLine(line.key)}>O'chirish</button>
                  )}
                </div>

                <div className="form-row">
                  <label>
                    <input type="checkbox" checked={line.isNew} onChange={(e) => updateKirimLine(line.key, { isNew: e.target.checked })} style={{ marginRight: 6 }} />
                    Yangi mahsulot (ro'yxatda yo'q)
                  </label>
                </div>

                {line.isNew ? (
                  <>
                    <div className="form-row">
                      <label>Mahsulot nomi *</label>
                      {/* (14b) Mavjud mahsulotlar nomidan tavsiya — tasodifan
                          takroriy nom bilan yangi yozuv ochib yubormaslik uchun. */}
                      <input required list="existing-product-names-list-supplier" value={line.new_product_name} onChange={(e) => updateKirimLine(line.key, { new_product_name: e.target.value })} />
                      {line.new_product_name && products.some((p) => p.name.toLowerCase() === line.new_product_name.trim().toLowerCase()) && (
                        <div style={{ fontSize: 12, color: 'var(--orange, #b8860b)', marginTop: 4 }}>
                          ⚠️ Bu nomdagi mahsulot ro'yxatda allaqachon bor — "Yangi mahsulot" belgisini olib, ro'yxatdan tanlashni o'ylab ko'ring.
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="form-row">
                        <label>Brend</label>
                        <input value={line.new_product_brand} onChange={(e) => updateKirimLine(line.key, { new_product_brand: e.target.value })} />
                      </div>
                      <div className="form-row">
                        <label>Turi</label>
                        <select value={line.new_product_part_type} onChange={(e) => updateKirimLine(line.key, { new_product_part_type: e.target.value })}>
                          <option value="original">Original</option>
                          <option value="oem">OEM (xitoy)</option>
                          <option value="ishlatilgan">Ishlatilgan</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <label>Mos mashina modellari</label>
                      <input value={line.new_product_car_models} onChange={(e) => updateKirimLine(line.key, { new_product_car_models: e.target.value })} placeholder="masalan: Nexia, Cobalt, Malibu" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div className="form-row">
                        <label>Sotish narxi *</label>
                        <input required type="number" value={line.new_product_sale_price} onFocus={(e) => e.target.select()} onChange={(e) => updateKirimLine(line.key, { new_product_sale_price: e.target.value })} />
                      </div>
                      <div className="form-row">
                        <label>Minimal qoldiq</label>
                        <input type="number" value={line.new_product_min_quantity} onFocus={(e) => e.target.select()} onChange={(e) => updateKirimLine(line.key, { new_product_min_quantity: e.target.value })} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="form-row">
                    <label>Mahsulot *</label>
                    <select required value={line.product_id} onChange={(e) => updateKirimLine(line.key, { product_id: e.target.value })}>
                      <option value="">— tanlang —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name} {p.brand ? `(${p.brand})` : ''}</option>)}
                    </select>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-row">
                    <label>Soni *</label>
                    <input required type="number" value={line.quantity} onFocus={(e) => e.target.select()} onChange={(e) => updateKirimLine(line.key, { quantity: e.target.value })} />
                  </div>
                  <div className="form-row">
                    <label>Tan narx (dona uchun) *</label>
                    <input required type="number" value={line.unit_cost} onFocus={(e) => e.target.select()} onChange={(e) => updateKirimLine(line.key, { unit_cost: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <label>To'lov turi *</label>
                  <select value={line.payment_type} onChange={(e) => updateKirimLine(line.key, { payment_type: e.target.value })}>
                    <option value="naqd">💵 Naqd (kassadan ayiriladi)</option>
                    <option value="karta">💳 Karta (kassadan ayiriladi)</option>
                    <option value="nasiya">📒 Nasiya (qarz sifatida yoziladi)</option>
                  </select>
                </div>
                {line.quantity > 0 && line.unit_cost > 0 && (
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Ushbu qator: {money(Number(line.quantity) * Number(line.unit_cost))}</div>
                )}
              </div>
            ))}

            <button type="button" className="btn secondary" style={{ width: '100%', marginBottom: 10 }} onClick={addKirimLine}>+ Yana mahsulot qo'shish</button>

            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 15 }}>
              Hujjat jami: {money(kirimLines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setKirimModal(false)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Saqlash</button>
            </div>
          </form>
        </div>
      )}

      {/* (14) Bitta kirim hujjatini ko'rish — ichidagi mahsulotlarni
          tahrirlash/o'chirish (mavjud, bitta-satrni o'chirish mantig'i
          ishlatiladi), chek qilib chop etish, yoki butun hujjatni bekor
          qilish. */}
      {docView && (
        <div className="modal-overlay" onClick={() => setDocView(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ marginTop: 0 }}>Kirim hujjati — {new Date(docView.date).toLocaleDateString('uz-UZ')}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn secondary" onClick={() => printKirimDocument(docView)}>🖨️ Chek qilib chiqarish</button>
                <button type="button" className="btn secondary" onClick={() => downloadReceiptPdf(buildKirimReceiptData(docView), `kirim-${docView.id}.pdf`)}>⬇️ PDF yuklab olish</button>
              </div>
            </div>
            {docView.note && <div style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 8 }}>Izoh: {docView.note}</div>}
            <table>
              <thead><tr><th>Mahsulot</th><th>Soni</th><th>Narx</th><th>Summa</th><th>Turi</th><th></th></tr></thead>
              <tbody>
                {docView.items.map((d) => (
                  <tr key={d.id}>
                    <td>{d.product_name || <span style={{ color: 'var(--text-dim)' }}>Eski qarz</span>}</td>
                    <td>{d.quantity ?? '-'}</td>
                    <td>{money(d.unit_cost || 0)}</td>
                    <td>{money(d.amount)}</td>
                    <td>{paymentBadge(d.payment_type)}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="btn secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => { setDocView(null); openEditEntry(d); }}>Tahrirlash</button>
                      <button className="btn danger" style={{ fontSize: 12, padding: '4px 8px' }} onClick={async () => { await handleDeleteEntry(d.id); refreshDocView(docView.id); }}>O'chirish</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontWeight: 700, textAlign: 'right', marginTop: 8 }}>Jami: {money(docView.total)}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button type="button" className="btn danger" style={{ flex: 1 }} onClick={() => handleDeleteDocument(docView.id)}>Hujjatni butunlay o'chirish</button>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setDocView(null)}>Yopish</button>
            </div>
          </div>
        </div>
      )}

      {editingEntry && (
        <div className="modal-overlay" onClick={() => setEditingEntry(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSaveEdit}>
            <h3 style={{ marginTop: 0 }}>Kirimni tahrirlash</h3>
            {editingEntry.product_id ? (
              <>
                <div className="form-row"><label>Mahsulot</label><input disabled value={editingEntry.product_name} /></div>
                <div className="form-row">
                  <label>Soni</label>
                  <input required type="number" value={editForm.quantity} onFocus={(e) => e.target.select()} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Tan narx (dona uchun)</label>
                  <input required type="number" value={editForm.unit_cost} onFocus={(e) => e.target.select()} onChange={(e) => setEditForm({ ...editForm, unit_cost: e.target.value })} />
                </div>
              </>
            ) : (
              <div className="form-row"><label>Bu — eski qarz yozuvi (mahsulotga bog'lanmagan), faqat izoh o'zgartirilishi mumkin.</label></div>
            )}
            <div className="form-row">
              <label>To'lov turi</label>
              <select value={editForm.payment_type} onChange={(e) => setEditForm({ ...editForm, payment_type: e.target.value })}>
                <option value="naqd">💵 Naqd</option>
                <option value="karta">💳 Karta</option>
                <option value="nasiya">📒 Nasiya</option>
              </select>
            </div>
            <div className="form-row">
              <label>Izoh</label>
              <input value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setEditingEntry(null)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Saqlash</button>
            </div>
          </form>
        </div>
      )}

      <datalist id="supplier-names-list-2">
        {suppliers.map((s) => <option key={s.supplier_name} value={s.supplier_name} />)}
      </datalist>
      <datalist id="existing-product-names-list-supplier">
        {products.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
    </div>
  );
}
