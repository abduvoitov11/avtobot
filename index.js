import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { chromium } from 'playwright';

// ======== Configuration ========

// Railway Variables bo'limidan olinadi
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
// Railway MongoDB URL o'zgaruvchisini avtomatik aniqlash
const MONGODB_URI = process.env.MONGODB_URL || process.env.MONGO_URL;
const LOGIN_URL = 'https://login.emaktab.uz/';

if (!BOT_TOKEN || !MONGODB_URI) {
  console.error('❌ XATO: BOT_TOKEN yoki MONGODB_URI topilmadi. Railway Variables sozlamalarini tekshiring!');
  process.exit(1);
}

// ======== MongoDB Setup ========

try {
  await mongoose.connect(MONGODB_URI, {
    autoIndex: true
  });
  console.log('✅ MongoDB-ga muvaffaqiyatli ulandik.');
} catch (err) {
  console.error('❌ MongoDB ulanishida xato:', err);
}

const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    login: { type: String, required: true, unique: true },
    password: { type: String, required: true }
  },
  { timestamps: true }
);

const Account = mongoose.model('Account', accountSchema);

// ======== Bot Setup ========

const bot = new Telegraf(BOT_TOKEN);

// Admin holatlarini saqlash
const adminState = new Map();

function ensureAdmin(ctx) {
  const fromId = ctx.from?.id;
  if (fromId !== ADMIN_ID) {
    ctx.reply('❌ Sizda bu amalni bajarish huquqi yo‘q.');
    return false;
  }
  return true;
}

function mainKeyboard() {
  return Markup.keyboard([
    ['➕ Add Account', '🗑 Delete account'],
    ['📋 List accounts']
  ]).resize();
}

// ======== Playwright Automation ========

async function captureDashboardScreenshot(account) {
  // Docker muhitida brauzerni ishga tushirish uchun maxsus argumentlar
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  let buffer = null;

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Login sahifasiga o'tish
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

    // Formalarni to'ldirish
    await page.fill('input[name="login"]', account.login);
    await page.fill('input[name="password"]', account.password);

    // Kirish tugmasini bosish va kutish
    await page.click('button[type="submit"], text=Tizimga kirish');
    
    // Kirgandan keyin ma'lumotlar yuklanishi uchun 5 soniya kutish
    await page.waitForTimeout(5000);

    // Skrinshot olish
    buffer = await page.screenshot({ fullPage: true });
    console.log(`📸 Skrinshot olindi: ${account.name}`);
  } catch (err) {
    console.error(`❌ Xatolik (${account.login}):`, err.message);
  } finally {
    await browser.close();
  }

  return buffer;
}

async function runScreenshotsForAllAccounts() {
  console.log('🚀 Rejali vazifa boshlandi...');
  const accounts = await Account.find({});

  for (const account of accounts) {
    const buffer = await captureDashboardScreenshot(account);
    if (!buffer) {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `⚠️ ${account.name} (${account.login}) uchun skrinshot olish imkonsiz bo'ldi.`
      );
      continue;
    }

    await bot.telegram.sendPhoto(
      ADMIN_ID,
      { source: buffer },
      {
        caption: `📸 eMaktab hisoboti\n👤 Ism: ${account.name}\n🔐 Login: ${account.login}`
      }
    );
  }
}

// ======== Cron Scheduling ========

// Har kuni 07:45 da (Toshkent vaqti bilan)
cron.schedule(
  '45 7 * * *',
  () => {
    runScreenshotsForAllAccounts().catch((err) => {
      console.error('Cron xatosi:', err);
    });
  },
  { timezone: 'Asia/Tashkent' }
);

// ======== Handlers ========

bot.start((ctx) => ctx.reply('Assalomu alaykum! eMaktab botiga xush kelibsiz.', mainKeyboard()));

bot.hears('➕ Add Account', (ctx) => {
  if (!ensureAdmin(ctx)) return;
  adminState.set(ctx.from.id, { mode: 'ADDING_NAME', temp: {} });
  ctx.reply('👤 O‘quvchi ismini yuboring:');
});

bot.hears('📋 List accounts', async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  const accounts = await Account.find({}).sort({ name: 1 });
  if (!accounts.length) return ctx.reply('Baza bo‘sh.');
  const list = accounts.map(a => `• ${a.name} (${a.login})`).join('\n');
  ctx.reply(`📋 Ro‘yxat:\n${list}`);
});

bot.hears('🗑 Delete account', async (ctx) => {
  if (!ensureAdmin(ctx)) return;
  adminState.set(ctx.from.id, { mode: 'DELETING' });
  ctx.reply('🗑 O‘chirmoqchi bo‘lgan akkaunt loginini yuboring:');
});

bot.on('text', async (ctx) => {
  const fromId = ctx.from?.id;
  if (fromId !== ADMIN_ID) return;

  const state = adminState.get(fromId);
  if (!state) return;

  const text = ctx.message.text.trim();

  if (state.mode === 'ADDING_NAME') {
    state.temp.name = text;
    state.mode = 'ADDING_LOGIN';
    ctx.reply('🔐 Loginni yuboring:');
  } else if (state.mode === 'ADDING_LOGIN') {
    state.temp.login = text;
    state.mode = 'ADDING_PASSWORD';
    ctx.reply('🔑 Parolni yuboring:');
  } else if (state.mode === 'ADDING_PASSWORD') {
    try {
      await Account.create({ ...state.temp, password: text });
      ctx.reply('✅ Saqlandi!', mainKeyboard());
    } catch (e) {
      ctx.reply('❌ Xato (login band bo‘lishi mumkin).');
    }
    adminState.delete(fromId);
  } else if (state.mode === 'DELETING') {
    const res = await Account.deleteOne({ login: text });
    ctx.reply(res.deletedCount ? '✅ O‘chirildi.' : '❌ Topilmadi.', mainKeyboard());
    adminState.delete(fromId);
  }
});

// ======== Shutdown ========

const closeBases = async () => {
  await mongoose.connection.close();
  console.log('Baza yopildi.');
  process.exit(0);
};

process.once('SIGINT', closeBases);
process.once('SIGTERM', closeBases);

bot.launch().then(() => console.log('🤖 Bot ishga tushdi...'));
