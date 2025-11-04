import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const TRIGGER = "!edgar";
const MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
];

const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("📱 Scan QR code di WhatsApp untuk login.");
});

client.on("ready", () => {
  console.log("🤖 WhatsApp Bot siap digunakan!");
});

// === FUNGSI PANGGIL GEMINI ===
async function getGeminiResponse(prompt) {
  const baseInstruction = `
Kamu adalah *Edgar*, asisten AI yang dibuat oleh *Idad*.
Berperilakulah sopan, ramah, dan komunikatif.
Jika seseorang bertanya "kamu siapa" atau "siapa kamu",
jawablah dengan: "Aku Edgar, AI buatan Idad 😊".
`;

  const fullPrompt = `${baseInstruction}\n\nPertanyaan pengguna: ${prompt}`;

  for (const modelName of MODELS) {
    try {
      console.log(`🚀 Coba model: ${modelName}`);
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelName });

      const result = await model.generateContent(fullPrompt);
      const text = result.response.text();

      if (text && text.trim()) return text;
    } catch (err) {
      console.error(`❌ Gagal dengan model ${modelName}:`, err.message);
    }
  }

  return "❌ Semua model gagal (server sibuk atau kunci API salah). Coba lagi nanti.";
}

// === EVENT PESAN ===
client.on("message", async (message) => {
  const chat = await message.getChat();

  // Hanya grup
  if (!chat.isGroup) return;

  console.log(`📩 Pesan diterima dari grup: ${chat.name} | Isi: ${message.body}`);

  // Jika pakai trigger
  if (message.body.startsWith(TRIGGER)) {
    const prompt = message.body.slice(TRIGGER.length).trim() || "Hai!";
    console.log(`⚡ Trigger ${TRIGGER} terdeteksi`);
    console.log(`🧠 Kirim ke Gemini: ${prompt}`);

    const reply = await getGeminiResponse(prompt);
    await message.reply(reply);
    console.log("📤 Balasan:", reply);
  }
});

client.initialize();
