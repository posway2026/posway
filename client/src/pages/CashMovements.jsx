import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import MoneyInput from '../components/MoneyInput.jsx';

const categories = [
  'Xodim maoshi/pul olish',
  'Kommunalka (suv, chiroq)',
  'Musr/tozalash',
  'Boshqa kunlik xarajat',
];

const emptyForm = {
  amount: '',
  category: categories[0],
  description: '',
  recorded_by: '',
  date_time: new Date().toISOString().slice(0, 16),
};

function formatMoney(value) {
  return Math.round(Number(value || 0)).toLocaleString('uz-UZ') + ' so\'m';
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' });
}

export default function CashMovements() {
  const { user } = useAuth();
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [breakdown, setBreakdown] = useState(null);

  function load() {
    api.listCashMovements().then(setEntries).catch(() => {});
  }

  function loadBreakdown() {
    api.dashboard().then((d) => setBreakdown(d.todayBreakdown)).catch(() => {});
  }

  useEffect(() => {
    load();
    loadBreakdown();
  }, []);

  const manualEntries = entries.filter((item) => !item.is_inventory);
  const inventoryEntries = entries.filter((item) => item.is_inventory);
  const manualTotal = manualEntries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const inventoryTotal = inventoryEntries.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  function openNew() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      recorded_by: user?.full_name || '',
      date_time: new Date().toISOString().slice(0, 16),
    });
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      amount: item.amount,
      category: item.category,
      description: item.description || '',
      recorded_by: item.recorded_by || user?.full_name || '',
      date_time: item.date_time ? new Date(item.date_time).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const payload = {
      amount: Number(form.amount || 0),
      category: form.category,
      description: form.description,
      recorded_by: form.recorded_by || user?.full_name || 'Noma\'lum',
      date_time: form.date_time ? new Date(form.date_time).toISOString() : new Date().toISOString(),
    };

    if (editingId) {
      await api.updateCashMovement(editingId, payload);
    } else {
      await api.createCashMovement(payload);
    }

    setEditingId(null);
    setForm({
      ...emptyForm,
      recorded_by: user?.full_name || '',
      date_time: new Date().toISOString().slice(0, 16),
    });
    load();
    loadBreakdown();
  }

  async function handleDelete(id) {
    if (!confirm('Kassa harakatini o\'chirishga ishonchingiz komilmi?')) return;
    await api.deleteCashMovement(id);
    load();
    loadBreakdown();
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Kassa harakati</h2>
      </div>

      {breakdown && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <div className="stat-card"><div className="label">Bugungi naqd</div><div className="value" style={{ color: 'var(--green)' }}>{formatMoney(breakdown.naqd)}</div></div>
          <div className="stat-card"><div className="label">Bugungi karta</div><div className="value" style={{ color: 'var(--green)' }}>{formatMoney(breakdown.karta)}</div></div>
          <div className="stat-card"><div className="label">Bugungi qarzga berilgan</div><div className="value" style={{ color: 'var(--red)' }}>{formatMoney(breakdown.qarz)}</div></div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Yangi harakat</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div className="form-row">
              <label>Sana va vaqt</label>
              <input
                type="datetime-local"
                value={form.date_time}
                onChange={(e) => setForm({ ...form, date_time: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Miqdor</label>
              <MoneyInput
                required
                value={form.amount}
                onFocus={(e) => e.target.select()}
                onChange={(v) => setForm({ ...form, amount: v })}
              />
            </div>
            <div className="form-row">
              <label>Kategoriya</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            <div className="form-row">
              <label>Kimga / nima uchun</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Masalan: Ismoil, suv to'lovi..."
              />
            </div>
            <div className="form-row">
              <label>Qaydnoma qilgan</label>
              <input
                value={form.recorded_by}
                onChange={(e) => setForm({ ...form, recorded_by: e.target.value })}
                placeholder={user?.full_name || 'Ism'}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button type="submit" className="btn">{editingId ? 'Yangilash' : 'Saqlash'}</button>
            {editingId && (
              <button type="button" className="btn secondary" onClick={openNew}>Bekor qilish</button>
            )}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Kunlik xarajatlar</h3>
          <div style={{ fontWeight: 700, color: 'var(--red)' }}>Jami: {formatMoney(manualTotal)}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Sana</th>
              <th>Miqdor</th>
              <th>Kategoriya</th>
              <th>Ta'rif</th>
              <th>Qaydnoma</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {manualEntries.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.date_time)}</td>
                <td style={{ color: 'var(--red)', fontWeight: 700 }}>{formatMoney(item.amount)}</td>
                <td>{item.category}</td>
                <td>{item.description || '-'}</td>
                <td>{item.recorded_by || '-'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn secondary" onClick={() => openEdit(item)}>Tahrirlash</button>
                  <button className="btn danger" onClick={() => handleDelete(item.id)}>O'chirish</button>
                </td>
              </tr>
            ))}
            {manualEntries.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Kunlik xarajat yo'q</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>📥 Mahsulot kirimlari (yuk)</h3>
          <div style={{ fontWeight: 700, color: 'var(--red)' }}>Jami: {formatMoney(inventoryTotal)}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Sana</th>
              <th>Miqdor</th>
              <th>To'lov turi</th>
              <th>Ta'rif</th>
              <th>Qaydnoma</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {inventoryEntries.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.date_time)}</td>
                <td style={{ color: 'var(--red)', fontWeight: 700 }}>{formatMoney(item.amount)}</td>
                <td>{item.payment_method === 'karta' ? '💳 Karta' : '💵 Naqd'}</td>
                <td>{item.description || '-'}</td>
                <td>{item.recorded_by || '-'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn danger" onClick={() => handleDelete(item.id)}>O'chirish</button>
                </td>
              </tr>
            ))}
            {inventoryEntries.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Mahsulot kirimi yo'q</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
