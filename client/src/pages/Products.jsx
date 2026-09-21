import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
import { printBarcodeLabel, downloadBarcodeLabelPdf, buildBarcodeLabelData } from '../lib/receipt.js';

// (3/c) O'lchov birliklari — "dona" standart. Ikki xil rejim (dual_mode)
// yoqilganda mahsulot HAM "butun" holda (whole_label/whole_size/whole_price),
// HAM shu asosiy birlik bo'yicha (unit/sale_price) sotilishi mumkin —
// ikkalasi ham bitta umumiy qoldiqdan (asosiy birlikda) kamayadi.
const UNIT_OPTIONS = [
  { value: 'dona', label: 'Dona' },
  { value: 'kg', label: 'Kilogramm (kg)' },
  { value: 'gramm', label: 'Gramm' },
  { value: 'metr', label: 'Metr' },
  { value: 'litr', label: 'Litr' },
];

const empty = {
  name: '', brand: '', category: '', part_type: 'original', costPrice: 0, purchase_price: 0, sale_price: 0,
  quantity: 0, min_quantity: 2, car_models: '', payment_type: 'naqd', supplier_name: '', barcode: '',
  unit: 'dona', dual_mode: false, whole_label: '', whole_size: '', whole_price: '',
};

function normalizeProduct(p = {}) {
  const costPrice = Number(p.costPrice ?? p.purchase_price ?? 0) || 0;
  return {
    ...p,
    costPrice,
    purchase_price: costPrice,
    unit: p.unit || 'dona',
    dual_mode: !!p.dual_mode,
    whole_label: p.whole_label || '',
    whole_size: p.whole_size || '',
    whole_price: p.whole_price || '',
  };
}

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

// (3/c-fix) Mahsulot turi — Original/Ishlatilgan ustiga OEM (xitoy) ham
// qo'shildi (foydalanuvchi so'rovi bo'yicha, 2026-09-20).
const PART_TYPE_LABELS = {
  original: { label: 'Original', color: 'green' },
  oem: { label: 'OEM (xitoy)', color: 'blue' },
  ishlatilgan: { label: 'Ishlatilgan', color: 'orange' },
};
function partTypeMeta(type) {
  return PART_TYPE_LABELS[type] || { label: type || '-', color: '' };
}

// (42) Harakat turlari — mahsulot tarixida o'qish oson bo'lishi uchun.
const MOVEMENT_LABELS = {
  kirim: { label: '📥 Kirim', color: 'green' },
  sotuv: { label: '🛒 Sotuv', color: 'red' },
  qaytarish: { label: '↩️ Qaytarish', color: 'orange' },
  hisobdan_chiqarish: { label: "🗑️ Hisobdan chiqarish", color: 'red' },
  tuzatish: { label: "✏️ Tuzatish", color: 'orange' },
  kirim_bekor: { label: '❌ Kirim bekor qilindi', color: 'red' },
};

export default function Products() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [showCostPrices, setShowCostPrices] = useState(false);
  const [kirimProduct, setKirimProduct] = useState(null);
  const [kirimForm, setKirimForm] = useState({ quantity: '', unit_cost: '', payment_type: 'naqd', supplier_name: '', note: '' });
  const [supplierNames, setSupplierNames] = useState([]);
  const [sortBy, setSortBy] = useState('created_desc');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [showStaleOnly, setShowStaleOnly] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // (6) Shtrix-kod / narx yorlig'i chop etish oynasi.
  const [labelProduct, setLabelProduct] = useState(null);
  const [generatingBarcode, setGeneratingBarcode] = useState(false);
  const { user } = useAuth();
  const canEdit = user.role === 'admin' || user.role === 'omborchi';

  function load(s) {
    // (yangi) O'chirilgan mahsulotlar ham ko'rinsin (xiraroq) — shu bilan
    // xato bosilgan o'chirishni "Tiklash" orqali qaytarish mumkin bo'ladi.
    api.listProducts(s, true).then((rows) => setProducts(rows.map(normalizeProduct))).catch(() => {});
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    // (31) Ta'minotchi nomi kiritilganda mavjud nomlardan avtomatik
    // taklif (autocomplete) chiqishi uchun.
    api.listSupplierDebts().then((rows) => setSupplierNames(rows.map((r) => r.supplier_name))).catch(() => {});
  }, []);

  function openKirim(p) {
    setKirimProduct(p);
    setKirimForm({ quantity: '', unit_cost: p.costPrice ?? p.purchase_price ?? '', payment_type: 'naqd', supplier_name: '', note: '' });
  }

  async function handleKirimSave(e) {
    e.preventDefault();
    try {
      await api.stockIn(kirimProduct.id, {
        quantity: Number(kirimForm.quantity || 0),
        unit_cost: Number(kirimForm.unit_cost || 0),
        payment_type: kirimForm.payment_type,
        supplier_name: kirimForm.supplier_name,
        note: kirimForm.note,
      });
      setKirimProduct(null);
      load(search);
    } catch (err) {
      alert(err.message || 'Kirim qilishda xatolik yuz berdi');
    }
  }

  function openNew() {
    setForm(empty);
    setEditingId(null);
    setModalOpen(true);
  }

  function openEdit(p) {
    setForm(normalizeProduct(p));
    setEditingId(p.id);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();

    // (3/c) Ikki xil rejim yoqilgan bo'lsa, "1 butunga necha X" va "1 butun
    // narxi" majburiy — aks holda ombordan qancha ayirishni bilib bo'lmaydi
    // (server ham xuddi shuni tekshiradi, lekin bu yerda oldindan aniq
    // ogohlantirish berish qulayroq).
    if (form.dual_mode && (Number(form.whole_size || 0) <= 0 || Number(form.whole_price || 0) <= 0)) {
      alert(`"1 butunga necha ${form.unit}" va "1 butun narxi" maydonlarini to'g'ri kiriting`);
      return;
    }

    const payload = {
      ...form,
      costPrice: Number(form.costPrice ?? form.purchase_price ?? 0) || 0,
      purchase_price: Number(form.costPrice ?? form.purchase_price ?? 0) || 0,
      sale_price: Number(form.sale_price || 0),
      quantity: Number(form.quantity || 0),
      min_quantity: Number(form.min_quantity ?? 2),
      unit: form.unit || 'dona',
      dual_mode: !!form.dual_mode,
      whole_label: form.dual_mode ? (form.whole_label || '').trim() || 'butun' : '',
      whole_size: form.dual_mode ? Number(form.whole_size || 0) : 0,
      whole_price: form.dual_mode ? Number(form.whole_price || 0) : 0,
    };

    // (23) Tan narx va sotish narxi tasodifan almashtirilib qo'yilishining
    // oldini olish uchun ogohlantirish — bu haqiqatda amalda sodir bo'lgan
    // (foyda hisobotida noto'g'ri katta zarar ko'rsatilgan edi).
    if (payload.costPrice > 0 && payload.sale_price > 0 && payload.sale_price < payload.costPrice) {
      const ok = confirm(
        `Diqqat! Sotish narxi (${money(payload.sale_price)}) tan narxdan (${money(payload.costPrice)}) past.\n\n` +
        `Ehtimol tan narx va sotish narxi joylari almashtirilib qo'yilgan bo'lishi mumkin. ` +
        `Shunday davom etishga ishonchingiz komilmi?`
      );
      if (!ok) return;
    }

    try {
      if (editingId) {
        await api.updateProduct(editingId, payload);
      } else {
        await api.createProduct(payload);
      }
      setModalOpen(false);
      load(search);
    } catch (err) {
      alert(err.message || 'Saqlashda xatolik yuz berdi');
    }
  }

  // (yangi) O'chirishdan oldin — agar mahsulotga bog'liq kirim tarixi
  // (naqt/karta yoki nasiya) bo'lsa, avval buni ko'rsatib, kassa/qarzga
  // qanday ta'sir qilishini so'raymiz (oddiy o'chirish o'rniga) — shunda
  // pul "shunchaki yo'q bo'lib qolmaydi".
  async function handleDelete(product) {
    let summary;
    try {
      summary = await api.productKirimSummary(product.id);
    } catch (e) {
      summary = { count: 0 };
    }
    if (!summary.count) {
      if (!confirm(`"${product.name}" mahsulotni o'chirishga ishonchingiz komilmi?`)) return;
      try {
        await api.deleteProduct(product.id);
        load(search);
      } catch (e) {
        alert(e.message || "O'chirishda xatolik yuz berdi");
      }
      return;
    }
    setDeleteModal({ product, summary });
  }

  async function confirmDelete(action) {
    try {
      await api.deleteProduct(deleteModal.product.id, action);
      setDeleteModal(null);
      load(search);
    } catch (e) {
      alert(e.message || "O'chirishda xatolik yuz berdi");
    }
  }

  // (42) Mahsulotning to'liq harakatlar tarixi — qachon, nima bo'lgan
  // (kirim/sotuv/qaytarish/hisobdan chiqarish/tuzatish), kimdan/kimga,
  // qanday to'lov bilan, va o'sha vaqtdagi qoldiq.
  async function openHistory(product) {
    setHistoryProduct(product);
    setHistoryLoading(true);
    try {
      const rows = await api.productMovements(product.id);
      setHistoryRows(rows);
    } catch (e) {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  // (6) Narx yorlig'i oynasi — shtrix-kodi yo'q eski mahsulot uchun avval
  // "Yaratish" tugmasi ko'rsatiladi, bo'lsa to'g'ridan-to'g'ri chop
  // etish/PDF tugmalari ishlaydi.
  function openLabel(product) {
    setLabelProduct(product);
  }

  async function handleGenerateBarcode() {
    if (!labelProduct) return;
    setGeneratingBarcode(true);
    try {
      const res = await api.generateProductBarcode(labelProduct.id);
      setLabelProduct({ ...labelProduct, barcode: res.barcode });
      load(search);
    } catch (err) {
      alert(err.message || "Shtrix-kod yaratishda xatolik yuz berdi");
    } finally {
      setGeneratingBarcode(false);
    }
  }

  const activeProducts = products.filter((p) => !p.is_deleted);
  const stats = {
    typeCount: activeProducts.length,
    totalUnits: activeProducts.reduce((s, p) => s + (Number(p.quantity) || 0), 0),
    costValue: activeProducts.reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.costPrice ?? p.purchase_price) || 0), 0),
    saleValue: activeProducts.reduce((s, p) => s + (Number(p.quantity) || 0) * (Number(p.sale_price) || 0), 0),
    lowStockCount: activeProducts.filter((p) => (Number(p.quantity) || 0) <= (Number(p.min_quantity) || 0)).length,
  };
  stats.potentialProfit = stats.saleValue - stats.costValue;

  // (27) Saralash va filtrlash — hammasi mijoz tomonida (client-side)
  // amalga oshiriladi, chunki mahsulotlar ro'yxati kichik va bu qo'shimcha
  // server so'rovlarini talab qilmaydi.
  const STALE_DAYS = 30;
  const staleThreshold = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;

  // (yangi) O'chirilgan mahsulotlar "kam qolgan"/"uzoq sotilmagan"
  // filtrlariga kirmaydi (bular faol ombor haqida savol), lekin filtr
  // yoqilmagan holatda ro'yxat oxirida xiraroq ko'rinib turadi.
  let visibleProducts = (showLowStockOnly || showStaleOnly) ? [...activeProducts] : [...products];
  if (showLowStockOnly) {
    visibleProducts = visibleProducts.filter((p) => (Number(p.quantity) || 0) <= (Number(p.min_quantity) || 0));
  }
  if (showStaleOnly) {
    visibleProducts = visibleProducts.filter((p) => {
      if (!p.last_sold_at) return true; // hech qachon sotilmagan — eng "eski"
      return new Date(p.last_sold_at).getTime() < staleThreshold;
    });
  }
  visibleProducts.sort((a, b) => {
    if (!!a.is_deleted !== !!b.is_deleted) return a.is_deleted ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'created_desc') return new Date(b.created_at) - new Date(a.created_at);
    if (sortBy === 'created_asc') return new Date(a.created_at) - new Date(b.created_at);
    if (sortBy === 'qty_asc') return (Number(a.quantity) || 0) - (Number(b.quantity) || 0);
    if (sortBy === 'qty_desc') return (Number(b.quantity) || 0) - (Number(a.quantity) || 0);
    return 0;
  });

  return (
    <div>
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Mahsulotlar</h2>
        {canEdit && <button className="btn" onClick={openNew}>+ Yangi mahsulot</button>}
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          placeholder="Qidirish: nomi, brend, mashina modeli..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
          style={{ flex: 1 }}
        />
        {canEdit && (
          <button type="button" className="btn secondary" onClick={() => setShowCostPrices((v) => !v)}>
            {showCostPrices ? '🙈' : '👁️'} {showCostPrices ? 'Yashirish' : 'Ko\'rsatish'}
          </button>
        )}
      </div>

      {/* (27) Saralash va filtrlash */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 13, color: 'var(--text-dim)' }}>Saralash:</label>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="created_desc">Yangi qo'shilganlar avval</option>
            <option value="name">Alfabet (A-Z)</option>
            <option value="created_asc">Eski qo'shilganlar avval</option>
            <option value="qty_asc">Qoldiq: kamdan-ko'pga</option>
            <option value="qty_desc">Qoldiq: ko'pdan-kamga</option>
          </select>
        </div>
        <button
          type="button"
          className={`btn ${showLowStockOnly ? '' : 'secondary'}`}
          onClick={() => setShowLowStockOnly((v) => !v)}
        >
          ⚠️ Faqat kam qolganlar
        </button>
        <button
          type="button"
          className={`btn ${showStaleOnly ? '' : 'secondary'}`}
          onClick={() => setShowStaleOnly((v) => !v)}
          title="Oxirgi 30 kunda sotilmagan mahsulotlar"
        >
          🐌 Uzoq sotilmaganlar (30+ kun)
        </button>
      </div>

      {/* (26) Mahsulotlar sahifasi uchun umumiy statistika paneli — tan
          narxga bog'liq ko'rsatkichlar (tan narx qiymati, potensial
          foyda) xuddi jadvaldagi "Tan narx" ustuni kabi showCostPrices
          orqasida yashiriladi, chunki bular ham nozik moliyaviy ma'lumot. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Mahsulot turi</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.typeCount}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Jami miqdor</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{stats.totalUnits}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Tan narx qiymati</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{showCostPrices ? money(stats.costValue) : '••••••'}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Sotish qiymati</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{money(stats.saleValue)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Potensial foyda</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{showCostPrices ? money(stats.potentialProfit) : '••••••'}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Kam qolgan</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: stats.lowStockCount > 0 ? 'var(--red)' : undefined }}>{stats.lowStockCount} ta</div>
          </div>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Nomi</th><th>Brend</th><th>Turi</th><th>Tan narx</th><th>Narx</th><th>Qoldiq</th>{canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {visibleProducts.map((p) => (
              <tr key={p.id} style={p.is_deleted ? { opacity: 0.5 } : undefined}>
                <td>
                  {p.name}
                  {p.is_deleted && <span className="badge" style={{ fontSize: 10, marginLeft: 6 }}>O'chirilgan</span>}
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{p.car_models}</div>
                  {p.barcode && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>🏷️ {p.barcode}</div>}
                </td>
                <td>{p.brand}</td>
                <td>
                  <span className={`badge ${partTypeMeta(p.part_type).color}`}>
                    {partTypeMeta(p.part_type).label}
                  </span>
                </td>
                <td>{showCostPrices ? money(p.costPrice ?? p.purchase_price ?? 0) : '••••••'}</td>
                <td>
                  {p.dual_mode ? (
                    <>
                      {money(p.whole_price)} / {p.whole_label || 'butun'}
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{money(p.sale_price)} / {p.unit}</div>
                    </>
                  ) : money(p.sale_price)}
                </td>
                <td>
                  <span className={`badge ${p.quantity <= p.min_quantity ? 'red' : 'green'}`}>{p.quantity} {p.unit || 'dona'}</span>
                </td>
                {canEdit && (
                  <td style={{ display: 'flex', gap: 6 }}>
                    {p.is_deleted ? (
                      user.role === 'admin' && <button className="btn secondary" onClick={() => api.restoreProduct(p.id).then(() => load(search))}>Tiklash</button>
                    ) : (
                      <>
                        <button className="btn secondary" onClick={() => openKirim(p)}>📥 Kirim</button>
                        <button className="btn secondary" onClick={() => openHistory(p)}>🕘 Tarix</button>
                        <button className="btn secondary" onClick={() => openLabel(p)} title="Narx yorlig'i (shtrix-kod)">🏷️</button>
                        <button className="btn secondary" onClick={() => openEdit(p)}>Tahrirlash</button>
                        {user.role === 'admin' && <button className="btn danger" onClick={() => handleDelete(p)}>O'chirish</button>}
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {visibleProducts.length === 0 && <tr><td colSpan={canEdit ? 7 : 6} style={{ color: 'var(--text-dim)' }}>Mahsulot topilmadi</td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        // (3/c-fix1) Forma uzun/skroll qilinadigan bo'lgani uchun, tashqariga
        // tasodifan bosilib ketsa kiritilgan hamma ma'lumot yo'qolib
        // qolmasligi kerak — shuning uchun bu yerda ENDI overlay bosilganda
        // yopilmaydi, faqat "Bekor qilish" tugmasi orqali yopiladi.
        <div className="modal-overlay">
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
            <h3 style={{ marginTop: 0 }}>{editingId ? 'Mahsulotni tahrirlash' : 'Yangi mahsulot'}</h3>
            <div className="form-row">
              <label>Nomi *</label>
              {/* (14b) Mavjud mahsulotlar nomidan tavsiya — xuddi shunga o'xshash
                  nomli mahsulot allaqachon bor bo'lsa (masalan qoldig'i oz qolgan),
                  tasodifan takroriy nom bilan yangi yozuv ochib yubormaslik uchun. */}
              <input required list="existing-product-names-list" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {/* (3/c-fix2) Endi shunchaki ogohlantirish emas — bosilsa
                  darhol shu mahsulotga Kirim oynasini ochib beradigan
                  tugma ham bor (avval bu yerda hech qanday amal yo'q edi,
                  foydalanuvchi qo'lda "Mahsulotlar" ro'yxatidan qidirib
                  topishga majbur edi). */}
              {!editingId && form.name && (() => {
                const match = activeProducts.find((p) => p.name.toLowerCase() === form.name.trim().toLowerCase());
                if (!match) return null;
                return (
                  <div style={{ fontSize: 12, color: 'var(--orange, #b8860b)', marginTop: 4 }}>
                    ⚠️ Bu nomdagi mahsulot ro'yxatda allaqachon bor — yangisini yaratish o'rniga shu mahsulotga kirim qiling.
                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ fontSize: 12, padding: '4px 10px' }}
                        onClick={() => { setModalOpen(false); openKirim(match); }}
                      >
                        📥 "{match.name}"ga Kirim qilish
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="form-row">
              <label>Brend</label>
              <input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="masalan: Bosch, Chevrolet" />
            </div>
            <div className="form-row">
              <label>Mos mashina modellari</label>
              <input value={form.car_models} onChange={(e) => setForm({ ...form, car_models: e.target.value })} placeholder="masalan: Nexia, Cobalt, Malibu" />
            </div>
            <div className="form-row">
              <label>Turi</label>
              <select value={form.part_type} onChange={(e) => setForm({ ...form, part_type: e.target.value })}>
                <option value="original">Original</option>
                <option value="oem">OEM (xitoy)</option>
                <option value="ishlatilgan">Ishlatilgan</option>
              </select>
            </div>
            {/* (3/c) O'lchov birligi — qoldiq va sotuv shu birlikda hisoblanadi
                (dona, kg, gramm, metr, litr). */}
            <div className="form-row">
              <label>O'lchov birligi</label>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                id="dual_mode_checkbox"
                style={{ width: 'auto' }}
                checked={!!form.dual_mode}
                onChange={(e) => setForm({ ...form, dual_mode: e.target.checked })}
              />
              <label htmlFor="dual_mode_checkbox" style={{ marginBottom: 0 }}>
                Ikki xil rejimda sotish (masalan: butun shisha HAM, litrlab HAM)
              </label>
            </div>
            {form.dual_mode && (
              <div className="card" style={{ background: 'var(--panel-light)', padding: 12, marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
                  Ikkala rejim ham BITTA umumiy qoldiqdan ({form.unit}) kamayadi.
                </div>
                <div className="form-row">
                  <label>"Butun"ning nomi (masalan: shisha, quti, rulon)</label>
                  <input value={form.whole_label} onChange={(e) => setForm({ ...form, whole_label: e.target.value })} placeholder="masalan: shisha" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-row">
                    <label>1 {form.whole_label || 'butun'}ga necha {form.unit} *</label>
                    {/* (2026-09-21) type="text" + inputMode — ba'zi
                        kompyuterlarda type="number" faqat vergul (",")
                        orqali kasr son kiritishga ruxsat berib, nuqtani
                        (".") rad etar edi. Endi ikkalasi ham qabul qilinadi. */}
                    <input required type="text" inputMode="decimal" value={form.whole_size} onFocus={(e) => e.target.select()} onChange={(e) => setForm({ ...form, whole_size: e.target.value.replace(',', '.') })} />
                  </div>
                  <div className="form-row">
                    <label>1 {form.whole_label || 'butun'} narxi *</label>
                    <input required type="number" value={form.whole_price} onFocus={(e) => e.target.select()} onChange={(e) => setForm({ ...form, whole_price: e.target.value })} />
                  </div>
                </div>
              </div>
            )}
            {/* (6) Mahsulotda ishlab chiqaruvchidan kelgan tayyor shtrix-kod
                bo'lsa shuni kiritish mumkin; bo'sh qoldirilsa Posway o'zi
                noyob shtrix-kod yaratib beradi. */}
            <div className="form-row">
              <label>Shtrix-kod (ixtiyoriy)</label>
              <input
                value={form.barcode || ''}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                placeholder="Bo'sh qoldirsangiz avtomatik yaratiladi"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-row">
                <label>Tan narx</label>
                <input type="number" value={form.costPrice ?? form.purchase_price ?? 0} onFocus={(e) => e.target.select()} onChange={(e) => setForm({ ...form, costPrice: +e.target.value, purchase_price: +e.target.value })} />
              </div>
              <div className="form-row">
                <label>{form.dual_mode ? `1 ${form.unit} narxi (o'lchovga bo'lib sotilganda) *` : 'Sotish narxi *'}</label>
                <input required type="number" value={form.sale_price} onFocus={(e) => e.target.select()} onChange={(e) => setForm({ ...form, sale_price: +e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-row">
                <label>Qoldiq soni</label>
                <input type="number" value={form.quantity} onFocus={(e) => e.target.select()} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} />
              </div>
              <div className="form-row">
                <label>Minimal qoldiq (ogohlantirish)</label>
                <input type="number" value={form.min_quantity} onFocus={(e) => e.target.select()} onChange={(e) => setForm({ ...form, min_quantity: +e.target.value })} />
              </div>
            </div>
            {!editingId && Number(form.quantity) > 0 && Number(form.costPrice ?? form.purchase_price ?? 0) > 0 && (
              <>
                <div className="form-row">
                  <label>Boshlang'ich zaxira qanday to'landi? *</label>
                  <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value })}>
                    <option value="naqd">💵 Naqd (kassadan ayiriladi)</option>
                    <option value="karta">💳 Karta (kassadan ayiriladi)</option>
                    <option value="nasiya">📒 Nasiya (ta'minotchiga qarz yoziladi)</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Ta'minotchi nomi *</label>
                  <input required list="supplier-names-list" value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} placeholder="masalan: Mavlon aka, Timsoll" />
                </div>
                <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text-dim)', fontSize: 13 }}>
                  Jami: {money(Number(form.quantity || 0) * Number(form.costPrice ?? form.purchase_price ?? 0))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setModalOpen(false)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Saqlash</button>
            </div>
          </form>
        </div>
      )}
      {kirimProduct && (
        // (3/c-fix1) Xuddi shu sabab bilan — kirim summasi/ta'minotchi kabi
        // ma'lumotlar tasodifan yo'qolib qolmasligi uchun.
        <div className="modal-overlay">
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleKirimSave}>
            <h3 style={{ marginTop: 0 }}>Kirim: {kirimProduct.name}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>Hozirgi qoldiq: {kirimProduct.quantity} {kirimProduct.unit || 'dona'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-row">
                <label>Qo'shiladigan miqdor ({kirimProduct.unit || 'dona'}) *</label>
                <input required type="text" inputMode="decimal" value={kirimForm.quantity} onFocus={(e) => e.target.select()} onChange={(e) => setKirimForm({ ...kirimForm, quantity: e.target.value.replace(',', '.') })} />
              </div>
              <div className="form-row">
                <label>1 {kirimProduct.unit || 'dona'} tan narxi *</label>
                <input required type="number" value={kirimForm.unit_cost} onFocus={(e) => e.target.select()} onChange={(e) => setKirimForm({ ...kirimForm, unit_cost: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label>Qanday to'landi? *</label>
              <select value={kirimForm.payment_type} onChange={(e) => setKirimForm({ ...kirimForm, payment_type: e.target.value })}>
                <option value="naqd">💵 Naqd (kassadan ayiriladi)</option>
                <option value="karta">💳 Karta (kassadan ayiriladi)</option>
                <option value="nasiya">📒 Nasiya (ta'minotchiga qarz yoziladi)</option>
              </select>
            </div>
            <div className="form-row">
              <label>Ta'minotchi nomi *</label>
              <input required list="supplier-names-list" value={kirimForm.supplier_name} onChange={(e) => setKirimForm({ ...kirimForm, supplier_name: e.target.value })} placeholder="masalan: Mavlon aka, Timsoll" />
            </div>
            <div className="form-row">
              <label>Izoh</label>
              <input value={kirimForm.note} onChange={(e) => setKirimForm({ ...kirimForm, note: e.target.value })} />
            </div>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              Jami: {money(Number(kirimForm.quantity || 0) * Number(kirimForm.unit_cost || 0))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setKirimProduct(null)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Saqlash</button>
            </div>
          </form>
        </div>
      )}

      {deleteModal && (
        <div className="modal-overlay" onClick={() => setDeleteModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>"{deleteModal.product.name}"ni o'chirish</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 14 }}>
              Bu mahsulot uchun kirim tarixi bor:
              {deleteModal.summary.naqdKartaTotal > 0 && (
                <div>💵 Naqt/karta orqali kassadan sarflangan: <b>{money(deleteModal.summary.naqdKartaTotal)}</b></div>
              )}
              {deleteModal.summary.nasiyaTotal > 0 && (
                <div>📒 Ta'minotchiga nasiya (qarz): <b>{money(deleteModal.summary.nasiyaTotal)}</b></div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn danger" onClick={() => confirmDelete('cancel_kirim')}>
                Xato kiritilgan edi — kirim, kassa harakati va qarz to'liq bekor qilinsin
              </button>
              <button className="btn secondary" onClick={() => confirmDelete('keep_history')}>
                Yo'q, pul/qarz haqiqiy sarflangan — tarix saqlansin, faqat ro'yxatdan chiqarilsin
              </button>
              <button className="btn secondary" onClick={() => setDeleteModal(null)}>Bekor qilish</button>
            </div>
          </div>
        </div>
      )}

      {historyProduct && (
        <div className="modal-overlay" onClick={() => setHistoryProduct(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <h3 style={{ marginTop: 0 }}>{historyProduct.name} — harakatlar tarixi</h3>
            {historyLoading ? (
              <div style={{ color: 'var(--text-dim)' }}>Yuklanmoqda...</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Sana</th><th>Harakat</th><th>Miqdor</th><th>Qoldiq</th><th>Kim/Nima</th><th>Kim bajardi</th></tr>
                </thead>
                <tbody>
                  {historyRows.map((m) => {
                    const meta = MOVEMENT_LABELS[m.type] || { label: m.type, color: '' };
                    return (
                      <tr key={m.id}>
                        <td>{new Date(m.created_at).toLocaleString('uz-UZ')}</td>
                        <td><span className={`badge ${meta.color}`}>{meta.label}</span></td>
                        <td style={{ color: m.quantity_delta < 0 ? 'var(--red)' : m.quantity_delta > 0 ? 'var(--green)' : undefined }}>
                          {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta} {historyProduct.unit || 'dona'}
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
                  {historyRows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--text-dim)' }}>Hali hech qanday harakat yo'q</td></tr>}
                </tbody>
              </table>
            )}
            <button className="btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setHistoryProduct(null)}>Yopish</button>
          </div>
        </div>
      )}

      {labelProduct && (
        <div className="modal-overlay" onClick={() => setLabelProduct(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3 style={{ marginTop: 0 }}>🏷️ Narx yorlig'i — {labelProduct.name}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>
              Narx: {money(labelProduct.sale_price)}
              <div>Shtrix-kod: {labelProduct.barcode || <span style={{ color: 'var(--red)' }}>yo'q</span>}</div>
            </div>
            {!labelProduct.barcode ? (
              <button className="btn" style={{ width: '100%' }} disabled={generatingBarcode} onClick={handleGenerateBarcode}>
                {generatingBarcode ? 'Yaratilmoqda...' : '🔀 Shtrix-kod yaratish'}
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ flex: 1 }}
                  onClick={() => printBarcodeLabel(buildBarcodeLabelData(labelProduct))}
                >
                  🖨️ Chop etish
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ flex: 1 }}
                  onClick={() => downloadBarcodeLabelPdf(buildBarcodeLabelData(labelProduct), `yorliq-${labelProduct.id}.pdf`)}
                >
                  ⬇️ PDF yuklab olish
                </button>
              </div>
            )}
            <button className="btn secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setLabelProduct(null)}>Yopish</button>
          </div>
        </div>
      )}

      <datalist id="supplier-names-list">
        {supplierNames.map((name) => <option key={name} value={name} />)}
      </datalist>
      <datalist id="existing-product-names-list">
        {activeProducts.map((p) => <option key={p.id} value={p.name} />)}
      </datalist>
    </div>
  );
}
