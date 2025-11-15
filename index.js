import express from "express";
import qrcode from "qrcode-terminal";
import fs from "fs";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

// 🔧 Trigger pemanggilan
const TRIGGER = "zippy"; // panggil bot pakai "Zippy" atau "zippy"
const MODELS = ["gemini-2.0-flash-exp", "gemini-2.0-flash", "gemini-1.5-pro"];
const MAX_ACCESS = 5;
const ACCESS_FILE = "./authorized.json";
const SUPER_ADMINS = ["085764565028", "6285764565028"];

if (!fs.existsSync(ACCESS_FILE)) fs.writeFileSync(ACCESS_FILE, "[]", "utf-8");
let authorized = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf-8"));

const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("📱 Scan QR code di WhatsApp untuk login.");
});

client.on("ready", () => {
  console.log("🤖 Bot WhatsApp Zippy siap digunakan!");
});

async function getGeminiResponse(prompt) {
  const baseInstruction = `
Kamu adalah *Zippy*, AI yang sopan dan santai.
Jika seseorang tanya "siapa kamu", jawab: "Aku Zippy, teman ngobrolmu 😄".
Gunakan bahasa Indonesia yang ringan, ramah, dan tidak kaku.
Jangan pernah menyebut AI, Gemini, atau Google.
`;
  const fullPrompt = `${baseInstruction}\n\nPertanyaan pengguna: ${prompt}`;

  for (const modelName of MODELS) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(fullPrompt);
      const text = result.response.text();
      if (text && text.trim()) return text;
    } catch (err) {
      console.error(`❌ Gagal model ${modelName}:`, err.message);
    }
  }
  return "⚠️ Maaf, aku lagi sibuk nih. Coba lagi nanti ya.";
}

const helpText = `
🧠 *Menu Perintah Zippy*
━━━━━━━━━━━━━━━
🤖 *AI Chat*
• Zippy [pesan] → Tanya AI

🔑 *Akses Bot*
• zac → Dapatkan kode akses
• zact [kode] → Aktivasi akses
• zoff → Hapus akses
• zls → Lihat daftar akses

👑 *Admin Grup*
• zad @user → Jadikan admin
• zdm @user → Turunkan admin
• zds [teks] → Ubah deskripsi
• zft (foto) → Ganti foto grup
• zlk → Hanya admin bisa chat
• zop → Semua bisa chat

📜 *Info*
• zmn → Lihat menu ini
`;

function saveAuthorized() {
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(authorized, null, 2), "utf-8");
}

function normalizeNumber(num) {
  return num.replace(/\D/g, "");
}

function hasAccess(num) {
  const plain = normalizeNumber(num);
  const alt = plain.startsWith("62") ? "0" + plain.slice(2) : "62" + plain.slice(1);
  return (
    SUPER_ADMINS.includes(plain) ||
    SUPER_ADMINS.includes(alt) ||
    authorized.includes(plain) ||
    authorized.includes(alt)
  );
}

client.on("message", async (message) => {
  const chat = await message.getChat();
  if (!chat.isGroup) return;

  let senderNumber =
    message.fromMe
      ? client.info.wid.user
      : (message.author || message.from).split("@")[0];
  senderNumber = senderNumber.replace(/\D/g, "");

  const args = message.body.trim().split(" ");
  const command = args[0].toLowerCase();

  // menu
  if (command === "zmn") return message.reply(helpText);

  // akses
  if (command === "zac") {
    if (authorized.includes(senderNumber))
      return message.reply("✅ Kamu sudah punya akses!");
    if (authorized.length >= MAX_ACCESS)
      return message.reply("❌ Kuota akses penuh.");
    const code = "ACCESS-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await message.reply(
      `🔐 *Kode Akses Unikmu:*\n${code}\n\nKetik: zact ${code} untuk aktivasi.`
    );
    return;
  }

  if (command === "zact") {
    const code = args[1];
    if (!code) return message.reply("❌ Gunakan: zact [kode]");
    if (authorized.includes(senderNumber))
      return message.reply("✅ Akses sudah aktif!");
    if (!code.startsWith("ACCESS-")) return message.reply("❌ Kode tidak valid.");
    authorized.push(senderNumber);
    saveAuthorized();
    return message.reply("✅ Akses berhasil diaktifkan!");
  }

  if (command === "zoff") {
    if (!authorized.includes(senderNumber))
      return message.reply("❌ Kamu belum punya akses.");
    authorized = authorized.filter((n) => n !== senderNumber);
    saveAuthorized();
    return message.reply("✅ Aksesmu sudah dihapus.");
  }

  if (command === "zls") {
    const list =
      authorized.length > 0
        ? authorized.map((id, i) => `${i + 1}. @${id}`).join("\n")
        : "Belum ada pengguna terdaftar.";
    return message.reply(`📋 *Daftar Akses:*\n${list}`);
  }

  // admin tools
  if (["zad", "zdm", "zkc", "zds", "zft", "zlk", "zop"].includes(command)) {
    const botIsAdmin = chat.participants.find(
      (p) => p.id._serialized === client.info.wid._serialized
    )?.isAdmin;
    if (!botIsAdmin) return message.reply("❌ Bot harus admin!");
    if (!hasAccess(senderNumber))
      return message.reply("❌ Kamu tidak punya akses!");
  }

  if (command === "zad") {
    if (!message.mentionedIds.length) return message.reply("❌ Mention anggota!");
    await chat.promoteParticipants(message.mentionedIds);
    return message.reply("✅ Berhasil dijadikan admin!");
  }

  if (command === "zdm") {
    if (!message.mentionedIds.length) return message.reply("❌ Mention admin!");
    await chat.demoteParticipants(message.mentionedIds);
    return message.reply("✅ Admin diturunkan!");
  }

  if (command === "zkc") {
    if (!message.mentionedIds.length) return message.reply("❌ Mention anggota!");
    await chat.removeParticipants(message.mentionedIds);
    return message.reply("✅ Anggota dikick!");
  }

  if (command === "zds") {
    const newDesc = message.body.slice(4).trim();
    if (!newDesc) return message.reply("❌ Gunakan: zds [teks]");
    await chat.setDescription(newDesc);
    return message.reply("✅ Deskripsi diubah!");
  }

  if (command === "zft") {
    if (!message.hasMedia) return message.reply("❌ Kirim gambar dengan caption: zft");
    const media = await message.downloadMedia();
    await chat.setPicture(media);
    return message.reply("✅ Foto grup diganti!");
  }

  if (command === "zlk") {
    await chat.setMessagesAdminsOnly(true);
    return message.reply("🔒 Sekarang hanya admin bisa chat!");
  }

  if (command === "zop") {
    await chat.setMessagesAdminsOnly(false);
    return message.reply("🔓 Semua anggota bisa chat lagi!");
  }

  // trigger zippy
  if (message.body.toLowerCase().startsWith(TRIGGER.toLowerCase())) {
    const prompt = message.body.slice(TRIGGER.length).trim() || "Hai!";
    if (!hasAccess(senderNumber))
      return message.reply("❌ Kamu belum punya akses! Ketik `zac` untuk dapatkan kode.");
    const reply = await getGeminiResponse(prompt);
    await message.reply(reply);
  }
});

client.initialize();
