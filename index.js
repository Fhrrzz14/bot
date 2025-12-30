import express from "express";
import qrcode from "qrcode-terminal";
import fs from "fs";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const TRIGGER = "zippy"; 
const MODELS_FILE = "./models.json";
let MODELS = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-flash-latest"];
const MAX_ACCESS = 5;

// load persisted models if available
if (fs.existsSync(MODELS_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(MODELS_FILE, "utf-8"));
    if (Array.isArray(data) && data.length) MODELS = data;
  } catch (e) {
    console.warn("⚠️ Gagal membaca models.json, menggunakan daftar bawaan.", e.message || e);
  }
} else {
  try { fs.writeFileSync(MODELS_FILE, JSON.stringify(MODELS, null, 2), "utf-8"); } catch (e) {}
}

function saveModels() {
  try { fs.writeFileSync(MODELS_FILE, JSON.stringify(MODELS, null, 2), "utf-8"); } catch (e) { console.error("❌ Gagal menyimpan models.json:", e.message || e); }
}

// in-memory map for temporarily disabled models (modelName -> epochMs)
const disabledModels = {}; 
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

async function parseRetrySeconds(err) {
  try {
    const m1 = (err.message || "").match(/retry.*?in\s*([\d.]+)s/i);
    if (m1) return parseFloat(m1[1]);
    const m2 = (err.message || "").match(/retryDelay\"\s*:\s*\"?(\d+)s\"?/i);
    if (m2) return parseInt(m2[1], 10);
  } catch (e) { }
  // fallback null
  return null;
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function getGeminiResponse(prompt) {
  const baseInstruction = `
Kamu adalah *Zippy*, AI yang sopan dan santai.
Jika seseorang tanya "siapa kamu", jawab: "Aku Zippy, teman ngobrolmu 😄".
Gunakan bahasa Indonesia yang ringan, ramah, dan tidak kaku.
Jangan pernah menyebut AI, Gemini, atau Google.
`;
  const fullPrompt = `${baseInstruction}\n\nPertanyaan pengguna: ${prompt}`;

  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000; // initial backoff

  for (let idx = 0; idx < MODELS.length; idx++) {
    const modelName = MODELS[idx];

    // skip temporarily disabled models
    const disabledUntil = disabledModels[modelName];
    if (disabledUntil && disabledUntil > Date.now()) {
      console.warn(`⚠️ Skipping disabled model ${modelName} until ${new Date(disabledUntil).toISOString()}`);
      continue;
    } else if (disabledUntil) {
      // expired
      delete disabledModels[modelName];
    }

    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: modelName });

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const result = await model.generateContent(fullPrompt);
          const text = result.response.text();
          if (text && text.trim()) return text;
          // if empty response, stop retrying this model
          break;
        } catch (err) {
          const msg = err.message || "";

          // Rate limited -> respect RetryInfo or exponential backoff
          if (/429|Too Many Requests/i.test(msg) || /quota/i.test(msg)) {
            const waitSec = (await parseRetrySeconds(err)) || (Math.pow(2, attempt) * (BASE_BACKOFF_MS / 1000));
            const waitMs = Math.ceil(waitSec * 1000);
            // If retry delay is long, disable model temporarily and move to next
            if (waitSec > 10) {
              disabledModels[modelName] = Date.now() + waitMs;
              console.warn(`⚠️ Rate limited on ${modelName}; disabling it for ${Math.ceil(waitMs/1000)}s and moving to next model.`);
              break; // move to next model
            } else {
              console.warn(`⚠️ Rate limited on ${modelName}, retrying after ${waitMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
              await sleep(waitMs);
              continue; // retry same model
            }
          }

          // Model not found / unsupported for generateContent
          if (/404|not found|not supported/i.test(msg)) {
            console.warn(`⚠️ Model ${modelName} not found or unsupported for generateContent, skipping it.`);
            break; // stop retries for this model and move to next
          }

          // Other errors -> log and stop retrying this model
          console.error(`❌ Error using model ${modelName}:`, err.message || err);
          break;
        }
      }
    } catch (err) {
      console.error(`❌ Gagal model ${modelName}:`, err.message || err);
    }
  }

  return "⚠️ Maaf, aku lagi sibuk nih dan layanan AI sedang terbatas. Jika masalah berlanjut, periksa kunci API / kuota pada project Google Cloud kamu.";
}

// List available models (tries SDK then falls back to public ListModels endpoint)
async function listAvailableModels() {
  try {
    const gen = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    if (typeof gen.listModels === 'function') {
      const res = await gen.listModels();
      return res?.models || [];
    }
  } catch (e) {
    console.warn('⚠️ listModels SDK failed:', e.message || e);
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    return json.models || [];
  } catch (e) {
    console.error('❌ listModels fallback failed:', e.message || e);
  }
  return [];
}

async function testModel(modelName) {
  try {
    const gen = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = gen.getGenerativeModel({ model: modelName });
    const res = await model.generateContent('Tes singkat untuk mengecek model, tolong jawab singkat ya.');
    const text = res?.response?.text?.();
    return { ok: true, text: text || '(no text)' };
  } catch (e) {
    return { ok: false, error: e.message || e.toString() };
  }
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

function isSuperAdmin(num) {
  const plain = normalizeNumber(num);
  const alt = plain.startsWith("62") ? "0" + plain.slice(2) : "62" + plain.slice(1);
  return (
    SUPER_ADMINS.includes(plain) ||
    SUPER_ADMINS.includes(alt) ||
    authorized.includes(plain) ||
    authorized.includes(alt)
  );
}

function hasAccess(num) {
  const plain = normalizeNumber(num);
  const alt = plain.startsWith("62") ? "0" + plain.slice(2) : "62" + plain.slice(1);
  return (
    isSuperAdmin(plain) ||
    isSuperAdmin(alt) ||
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
  if (["zad", "zdm", "zkc", "zds", "zft", "zlk", "zop", "zall"].includes(command)) {
    const botIsAdmin = chat.participants.find(
      (p) => p.id._serialized === client.info.wid._serialized
    )?.isAdmin;
    if (!botIsAdmin) return message.reply("❌ Bot harus admin!");
    if (!hasAccess(senderNumber))
      return message.reply("❌ Kamu tidak punya akses!");
  }

  if (command === "zad") {
      if (!message.mentionedIds.length) return message.reply("❌ Mention anggota!");
      try {
        // Pastikan ID memiliki format @c.us atau @g.us
        await chat.promoteParticipants(message.mentionedIds);
        return message.reply("✅ Berhasil dijadikan admin!");
      } catch (err) {
        console.error(err);
        return message.reply("❌ Gagal menjadikan admin. Pastikan bot adalah admin!");
      }
    }

    if (command === "zdm") {
      if (!message.mentionedIds.length) return message.reply("❌ Mention admin!");
      try {
        await chat.demoteParticipants(message.mentionedIds);
        return message.reply("✅ Admin diturunkan!");
      } catch (err) {
        console.error(err);
        return message.reply("❌ Gagal menurunkan admin!");
      }
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

  // mention all (admin only)
  if (command === "zall") {
    // teks custom setelah perintah (opsional)
    const customText = message.body.slice(4).trim();

    // dapatkan daftar participant ids
    const participantIds = (chat.participants || []).map((p) => {
      if (!p) return null;
      if (p.id && p.id._serialized) return p.id._serialized;
      if (p._serialized) return p._serialized;
      return null;
    }).filter(Boolean);

    console.log("🔔 zall triggered, participants count:", participantIds.length);

    if (participantIds.length === 0) return message.reply("❌ Tidak ada anggota untuk disebut.");

    // filter: hanya anggota (lewati bot sendiri)
    const mentionIds = participantIds.filter((id) => {
      if (client.info && client.info.wid && id === client.info.wid._serialized) return false;
      return Boolean(id && typeof id === 'string');
    });

    if (mentionIds.length === 0) return message.reply("❌ Tidak ada anggota untuk disebut.");

    // bangun pesan dengan @nomor untuk visual mention
    const mentionTexts = mentionIds.map((id) => {
      const num = id.split('@')[0];
      return `@${num}`;
    });

    const suffix = customText ? " " + customText : "";
    const MAX_MENTIONS = 50;

    if (mentionIds.length > MAX_MENTIONS) {l
      // batch jika anggota banyak
      for (let i = 0; i < mentionIds.length; i += MAX_MENTIONS) {
        const idBatch = mentionIds.slice(i, i + MAX_MENTIONS);
        const textBatch = mentionTexts.slice(i, i + MAX_MENTIONS).join(" ");
        const fullMsg = textBatch + suffix;
        await client.sendMessage(chat.id._serialized, fullMsg, { mentions: idBatch });
      }
    } else {
      // satu pesan jika anggota tidak banyak
      const fullMsg = mentionTexts.join(" ") + suffix;
      await client.sendMessage(chat.id._serialized, fullMsg, { mentions: mentionIds });
    }

    console.log(`✅ Mention sent to ${mentionIds.length} members`);
    return;
  }

  // model management (super-admin only)
  if (command === "zmodel") {
    if (!isSuperAdmin(senderNumber))
      return message.reply("❌ Hanya super admin yang bisa mengelola model.");
    const sub = args[1] && args[1].toLowerCase();
    if (!sub || sub === "list") {
      const list = MODELS.map((m, i) => {
        const d = disabledModels[m];
        const note = d && d > Date.now() ? ` (disabled until ${new Date(d).toLocaleString()})` : "";
        return `${i + 1}. ${m}${note}`;
      }).join("\n") || "(tidak ada model)";
      return message.reply(`📋 *Daftar Model:*\n${list}`);
    }
    if (sub === "add") {
      const model = args[2];
      if (!model) return message.reply("❌ Gunakan: zmodel add [modelName]");
      if (MODELS.includes(model)) return message.reply("✅ Model sudah ada.");
      MODELS.push(model);
      saveModels();
      return message.reply(`✅ Menambahkan model: ${model}`);
    }
    if (sub === "remove") {
      const model = args[2];
      if (!model) return message.reply("❌ Gunakan: zmodel remove [modelName]");
      MODELS = MODELS.filter(m => m !== model);
      saveModels();
      return message.reply(`✅ Menghapus model: ${model}`);
    }
    if (sub === "set") {
      const rest = message.body.slice(message.body.indexOf("set") + 3).trim();
      const newArr = rest.split(",").map(s => s.trim()).filter(Boolean);
      if (!newArr.length) return message.reply("❌ Gunakan: zmodel set model1,model2,...");
      MODELS = newArr;
      saveModels();
      return message.reply(`✅ Model di-set: ${MODELS.join(", ")}`);
    }

    if (sub === "test") {
      const model = args[2];
      if (!model) return message.reply("❌ Gunakan: zmodel test [modelName]");
      await message.reply(`🔬 Menguji model: ${model} ...`);
      const res = await testModel(model);
      if (res.ok) {
        const snippet = res.text.length > 800 ? res.text.slice(0,800) + '...' : res.text;
        return message.reply(`✅ Model OK. Respon:\n${snippet}`);
      } else {
        return message.reply(`❌ Gagal: ${res.error}`);
      }
    }

    if (sub === "status") {
      const disabled = Object.keys(disabledModels).map(m => {
        const until = new Date(disabledModels[m]).toLocaleString();
        return `${m} (disabled until ${until})`;
      }).join("\n") || "(tidak ada yang dinonaktifkan)";
      await message.reply(`🔧 Disabled models:\n${disabled}`);
      const avail = await listAvailableModels();
      const genModels = (avail || []).filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')).slice(0,10);
      const list = genModels.map(m => m.name).join('\n') || '(tidak ada model generateContent ditemukan)';
      return message.reply(`📡 Models that support generateContent (sample):\n${list}`);
    }

    return message.reply("❌ Perintah tidak dikenali. Gunakan: zmodel [list|add|remove|set|test|status]");
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
