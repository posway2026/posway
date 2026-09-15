import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

// (32) Harakat turlari — umumiy tarixda o'qish oson bo'lishi uchun.
const MOVEMENT_LABELS = {
  kirim: { label: '📥 Kirim', color: 'green' },
  sotuv: { label: '🛒 Sotuv', color: 'red' },
  qaytarish: { label: '↩️ Qaytarish', color: 'orange' },
  hisobdan_chiqarish: { label: '🗑️ Hisobdan chiqarish', color: 'red' },
  tuzatish: { label: '✏️ Tuzatish', color: 'orange' },
  kirim_bekor: { label: '❌ Kirim bekor qilindi', color: 'red' },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// (32) Butun do'kon bo'yicha barcha kirim/sotuv/qaytarish/hisobdan
// chiqarish/tuzatish harakatlari — bitta umumiy tarix, bir joydan
// filtrlab ko'rish mumkin. Bu yozuvlar boshqa joydan (sotuv, kirim)
// o'chirilsa/o'zgarsa ham o'zgarmay qoladi, shuning uchun har doim
// to'liq va ishonchli "nima bo'lganini" ko'rsatadi.
export default function StockMovements() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [useDateRange, setUseDateRange] = useState(false);
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [type, setType] = useState('');
  const [q, setQ] = useState('');

  function load() {
    setLoading(true);
    const params = { type: type || undefined, q: q || undefined };
    if (useDateRange) {
      params.from = from;
      params.to = to;
    }
    api.listStockMovements(params).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }

  useEffect(load, [useDateRange, from, to, type]);

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Harakatlar tarixi</h2>
      </div>

      <div className="card" style={{ marginBottom: 16, color: 'var(--text-dim)', fontSize: 13 }}>
        Bu bo'lim — do'kondagi HAR BIR mahsulot harakatini (kirim, sotuv, qaytarish, hisobdan chiqarish, tuzatish) bitta umumiy joyda ko'rsatadi. Har bir mahsulotning o'z alohida tarixini Mahsulotlar sahifasidagi "🕘 Tarix" tugmasidan ko'rish mumkin.
      </div>

      <form className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }} onSubmit={handleSearch}>
        <input
          placeholder="Qidirish: mahsulot, ta'minotchi, mijoz, izoh..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Barcha turlar</option>
          <option value="kirim">📥 Kirim</option>
          <option value="sotuv">🛒 Sotuv</option>
          <option value="qaytarish">↩️ Qaytarish</option>
          <option value="hisobdan_chiqarish">🗑️ Hisobdan chiqarish</option>
          <option value="tuzatish">✏️ Tuzatish</option>
          <option value="kirim_bekor">❌ Kirim bekor qilindi</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={useDateRange} onChange={(e) => setUseDateRange(e.target.checked)} />
          Sana oralig'i
        </label>
        {useDateRange && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <button className="btn">Qidirish</button>
      </form>

      <div className="card">
        {loading ? (
          <div style={{ color: 'var(--text-dim)' }}>Yuklanmoqda...</div>
        ) : (
          <table>
            <thead>
              <tr><th>Sana</th><th>Harakat</th><th>Mahsulot</th><th>Miqdor</th><th>Qoldiq</th><th>Kim/Nima</th><th>Kim bajardi</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const meta = MOVEMENT_LABELS[m.type] || { label: m.type, color: '' };
                return (
                  <tr key={m.id}>
                    <td>{new Date(m.created_at).toLocaleString('uz-UZ')}</td>
                    <td><span className={`badge ${meta.color}`}>{meta.label}</span></td>
                    <td>{m.product_name || '-'}</td>
                    <td style={{ color: m.quantity_delta < 0 ? 'var(--red)' : m.quantity_delta > 0 ? 'var(--green)' : undefined }}>
                      {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta} dona
                      {(m.unit_cost || m.unit_price) ? (
                        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                          {m.unit_cost ? `tan narx: ${money(m.unit_cost)}` : ''}
                          {m.unit_price ? `narx: ${money(m.unit_price)}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>{m.balance_after ?? '-'}</td>
                    <td>
                      {m.supplier_name || m.customer_name || '-'}
                      {m.payment_type && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{m.payment_type}</div>}
                      {m.note && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{m.note}</div>}
                    </td>
                    <td>{m.performed_by || '-'}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--text-dim)' }}>Harakat topilmadi</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
