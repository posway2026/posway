import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// (2026-09-24) Narx maydonlari uchun umumiy komponent — Sherzodning so'roviga
// ko'ra, yozayotganda avtomatik "100.000" kabi minglik ajratuvchi nuqtalar
// bilan ko'rsatadi: 100000 -> "100.000", 1000000 -> "1.000.000", 1000 ->
// "1.000" va h.k. Shunda nechta nol yozganini aniq ko'rib, xato qilmaydi
// (masalan 450000 o'rniga qo'shimcha/kam nol yozib qo'yish).
//
// Bonus: type="text" + qo'lda raqam-filtrlash ishlatilgani uchun, ba'zi
// kompyuterlarda type="number" ni vergul/nuqta bo'yicha noto'g'ri
// talqin qilishi bilan bog'liq eski muammo ham bu maydonlarda butunlay
// yo'qoladi (faqat 0-9 raqamlar qoladi, boshqa hamma narsa e'tiborga
// olinmaydi).
//
// Ishlatish (controlled — asosiy holat, forma state'ida saqlangan narx):
//   <MoneyInput value={form.sale_price} onChange={(digits) => setForm({ ...form, sale_price: digits })} />
//   `digits` — nuqtasiz, faqat 0-9 belgilardan iborat string ("" agar bo'sh
//   bo'lsa). Eski kod deyarli hamma joyda bu qiymatni keyinchalik
//   Number(...)/+... bilan ishlatadi, shuning uchun to'g'ridan-to'g'ri
//   string sifatida saqlash yetarli.
//
// Ishlatish (uncontrolled — bir martalik joyida-tahrirlash maydonlari
// uchun, masalan Pos.jsx'dagi savat narxini tezda o'zgartirish):
//   <MoneyInput defaultValue={it.unit_price} onBlur={(digits) => updateItemPrice(it.line_id, digits)} />
//
// Diqqat (ichki texnik izoh): maydon fokusda ekan (foydalanuvchi hozir
// yozayotgan payt), tashqi `value` prop orqali kelgan "aks-sado" (parent
// state ni yangilab, keyin qayta pastga uzatgan o'sha qiymat) displeyni
// qayta yozib, tez-tez bosilgan tugmalarda raqam takrorlanib/yo'qolib
// qolishiga sabab bo'lishi mumkin edi. Shu sababli fokus davomida faqat
// o'zining lokal holatiga ishonadi; tashqi qiymat bilan sinxronlash faqat
// fokusdan chiqqanda yoki fokus umuman bo'lmaganda amalga oshadi.

function digitsOnly(s) {
  return String(s ?? '').replace(/[^\d]/g, '');
}

function groupDigits(digits) {
  return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '';
}

export default function MoneyInput({ value, defaultValue, onChange, onBlur, onFocus, inputRef, ...rest }) {
  const localRef = useRef(null);
  const ref = inputRef || localRef;
  const isControlled = value !== undefined;
  const focusedRef = useRef(false);
  const pendingCursor = useRef(null);

  const [display, setDisplay] = useState(() => groupDigits(digitsOnly(isControlled ? value : defaultValue)));

  // Har bir qayta chizishdan keyin (masalan nuqta qo'shilib/olib
  // tashlanganda) kursorni foydalanuvchi to'xtagan joyiga qaytaramiz.
  // useLayoutEffect requestAnimationFrame'dan tezroq (bir xil sinxron
  // bosqichda) ishlaydi, shuning uchun tez-tez bosilgan tugmalarda ham
  // kursor keyingi harfdan oldin to'g'rilanib ulguradi.
  useLayoutEffect(() => {
    if (pendingCursor.current != null && ref.current) {
      try {
        ref.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
      } catch {
        // e'tiborsiz qoldiramiz
      }
      pendingCursor.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display]);

  // Tashqi (parent) qiymat o'zgarsa (masalan forma tozalansa yoki boshqa
  // joydan to'ldirilsa) — displeyni shunga moslashtiramiz. Faqat maydon
  // FOKUSDA BO'LMAGANDA — aks holda parentdan qaytib kelgan eski/aks-sado
  // qiymat hozirgina yozilgan harflarni "yeb qo'yishi" mumkin edi.
  useEffect(() => {
    if (!isControlled) return;
    if (focusedRef.current) return;
    const digits = digitsOnly(value);
    if (digits !== digitsOnly(display)) setDisplay(groupDigits(digits));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(e) {
    const el = e.target;
    const cursorBefore = el.selectionStart ?? el.value.length;
    const digitsBeforeCursor = digitsOnly(el.value.slice(0, cursorBefore)).length;
    const digits = digitsOnly(el.value);
    const grouped = groupDigits(digits);

    let pos = grouped.length;
    if (digitsBeforeCursor === 0) {
      pos = 0;
    } else {
      let seen = 0;
      for (let i = 0; i < grouped.length; i++) {
        if (grouped[i] !== '.') seen++;
        if (seen === digitsBeforeCursor) {
          pos = i + 1;
          break;
        }
      }
    }
    pendingCursor.current = pos;

    setDisplay(grouped);
    if (isControlled) onChange && onChange(digits);
  }

  function handleFocus(e) {
    focusedRef.current = true;
    onFocus && onFocus(e);
  }

  function handleBlur(e) {
    focusedRef.current = false;
    if (!isControlled && onBlur) onBlur(digitsOnly(display));
    else if (isControlled && onBlur) onBlur(e);
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      {...rest}
    />
  );
}
