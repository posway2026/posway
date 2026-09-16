import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { printReceipt, downloadReceiptPdf, buildSaleReceiptData } from '../lib/receipt.js';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function Reports() {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [sales, setSales] = useState([]);
  const [daily, setDaily] = useState([]);
  const [profitView, setProfitView] = useState('daily');
  const [profitData, setProfitData] = useState(null);

  // (29/33/39) Qaytarish oynasi — sotuvni "qaytarish" bosilganda ochiladi.
  // Endi har bir mahsulotni ALOHIDA qaytarish/qaytarmaslikni (selected) va
  // holatini (sotiladigan/yaroqsiz) tanlash mumkin; agar qaytarilayotgan
  // qism uchun mijoz allaqachon pul to'lagan bo'lsa (qarzdan ortig'i),
  // buni qanday (naqd/karta) qaytarib berilganini kiritish so'raladi.
  const [returnModal, setReturnModal] = useState(null);
  const [returnBusy, setReturnBusy] = useState(false);
  const [refundInput, setRefundInput] = useState({ naqd: '', karta: '' });

  // (29) Chek tafsiloti — faqat ko'rish uchun (hech narsani o'zgartirmaydi).
  const [viewModal, setViewModal] = useState(null);

  function load() {
    api.listSales(from, to).then(setSales);
  }

  function refreshReports() {
    load();
    api.dailyReport().then(setDaily);
    api.profitReport(profitView).then(setProfitData).catch(() => setProfitData(null));
  }

  useEffect(() => {
    refreshReports();
  }, []);

  useEffect(() => {
    api.profitReport(profitView).then(setProfitData).catch(() => setProfitData(null));
  }, [profitView]);

  async function openReturnModal(sale) {
    try {
      const detail = await api.getSale(sale.id);
      const conditions = {};
      const selected = {};
      (detail.items || []).forEach((it) => {
        conditions[it.id] = 'sellable';
        selected[it.id] = true; // (29) standart bo'yicha hammasi qaytariladi — avvalgi xatti-harakat
      });
      setReturnModal({ sale: detail.sale, items: detail.items || [], conditions, selected });
      setRefundInput({ naqd: '', karta: '' });
    } catch (e) {
      alert(e.message || "Sotuv ma'lumotini olishda xatolik yuz berdi");
    }
  }

  function setItemCondition(itemId, condition) {
    setReturnModal((prev) => prev && { ...prev, conditions: { ...prev.conditions, [itemId]: condition } });
  }

  function toggleItemSelected(itemId) {
    setReturnModal((prev) => prev && { ...prev, selected: { ...prev.selected, [itemId]: !prev.selected[itemId] } });
  }

  // (39) Server bilan bir xil formula — mijozga qaytarib berish kerak
  // bo'lgan summani OLDINDAN (so'rov yuborishdan avval) ko'rsatish uchun.
  // Yakuniy hisob-kitob va tekshiruv baribir serverda amalga oshadi.
  function computeReturnPreview(modal) {
    if (!modal) return { returnedValue: 0, amountFromDebt: 0, remainderNeedingRefund: 0, anySelected: false };
    const returnedItems = modal.items.filter((it) => modal.selected[it.id]);
    const returnedSubtotal = returnedItems.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 0), 0);
    const subtotal = Number(modal.sale.subtotal_amount || 0);
    const discount = Number(modal.sale.discount_amount || 0);
    const discountShare = subtotal > 0 ? (returnedSubtotal / subtotal) * discount : 0;
    const returnedValue = Math.max(0, returnedSubtotal - discountShare);
    const debtRemaining = Number(modal.sale.debt_remaining ?? modal.sale.debt_amount ?? 0);
    const amountFromDebt = Math.min(returnedValue, debtRemaining);
    const remainderNeedingRefund = Math.round(Math.max(0, returnedValue - amountFromDebt));
    return { returnedValue, amountFromDebt, remainderNeedingRefund, anySelected: returnedItems.length > 0 };
  }

  async function confirmReturn() {
    if (!returnModal) return;
    const preview = computeReturnPreview(returnModal);
    if (!preview.anySelected) {
      alert('Qaytarish uchun kamida bitta mahsulot tanlang');
      return;
    }
    const refundNaqd = Number(refundInput.naqd) || 0;
    const refundKarta = Number(refundInput.karta) || 0;
    if (preview.remainderNeedingRefund > 0 && Math.abs(refundNaqd + refundKarta - preview.remainderNeedingRefund) > 1) {
      alert(`Mijozga qaytarilishi kerak bo'lgan summa (${money(preview.remainderNeedingRefund)}) bilan kiritilgan naqd+karta yig'indisi mos kelmayapti.`);
      return;
    }
    setReturnBusy(true);
    try {
      const returnItemIds = returnModal.items.filter((it) => returnModal.selected[it.id]).map((it) => it.id);
      const result = await api.deleteSale(returnModal.sale.id, {
        returnItemIds,
        itemConditions: returnModal.conditions,
        refund: { naqd: refundNaqd, karta: refundKarta },
      });
      setReturnModal(null);
      refreshReports();
      if (result.writtenOff && result.writtenOff.length > 0) {
        const lines = result.writtenOff.map((w) => `• ${w.product_name} — ${w.quantity} dona`).join('\n');
        alert(`Qaytarish yakunlandi.\n\nYaroqsiz deb belgilangani uchun qoldiqqa qaytarilmay, hisobdan chiqarildi:\n${lines}`);
      }
    } catch (e) {
      // (39) Server refund summasi mos kelmasa aniq kerakli summani
      // qaytaradi — buni foydalanuvchiga to'g'ridan-to'g'ri ko'rsatamiz.
      alert(e.message || 'Qaytarishda xatolik yuz berdi');
    } finally {
      setReturnBusy(false);
    }
  }

  async function openViewModal(sale) {
    try {
      const detail = await api.getSale(sale.id);
      // (40) `sales` ro'yxatidagi qatorda customer_name/seller_name
      // allaqachon bor (GET /sales join qilib beradi) — chekda ko'rsatish
      // uchun shu yerga qo'shib qo'yamiz (GET /sales/:id ularni bermaydi).
      setViewModal({ ...detail, sale: { ...detail.sale, customer_name: sale.customer_name, seller_name: sale.seller_name } });
    } catch (e) {
      alert(e.message || "Sotuv ma'lumotini olishda xatolik yuz berdi");
    }
  }

  // (34) Aralash to'lovda bitta sotuv ham naqd, ham karta ulushiga ega
  // bo'lishi mumkin, shuning uchun payment_type bo'yicha filtrlash o'rniga
  // har bir sotuvning paid_naqd/paid_karta maydonlarini to'g'ridan-to'g'ri
  // yig'amiz — bu qarzga qisman to'langan upfront qismini ham to'g'ri hisoblaydi.
  const total = sales.reduce((s, x) => s + x.total_amount, 0);
  const cashTotal = sales.reduce((s, x) => s + Number(x.paid_naqd || 0), 0);
  const cardTotal = sales.reduce((s, x) => s + Number(x.paid_karta || 0), 0);
  const debtTotal = sales.reduce((s, x) => s + Number(x.debt_amount || 0), 0);

  const maxDaily = Math.max(1, ...daily.map((d) => d.total));

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Hisobotlar</h2>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h4 style={{ marginTop: 0 }}>Oxirgi 14 kunlik savdo</h4>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
          {daily.map((d) => (
            <div key={d.day} style={{ flex: 1, textAlign: 'center' }}>
              <div
                title={money(d.total)}
                style={{
                  background: 'var(--accent)',
                  height: `${Math.max(4, (d.total / maxDaily) * 110)}px`,
                  borderRadius: 4,
                  marginBottom: 4,
                }}
              />
              <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{d.day.slice(5)}</div>
            </div>
          ))}
          {daily.length === 0 && <div style={{ color: 'var(--text-dim)' }}>Ma'lumot yo'q</div>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Dan</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Gacha</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn" onClick={load}>Filtrlash</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>Foyda hisoboti</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {['daily', 'monthly', 'yearly'].map((key) => (
              <button
                key={key}
                type="button"
                className={`btn ${profitView === key ? '' : 'secondary'}`}
                onClick={() => setProfitView(key)}
              >
                {key === 'daily' ? 'Kunlik' : key === 'monthly' ? 'Oylik' : 'Yillik'}
              </button>
            ))}
          </div>
        </div>

        {profitData && (
          <div>
            <div className="stat-grid" style={{ marginTop: 16 }}>
              <div className="stat-card"><div className="label">Jami savdo</div><div className="value">{money(profitData.totalSales)}</div></div>
              <div className="stat-card"><div className="label">Jami tan narx</div><div className="value">{money(profitData.totalCost)}</div></div>
              <div className="stat-card"><div className="label">Jami xarajat</div><div className="value" style={{ color: 'var(--red)' }}>{money(profitData.totalExpenses)}</div></div>
              <div className="stat-card">
                <div className="label">Real (kassa) foyda</div>
                <div className="value" style={{ color: profitData.kassaFoyda >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(profitData.kassaFoyda)}</div>
              </div>
            </div>
            <div className="card" style={{ marginTop: 12, background: 'var(--panel-light)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>📒 Kutilayotgan foyda (hali qaytarilmagan qarzlardan)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Mijoz qarzni to'laganda, bu summa avtomatik real foydaga qo'shiladi</div>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{money(profitData.kutilayotganFoyda)}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="label">Jami savdo</div><div className="value">{money(total)}</div></div>
        <div className="stat-card"><div className="label">Naqd</div><div className="value">{money(cashTotal)}</div></div>
        <div className="stat-card"><div className="label">Karta</div><div className="value">{money(cardTotal)}</div></div>
        <div className="stat-card"><div className="label">Qarzga berilgan</div><div className="value" style={{ color: 'var(--red)' }}>{money(debtTotal)}</div></div>
      </div>

      <div className="card">
        <table>
          <thead><tr><th>Sana</th><th>Mijoz</th><th>Sotuvchi</th><th>To'lov turi</th><th>Jami</th><th></th></tr></thead>
          <tbody>
            {sales.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.created_at).toLocaleString('uz-UZ')}</td>
                <td>{s.customer_name || '—'}</td>
                <td>{s.seller_name}</td>
                <td>
                  <span className={`badge ${s.payment_type === 'qarz' ? 'red' : s.payment_type === 'aralash' ? 'orange' : 'green'}`}>
                    {s.payment_type}
                  </span>
                  {/* (34) Aralash yoki qisman to'langan qarz sotuvlarida naqd/karta
                      ulushini ham ko'rsatamiz, shunda tarkibi shaffof bo'ladi. */}
                  {Number(s.paid_naqd) > 0 && Number(s.paid_karta) > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                      💵 {money(s.paid_naqd)} + 💳 {money(s.paid_karta)}
                    </div>
                  )}
                </td>
                <td>
                  {money(s.total_amount)}
                  {Number(s.discount_amount) > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--red)' }}>Chegirma: -{money(s.discount_amount)}</div>
                  )}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn secondary" onClick={() => openViewModal(s)}>
                    Ko'rish
                  </button>
                  <button className="btn danger" onClick={() => openReturnModal(s)}>
                    Qaytarish
                  </button>
                </td>
              </tr>
            ))}
            {sales.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Bu davrda sotuv yo'q</td></tr>}
          </tbody>
        </table>
      </div>

      {returnModal && (() => {
        const preview = computeReturnPreview(returnModal);
        return (
          <div className="modal-overlay" onClick={() => !returnBusy && setReturnModal(null)}>
            <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginTop: 0 }}>Sotuvni qaytarish</h3>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
                {new Date(returnModal.sale.created_at).toLocaleString('uz-UZ')} — {money(returnModal.sale.total_amount)}
              </div>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Qaytarilayotgan mahsulot(lar)ni belgilang. Har biri uchun holatini ham tanlang: <strong>sotiladigan</strong> bo'lsa — qoldiqqa qaytariladi; <strong>yaroqsiz</strong> bo'lsa — qoldiqqa qaytarilmay, avtomatik hisobdan chiqariladi.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {returnModal.items.map((it) => (
                  <div key={it.id} className="card" style={{ padding: 12, opacity: returnModal.selected[it.id] ? 1 : 0.5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!returnModal.selected[it.id]} onChange={() => toggleItemSelected(it.id)} />
                        <strong>{it.product_name}</strong>
                      </label>
                      <span style={{ color: 'var(--text-dim)' }}>{it.quantity} dona — {money(it.total_price)}</span>
                    </div>
                    {returnModal.selected[it.id] && (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type="button"
                          className={`btn ${returnModal.conditions[it.id] === 'sellable' ? '' : 'secondary'}`}
                          style={{ flex: 1 }}
                          onClick={() => setItemCondition(it.id, 'sellable')}
                        >
                          ✅ Sotiladigan holatda
                        </button>
                        <button
                          type="button"
                          className={`btn ${returnModal.conditions[it.id] === 'defective' ? 'danger' : 'secondary'}`}
                          style={{ flex: 1 }}
                          onClick={() => setItemCondition(it.id, 'defective')}
                        >
                          ⚠️ Yaroqsiz (hisobdan chiqariladi)
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {returnModal.items.length === 0 && (
                  <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Bu sotuvda mahsulot topilmadi.</div>
                )}
              </div>

              {preview.anySelected && (
                <div className="card" style={{ background: 'var(--panel-light)', padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>Qaytarilayotgan summa: <strong>{money(preview.returnedValue)}</strong></div>
                  {preview.amountFromDebt > 0 && (
                    <div style={{ fontSize: 13, marginBottom: 4 }}>Shundan qarz qoldig'idan yechiladi: <strong>{money(preview.amountFromDebt)}</strong></div>
                  )}
                  {preview.remainderNeedingRefund > 0 ? (
                    <>
                      <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 8 }}>
                        Mijoz bu qism uchun allaqachon <strong>{money(preview.remainderNeedingRefund)}</strong> to'lagan — buni qanday qaytarib berganingizni kiriting:
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                          <label>💵 Naqd</label>
                          <input
                            type="number"
                            value={refundInput.naqd}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setRefundInput({ ...refundInput, naqd: e.target.value })}
                          />
                        </div>
                        <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
                          <label>💳 Karta</label>
                          <input
                            type="number"
                            value={refundInput.karta}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setRefundInput({ ...refundInput, karta: e.target.value })}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ marginTop: 8, fontSize: 12, padding: '4px 8px' }}
                        onClick={() => setRefundInput({ naqd: String(preview.remainderNeedingRefund), karta: '0' })}
                      >
                        Hammasini naqd qaytardim
                      </button>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>Mijozga qaytarib berish shart bo'lgan pul yo'q — hammasi qarz hisobidan yopiladi.</div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="btn secondary" style={{ flex: 1 }} disabled={returnBusy} onClick={() => setReturnModal(null)}>
                  Bekor qilish
                </button>
                <button type="button" className="btn danger" style={{ flex: 1 }} disabled={returnBusy} onClick={confirmReturn}>
                  {returnBusy ? 'Yuborilmoqda...' : 'Qaytarishni tasdiqlash'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {viewModal && (
        <div className="modal-overlay" onClick={() => setViewModal(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Chek #{viewModal.sale.id}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 12 }}>
              {new Date(viewModal.sale.created_at).toLocaleString('uz-UZ')}
              {viewModal.sale.customer_name && <> — {viewModal.sale.customer_name}</>}
            </div>
            <table>
              <thead><tr><th>Mahsulot</th><th>Miqdor</th><th>Narx</th><th>Summa</th></tr></thead>
              <tbody>
                {viewModal.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product_name}</td>
                    <td>{it.quantity}</td>
                    <td>{money(it.unit_price)}</td>
                    <td>{money(it.total_price)}</td>
                  </tr>
                ))}
                {viewModal.items.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--text-dim)' }}>Mahsulot yo'q (qo'lda kiritilgan qarz)</td></tr>}
              </tbody>
            </table>
            <div className="card" style={{ background: 'var(--panel-light)', padding: 12, margin: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>Oraliq summa</span><span>{money(viewModal.sale.subtotal_amount)}</span>
              </div>
              {Number(viewModal.sale.discount_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: 'var(--red)' }}>
                  <span>Chegirma</span><span>-{money(viewModal.sale.discount_amount)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: 8 }}>
                <span>Jami</span><span>{money(viewModal.sale.total_amount)}</span>
              </div>
              {Number(viewModal.sale.paid_naqd) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>💵 Naqd to'langan</span><span>{money(viewModal.sale.paid_naqd)}</span>
                </div>
              )}
              {Number(viewModal.sale.paid_karta) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>💳 Karta to'langan</span><span>{money(viewModal.sale.paid_karta)}</span>
                </div>
              )}
              {Number(viewModal.sale.debt_remaining ?? viewModal.sale.debt_amount) > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--red)' }}>
                  <span>Qarz qoldig'i</span><span>{money(viewModal.sale.debt_remaining ?? viewModal.sale.debt_amount)}</span>
                </div>
              )}
            </div>
            {viewModal.sale.return_history && viewModal.sale.return_history.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <h4 style={{ marginBottom: 6 }}>Qaytarishlar tarixi</h4>
                {viewModal.sale.return_history.map((r, idx) => (
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
                onClick={() => printReceipt(buildSaleReceiptData(viewModal.sale, viewModal.items, { customerName: viewModal.sale.customer_name, sellerName: viewModal.sale.seller_name }))}
              >
                🖨️ Chop etish
              </button>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => downloadReceiptPdf(buildSaleReceiptData(viewModal.sale, viewModal.items, { customerName: viewModal.sale.customer_name, sellerName: viewModal.sale.seller_name }), `chek-${viewModal.sale.id}.pdf`)}
              >
                ⬇️ PDF yuklab olish
              </button>
            </div>
            <button className="btn secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => setViewModal(null)}>Yopish</button>
          </div>
        </div>
      )}
    </div>
  );
}
