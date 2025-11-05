import express from "express";
import qrcode from "qrcode-terminal";
import fs from "fs";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

// ===== CONFIG =====
const TRIGGER = "!query";
const MODELS = ["gemini-2.0-flash-exp", "gemini-2.0-flash", "gemini-1.5-pro"];
const MAX_ACCESS = 5;
const ACCESS_FILE = "./authorized.json";
const SUPER_ADMINS = ["085764565028", "6285764565028"];

// ===== FILE AKSES PERMANEN =====
if (!fs.existsSync(ACCESS_FILE)) fs.writeFileSync(ACCESS_FILE, "[]", "utf-8");
let authorized = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf-8"));

// ===== QR LOGIN WHATSAPP =====
const client = new Client({
  authStrategy: new LocalAuth(),
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("📱 Scan QR code di WhatsApp untuk login.");
});

client.on("ready", () => {
  console.log("🤖 WhatsApp Bot siap digunakan di semua grup!");
});

// ===== GEMINI =====
async function getGeminiResponse(prompt) {
  const baseInstruction = `
Kamu adalah *Sahroni*, asisten AI yang dibuat oleh *Idad*.
Berperilakulah sopan, ramah, dan komunikatif.
Jika seseorang bertanya "kamu siapa" atau "siapa kamu",
jawablah dengan: "Aku Sahroni, AI buatan Idad 😊".
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
      console.error(`❌ Gagal dengan model ${modelName}:`, err.message);
    }
  }
  return "❌ Semua model gagal (server sibuk atau kunci API salah). Coba lagi nanti.";
}

// ===== HELP TEXT =====
const helpText = `
🧠 *Daftar Perintah Bot AI (Sahroni)*
━━━━━━━━━━━━━━━
📚 *AI & Info*
• \`!query [teks]\` → Tanya AI (Gemini)
• \`!help\` → Menampilkan daftar perintah

🔒 *Akses Bot*
• \`!akses\` → Dapatkan ID akses (permanen)
• \`!aktivasi [kode]\` → Aktivasi akses dengan kode
• \`!accesslist\` → Lihat daftar akses

👑 *Admin Group*
• \`!admin @user\` → Jadikan admin
• \`!demote @user\` → Turunkan jadi member
• \`!desc [teks]\` → Ubah deskripsi grup
• \`!foto\` + gambar → Ubah foto grup
• \`!adminonly\` → Hanya admin bisa chat
• \`!all\` → Semua anggota bisa chat

━━━━━━━━━━━━━━━
🤖 _Aku Sahroni, AI buatan Idad yang siap bantu grupmu!_
`;

// ===== UTILITY =====
function saveAuthorized() {
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(authorized, null, 2), "utf-8");
}

function normalizeNumber(num) {
  return num.replace(/\D/g, "");
}

function hasAccess(num) {
  const plain = normalizeNumber(num);
  const alt = plain.startsWith("62")
    ? "0" + plain.slice(2)
    : "62" + plain.slice(1);
  return (
    SUPER_ADMINS.includes(plain) ||
    SUPER_ADMINS.includes(alt) ||
    authorized.includes(plain) ||
    authorized.includes(alt)
  );
}

// ===== HANDLER PESAN =====
client.on("message", async (message) => {
  const chat = await message.getChat();
  if (!chat.isGroup) return;

  const sender = message.author || message.from;
  const senderNumber = sender.replace("@c.us", "");
  const args = message.body.trim().split(" ");
  const command = args[0].toLowerCase();

  // === !help ===
  if (command === "!help") return message.reply(helpText);

  // === !akses ===
  if (command === "!akses") {
    if (authorized.includes(senderNumber))
      return message.reply("✅ Kamu sudah punya akses permanen!");

    if (authorized.length >= MAX_ACCESS)
      return message.reply("❌ Batas akses penuh sudah tercapai (maks 5 orang).");

    // Buat kode unik (simulasi QR)
    const code = "ACCESS-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    await message.reply(
      `🔐 *Kode Akses Unikmu:*\n${code}\n\nKirim balik dengan perintah:\n\`!aktivasi ${code}\`\nUntuk mengaktifkan akses permanen.`
    );
    message._accessCode = code;
    return;
  }

  // === !aktivasi [kode] ===
  if (command === "!aktivasi") {
    const code = args[1];
    if (!code) return message.reply("❌ Gunakan: !aktivasi [kode]");
    if (authorized.includes(senderNumber))
      return message.reply("✅ Kamu sudah punya akses permanen!");

    if (authorized.length >= MAX_ACCESS)
      return message.reply("❌ Batas akses penuh sudah tercapai (maks 5 orang).");

    if (!code.startsWith("ACCESS-"))
      return message.reply("❌ Kode akses tidak valid.");

    authorized.push(senderNumber);
    saveAuthorized();
    return message.reply("✅ Akses permanen berhasil diaktifkan! 🎉");
  }

  // === !remove ===
  if (command === "!remove") {
    if (!authorized.includes(senderNumber))
      return message.reply("❌ Kamu belum punya akses untuk dihapus.");
    authorized = authorized.filter((n) => n !== senderNumber);
    saveAuthorized();
    return message.reply("✅ Aksesmu telah dihapus. Kamu bisa daftar lagi kapan pun dengan !akses");
  }

  // === !accesslist ===
  if (command === "!accesslist") {
      const list =
        authorized.length > 0
          ? authorized.map((id, i) => `${i + 1}. @${id}`).join("\n")
          : "Belum ada yang punya akses.";
      return message.reply(`📋 *Daftar Akses Bot:*\n${list}`);
    }

    if (command === "!accesslist") {
    const accessList = readAccess();
    if (accessList.length === 0) {
      return message.reply("📋 Belum ada pengguna dengan akses permanen.");
    }
    const listText = accessList.map((no, i) => `${i + 1}. ${no}`).join("\n");
    return message.reply(`📋 Daftar pengguna dengan akses permanen:\n${listText}`);
  }

  // ===== CEK AKSES SEBELUM COMMAND PENTING =====
  if (["!admin", "!demote", "!kick", "!desc", "!foto", "!adminonly", "!all"].includes(command)) {
    const botIsAdmin = chat.participants.find(
      (p) => p.id._serialized === client.info.wid._serialized
    )?.isAdmin;

    if (!botIsAdmin) return message.reply("❌ Bot harus admin!");
    if (!hasAccess(senderNumber))
      return message.reply("❌ Kamu tidak punya akses untuk perintah ini!");
  }

  // ===== ADMIN COMMANDS =====
  if (command === "!admin") {
    if (!message.mentionedIds.length)
      return message.reply("❌ Mention anggota!");
    await chat.promoteParticipants(message.mentionedIds);
    return message.reply("✅ Berhasil dijadikan admin!");
  }

  if (command === "!demote") {
    if (!message.mentionedIds.length)
      return message.reply("❌ Mention admin!");
    await chat.demoteParticipants(message.mentionedIds);
    return message.reply("✅ Admin diturunkan jadi member!");
  }

  if (command === "!kick") {
    if (!message.mentionedIds.length)
      return message.reply("❌ Mention anggota!");
    await chat.removeParticipants(message.mentionedIds);
    return message.reply("✅ Anggota berhasil di-kick!");
  }

  if (command === "!desc") {
    const newDesc = message.body.slice(6).trim();
    if (!newDesc) return message.reply("❌ Gunakan: !desc [teks]");
    await chat.setDescription(newDesc);
    return message.reply("✅ Deskripsi grup diubah!");
  }

  if (command === "!foto") {
    if (!message.hasMedia)
      return message.reply("❌ Kirim gambar dengan caption: !foto");
    const media = await message.downloadMedia();
    await chat.setPicture(media);
    return message.reply("✅ Foto grup diubah!");
  }

  if (command === "!adminonly") {
    await chat.setMessagesAdminsOnly(true);
    return message.reply("✅ Sekarang hanya admin yang bisa kirim pesan!");
  }

  if (command === "!all") {
    await chat.setMessagesAdminsOnly(false);
    return message.reply("✅ Semua anggota bisa chat lagi!");
  }

  // ===== QUERY AI =====
  if (command === TRIGGER) {
    const prompt = message.body.slice(TRIGGER.length).trim() || "Hai!";
    if (!hasAccess(senderNumber))
      return message.reply("❌ Kamu belum punya akses! Kirim `!akses` untuk mendapatkannya.");
    const reply = await getGeminiResponse(prompt);
    await message.reply(reply);
  }
});

client.initialize();
