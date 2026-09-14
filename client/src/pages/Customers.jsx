import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

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
  const [closeDebtModal, setCloseDebtModal] = useState(null);
  const [closeDebtItems, setCloseDebtItems] = useState([]);
  const [closeDebtConditions, setCloseDebtConditions] = useState({});
  const [closeDebtBusy, setCloseDebtBusy] = useState(false);

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
      await api.addOldDebt(oldDebtModal.id, { amount: +oldDebtAmount, date: oldDebtDate, note: oldDebtNote });
      setOldDebtModal(null);
      setOldDebtAmount('');
      setOldDebtNote('');
      setOldDebtDate(new Date().toISOString().slice(0, 10));
      load();
    } catch (err) {
      alert(err.message || "Qarz qo'shishda xatolik yuz berdi");
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
    setCloseDebtModal(sale);
    try {
      const { items } = await api.getSale(sale.id);
      setCloseDebtItems(items || []);
    } catch (e) {
      setCloseDebtItems([]);
    }
  }

  async function handleCloseDebt(e) {
    e.preventDefault();
    setCloseDebtBusy(true);
    try {
      await api.closeSaleDebt(closeDebtModal.id, closeDebtConditions);
      setCloseDebtModal(null);
      setCloseDebtItems([]);
      setCloseDebtConditions({});
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

      <div className="card">
        <table>
          <thead><tr><th>Ism</th><th>Telefon</th><th>Qarzi</th><th></th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} style={c.is_deleted ? { opacity: 0.5 } : undefined}>
                <td>
                  {c.full_name}
                  {c.is_deleted && <span className="badge" style={{ fontSize: 10, marginLeft: 6 }}>O'chirilgan</span>}
                </td>
                <td>{c.phone}</td>
                <td>
                  <span className={`badge ${c.current_debt > 0 ? 'red' : 'green'}`}>{money(c.current_debt)}</span>
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
              <thead><tr><th>Sana</th><th>Jami</th><th>To'langan</th><th>Qarz qoldig'i</th><th></th></tr></thead>
              <tbody>
                {detail.sales.map((s) => {
                  const remaining = Number(s.debt_remaining ?? s.debt_amount ?? 0);
                  return (
                    <tr key={s.id}>
                      <td>{new Date(s.created_at).toLocaleDateString('uz-UZ')}</td>
                      <td>{money(s.total_amount)}</td>
                      <td>{money(s.paid_amount)}</td>
                      <td>{money(remaining)}</td>
                      <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {s.is_manual_debt && <span className="badge" style={{ fontSize: 10 }}>Eski qarz</span>}
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
                {detail.sales.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-dim)' }}>Xaridlar yo'q</td></tr>}
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
    </div>
  );
}
