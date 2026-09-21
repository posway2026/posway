import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';

const router = Router();

// (2026-09-20) Ta'minotchidan kelgan hisob-faktura yoki narxlar ro'yxati
// rasmidan AI yordamida mahsulotlarni avtomatik o'qib olish — foydalanuvchi
// so'rovi bo'yicha qo'shildi ("ChatGPT'da rasm yuklab mahsulot kiritish bor
// ekan" degan taklif asosida). Anthropic Claude API'ning rasmni tushunish
// ("vision") imkoniyatidan foydalanamiz.
//
// MUHIM — bu butunlay IXTIYORIY, qo'shimcha funksiya:
//  - Agar server muhitida ANTHROPIC_API_KEY sozlanmagan bo'lsa, aniq xato
//    xabari qaytariladi va bundan tashqari HECH NARSA ishlamay qolmaydi —
//    oddiy qo'lda kiritish tizimi hech qanday holatda bunga bog'liq emas.
//  - Billing: Anthropic API "pay-as-you-go" (foydalanganda pul yechiladi,
//    oylik majburiy to'lov yo'q) — https://platform.claude.com/docs/en/about-claude/pricing
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
// Model ID'ni muhit o'zgaruvchisi orqali ham almashtirish mumkin — agar
// kelajakda Anthropic yangi model chiqarsa, kodni o'zgartirmasdan Render'da
// ANTHROPIC_MODEL qiymatini yangilash kifoya qiladi.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const VALID_UNITS = ['dona', 'kg', 'gramm', 'metr', 'litr'];

const EXTRACTION_PROMPT = `Bu — bir avtozapchastlar do'koniga ta'minotchidan kelgan hisob-faktura yoki narxlar ro'yxatining rasmi (bir nechta rasm bo'lishi mumkin, hammasi BITTA hujjatning turli qismlari/sahifalari deb hisobla). Rasm(lar)dagi HAR BIR mahsulot qatorini o'qib chiq va FAQAT quyidagi ko'rinishdagi JSON massiv bilan javob ber, boshqa hech qanday matn yozma:

[
  {"name": "mahsulot nomi", "brand": "brend (ko'rinsa, aks holda bo'sh satr)", "quantity": son, "unit_cost": son, "unit": "dona"}
]

Qoidalar:
- Faqat rasmda haqiqatan ko'ringan narsani yoz, taxmin qilib to'ldirma.
- "quantity" — shu qatordagi mahsulot soni (ko'rinmasa 1 deb yoz).
- "unit_cost" — 1 dona/birlikning tan narxi (ta'minotchi qo'ygan narx), faqat raqam, valyuta belgisisiz.
- "unit" maydoniga FAQAT "dona", "kg", "gramm", "metr" yoki "litr" so'zlaridan birini yoz (aks holda "dona" deb qoldir).
- Mahsulotning SOTISH narxi rasmda ko'rinmaydi — uni hech qachon to'qib yozma, bu maydonni umuman qo'shma.
- Javobing FAQAT JSON massiv bo'lsin — hech qanday tushuntirish, sarlavha yoki \`\`\` belgisi qo'shma. Agar rasmda hech qanday mahsulot topa olmasang, bo'sh massiv [] qaytar.`;

function extractJsonArray(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch (e2) { /* pastda null qaytadi */ }
    }
  }
  return null;
}

router.post('/extract-invoice', authRequired, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: "AI funksiyasi hali sozlanmagan — serverga ANTHROPIC_API_KEY kaliti qo'shilishi kerak (Render → Environment). Hozircha odatdagidek qo'lda kiritishdan foydalaning.",
    });
  }

  const images = Array.isArray(req.body.images) ? req.body.images : [];
  if (images.length === 0) return res.status(400).json({ error: 'Kamida bitta rasm yuboring' });
  if (images.length > 5) return res.status(400).json({ error: "Bir vaqtda ko'pi bilan 5 ta rasm yuborish mumkin" });

  const content = [];
  for (const img of images) {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(img || '');
    if (!match) return res.status(400).json({ error: "Rasm formati noto'g'ri" });
    content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
  }
  content.push({ type: 'text', text: EXTRACTION_PROMPT });

  let response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || "AI bilan bog'lanishda xatolik yuz berdi" });
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return res.status(502).json({ error: "AI xizmatidan noto'g'ri javob keldi" });
  }

  if (!response.ok) {
    return res.status(502).json({ error: data?.error?.message || `AI xizmatidan xatolik qaytdi (${response.status})` });
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const items = extractJsonArray(text);
  if (!items) {
    return res.status(502).json({ error: "AI javobini o'qib bo'lmadi. Qayta urinib ko'ring yoki qo'lda kiriting.", raw: (text || '').slice(0, 500) });
  }

  const cleanItems = items
    .map((it) => ({
      name: String(it?.name || '').trim(),
      brand: String(it?.brand || '').trim(),
      quantity: Number(it?.quantity) || 1,
      unit_cost: Number(it?.unit_cost) || 0,
      unit: VALID_UNITS.includes(it?.unit) ? it.unit : 'dona',
    }))
    .filter((it) => it.name);

  res.json({ items: cleanItems });
});

export default router;
