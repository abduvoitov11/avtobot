import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { chromium } from 'playwright';

// ======== Configuration ========

// It is strongly recommended to set these via environment variables in production.
const BOT_TOKEN = process.env.BOT_TOKEN || '8375587042:AAEQ5gKtZqJ-dSy39nV2eOwnaVd76772yQ';
const ADMIN_ID = Number(process.env.ADMIN_ID) || 6291811673;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/emaktab_bot';
const LOGIN_URL = 'https://login.emaktab.uz/';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required. Set it in your environment variables.');
  process.exit(1);
}

// ======== MongoDB Setup ========

await mongoose.connect(MONGODB_URI, {
  autoIndex: true
});

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

// Simple in-memory conversational state for the admin
const adminState = new Map(); // key: adminId, value: { mode, temp }

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
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let buffer = null;

  try {
    const page = await browser.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });

    await page.fill('input[name="login"]', account.login);
    await page.fill('input[name="password"]', account.password);

    // Click the "Tizimga kirish" button
    await Promise.all([
      page.click('button[type="submit"], text=Tizimga kirish'),
      // Do not await navigation; we must wait exactly 3 seconds
    ]);

    // Wait exactly 3 seconds after clicking
    await page.waitForTimeout(3000);

    // Take full-page screenshot
    buffer = await page.screenshot({ fullPage: true });
  } catch (err) {
    console.error(`Error capturing screenshot for ${account.name} (${account.login}):`, err);
  } finally {
    await browser.close();
  }

  return buffer;
}

async function runScreenshotsForAllAccounts() {
  console.log('Starting scheduled screenshot task...');
  const accounts = await Account.find({});

  for (const account of accounts) {
    const buffer = await captureDashboardScreenshot(account);
    if (!buffer) {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `⚠️ ${account.name} (${account.login}) uchun skrinshot olishda xatolik yuz berdi.`
      );
      continue;
    }

    await bot.telegram.sendPhoto(
      ADMIN_ID,
      { source: buffer },
      {
        caption: `📸 eMaktab skrinshoti\n👤 ${account.name}\n🔐 Login: ${account.login}`
      }
    );
  }

  console.log('Scheduled screenshot task finished.');
}

// ======== Cron Scheduling ========

// Every day at 07:45 AM Tashkent time
cron.schedule(
  '45 7 * * *',
  () => {
    runScreenshotsForAllAccounts().catch((err) => {
      console.error('Error in scheduled task:', err);
    });
  },
  {
    timezone: 'Asia/Tashkent'
  }
);

// ======== Bot Commands & Handlers ========

bot.start(async (ctx) => {
  await ctx.reply(
    'Assalomu alaykum! eMaktab avto-skrinshot botiga xush kelibsiz.',
    mainKeyboard()
  );
});

bot.hears('➕ Add Account', async (ctx) => {
  if (!ensureAdmin(ctx)) return;

  adminState.set(ctx.from.id, { mode: 'ADDING_NAME', temp: {} });
  await ctx.reply('➕ Yangi akkaunt qo‘shish.\nIltimos, o‘quvchi ismini yuboring:');
});

bot.hears('🗑 Delete account', async (ctx) => {
  if (!ensureAdmin(ctx)) return;

  const accounts = await Account.find({}).sort({ name: 1 });
  if (!accounts.length) {
    await ctx.reply('Bazadan hech qanday akkaunt topilmadi.', mainKeyboard());
    return;
  }

  let msg = '🗑 Qaysi akkauntni o‘chirmoqchisiz?\nIsmini yoki loginini yuboring.\n\nMavjud akkauntlar:\n';
  msg += accounts.map((a) => `• ${a.name} (${a.login})`).join('\n');

  adminState.set(ctx.from.id, { mode: 'DELETING', temp: {} });
  await ctx.reply(msg);
});

bot.hears('📋 List accounts', async (ctx) => {
  if (!ensureAdmin(ctx)) return;

  const accounts = await Account.find({}).sort({ name: 1 });
  if (!accounts.length) {
    await ctx.reply('Bazadan hech qanday akkaunt topilmadi.', mainKeyboard());
    return;
  }

  const msg =
    '📋 Akkauntlar ro‘yxati:\n' +
    accounts.map((a) => `• ${a.name} (${a.login})`).join('\n');

  await ctx.reply(msg, mainKeyboard());
});

// Generic text handler for multi-step admin flows
bot.on('text', async (ctx) => {
  const fromId = ctx.from?.id;
  if (fromId !== ADMIN_ID) {
    // Non-admins can only use /start and see the menu; ignore other texts
    return;
  }

  const state = adminState.get(fromId);
  if (!state) return; // nothing in progress

  const text = ctx.message.text.trim();

  if (state.mode === 'ADDING_NAME') {
    state.temp.name = text;
    state.mode = 'ADDING_LOGIN';
    adminState.set(fromId, state);
    await ctx.reply('🔐 Endi loginni yuboring:');
    return;
  }

  if (state.mode === 'ADDING_LOGIN') {
    state.temp.login = text;
    state.mode = 'ADDING_PASSWORD';
    adminState.set(fromId, state);
    await ctx.reply('🔑 Endi parolni yuboring:');
    return;
  }

  if (state.mode === 'ADDING_PASSWORD') {
    state.temp.password = text;

    try {
      const account = new Account({
        name: state.temp.name,
        login: state.temp.login,
        password: state.temp.password
      });
      await account.save();

      await ctx.reply(
        `✅ Akkaunt qo‘shildi:\n👤 ${account.name}\n🔐 Login: ${account.login}`,
        mainKeyboard()
      );
    } catch (err) {
      console.error('Error saving account:', err);
      if (err.code === 11000) {
        await ctx.reply(
          '❌ Bu login bilan akkaunt allaqachon mavjud. Iltimos, boshqa login kiriting.',
          mainKeyboard()
        );
      } else {
        await ctx.reply('❌ Akkauntni saqlashda xatolik yuz berdi.', mainKeyboard());
      }
    } finally {
      adminState.delete(fromId);
    }

    return;
  }

  if (state.mode === 'DELETING') {
    const query = text;
    const account = await Account.findOne({
      $or: [{ name: query }, { login: query }]
    });

    if (!account) {
      await ctx.reply(
        '❌ Bu nom yoki login bo‘yicha akkaunt topilmadi. Qaytadan urinib ko‘ring yoki /start bosing.',
        mainKeyboard()
      );
      adminState.delete(fromId);
      return;
    }

    await Account.deleteOne({ _id: account._id });
    await ctx.reply(
      `✅ Akkaunt o‘chirildi:\n👤 ${account.name}\n🔐 Login: ${account.login}`,
      mainKeyboard()
    );
    adminState.delete(fromId);
    return;
  }
});

// ======== Graceful Shutdown ========

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`Received ${signal}. Shutting down gracefully...`);

  try {
    await bot.stop(signal);
  } catch (err) {
    console.error('Error stopping bot:', err);
  }

  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed.');
  } catch (err) {
    console.error('Error closing MongoDB connection:', err);
  }

  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// ======== Start Bot (Long Polling) ========

bot
  .launch()
  .then(() => {
    console.log('Bot started successfully.');
  })
  .catch((err) => {
    console.error('Failed to launch bot:', err);
    process.exit(1);
  });

