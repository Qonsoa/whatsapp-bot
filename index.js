import makeWASocket, {
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import Groq from "groq-sdk";
import Redis from "ioredis";
import express from "express";

/* ============================
   1) Express (ضروري لـ Render)
============================= */
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("WhatsApp Bot Running ✔"));
app.listen(PORT, () => console.log(`HTTP server on ${PORT}`));

/* ============================
   2) مفاتيح البيئة
============================= */
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WA_PHONE = process.env.WA_PHONE; // رقم بدون +

if (!GROQ_API_KEY) {
  console.error("ERROR: GROQ_API_KEY not set");
  process.exit(1);
}
if (!WA_PHONE) {
  console.error("ERROR: WA_PHONE not set (example: 201067861263)");
  process.exit(1);
}

const client = new Groq({ apiKey: GROQ_API_KEY });

/* ============================
   3) Redis لحفظ الجلسة
============================= */
const redis = new Redis(process.env.REDIS_URL); // متغير البيئة من Render

async function loadCreds() {
  const raw = await redis.get("baileys:creds");
  return raw ? JSON.parse(raw) : null;
}
async function saveCreds(data) {
  await redis.set("baileys:creds", JSON.stringify(data));
}

/* ============================
   4) دالة الـ AI (Groq)
============================= */
async function askGroq(message) {
  try {
    const completion = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `
انت موظف استقبال في جيم اسمه Jungle Gym.
بترد على العميل بطريقة ودية وبالعامية المصرية.
أسعار الاشتراك:
- 600 شهر
- 1200 لـ 3 شهور
- 1500 لـ 6 شهور
- 2200 للسنة
المواعيد: 24 ساعة.
مواعيد البنات:
السبت والاتنين والأربع 4-8،
والحد والتلات والخميس 10-4.
العنوان: 180 أبراج الصفوة، شارع التروللي، المطرية.
لو سأل عن أي سؤال خارج الجيم، جاوبه برضه.
        `
        },
        { role: "user", content: message }
      ]
    });

    return completion.choices?.[0]?.message?.content || "معرفتش أرد دلوقتي.";
  } catch (err) {
    console.error("AI Error:", err);
    return "حصلت مشكلة.. حاول تاني ♥";
  }
}

/* ============================
   5) بدء البوت
============================= */
async function startBot() {
  const savedCreds = await loadCreds();
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: savedCreds
      ? {
          creds: savedCreds.creds,
          keys: savedCreds.keys
        }
      : undefined,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    mobile: false
  });

  // حفظ الجلسة في Redis
  sock.ev.on("creds.update", async (newCreds) => {
    await saveCreds(newCreds);
  });

  // أحداث الاتصال
  sock.ev.on("connection.update", async (u) => {
    const { connection, pairingCode } = u;

    if (pairingCode) {
      console.log("🔑 Pairing Code:");
      console.log(pairingCode);
    }

    if (connection === "open") {
      console.log("✔ متصل بنجاح!");
    }

    if (connection === "close") {
      console.log("❌ الاتصال اتقفل.. إعادة المحاولة");
      setTimeout(startBot, 3000);
    }
  });

  // لو مفيش جلسة → اطلب pairing code
  if (!savedCreds) {
    try {
      const code = await sock.requestPairingCode(WA_PHONE);
      console.log("🔗 Pairing code:", code);
    } catch (err) {
      console.error("Pairing Error:", err.message);
    }
  }

  // استقبال الرسائل
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text.trim()) return;

    const reply = await askGroq(text);
    await sock.sendMessage(msg.key.remoteJid, { text: reply });
  });
}

startBot();

