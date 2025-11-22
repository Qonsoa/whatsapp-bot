import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import Groq from "groq-sdk";

// اقرأ مفاتيح من متغيرات البيئة
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WA_PHONE = process.env.WA_PHONE; // شكل: 201067861263 (بدون +)

if (!GROQ_API_KEY) {
  console.error("ERROR: ضع GROQ_API_KEY كمتغير بيئة (env)");
  process.exit(1);
}
if (!WA_PHONE) {
  console.error("ERROR: ضع WA_PHONE (مثال: 201067861263) كمتغير بيئة (env)");
  process.exit(1);
}

const client = new Groq({ apiKey: GROQ_API_KEY });

// === دالة الـ AI ===
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
- 1500 لـ 6 شهور (بدل 1800 لفترة محدودة)
- 2200 للسنة
المواعيد: 24 ساعة.
مواعيد البنات:
السبت والاتنين والأربع من 4 لـ 8،
والحد والتلات والخميس من 10 الصبح لـ 4 العصر.
العنوان: 180 أبراج الصفوة، شارع التروللي، المطرية.
لو العميل سأل سؤال خارج الجيم برضه جاوبه وكون لطيف.
`
        },
        { role: "user", content: message }
      ]
    });

    return completion.choices?.[0]?.message?.content || "آسف، مفيش رد من الـ AI دلوقتي.";
  } catch (err) {
    console.error("AI Error:", err);
    return "حصلت مشكلة مؤقتة مع السيرفر.. جرّب تبعتلي تاني ♥";
  }
}

// === بدء البوت ===
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    mobile: false
  });

  sock.ev.on("creds.update", saveCreds);

  // معالجة تحديث الاتصال (سيطبع pairingCode عند الطلب)
  sock.ev.on("connection.update", async (update) => {
    const { connection, pairingCode, lastDisconnect } = update;

    if (pairingCode) {
      console.log("🔑 Pairing code (أدخله في واتساب → Link with phone number):");
      console.log(pairingCode);
    }

    if (connection === "open") {
      console.log("✅ متصل بواتساب بنجاح!");
    }

    if (connection === "close") {
      console.log("❌ الاتصال اتقفل. محاولة إعادة التشغيل بعد 2 ثانية...");
      setTimeout(startBot, 2000);
    }
  });

  // طلب pairing code فقط إن لم تكن الجلسة مسجلة
  if (!state.creds.registered) {
    try {
      const code = await sock.requestPairingCode(WA_PHONE);
      console.log("🔗 تم طلب Pairing code. الكود في اللوجس أعلاه أو سيطبع عند استلامه.");
      console.log("Pairing request response:", code);
    } catch (err) {
      console.error("فشل طلب pairing code:", err?.message || err);
    }
  }

  // استقبال الرسائل والرد عليها باستخدام Groq
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if (!text.trim()) return;

    const reply = await askGroq(text);
    await sock.sendMessage(msg.key.remoteJid, { text: reply });
  });
}

startBot();
