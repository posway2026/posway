import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import MoneyInput from '../components/MoneyInput.jsx';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' });
}

export default function CashClose() {
  const [expected, setExpected] = useState(null);
  const [history, setHistory] = useState([]);
  const [actualNaqd, setActualNaqd] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNote, setEditNote] = useState('');

  function load() {
    api.expectedCashClose().then(setExpected).catch(() => {});
    api.listCashCloses().then(setHistory).catch(() => {});
  }

  useEffect(load, []);

  const difference = expected && actualNaqd !== '' ? Number(actualNaqd) - expected.cashOnHand : null;

  async function handleClose(e) {
    e.preventDefault();
    setSaving(true);
    setResult(null);
    try {
      const record = await api.createCashClose({ actual_naqd: +actualNaqd, note });
      setResult(record);
      setActualNaqd('');
      setNote('');
      load();
    } catch (err) {
      alert(err.message || 'Saqlashda xatolik yuz berdi');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(h) {
    setEditingId(h.id);
    setEditNote(h.note || '');
  }

  // (25) Farq keyinroq tushuntirilsa (masalan "kamunalgaga ketgan ekan,
  // Kassa harakatiga yozib qo'ydim") — izohni yangilab, "tushuntirilgan"
  // deb belgilaymiz. Bu yozuvning o'zidagi raqamlar o'zgarmaydi, faqat
  // holati va izohi yangilanadi.
  async function handleSaveNote(id) {
    try {
      await api.updateCashClose(id, { note: editNote, resolved: true });
      setEditingId(null);
      load();
    } catch (err) {
      alert(err.message || 'Saqlashda xatolik yuz berdi');
    }
  }

  async function handleDelete(id) {
    if (!confirm("Bu kassa yopish yozuvini o'chirishni xohlaysizmi?")) return;
    try {
      await api.deleteCashClose(id);
      load();
    } catch (err) {
      alert(err.message || "O'chirishda xatolik yuz berdi");
    }
  }

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Kunlik kassa yopish</h2>
      </div>

      <div className="card" style={{ marginBottom: 16, color: 'var(--text-dim)', fontSize: 13 }}>
        Kun oxirida qo'lingizdagi naqt pulni sanab, shu yerga kiriting. Tizim
        o'z hisob-kitobi bo'yicha "bo'lishi kerak bo'lgan" summa bilan
        solishtirib, farqni ko'rsatadi. Bu faqat farqni aniqlash uchun —
        kassa hisobiga avtomatik hech qanday o'zgartirish kiritilmaydi.
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Bugungi solishtirish</h3>
        <form onSubmit={handleClose}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Tizim bo'yicha bo'lishi kerak (naqt)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{expected ? money(expected.cashOnHand) : '...'}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Tizim bo'yicha bo'lishi kerak (karta, ma'lumot uchun)</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{expected ? money(expected.cardOnHand) : '...'}</div>
            </div>
          </div>

          <div className="form-row">
            <label>Jismonan sanalgan naqt summasi *</label>
            <MoneyInput required value={actualNaqd} onFocus={(e) => e.target.select()} onChange={(v) => setActualNaqd(v)} />
          </div>

          {difference !== null && (
            <div style={{ marginBottom: 14, fontWeight: 700, color: difference === 0 ? 'var(--green)' : 'var(--red)' }}>
              {difference === 0
                ? "✅ Farq yo'q — hammasi to'g'ri"
                : difference > 0
                ? `⚠️ ${money(difference)} ORTIQCHA (tizim kutganidan ko'proq bor)`
                : `⚠️ ${money(Math.abs(difference))} KAMOMAD (tizim kutganidan kam)`}
            </div>
          )}

          <div className="form-row">
            <label>Izoh (ixtiyoriy — farq sababi, agar bilsangiz)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: mayda pul yetishmadi, hisoblash xatosi va h.k." />
          </div>

          <button className="btn" disabled={saving}>{saving ? 'Saqlanmoqda...' : 'Yopish va saqlash'}</button>
        </form>

        {result && (
          <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: 'var(--panel-light)', border: '1px solid var(--border)' }}>
            ✅ Saqlandi — {formatDateTime(result.created_at)}: kutilgan {money(result.expected_naqd)}, sanalgan {money(result.actual_naqd)}, farq{' '}
            <b style={{ color: result.difference === 0 ? 'var(--green)' : 'var(--red)' }}>{money(result.difference)}</b>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tarix</h3>
        <table>
          <thead>
            <tr>
              <th>Sana</th>
              <th>Kutilgan (naqt)</th>
              <th>Sanalgan (naqt)</th>
              <th>Farq</th>
              <th>Holati</th>
              <th>Izoh</th>
              <th>Kim yopdi</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id}>
                <td>{formatDateTime(h.created_at)}</td>
                <td>{money(h.expected_naqd)}</td>
                <td>{money(h.actual_naqd)}</td>
                <td style={{ color: h.difference === 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{money(h.difference)}</td>
                <td>
                  {h.difference === 0 ? (
                    <span style={{ color: 'var(--green)' }}>✅ Farqsiz</span>
                  ) : h.resolved ? (
                    <span style={{ color: 'var(--green)' }}>✅ Tushuntirilgan</span>
                  ) : (
                    <span style={{ color: 'var(--red)' }}>⚠️ Hal qilinmagan</span>
                  )}
                </td>
                <td>
                  {editingId === h.id ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        style={{ minWidth: 160 }}
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Farq sababi"
                        autoFocus
                      />
                      <button type="button" className="btn" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => handleSaveNote(h.id)}>Saqlash</button>
                      <button type="button" className="btn secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setEditingId(null)}>Bekor</button>
                    </div>
                  ) : (
                    h.note || '-'
                  )}
                </td>
                <td>{h.closed_by || '-'}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  {editingId !== h.id && (
                    <button type="button" className="btn secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => openEdit(h)}>Tahrirlash</button>
                  )}
                  <button type="button" className="btn danger" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => handleDelete(h.id)}>O'chirish</button>
                </td>
              </tr>
            ))}
            {history.length === 0 && <tr><td colSpan={8} style={{ color: 'var(--text-dim)' }}>Hali kassa yopilmagan</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
