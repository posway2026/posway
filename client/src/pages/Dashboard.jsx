import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [error, setError] = useState('');

  // (2026-10-01) Ilgari bu yerdagi xato jimgina yutib yuborilardi
  // (`.catch(() => {})`), shuning uchun biror muammo bo'lsa (internet
  // uzilishi, server vaqtincha javob bermasligi va h.k.) sahifa
  // "Yuklanmoqda..." holatida abadiy osilib qolardi. Token muddati tugashi
  // holati endi api.js'da markazlashtirilgan (avtomatik login sahifasiga
  // qaytaradi) — bu yerda esa QOLGAN xatolar uchun aniq xabar + "Qayta
  // urinish" tugmasi ko'rsatiladi.
  function loadDashboard() {
    setError('');
    api.dashboard().then(setData).catch((err) => setError(err.message || "Ma'lumotlarni yuklab bo'lmadi"));
    api.lowStock().then(setLowStock).catch(() => {});
  }

  useEffect(() => {
    loadDashboard();
    const onFocus = () => loadDashboard();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', padding: 14, borderRadius: 10, marginBottom: 14, fontWeight: 600 }}>
          ⚠️ {error}
        </div>
        <button className="btn" onClick={loadDashboard}>Qayta urinish</button>
      </div>
    );
  }

  if (!data) return <div>Yuklanmoqda...</div>;

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Bosh sahifa</h2>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">💰 Kassada naqt</div>
          <div className="value" style={{ color: data.cashOnHand >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(data.cashOnHand)}</div>
        </div>
        <div className="stat-card">
          <div className="label">💳 Kassada karta</div>
          <div className="value" style={{ color: data.cardOnHand >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(data.cardOnHand)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Bugungi savdo</div>
          <div className="value">{money(data.todaySales.total)}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{data.todaySales.count} ta chek</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">Bugungi naqd</div>
          <div className="value" style={{ color: 'var(--green)' }}>{money(data.todayBreakdown?.naqd)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Bugungi karta</div>
          <div className="value" style={{ color: 'var(--green)' }}>{money(data.todayBreakdown?.karta)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Bugungi qarzga berilgan</div>
          <div className="value" style={{ color: 'var(--red)' }}>{money(data.todayBreakdown?.qarz)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Shu oylik savdo</div>
          <div className="value">{money(data.monthSales.total)}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>{data.monthSales.count} ta chek</div>
        </div>
        <div className="stat-card">
          <div className="label">Umumiy qarzdorlik</div>
          <div className="value" style={{ color: 'var(--red)' }}>{money(data.totalDebt)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Mahsulot turi</div>
          <div className="value">{data.productTypeCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">Mahsulotlar soni (dona)</div>
          <div className="value">{data.productUnitCount}</div>
        </div>
        <div className="stat-card">
          <div className="label">Kam qolgan mahsulot</div>
          <div className="value" style={{ color: data.lowStockCount > 0 ? 'var(--accent)' : 'var(--green)' }}>
            {data.lowStockCount}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>🔥 Eng ko'p sotilgan</h3>
          <table>
            <thead><tr><th>Mahsulot</th><th>Soni</th><th>Summa</th></tr></thead>
            <tbody>
              {data.topProducts.map((p, i) => (
                <tr key={i}>
                  <td>{p.product_name}</td>
                  <td>{p.total_qty}</td>
                  <td>{money(p.total_sum)}</td>
                </tr>
              ))}
              {data.topProducts.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-dim)' }}>Hali sotuv yo'q</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>⚠️ Kam qolgan mahsulotlar</h3>
          <table>
            <thead><tr><th>Mahsulot</th><th>Qoldiq</th></tr></thead>
            <tbody>
              {lowStock.slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td><span className="badge orange">{p.quantity} dona</span></td>
                </tr>
              ))}
              {lowStock.length === 0 && <tr><td colSpan={2} style={{ color: 'var(--text-dim)' }}>Hammasi yetarli ✅</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
