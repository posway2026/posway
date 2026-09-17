# Posway — Do'kon Boshqaruv Tizimi

Avtoehtiyot qismlar do'koni uchun to'liq boshqaruv tizimi: sotuv (kassa), ombor,
mijozlar/qarz daftari, ta'minotchilarga qarz, xodimlar va hisobotlar. Veb-ilova
(PWA) sifatida qurilgan — istalgan telefon yoki kompyuterdan, brauzer orqali
ishlaydi va telefonga "ilova" sifatida o'rnatiladi.

## Tuzilma

```
posway/
├── server/     ← Backend (Node.js + Express, Supabase Postgres)
└── client/     ← Frontend (React + Vite, PWA)
```

## Joylashtirilgan manzillar (production)

- Backend: https://posway-api.onrender.com
- Frontend: https://posway-1.onrender.com

Ikkalasi ham Render.com'da ishlaydi va GitHub'ning `main` branchiga har bir
push'dan so'ng avtomatik qayta deploy bo'ladi.

---

## Kompyuterda mahalliy ishga tushirish (ixtiyoriy, faqat rivojlantirish uchun)

### Talablar
- [Node.js](https://nodejs.org) (v18 yoki undan yuqori)

### Serverni ishga tushirish
```bash
cd server
npm install
npm run dev
```
`DATABASE_URL` muhit o'zgaruvchisi berilmasa, server oddiy JSON fayl orqali
ishlaydi (faqat sinov uchun — production'da doim Supabase Postgres ishlatiladi).
Birinchi marta ishga tushganda avtomatik admin hisobi yaratiladi:
- **Login:** `admin`
- **Parol:** `admin123`

### Clientni ishga tushirish (boshqa terminalda)
```bash
cd client
npm install
npm run dev
```
Brauzeringizda `http://localhost:5173` manzilini oching.

---

## Rollar (kirish huquqlari)

| Rol       | Huquqlari |
|-----------|-----------|
| Admin     | Hammasi: mahsulot, sotuv, mijoz, xodim qo'shish/o'chirish, hisobotlar |
| Kassir    | Sotuv qilish, mijozlarni ko'rish, hisobotlarni ko'rish |
| Omborchi  | Mahsulot qo'shish/tahrirlash, sotuv qilish |

Yangi xodim qo'shish: admin sifatida kiring → **Xodimlar** bo'limi → **+ Yangi xodim**.

## Asosiy imkoniyatlar

- Sotuv (kassa): bir nechta savat, chegirma, naqd/karta/aralash/qarzga sotish,
  shtrix-kod skaneri, mahsulot kafolati, chek chop etish va PDF yuklab olish
- Ombor: kirim/kirim hujjatlari, harakatlar tarixi, kam qolgan/uzoq sotilmagan
  filtrlari, har bir mahsulot uchun shtrix-kod va narx yorlig'i
- Mijozlar/Qarz: qarz tarixi, qisman/to'liq qaytarish, qarzni yopish
- Ta'minotchilarga qarzim: kirim hujjatlari, to'lovlar
- Hisobotlar: kunlik/oylik/yillik foyda, kassa harakati, kunlik kassa yopish

## Ma'lumotlar bazasi

Production'da Supabase (Postgres) ishlatiladi — `DATABASE_URL` orqali ulanadi,
ma'lumotlar server qayta ishga tushsa ham yo'qolmaydi.
