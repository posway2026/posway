// ---------------------------------------------------------------------
// (24) Eskiz.uz orqali SMS yuborish — mijozlarga qarz to'lov muddati
// haqida avtomatik eslatma yuborish uchun.
//
// MUHIM — bu ham (aiExtract.js'dagi AI funksiyasi kabi) butunlay
// IXTIYORIY, qo'shimcha funksiya: agar ESKIZ_EMAIL / ESKIZ_PASSWORD
// muhit o'zgaruvchilari sozlanmagan bo'lsa, aniq xato qaytariladi va
// ilovaning qolgan qismi bunga umuman bog'liq emas.
//
// Endpoint'lar va so'rov formati Eskiz'ning rasmiy Postman hujjatiga
// (notify.eskiz.uz/api/auth/login, form-data: email+password) asoslangan —
// MUHIM: Eskiz bu yerda JSON emas, balki "multipart/form-data" formatini
// kutadi (shuning uchun pastda JSON.stringify emas, FormData ishlatiladi).
// Lekin agar Eskiz tomonidan javob formati bu yerda kutilganidan farq
// qilsa — aniq xato xabari chiqadi (jim bo'lib qolmaydi), shuni ko'rib
// keyin moslashtirish kerak bo'ladi.
//
// ESLATMA (Eskiz'ning o'zi haqida, hisob ochganda duch kelasiz):
// yangi (tasdiqlanmagan) Eskiz biznes-hisobi dastlab "test rejimi"da
// bo'ladi — shu rejimda FAQAT Eskiz berilgan 3 ta tayyor shablon
// matnidan birini, FAQAT o'zingiz ro'yxatdan o'tgan telefon raqamingizga
// yuborish mumkin. Haqiqiy mijozlarga ixtiyoriy matn yuborish uchun
// Eskiz'ning o'zida hisobni tasdiqlatish (biznes ma'lumotlarini
// to'ldirish) kerak bo'ladi — bu alohida qadam, kodga aloqasi yo'q.
// ---------------------------------------------------------------------

// (test uchun) ESKIZ_BASE_URL orqali almashtirish mumkin — odatiy holatda
// Eskiz'ning haqiqiy manzili ishlatiladi.
const BASE_URL = process.env.ESKIZ_BASE_URL || 'https://notify.eskiz.uz/api';

let cachedToken = null;

async function login() {
  const email = process.env.ESKIZ_EMAIL;
  const password = process.env.ESKIZ_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SMS funksiyasi hali sozlanmagan — serverga ESKIZ_EMAIL va ESKIZ_PASSWORD qo'shilishi kerak (Render → Environment)."
    );
  }

  // Eskiz'ning rasmiy hujjatida login so'rovi "multipart/form-data"
  // ko'rinishida kutiladi (curl --form email=... --form password=...) —
  // shuning uchun JSON emas, FormData ishlatamiz. 'Content-Type'ni qo'lda
  // qo'ymaymiz: fetch uni FormData'dan o'zi, to'g'ri "boundary" bilan,
  // avtomatik qo'yadi.
  const form = new FormData();
  form.append('email', email);
  form.append('password', password);

  let response;
  try {
    response = await fetch(`${BASE_URL}/auth/login`, { method: 'POST', body: form });
  } catch (err) {
    throw new Error(`Eskiz bilan bog'lanishda xatolik (login): ${err.message}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Eskiz login javobini o'qib bo'lmadi (kutilmagan format)");
  }

  if (!response.ok) {
    throw new Error(data?.message || `Eskiz login xatolik qaytardi (${response.status})`);
  }

  const token = data?.data?.token || data?.token;
  if (!token) {
    throw new Error("Eskiz login javobida token topilmadi — API formati o'zgargan bo'lishi mumkin");
  }

  cachedToken = token;
  return token;
}

async function getToken() {
  if (cachedToken) return cachedToken;
  return login();
}

// (telefon raqamlarini Eskiz kutgan "998XXXXXXXXX" (12 ta raqam, +'siz)
// ko'rinishiga keltiramiz — mijozlar bazasida raqam turlicha kiritilgan
// bo'lishi mumkin: "901234567", "+998901234567", "998 90 123 45 67" va h.k.)
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) return `998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return digits;
  if (digits.length === 13 && digits.startsWith('998')) return digits.slice(0, 12);
  return digits.length >= 9 ? digits : null;
}

// `message` — Eskiz hisobi tasdiqlanmagan ("test rejimi") bo'lsa, FAQAT
// Eskiz'ning tayyor shablon matnlaridan biri bo'lishi kerak, aks holda
// API xato qaytaradi — bu kod darajasida tuzatib bo'lmaydigan cheklov.
export async function sendSms(phone, message) {
  const mobile_phone = normalizePhone(phone);
  if (!mobile_phone) {
    throw new Error("Telefon raqami noto'g'ri yoki bo'sh");
  }

  // (Eskiz'ning login so'rovi "form-data" ekani hujjatdan tasdiqlandi —
  // SMS yuborish so'rovi ham ehtimol xuddi shunday, shuning uchun shu
  // yerda ham FormData ishlatilgan. Agar Eskiz'ning "Отправка" bo'limi
  // boshqacha ko'rsatsa, shu joyni moslashtirish kerak bo'ladi.)
  async function attempt(token) {
    const form = new FormData();
    form.append('mobile_phone', mobile_phone);
    form.append('message', message);
    form.append('from', process.env.ESKIZ_SENDER || '4546');
    return fetch(`${BASE_URL}/message/sms/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  }

  let token = await getToken();
  let response;
  try {
    response = await attempt(token);
  } catch (err) {
    throw new Error(`Eskiz bilan bog'lanishda xatolik (SMS yuborish): ${err.message}`);
  }

  // Token muddati tugagan bo'lishi mumkin — bir marta qayta login qilib ko'ramiz.
  if (response.status === 401) {
    cachedToken = null;
    token = await login();
    try {
      response = await attempt(token);
    } catch (err) {
      throw new Error(`Eskiz bilan bog'lanishda xatolik (SMS yuborish, qayta urinish): ${err.message}`);
    }
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data?.message || `Eskiz SMS yuborishda xatolik qaytardi (${response.status})`);
  }

  return data;
}
