import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { printReceipt, downloadReceiptPdf, buildSaleReceiptData } from '../lib/receipt.js';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

const RESOLUTION_LABELS = {
  writeoff: "Hisobdan chiqarildi",
  restock: "Qoldiqqa qaytarildi",
  mixed: "Qisman qaytarildi / hisobdan chiqarildi",
  forgiven: "Qarz kechirildi",
};

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ full_name: '', phone: '', note: '' });
  const [payModal, setPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('naqd');
  const [detail, setDetail] = useState(null);
  const [oldDebtModal, setOldDebtModal] = useState(null);
  const [oldDebtAmount, setOldDebtAmount] = useState('');
  const [oldDebtDate, setOldDebtDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [oldDebtNote, setOldDebtNote] = useState('');
  const [oldDebtDueDate, setOldDebtDueDate] = useState('');
  // (38) Mijozlar ro'yxatini ism/telefon/qarz summasi bo'yicha jonli
  // qidirish va saralash — ro'yxat kattalashgani sayin kerakli mijozni
  // tezroq topish uchun.
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [closeDebtModal, setCloseDebtModal] = useState(null);
  const [closeDebtItems, setCloseDebtItems] = useState([]);
  const [closeDebtConditions, setCloseDebtConditions] = useState({});
  const [closeDebtBusy, setCloseDebtBusy] = useState(false);
  // (39) Agar shu xarid uchun mijoz OLDINDAN biroz naqd/karta to'lagan
  // bo'lsa-yu, endi mahsulot(lar) qaytarib olinayotgan bo'lsa — o'sha
  // to'langan qismni ham qanday qaytarib berilganini kiritish kerak.
  const [closeDebtRefund, setCloseDebtRefund] = useState({ naqd: '', karta: '' });
  // (39) Xarid qatoridagi "Ko'rish" — qaysi mahsulot(lar) sotilgani va
  // aniq naqd/karta/qarz bo'linishini ko'rsatadi (faqat ko'rish, o'zgartirmaydi).
  const [viewSaleModal, setViewSaleModal] = useState(null);

  function load() {
    api.listCustomers().then(setCustomers);
  }
  useEffect(load, []);

  async function handleSave(e) {
    e.preventDefault();
    await api.createCustomer(form);
    setModalOpen(false);
    setForm({ full_name: '', phone: '', note: '' });
    load();
  }

  async function openDetail(c) {
    const d = await api.getCustomer(c.id);
    setDetail(d);
  }

  async function handlePay(e) {
    e.preventDefault();
    await api.payDebt(payModal.id, { amount: +payAmount, payment_method: payMethod });
    setPayModal(null);
    setPayAmount('');
    setPayMethod('naqd');
    load();
  }

  // (30) Ilovadan oldingi eski qarzni qo'lda qo'shish — tan narxi
  // noma'lum bo'lgani uchun bu qarz "kutilayotgan foyda" hisobiga
  // qo'shilmaydi (backend margin=0 qilib yaratadi), faqat qarz sifatida
  // kuzatiladi.
  async function handleAddOldDebt(e) {
    e.preventDefault();
    try {
      await api.addOldDebt(oldDebtModal.id, { amount: +oldDebtAmount, date: oldDebtDate, note: oldDebtNote, due_date: oldDebtDueDate || null });
      setOldDebtModal(null);
      setOldDebtAmount('');
      setOldDebtNote('');
      setOldDebtDate(new Date().toISOString().slice(0, 10));
      setOldDebtDueDate('');
      load();
    } catch (err) {
      alert(err.message || "Qarz qo'shishda xatolik yuz berdi");
    }
  }

  // (1) Tarix oynasidagi har bir qarz qatori uchun to'lov muddatini
  // belgilash/o'zgartirish — tanlangan sanadan so'ng darhol saqlanadi.
  async function handleSetDueDate(sale, value) {
    try {
      await api.setSaleDueDate(detail.customer.id, sale.id, value || null);
      await openDetail(detail.customer);
      load();
    } catch (e) {
      alert(e.message || "Muddatni saqlashda xatolik yuz berdi");
    }
  }

  function dueDateStatus(sale, remaining) {
    if (!sale.due_date || remaining <= 0) return null;
    const todayISO = new Date().toISOString().slice(0, 10);
    if (sale.due_date < todayISO) return 'overdue';
    const in3DaysISO = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    if (sale.due_date <= in3DaysISO) return 'soon';
    return null;
  }

  // (38) Qidiruv (ism/telefon/qarz summasi) + saralash — mijozlar
  // ro'yxatiga qo'llanadi, o'chirilgan mijozlar har doim oxirida qoladi.
  function visibleCustomers() {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    let list = customers;
    if (q) {
      list = list.filter((c) => {
        const nameMatch = c.full_name?.toLowerCase().includes(q);
        const phoneMatch = c.phone?.toLowerCase().includes(q);
        const debtMatch = qDigits.length > 0 && String(Math.round(Number(c.current_debt || 0))).includes(qDigits);
        return nameMatch || phoneMatch || debtMatch;
      });
    }
    return [...list].sort((a, b) => {
      if (!!a.is_deleted !== !!b.is_deleted) return a.is_deleted ? 1 : -1;
      if (sortBy === 'debt') return Number(b.current_debt || 0) - Number(a.current_debt || 0);
      if (sortBy === 'recent') return new Date(b.created_at) - new Date(a.created_at);
      return a.full_name.localeCompare(b.full_name);
    });
  }

  async function openViewSale(sale) {
    try {
      const d = await api.getSale(sale.id);
      // (40) Bu oyna mijoz tarixi ichida ochilgani uchun mijoz ismi
      // allaqachon ma'lum — chekda ko'rsatish uchun qo'shib qo'yamiz.
      setViewSaleModal({ ...d, sale: { ...d.sale, customer_name: detail?.customer?.full_name } });
    } catch (e) {
      alert(e.message || "Sotuv ma'lumotini olishda xatolik yuz berdi");
    }
  }

  async function handleRestore(c) {
    if (!confirm(`"${c.full_name}" mijozni qayta faollashtirasizmi?`)) return;
    try {
      await api.restoreCustomer(c.id);
      load();
    } catch (e) {
      alert(e.message || 'Tiklashda xatolik yuz berdi');
    }
  }

  // (yangi) "Qarzni yopish" oynasini ochish — sotuvning mahsulot
  // bandlarini (agar bo'lsa) yuklab olamiz, shunda har biri uchun
  // "qoldiqqa qaytarish" yoki "hisobdan chiqarish" tanlash mumkin.
  async function openCloseDebt(sale) {
    setCloseDebtBusy(false);
    setCloseDebtConditions({});
    setCloseDebtRefund({ naqd: '', karta: '' });
    setCloseDebtModal(sale);
    try {
      const { items } = await api.getSale(sale.id);
      setCloseDebtItems(items || []);
    } catch (e) {
      setCloseDebtItems([]);
    }
  }

  // (39) Server bilan bir xil formula — barcha mahsulot(lar) qaytarib
  // olinganda mijozga qaytarib berish kerak bo'lgan summani OLDINDAN
  // ko'rsatish uchun (chekning to'langan-qarz bo'lmagan qismi).
  function closeDebtRemainderNeedingRefund() {
    if (!closeDebtModal || closeDebtItems.length === 0) return 0;
    const totalAmount = Number(closeDebtModal.total_amount || 0);
    const debtRemaining = Number(closeDebtModal.debt_remaining ?? closeDebtModal.debt_amount ?? 0);
    return Math.round(Math.max(0, totalAmount - debtRemaining));
  }

  async function handleCloseDebt(e) {
    e.preventDefault();
    const remainder = closeDebtRemainderNeedingRefund();
    const refundNaqd = Number(closeDebtRefund.naqd) || 0;
    const refundKarta = Number(closeDebtRefund.karta) || 0;
    if (remainder > 0 && Math.abs(refundNaqd + refundKarta - remainder) > 1) {
      alert(`Mijozga qaytarilishi kerak bo'lgan summa (${money(remainder)}) bilan kiritilgan naqd+karta yig'indisi mos kelmayapti.`);
      return;
    }
    setCloseDebtBusy(true);
    try {
      await api.closeSaleDebt(closeDebtModal.id, { itemConditions: closeDebtConditions, refund: { naqd: refundNaqd, karta: refundKarta } });
      setCloseDebtModal(null);
      setCloseDebtItems([]);
      setCloseDebtConditions({});
      setCloseDebtRefund({ naqd: '', karta: '' });
      if (detail) await openDetail(detail.customer);
      load();
    } catch (err) {
      alert(err.message || "Qarzni yopishda xatolik yuz berdi");
    } finally {
      setCloseDebtBusy(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Mijozlar / Qarz daftari</h2>
        <button className="btn" onClick={() => setModalOpen(true)}>+ Yangi mijoz</button>
      </div>

      <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ flex: '1 1 240px' }}
          placeholder="Ism, telefon yoki qarz summasi bo'yicha qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ minWidth: 200 }}>
          <option value="name">Saralash: Alifbo bo'yicha (A-Z)</option>
          <option value="recent">Saralash: Oxirgi qo'shilganlar</option>
          <option value="debt">Saralash: Eng katta qarzdan</option>
        </select>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Ism</th><th>Telefon</th><th>Qarzi</th><th></th></tr></thead>
          <tbody>
            {visibleCustomers().map((c) => (
              <tr key={c.id} style={c.is_deleted ? { opacity: 0.5 } : undefined}>
                <td>
                  {c.full_name}
                  {c.is_deleted && <span className="badge" style={{ fontSize: 10, marginLeft: 6 }}>O'chirilgan</span>}
                </td>
                <td>{c.phone}</td>
                <td>
                  <span className={`badge ${c.current_debt > 0 ? 'red' : 'green'}`}>{money(c.current_debt)}</span>
                  {c.overdue_debt && <span className="badge red" style={{ marginLeft: 4 }}>Muddati o'tgan!</span>}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn secondary" onClick={() => openDetail(c)}>Tarix</button>
                  {c.is_deleted ? (
                    <button className="btn secondary" onClick={() => handleRestore(c)}>Tiklash</button>
                  ) : (
                    <>
                      {c.current_debt > 0 && <button className="btn" onClick={() => { setPayModal(c); setPayMethod('naqd'); }}>To'lov qabul qilish</button>}
                      <button className="btn secondary" onClick={() => setOldDebtModal(c)}>Eski qarz qo'shish</button>
                      <button
                        className="btn danger"
                        onClick={async () => {
                          if (!confirm(`"${c.full_name}" mijozni faol ro'yxatdan olib tashlaysizmi? (Qarzi bo'lsa avval yopilishi kerak; sotuv tarixi baribir saqlanib qoladi, ro'yxatda xiraroq ko'rinib turadi)`)) return;
                          try {
                            await api.deleteCustomer(c.id);
                            load();
                          } catch (e) {
                            alert(e.message || 'O\'chirishda xatolik yuz berdi');
                          }
                        }}
                      >
                        O'chirish
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {customers.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-dim)' }}>Mijozlar yo'q</td></tr>}
            {customers.length > 0 && visibleCustomers().length === 0 && (
              <tr><td colSpan={4} style={{ color: 'var(--text-dim)' }}>Qidiruvga mos mijoz topilmadi</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
            <h3 style={{ marginTop: 0 }}>Yangi mijoz</h3>
            <div className="form-row"><label>Ism familiya *</label><input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="form-row"><label>Telefon</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 90 123 45 67" /></div>
            <div className="form-row"><label>Izoh</label><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows={3} /></div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setModalOpen(false)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Saqlash</button>
            </div>
          </form>
        </div>
      )}

      {payModal && (
        <div className="modal-overlay" onClick={() => setPayModal(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handlePay}>
            <h3 style={{ marginTop: 0 }}>{payModal.full_name} — to'lov qabul qilish</h3>
            <div className="form-row"><label>Qarzi: {money(payModal.current_debt)}</label></div>
            <div className="form-row">
              <label>To'lov summasi</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input required type="number" style={{ flex: 1 }} value={payAmount} onFocus={(e) => e.target.select()} onChange={(e) => setPayAmount(e.target.value)} />
                <button type="button" className="btn secondary" onClick={() => setPayAmount(String(payModal.current_debt))}>Jami (to'liq)</button>
              </div>
            </div>
            <div className="form-row">
              <label>Qanday to'landi?</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="naqd">💵 Naqd</option>
                <option value="karta">💳 Karta</option>
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
        <div className="modal-overlay" onClick={() => setOldDebtModal(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleAddOldDebt}>
            <h3 style={{ marginTop: 0 }}>{oldDebtModal.full_name} — eski qarz qo'shish</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
              Bu ilovadan oldingi (mahsulot bog'lanmagan) qarzlar uchun. Tan narxi noma'lum bo'lgani uchun bu qarzning foydasi hisobotlarga qo'shilmaydi — faqat qarz sifatida kuzatiladi.
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
              <label>To'lov muddati (ixtiyoriy)</label>
              <input type="date" value={oldDebtDueDate} onChange={(e) => setOldDebtDueDate(e.target.value)} />
            </div>
            <div className="form-row">
              <label>Izoh (ixtiyoriy)</label>
              <input value={oldDebtNote} onChange={(e) => setOldDebtNote(e.target.value)} placeholder="Masalan: ilovadan oldingi qarz" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setOldDebtModal(null)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Qo'shish</button>
            </div>
          </form>
        </div>
      )}

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <h3 style={{ marginTop: 0 }}>{detail.customer.full_name} — tarix</h3>
            <h4>Xaridlar</h4>
            <table>
              <thead><tr><th>Sana</th><th>Jami</th><th>To'langan</th><th>Qarz qoldig'i</th><th>Muddat</th><th></th></tr></thead>
              <tbody>
                {detail.sales.map((s) => {
                  const remaining = Number(s.debt_remaining ?? s.debt_amount ?? 0);
                  const status = dueDateStatus(s, remaining);
                  return (
                    <tr key={s.id}>
                      <td>{new Date(s.created_at).toLocaleDateString('uz-UZ')}</td>
                      <td>{money(s.total_amount)}</td>
                      <td>{money(s.paid_amount)}</td>
                      <td>{money(remaining)}</td>
                      <td>
                        {remaining > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <input
                              type="date"
                              value={s.due_date ? s.due_date.slice(0, 10) : ''}
                              onChange={(e) => handleSetDueDate(s, e.target.value)}
                              style={{ fontSize: 12, padding: '4px 6px' }}
                            />
                            {status === 'overdue' && <span className="badge red" style={{ fontSize: 10 }}>Muddati o'tgan!</span>}
                            {status === 'soon' && <span className="badge orange" style={{ fontSize: 10 }}>Tez orada</span>}
                          </div>
                        ) : (
                          s.due_date ? new Date(s.due_date).toLocaleDateString('uz-UZ') : '—'
                        )}
                      </td>
                      <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {s.is_manual_debt && <span className="badge" style={{ fontSize: 10 }}>Eski qarz</span>}
                        {!s.is_manual_debt && (
                          <button className="btn secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => openViewSale(s)}>
                            Ko'rish
                          </button>
                        )}
                        {remaining > 0 && (
                          <button className="btn secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => openCloseDebt(s)}>
                            Qarzni yopish
                          </button>
                        )}
                        {remaining <= 0 && s.debt_resolution && (
                          <span className="badge" style={{ fontSize: 10 }}>{RESOLUTION_LABELS[s.debt_resolution] || s.debt_resolution}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {detail.sales.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Xaridlar yo'q</td></tr>}
              </tbody>
            </table>
            <h4>To'lovlar</h4>
            <table>
              <thead><tr><th>Sana</th><th>Summa</th></tr></thead>
              <tbody>
                {detail.payments.map((p) => (
                  <tr key={p.id}><td>{new Date(p.created_at).toLocaleDateString('uz-UZ')}</td><td>{money(p.amount)}</td></tr>
                ))}
                {detail.payments.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--text-dim)' }}>To'lovlar yo'q</td></tr>}
              </tbody>
            </table>
            <button className="btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setDetail(null)}>Yopish</button>
          </div>
        </div>
      )}

      {closeDebtModal && (
        <div className="modal-overlay" onClick={() => !closeDebtBusy && setCloseDebtModal(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleCloseDebt}>
            <h3 style={{ marginTop: 0 }}>Qarzni yopish</h3>
            <div className="form-row">
              <label>
                {new Date(closeDebtModal.created_at).toLocaleDateString('uz-UZ')} sanadagi xarid — qarz qoldig'i: {money(closeDebtModal.debt_remaining ?? closeDebtModal.debt_amount)}
              </label>
            </div>

            {closeDebtItems.length > 0 ? (
              <>
                <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
                  Mijoz to'lamagan mahsulot(lar) uchun har birini qayerga qo'yishni tanlang: yaroqli bo'lsa qoldiqqa qaytariladi, yaroqsiz/yo'q bo'lsa hisobdan chiqariladi (zarar sifatida qayd etiladi).
                </div>
                {closeDebtItems.map((it) => (
                  <div className="form-row" key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span>{it.product_name} × {it.quantity}</span>
                    <select
                      value={closeDebtConditions[it.id] || 'sellable'}
                      onChange={(e) => setCloseDebtConditions({ ...closeDebtConditions, [it.id]: e.target.value })}
                    >
                      <option value="sellable">Qoldiqqa qaytarish</option>
                      <option value="defective">Hisobdan chiqarish (zarar)</option>
                    </select>
                  </div>
                ))}
                {closeDebtRemainderNeedingRefund() > 0 && (
                  <div className="card" style={{ background: 'var(--panel-light)', padding: 12, marginTop: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>
                      Mijoz bu xarid uchun allaqachon <strong>{money(closeDebtRemainderNeedingRefund())}</strong> to'lagan — mahsulot(lar) qaytarib olinayotgani uchun buni qanday qaytarib berganingizni kiriting:
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                        <label>💵 Naqd</label>
                        <input
                          type="number"
                          value={closeDebtRefund.naqd}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setCloseDebtRefund({ ...closeDebtRefund, naqd: e.target.value })}
                        />
                      </div>
                      <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                        <label>💳 Karta</label>
                        <input
                          type="number"
                          value={closeDebtRefund.karta}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => setCloseDebtRefund({ ...closeDebtRefund, karta: e.target.value })}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ marginTop: 8, fontSize: 12, padding: '4px 8px' }}
                      onClick={() => setCloseDebtRefund({ naqd: String(closeDebtRemainderNeedingRefund()), karta: '0' })}
                    >
                      Hammasini naqd qaytardim
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
                Bu qo'lda kiritilgan eski qarz (mahsulot bog'lanmagan). Uni yopish shu qarzni kechirish (hisobdan chiqarish) degani bo'ladi.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} disabled={closeDebtBusy} onClick={() => setCloseDebtModal(null)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }} disabled={closeDebtBusy}>Tasdiqlash</button>
            </div>
          </form>
        </div>
      )}

      {viewSaleModal && (
        <div className="modal-overlay" onClick={() => setViewSaleModal(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Chek #{viewSaleModal.sale.id}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
              {new Date(viewSaleModal.sale.created_at).toLocaleString('uz-UZ')}
            </div>
            <table>
              <thead><tr><th>Mahsulot</th><th>Miqdor</th><th>Narx</th><th>Summa</th></tr></thead>
              <tbody>
                {viewSaleModal.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td>{it.quantity}</td>
                    <td>{money(it.unit_price)}</td>
                    <td>{money(it.total_price)}</td>
                  </tr>
                ))}
                {viewSaleModal.items.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-dim)' }}>Mahsulot yo'q</td></tr>}
              </tbody>
            </table>
            <div className="card" style={{ background: 'var(--panel-light)', padding: 12, margin: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>Oraliq summa</span><span>{money(viewSaleModal.sale.subtotal_amount)}</span>
              </div>
              {Number(viewSaleModal.sale.discount_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: 'var(--red)' }}>
                  <span>Chegirma</span><span>-{money(viewSaleModal.sale.discount_amount)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 8 }}>
                <span>Jami</span><span>{money(viewSaleModal.sale.total_amount)}</span>
              </div>
              {Number(viewSaleModal.sale.paid_naqd) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>💵 Naqd to'langan</span><span>{money(viewSaleModal.sale.paid_naqd)}</span>
                </div>
              )}
              {Number(viewSaleModal.sale.paid_karta) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>💳 Karta to'langan</span><span>{money(viewSaleModal.sale.paid_karta)}</span>
                </div>
              )}
              {Number(viewSaleModal.sale.debt_remaining ?? viewSaleModal.sale.debt_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--red)' }}>
                  <span>Qarz qoldig'i</span><span>{money(viewSaleModal.sale.debt_remaining ?? viewSaleModal.sale.debt_amount)}</span>
                </div>
              )}
            </div>
            {viewSaleModal.sale.return_history && viewSaleModal.sale.return_history.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <h4 style={{ marginBottom: 6 }}>Qaytarishlar tarixi</h4>
                {viewSaleModal.sale.return_history.map((r, idx) => (
                  <div key={idx} className="card" style={{ padding: 10, fontSize: 12, marginBottom: 6 }}>
                    <div style={{ color: 'var(--text-dim)' }}>{new Date(r.at).toLocaleString('uz-UZ')} — {r.by}</div>
                    <div>{r.items.map((i) => `${i.product_name} x${i.quantity}`).join(', ')}</div>
                    <div>Qaytarilgan summa: {money(r.returnedValue)}
                      {(Number(r.refund?.naqd) > 0 || Number(r.refund?.karta) > 0) && (
                        <> — mijozga qaytarib berildi: {Number(r.refund.naqd) > 0 && `💵 ${money(r.refund.naqd)}`} {Number(r.refund.karta) > 0 && `💳 ${money(r.refund.karta)}`}</>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => printReceipt(buildSaleReceiptData(viewSaleModal.sale, viewSaleModal.items, { customerName: viewSaleModal.sale.customer_name }))}
              >
                🖨️ Chop etish
              </button>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => downloadReceiptPdf(buildSaleReceiptData(viewSaleModal.sale, viewSaleModal.items, { customerName: viewSaleModal.sale.customer_name }), `chek-${viewSaleModal.sale.id}.pdf`)}
              >
                ⬇️ PDF yuklab olish
              </button>
            </div>
            <button className="btn secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => setViewSaleModal(null)}>Yopish</button>
          </div>
        </div>
      )}
    </div>
  );
}
