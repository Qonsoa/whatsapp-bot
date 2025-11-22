import makeWASocket, {
  fetchLatestBaileysVersion,
  useSingleFileAuthState,
  makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";

import Groq from "groq-sdk";
import { Redis } from "@upstash/redis";

// ========= ENV VARIABLES =========
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const WA_PHONE = process.env.WA_PHONE;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!GROQ_API_KEY || !WA_PHONE || !REDIS_URL || !REDIS_TOKEN) {
  console.error("❌ ERROR: Missing environment variables.");
  process.exit(1);
}

// ========= Redis Setup =========
const redis = new Redis({
  url: REDIS_URL,
  token: REDIS_TOKEN
});

// load creds from Redis
async function loadCreds() {
  const data = await redis.get("baileys_auth");
  return data || {};
}

// save creds to Redis
async function saveCreds(data) {
  await redis.set("baileys_auth", data);
}

// ========= AI Setup =========
const client = new Groq({ apiKey: GROQ_API_KEY });

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
لو العميل سأل حاجة تانية برضه جاوبه.
`
        },
        { role: "user", content: message }
      ]
    });

    return completion.choices?.[0]?.message?.content || "حصلت مشكلة بسيطة.. جرّب تاني ❤️";
  } catch (e) {
    console.error("AI Error:", e);
    return "حصلت مشكلة مؤقتة.. ابعت تاني ❤️";
  }
}

// ========= Start Bot =========
async function startBot() {
  const savedCreds = await loadCreds();

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: savedCreds.creds || {},
      keys: makeCacheableSignalKeyStore(savedCreds.keys || {}, saveCreds)
    },
    printQRInTerminal: false,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    syncFullHistory: false
  });

  sock.ev.on("creds.update", async (creds) => {
    await saveCreds({ creds, keys: savedCreds.keys });
  });

  sock.ev.on("connection.update", async ({ connection, pairingCode }) => {
    if (pairingCode) {
      console.log("🔑 Pairing Code:");
      console.log(pairingCode);
    }

    if (connection === "open") {
      console.log("✅ Bot Connected Successfully!");
    }
    if (connection === "close") {
      console.log("❌ Connection closed. Restarting...");
      setTimeout(startBot, 3000);
    }
  });

  // لو مفيش جلسة → اطلب pairing code
  if (!savedCreds.creds?.registered) {
    const code = await sock.requestPairingCode(WA_PHONE);
    console.log("🔗 Pairing Code (ادخله في واتساب):", code);
  }

  // === الرسائل ===
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text.trim()) return;

    const reply = await askGroq(text);

    await sock.sendMessage(msg.key.remoteJid, {
      text: reply
    });
  });
}

startBot();

