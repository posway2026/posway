import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { printReceipt, downloadReceiptPdf, buildSaleReceiptData } from '../lib/receipt.js';

function money(n) {
  return Math.round(Number(n || 0)).toLocaleString('uz-UZ') + " so'm";
}

const CARTS_STORAGE_KEY = 'gm0064_pos_carts_v2';
const LEGACY_CART_STORAGE_KEY = 'gm0064_pos_cart_v1';
// (36) Bir vaqtda ochiq bo'lishi mumkin bo'lgan savatlar soni chegarasi.
const MAX_CARTS = 5;

function makeEmptyCart(label) {
  return {
    uid: Math.random().toString(36).slice(2),
    label,
    cart: [],
    customerId: '',
    customerSearch: '',
    discountType: 'none',
    discountValue: '',
    debtPaidNaqd: '',
    debtPaidKarta: '',
    mixedOpen: false,
    mixedNaqd: '',
    mixedKarta: '',
  };
}

// (36) Avval saqlangan ko'p-savat holatini tiklaymiz; agar hali eski
// (bitta savat) formatida saqlangan bo'lsa, o'shani birinchi savat
// sifatida o'qib olamiz — hech qanday joriy savat mazmuni yo'qolmasin.
function loadSavedCarts() {
  try {
    const raw = localStorage.getItem(CARTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.carts) && parsed.carts.length > 0) return parsed;
    }
  } catch {
    // e'tiborsiz qoldiramiz
  }
  try {
    const legacyRaw = localStorage.getItem(LEGACY_CART_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      const migrated = {
        ...makeEmptyCart('Savat 1'),
        cart: legacy.cart || [],
        customerId: legacy.customerId || '',
        customerSearch: legacy.customerSearch || '',
        discountType: legacy.discountType || 'none',
        discountValue: legacy.discountValue || '',
        debtPaidNaqd: legacy.debtPaidNaqd || '',
        debtPaidKarta: legacy.debtPaidKarta || '',
        mixedOpen: legacy.mixedOpen || false,
        mixedNaqd: legacy.mixedNaqd || '',
        mixedKarta: legacy.mixedKarta || '',
      };
      return { carts: [migrated], activeIndex: 0 };
    }
  } catch {
    // e'tiborsiz qoldiramiz
  }
  return null;
}

function saveCarts(state) {
  try {
    localStorage.setItem(CARTS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage ishlamasa ham, ilova ishlashda davom etaveradi
  }
}

export default function Pos() {
  const saved = useMemo(() => loadSavedCarts(), []);

  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [carts, setCarts] = useState(saved?.carts?.length ? saved.carts : [makeEmptyCart('Savat 1')]);
  const [activeIndex, setActiveIndex] = useState(
    saved && Number.isInteger(saved.activeIndex) && saved.activeIndex < (saved.carts || []).length ? saved.activeIndex : 0
  );
  const [customers, setCustomers] = useState([]);
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({ full_name: '', phone: '' });
  const [message, setMessage] = useState('');
  // { id, field: 'price' | 'warranty' } | null
  const [editingField, setEditingField] = useState(null);
  const customerBoxRef = useRef(null);
  const searchRef = useRef(null);
  // (29/40) Har bir tugallangan sotuvdan keyin chek — mijozga chop etib
  // berish yoki PDF qilib yuklab olish uchun.
  const [lastReceipt, setLastReceipt] = useState(null);
  // (20) Mobilda savat pastdagi tugma bosilganda ochiladigan "drawer";
  // katta ekranda bu holat e'tiborga olinmaydi, savat doim ko'rinadi.
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);
  // (20) Kiosk rejimi — barmoq bilan bosish uchun katta +/-/tartib
  // tugmalarini yoqib/o'chirish mumkin.
  const [kioskMode, setKioskMode] = useState(true);

  const activeIdx = activeIndex < carts.length ? activeIndex : 0;
  const activeCart = carts[activeIdx];
  const cart = activeCart.cart;

  useEffect(() => {
    api.listProducts().then(setProducts);
    api.listCustomers().then(setCustomers);
  }, []);

  // Har bir savat to'plami o'zgarishida saqlab boramiz — sahifadan chiqib
  // qaytilsa ham hech qanday savat mazmuni yo'qolmasin.
  useEffect(() => {
    saveCarts({ carts, activeIndex: activeIdx });
  }, [carts, activeIdx]);

  // Mijoz tanlash oynasidan tashqariga bosilsa, ro'yxat yopiladi.
  useEffect(() => {
    function onClickOutside(e) {
      if (customerBoxRef.current && !customerBoxRef.current.contains(e.target)) {
        setCustomerDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function search_(s) {
    setSearch(s);
    api.listProducts(s).then(setProducts);
  }

  // (36) Faqat FAOL savatning bir qismini yangilash uchun umumiy
  // yordamchi — boshqa ochiq savatlarga hech qanday ta'sir qilmaydi.
  function updateActiveCart(patch) {
    setCarts((prev) => prev.map((c, i) => (i === activeIdx ? { ...c, ...(typeof patch === 'function' ? patch(c) : patch) } : c)));
  }

  function addNewCart() {
    if (carts.length >= MAX_CARTS) return;
    setCarts((prev) => [...prev, makeEmptyCart(`Savat ${prev.length + 1}`)]);
    setActiveIndex(carts.length);
  }

  function closeCart(idx) {
    const target = carts[idx];
    if (target.cart.length > 0 && !confirm(`"${target.label}" savatida ${target.cart.length} ta mahsulot bor — baribir yopilsinmi?`)) return;
    setCarts((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [makeEmptyCart('Savat 1')];
    });
    setActiveIndex((prevActive) => {
      if (idx < prevActive) return prevActive - 1;
      if (idx === prevActive) return Math.max(0, prevActive - 1);
      return prevActive - 1 < 0 ? 0 : prevActive;
    });
  }

  function addToCart(p) {
    updateActiveCart((c) => ({
      cart: c.cart.find((it) => it.product_id === p.id)
        ? c.cart.map((it) => (it.product_id === p.id ? { ...it, quantity: it.quantity + 1 } : it))
        : [
            ...c.cart,
            {
              product_id: p.id,
              product_name: p.name,
              unit_price: p.sale_price,
              original_price: p.sale_price,
              quantity: 1,
              max: p.quantity,
              // (37) Kafolat — ixtiyoriy, standart bo'sh (0 kun = kafolatsiz).
              warranty_days: '',
            },
          ],
    }));
  }

  // (6) Shtrix-kod skaneri odatda klaviaturaga juda tez raqam terib, oxirida
  // Enter yuboradi. Qidiruv maydoniga Enter bosilganda avval ANIQ mos
  // shtrix-kodni tekshiramiz; topilsa to'g'ridan-to'g'ri savatga qo'shamiz
  // va qidiruvni tozalaymiz; topilmasa — oddiy matn qidiruvi allaqachon
  // ishlagani uchun hech narsa qilinmaydi.
  async function handleSearchKeyDown(e) {
    if (e.key !== 'Enter') return;
    const code = search.trim();
    if (!code) return;
    try {
      const product = await api.getProductByBarcode(code);
      if (Number(product.quantity) <= 0) {
        setMessage(`❌ "${product.name}" qoldiqda yo'q`);
        return;
      }
      addToCart(product);
      setMessage(`✅ "${product.name}" savatga qo'shildi (shtrix-kod)`);
      setSearch('');
      api.listProducts('').then(setProducts);
    } catch {
      // Aniq shtrix-kod topilmadi — bu oddiy matn qidiruvi bo'lishi ham
      // mumkin, shuning uchun hech qanday xatolik ko'rsatilmaydi.
    }
  }

  function updateQty(id, qty) {
    updateActiveCart((c) => ({ cart: c.cart.map((it) => (it.product_id === id ? { ...it, quantity: Math.max(1, qty) } : it)) }));
  }

  // (20) Kiosk rejimidagi katta +/- tugmalari uchun.
  function stepQty(id, delta) {
    updateActiveCart((c) => ({
      cart: c.cart.map((it) => (it.product_id === id ? { ...it, quantity: Math.max(1, it.quantity + delta) } : it)),
    }));
  }

  // (20) Kiosk rejimida qatorlarni yuqori/pastga surish (kassachi uchun
  // qulay tartibda joylashtirish imkoni).
  function moveItem(id, dir) {
    updateActiveCart((c) => {
      const idx = c.cart.findIndex((it) => it.product_id === id);
      const swapWith = idx + dir;
      if (idx === -1 || swapWith < 0 || swapWith >= c.cart.length) return {};
      const next = [...c.cart];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return { cart: next };
    });
  }

  // (2) Tovar darajasidagi chegirma — savatdagi bitta qatorning narxini
  // to'g'ridan-to'g'ri tahrirlash imkoniyati.
  function updateItemPrice(id, price) {
    const clean = Math.max(0, Number(price) || 0);
    updateActiveCart((c) => ({ cart: c.cart.map((it) => (it.product_id === id ? { ...it, unit_price: clean } : it)) }));
  }

  function resetItemPrice(id) {
    updateActiveCart((c) => ({ cart: c.cart.map((it) => (it.product_id === id ? { ...it, unit_price: it.original_price } : it)) }));
  }

  // (37) Kafolat kun soni — bo'sh yoki 0 = kafolatsiz (chekda hech narsa
  // ko'rsatilmaydi, faqat kafolat belgilangan qatorlarga izoh qo'shiladi).
  function updateItemWarranty(id, days) {
    const clean = Math.max(0, Math.round(Number(days) || 0));
    updateActiveCart((c) => ({ cart: c.cart.map((it) => (it.product_id === id ? { ...it, warranty_days: clean || '' } : it)) }));
  }

  function removeItem(id) {
    updateActiveCart((c) => ({ cart: c.cart.filter((it) => it.product_id !== id) }));
  }

  const subtotal = cart.reduce((s, it) => s + it.quantity * it.unit_price, 0);

  // (2) Umumiy chek chegirmasi — foiz yoki aniq summa, ikkalasi ham
  // subtotal'dan oshib ketmasligi uchun cheklanadi.
  const discountAmount = Math.min(
    subtotal,
    Math.max(
      0,
      activeCart.discountType === 'percent'
        ? (subtotal * (Number(activeCart.discountValue) || 0)) / 100
        : activeCart.discountType === 'fixed'
        ? Number(activeCart.discountValue) || 0
        : 0
    )
  );
  const total = subtotal - discountAmount;

  const filteredCustomers = useMemo(() => {
    const q = activeCart.customerSearch.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => (c.full_name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q));
  }, [customers, activeCart.customerSearch]);

  function selectCustomer(c) {
    updateActiveCart({ customerId: c.id, customerSearch: c.full_name });
    setCustomerDropdownOpen(false);
  }

  function clearCustomer() {
    updateActiveCart({ customerId: '', customerSearch: '' });
  }

  function openQuickAdd() {
    setQuickAddForm({ full_name: activeCart.customerSearch && !activeCart.customerId ? activeCart.customerSearch : '', phone: '' });
    setQuickAddOpen(true);
    setCustomerDropdownOpen(false);
  }

  async function handleQuickAddSave(e) {
    e.preventDefault();
    if (!quickAddForm.full_name.trim()) return;
    try {
      const res = await api.createCustomer({ full_name: quickAddForm.full_name.trim(), phone: quickAddForm.phone, note: '' });
      const newCustomer = { id: res.id, full_name: quickAddForm.full_name.trim(), phone: quickAddForm.phone, current_debt: 0 };
      setCustomers((prev) => [...prev, newCustomer]);
      updateActiveCart({ customerId: res.id, customerSearch: newCustomer.full_name });
      setQuickAddOpen(false);
    } catch (err) {
      alert(err.message || "Mijoz qo'shishda xatolik yuz berdi");
    }
  }

  // (34) `mode` — 'naqd' | 'karta' | 'aralash' | 'qarz'.
  async function handleCheckout(mode) {
    setMessage('');
    if (cart.length === 0) return;
    try {
      let paidNaqd = 0;
      let paidKarta = 0;
      if (mode === 'naqd') {
        paidNaqd = total;
      } else if (mode === 'karta') {
        paidKarta = total;
      } else if (mode === 'aralash') {
        paidNaqd = Number(activeCart.mixedNaqd) || 0;
        paidKarta = Number(activeCart.mixedKarta) || 0;
      } else if (mode === 'qarz') {
        paidNaqd = activeCart.debtPaidNaqd === '' ? 0 : Number(activeCart.debtPaidNaqd) || 0;
        paidKarta = activeCart.debtPaidKarta === '' ? 0 : Number(activeCart.debtPaidKarta) || 0;
      }
      const result = await api.createSale({
        customer_id: activeCart.customerId || null,
        items: cart.map(({ product_id, product_name, quantity, unit_price, warranty_days }) => ({
          product_id,
          product_name,
          quantity,
          unit_price,
          warranty_days: Number(warranty_days) || 0,
        })),
        paid_naqd: paidNaqd,
        paid_karta: paidKarta,
        discount_type: activeCart.discountType === 'none' ? null : activeCart.discountType,
        discount_value: activeCart.discountType === 'none' ? 0 : Number(activeCart.discountValue) || 0,
      });
      setMessage('✅ Sotuv muvaffaqiyatli amalga oshirildi!');
      // (29/40) Chek ma'lumotini savat tozalanishidan OLDIN saqlab qolamiz.
      setLastReceipt({
        sale: {
          id: result.id,
          created_at: new Date().toISOString(),
          subtotal_amount: result.subtotal_amount,
          discount_amount: result.discount_amount,
          total_amount: result.total_amount,
          paid_naqd: result.paid_naqd,
          paid_karta: result.paid_karta,
          debt_amount: result.debt_amount,
        },
        items: cart.map((it) => ({
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total_price: it.quantity * it.unit_price,
          warranty_days: Number(it.warranty_days) || 0,
        })),
        customerName: activeCart.customerId ? customers.find((c) => c.id == activeCart.customerId)?.full_name || null : null,
      });
      // (36) Faqat shu savat tozalanadi — boshqa ochiq savatlar (masalan
      // navbatda kutayotgan boshqa mijoz uchun) tegilmay qoladi.
      updateActiveCart(() => ({
        cart: [],
        customerId: '',
        customerSearch: '',
        debtPaidNaqd: '',
        debtPaidKarta: '',
        mixedOpen: false,
        mixedNaqd: '',
        mixedKarta: '',
        discountType: 'none',
        discountValue: '',
      }));
      setCartDrawerOpen(false);
      api.listProducts(search).then(setProducts);
    } catch (e) {
      setMessage('❌ ' + e.message);
    }
  }

  return (
    <div className="pos-page">
      <div className="topbar">
        <h2 style={{ margin: 0 }}>Sotuv (kassa)</h2>
      </div>

      {message && (
        <div className="card" style={{ marginBottom: 14, borderColor: message.startsWith('✅') ? 'var(--green)' : 'var(--red)' }}>
          {message}
        </div>
      )}

      <div className="pos-grid" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <div className="card">
          {/* (6) Shu maydon ham oddiy matn qidiruvi, ham shtrix-kod skaneri
              kirishi sifatida ishlaydi — skaner Enter yuborganda aniq
              moslikni tekshiramiz. */}
          <input
            ref={searchRef}
            placeholder="Mahsulot qidirish yoki shtrix-kodni skanerlash..."
            value={search}
            onChange={(e) => search_(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            style={{ marginBottom: 12 }}
          />
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="pos-product-row">
              <thead><tr><th>Nomi</th><th>Narx</th><th>Qoldiq</th><th></th></tr></thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{money(p.sale_price)}</td>
                    <td>{p.quantity}</td>
                    <td><button className="btn secondary" disabled={p.quantity <= 0} onClick={() => addToCart(p)}>+ Qo'shish</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* (20) Mobilda savat "drawer" sifatida ochiladi — tashqarisiga
            (shu qoraytirilgan qatlamga) bosilsa yopiladi. Katta ekranda bu
            qatlam ko'rinmaydi va savat doim ochiq turadi. */}
        {cartDrawerOpen && <div className="pos-cart-overlay" onClick={() => setCartDrawerOpen(false)} />}

        <div className={`card pos-cart-panel${cartDrawerOpen ? ' open' : ''}`}>
          {/* (36) Bir nechta savat — tablar orqali almashtiriladi, "+"
              bilan yangisi ochiladi (eng ko'pi bilan 5 ta). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {carts.map((c, i) => (
              <div key={c.uid} style={{ display: 'flex', alignItems: 'stretch' }}>
                <button
                  type="button"
                  className={`btn ${i === activeIdx ? '' : 'secondary'}`}
                  style={{ padding: '6px 12px', fontSize: 13, borderRadius: carts.length > 1 ? '8px 0 0 8px' : 8 }}
                  onClick={() => setActiveIndex(i)}
                >
                  {c.label}{c.cart.length > 0 ? ` (${c.cart.length})` : ''}
                </button>
                {carts.length > 1 && (
                  <button
                    type="button"
                    className={`btn ${i === activeIdx ? '' : 'secondary'}`}
                    style={{ padding: '6px 8px', fontSize: 11, borderRadius: '0 8px 8px 0' }}
                    title="Savatni yopish"
                    onClick={() => closeCart(i)}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {carts.length < MAX_CARTS && (
              <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={addNewCart}>+ Yangi</button>
            )}
            <button
              type="button"
              className="btn secondary"
              style={{ padding: '6px 10px', fontSize: 12, marginLeft: 'auto' }}
              title="Kiosk boshqaruvi — katta +/-/tartib tugmalarini yoqish/o'chirish"
              onClick={() => setKioskMode((v) => !v)}
            >
              {kioskMode ? "🎛️ Katta tugmalar: YONIQ" : "🎛️ Katta tugmalar: O'CHIQ"}
            </button>
          </div>

          <h3 style={{ marginTop: 0 }}>Savat</h3>
          {cart.length === 0 && <div style={{ color: 'var(--text-dim)' }}>Savat bo'sh</div>}
          {cart.map((it, idx) => {
            const isDiscounted = it.unit_price !== it.original_price;
            const isEditingPrice = editingField?.id === it.product_id && editingField?.field === 'price';
            const isEditingWarranty = editingField?.id === it.product_id && editingField?.field === 'warranty';
            const hasWarranty = Number(it.warranty_days) > 0;
            return (
              <div key={it.product_id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px dashed var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 140px', fontSize: 14, fontWeight: 700, minWidth: 100 }}>
                    {it.product_name}
                    {hasWarranty && !isEditingWarranty && (
                      <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>🛡️ {it.warranty_days} kun</div>
                    )}
                  </div>

                  {/* (20) Kiosk rejimida katta +/- tugmalari, aks holda
                      oddiy raqam maydoni. */}
                  {kioskMode ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button type="button" className="btn secondary" style={{ padding: '4px 10px', fontSize: 16, fontWeight: 700 }} onClick={() => stepQty(it.product_id, -1)}>−</button>
                      <input
                        type="number"
                        style={{ width: 46, textAlign: 'center', padding: '6px 4px' }}
                        value={it.quantity}
                        max={it.max}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateQty(it.product_id, +e.target.value)}
                      />
                      <button type="button" className="btn secondary" style={{ padding: '4px 10px', fontSize: 16, fontWeight: 700 }} onClick={() => stepQty(it.product_id, 1)}>+</button>
                    </div>
                  ) : (
                    <input
                      type="number"
                      style={{ width: 60 }}
                      value={it.quantity}
                      max={it.max}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => updateQty(it.product_id, +e.target.value)}
                    />
                  )}

                  {isEditingPrice ? (
                    <input
                      type="number"
                      autoFocus
                      style={{ width: 90 }}
                      defaultValue={it.unit_price}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => { updateItemPrice(it.product_id, e.target.value); setEditingField(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                  ) : isEditingWarranty ? (
                    <input
                      type="number"
                      autoFocus
                      style={{ width: 90 }}
                      placeholder="Kafolat, kun"
                      defaultValue={it.warranty_days || ''}
                      onFocus={(e) => e.target.select()}
                      onBlur={(e) => { updateItemWarranty(it.product_id, e.target.value); setEditingField(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    />
                  ) : (
                    <div style={{ width: 90, fontSize: 13, textAlign: 'right' }}>
                      {isDiscounted && (
                        <div style={{ textDecoration: 'line-through', color: 'var(--text-dim)', fontSize: 11 }}>
                          {money(it.quantity * it.original_price)}
                        </div>
                      )}
                      <div style={{ color: isDiscounted ? 'var(--accent)' : undefined, fontWeight: isDiscounted ? 700 : undefined }}>
                        {money(it.quantity * it.unit_price)}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn secondary"
                    style={{ padding: '6px 8px', fontSize: 12 }}
                    title="Narxni o'zgartirish (chegirma)"
                    onClick={() => setEditingField(isEditingPrice ? null : { id: it.product_id, field: 'price' })}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    style={{ padding: '6px 8px', fontSize: 12 }}
                    title="Kafolat kunini belgilash"
                    onClick={() => setEditingField(isEditingWarranty ? null : { id: it.product_id, field: 'warranty' })}
                  >
                    🛡️
                  </button>

                  {/* (20) Kiosk rejimida qatorni yuqoriga/pastga surish. */}
                  {kioskMode && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button type="button" className="btn secondary" style={{ padding: '1px 6px', fontSize: 10, lineHeight: 1.4 }} disabled={idx === 0} onClick={() => moveItem(it.product_id, -1)}>▲</button>
                      <button type="button" className="btn secondary" style={{ padding: '1px 6px', fontSize: 10, lineHeight: 1.4 }} disabled={idx === cart.length - 1} onClick={() => moveItem(it.product_id, 1)}>▼</button>
                    </div>
                  )}

                  <button className="btn danger" style={{ padding: '6px 10px' }} onClick={() => removeItem(it.product_id)}>✕</button>
                </div>
                {isDiscounted && !isEditingPrice && (
                  <div style={{ textAlign: 'right', marginTop: 2 }}>
                    <button type="button" className="btn secondary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => resetItemPrice(it.product_id)}>
                      Asl narxga qaytarish
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <hr style={{ borderColor: 'var(--border)' }} />

          {/* (2) Umumiy chek chegirmasi */}
          <div className="form-row">
            <label>Umumiy chegirma (ixtiyoriy)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select style={{ width: 110, flexShrink: 0 }} value={activeCart.discountType} onChange={(e) => updateActiveCart({ discountType: e.target.value })}>
                <option value="none">Yo'q</option>
                <option value="percent">Foiz (%)</option>
                <option value="fixed">Summa</option>
              </select>
              {activeCart.discountType !== 'none' && (
                <input
                  type="number"
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder={activeCart.discountType === 'percent' ? 'Masalan: 10' : "Masalan: 20000"}
                  value={activeCart.discountValue}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => updateActiveCart({ discountValue: e.target.value })}
                />
              )}
            </div>
          </div>

          {discountAmount > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-dim)' }}>
                <span>Mahsulotlar jami:</span><span>{money(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--red)' }}>
                <span>Chegirma:</span><span>-{money(discountAmount)}</span>
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700, margin: '10px 0' }}>
            <span>Jami to'lov:</span><span>{money(total)}</span>
          </div>

          <div className="form-row" ref={customerBoxRef} style={{ position: 'relative' }}>
            <label>Mijoz (ixtiyoriy)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ flex: 1 }}
                placeholder="Ism yoki telefon bo'yicha qidirish..."
                value={activeCart.customerSearch}
                onChange={(e) => {
                  updateActiveCart({ customerSearch: e.target.value, customerId: '' });
                  setCustomerDropdownOpen(true);
                }}
                onFocus={() => setCustomerDropdownOpen(true)}
              />
              {activeCart.customerId && (
                <button type="button" className="btn secondary" style={{ padding: '6px 10px' }} onClick={clearCustomer} title="Mijozni bekor qilish">✕</button>
              )}
            </div>

            {customerDropdownOpen && (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  marginTop: 4,
                  maxHeight: 220,
                  overflowY: 'auto',
                  padding: 6,
                }}
              >
                <button
                  type="button"
                  className="btn"
                  style={{ width: '100%', marginBottom: 6 }}
                  onClick={openQuickAdd}
                >
                  + Yangi mijoz qo'shish
                </button>
                {filteredCustomers.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      borderRadius: 6,
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--border)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>{c.full_name}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{c.phone}</span>
                  </div>
                ))}
                {filteredCustomers.length === 0 && (
                  <div style={{ padding: '8px 10px', color: 'var(--text-dim)', fontSize: 13 }}>Mijoz topilmadi</div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => handleCheckout('naqd')} disabled={cart.length === 0}>💵 Naqd</button>
            <button className="btn" style={{ flex: 1 }} onClick={() => handleCheckout('karta')} disabled={cart.length === 0}>💳 Karta</button>
          </div>

          {/* (34) Aralash to'lov — chekni naqd va karta o'rtasida bo'lib to'lash. */}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn secondary"
              style={{ width: '100%' }}
              disabled={cart.length === 0}
              onClick={() => {
                if (!activeCart.mixedOpen && !activeCart.mixedNaqd && !activeCart.mixedKarta) {
                  updateActiveCart({ mixedNaqd: String(total), mixedKarta: '0', mixedOpen: true });
                } else {
                  updateActiveCart((c) => ({ mixedOpen: !c.mixedOpen }));
                }
              }}
            >
              🔀 Aralash to'lov (naqd + karta)
            </button>
            {activeCart.mixedOpen && (
              <div className="card" style={{ marginTop: 8, background: 'var(--panel-light)' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="form-row" style={{ flex: 1, marginBottom: 8 }}>
                    <label>💵 Naqd</label>
                    <input
                      type="number"
                      value={activeCart.mixedNaqd}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateActiveCart({ mixedNaqd: v, mixedKarta: String(Math.max(0, total - (Number(v) || 0))) });
                      }}
                    />
                  </div>
                  <div className="form-row" style={{ flex: 1, marginBottom: 8 }}>
                    <label>💳 Karta</label>
                    <input
                      type="number"
                      value={activeCart.mixedKarta}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateActiveCart({ mixedKarta: v, mixedNaqd: String(Math.max(0, total - (Number(v) || 0))) });
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: (Number(activeCart.mixedNaqd) || 0) + (Number(activeCart.mixedKarta) || 0) === total ? 'var(--text-dim)' : 'var(--red)', marginBottom: 8 }}>
                  Jami: {money((Number(activeCart.mixedNaqd) || 0) + (Number(activeCart.mixedKarta) || 0))} / {money(total)}
                  {(Number(activeCart.mixedNaqd) || 0) + (Number(activeCart.mixedKarta) || 0) !== total && ' — summalar mos kelmayapti'}
                </div>
                <button
                  className="btn"
                  style={{ width: '100%' }}
                  disabled={cart.length === 0 || (Number(activeCart.mixedNaqd) || 0) + (Number(activeCart.mixedKarta) || 0) !== total}
                  onClick={() => handleCheckout('aralash')}
                >
                  Aralash to'lovni tasdiqlash
                </button>
              </div>
            )}
          </div>

          {/* (34) Qarzga sotishda "hozir to'langan" qismini ham naqd/karta
              bo'yicha aniqlashtirish mumkin. */}
          <div className="form-row" style={{ marginTop: 12 }}>
            <label>Qarzga sotish — hozir to'langan summa</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="number"
                placeholder="💵 Naqd"
                value={activeCart.debtPaidNaqd}
                onFocus={(e) => e.target.select()}
                onChange={(e) => updateActiveCart({ debtPaidNaqd: e.target.value })}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                placeholder="💳 Karta"
                value={activeCart.debtPaidKarta}
                onFocus={(e) => e.target.select()}
                onChange={(e) => updateActiveCart({ debtPaidKarta: e.target.value })}
                style={{ flex: 1 }}
              />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              Qarzga qoladi: {money(Math.max(0, total - (Number(activeCart.debtPaidNaqd) || 0) - (Number(activeCart.debtPaidKarta) || 0)))}
            </div>
            <button className="btn secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => handleCheckout('qarz')} disabled={cart.length === 0 || !activeCart.customerId}>
              📒 Qarzga yozish
            </button>
            {!activeCart.customerId && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>Qarzga sotish uchun mijoz tanlang</div>}
          </div>
        </div>
      </div>

      {/* (20) Mobilda savatni ochish uchun pastda suzuvchi tugma. Katta
          ekranda CSS orqali yashiriladi (savat allaqachon ko'rinib turadi). */}
      <button type="button" className="pos-cart-toggle" onClick={() => setCartDrawerOpen(true)}>
        <span>🛒 {activeCart.label}: {cart.length} ta</span>
        <strong>{money(total)}</strong>
      </button>

      {quickAddOpen && (
        <div className="modal-overlay" onClick={() => setQuickAddOpen(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleQuickAddSave}>
            <h3 style={{ marginTop: 0 }}>Yangi mijoz</h3>
            <div className="form-row">
              <label>Ism familiya *</label>
              <input
                required
                autoFocus
                value={quickAddForm.full_name}
                onChange={(e) => setQuickAddForm({ ...quickAddForm, full_name: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Telefon</label>
              <input
                value={quickAddForm.phone}
                onChange={(e) => setQuickAddForm({ ...quickAddForm, phone: e.target.value })}
                placeholder="+998 90 123 45 67"
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn secondary" style={{ flex: 1 }} onClick={() => setQuickAddOpen(false)}>Bekor qilish</button>
              <button className="btn" style={{ flex: 1 }}>Saqlash va tanlash</button>
            </div>
          </form>
        </div>
      )}

      {lastReceipt && (
        <div className="modal-overlay" onClick={() => setLastReceipt(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>✅ Chek #{lastReceipt.sale.id}</h3>
            <table>
              <thead><tr><th>Mahsulot</th><th>Miqdor</th><th>Summa</th></tr></thead>
              <tbody>
                {lastReceipt.items.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.product_name}
                      {Number(it.warranty_days) > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--accent)' }}>🛡️ {it.warranty_days} kun kafolat</div>
                      )}
                    </td>
                    <td>{it.quantity}</td>
                    <td>{money(it.total_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, margin: '10px 0' }}>
              <span>Jami</span><span>{money(lastReceipt.sale.total_amount)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => printReceipt(buildSaleReceiptData(lastReceipt.sale, lastReceipt.items, { customerName: lastReceipt.customerName }))}
              >
                🖨️ Chop etish
              </button>
              <button
                type="button"
                className="btn secondary"
                style={{ flex: 1 }}
                onClick={() => downloadReceiptPdf(buildSaleReceiptData(lastReceipt.sale, lastReceipt.items, { customerName: lastReceipt.customerName }), `chek-${lastReceipt.sale.id}.pdf`)}
              >
                ⬇️ PDF yuklab olish
              </button>
            </div>
            <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setLastReceipt(null)}>Yopish</button>
          </div>
        </div>
      )}
    </div>
  );
}
