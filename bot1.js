// ============================================
// GIFT TRANSACTOR BOT - CLEAN VERSION
// ============================================
// v2.2 - Fixed all mapping issues
// 
// REQUIRED ENVIRONMENT VARIABLES:
// - GIFT_BOT_TOKEN=your_bot_token
// - PRIZE_STORE_URL=https://your-prize-store.up.railway.app
// - LOG_CHAT_ID=your_telegram_group_id (optional)
// - GIFT_LOG_TOPIC_ID=5 (optional)

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');

// ============================================
// CONFIGURATION
// ============================================

const GIFT_BOT_TOKEN = process.env.GIFT_BOT_TOKEN;
const PRIZE_STORE_URL = process.env.PRIZE_STORE_URL;
const HTTP_PORT = process.env.PORT || process.env.GIFT_BOT_PORT || 3001;

// Telegram Group Logging Configuration
const LOG_CHAT_ID = process.env.LOG_CHAT_ID;
const GIFT_LOG_TOPIC_ID = process.env.GIFT_LOG_TOPIC_ID || 5;

if (!GIFT_BOT_TOKEN) {
  console.error('❌ GIFT_BOT_TOKEN is required!');
  process.exit(1);
}

if (!PRIZE_STORE_URL) {
  console.error('❌ PRIZE_STORE_URL is required!');
  console.error('   Example: https://your-prize-store.up.railway.');
  process.exit(1);
}

console.log('✅ Prize Store URL:', PRIZE_STORE_URL);
console.log('✅ HTTP Port:', HTTP_PORT);

// ============================================
// GIFT MAPPINGS - TELEGRAM ID TO FRIENDLY NAME
// ============================================

const GIFT_MAPPINGS = {
  // Telegram ID -> Friendly Name & Star Cost
  'd01a849b9ef17642d8f4': { name: 'Heart', stars: 15 },
  'd01a849bfc7f7938aa86': { name: 'Bear', stars: 75 },
  'd01a849b9e2c54fb0cf1': { name: 'Rose', stars: 100 },
  'd01a849ba490ee9e6308': { name: 'Gift', stars: 125 },
  'd01a849bb0e2c9f42a0a': { name: 'Cake', stars: 150 },
  'd01a849b8c2f0cd6de99': { name: 'Rose Bouquet', stars: 200 },
  'd01a849b9c4de7d48c4e': { name: 'Ring', stars: 300 },
  'd01a849b8de88d0e703d': { name: 'Trophy', stars: 500 },
  'd01a849b92670e79adce': { name: 'Diamond', stars: 750 },
  'd01a849b95b3da4d0acb': { name: 'Calendar', stars: 1000 }
};

// Helper function to find gift by Telegram ID
function findGiftByTelegramId(telegramId) {
  return GIFT_MAPPINGS[telegramId] || null;
}

// Helper function to get Telegram ID from friendly name
function getTelegramIdByName(friendlyName) {
  for (const [telegramId, data] of Object.entries(GIFT_MAPPINGS)) {
    if (data.name === friendlyName) {
      return telegramId;
    }
  }
  return null;
}

// ============================================
// STATE
// ============================================

const STATE = {
  botStarBalance: 0,
  statistics: {
    totalGiftsSent: 0,
    totalStarsSpent: 0
  }
};

const bot = new TelegramBot(GIFT_BOT_TOKEN, { polling: true });
const app = express();

app.use((req, res, next) => {
  // Allow requests from your GitHub Pages domain
  res.header('Access-Control-Allow-Origin', 'https://image002.github.io');
  
  // Allow credentials (cookies, authorization headers)
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Allow these methods
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  
  // Allow these headers
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Cache preflight for 24 hours (reduces OPTIONS requests)
  res.header('Access-Control-Max-Age', '86400');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

app.use(express.json());

// ============================================
// LOGGING FUNCTIONS
// ============================================

async function sendGiftLog(message, options = {}) {
  if (!LOG_CHAT_ID) {
    console.warn('⚠️ LOG_CHAT_ID not configured - skipping log');
    return;
  }
  
  try {
    await bot.sendMessage(LOG_CHAT_ID, message, {
      message_thread_id: GIFT_LOG_TOPIC_ID,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    });
  } catch (error) {
    console.error('❌ Error sending gift log to Telegram:', error);
  }
}

async function logSuccessfulClaim(userId, giftName, prizeId, starCost, balanceAfter) {
  const message = `
✅ <b>GIFT CLAIMED SUCCESSFULLY</b>
━━━━━━━━━━━━━━━━━━━━

👤 <b>User ID:</b> <code>${userId}</code>
🎁 <b>Gift:</b> ${giftName}
🆔 <b>Prize ID:</b> <code>${prizeId}</code>
⭐ <b>Stars Spent:</b> ${starCost}
💰 <b>New Balance:</b> ${balanceAfter} stars
📅 <b>Time:</b> ${new Date().toISOString()}

<b>Status:</b> Gift sent via Telegram API
  `.trim();
  
  await sendGiftLog(message);
  console.log('📊 Success logged to Telegram channel');
}

async function logFailedClaim(userId, giftName, prizeId, error) {
  const message = `
❌ <b>GIFT CLAIM FAILED</b>
━━━━━━━━━━━━━━━━━━━━

👤 <b>User ID:</b> <code>${userId}</code>
🎁 <b>Gift:</b> ${giftName}
🆔 <b>Prize ID:</b> <code>${prizeId}</code>
❌ <b>Error:</b> ${error}
📅 <b>Time:</b> ${new Date().toISOString()}

<b>Status:</b> Gift NOT sent - claim failed
  `.trim();
  
  await sendGiftLog(message);
  console.log('📊 Failure logged to Telegram channel');
}

// ============================================
// UPDATE BOT BALANCE
// ============================================

async function updateBotBalance() {
  try {
    const balance = await bot.getStarTransactions();
    
    let totalStars = 0;
    if (balance && balance.transactions) {
      balance.transactions.forEach(tx => {
        if (tx.source === 'user') {
          totalStars += tx.amount;
        } else if (tx.source === 'fragment') {
          totalStars -= tx.amount;
        }
      });
    }
    
    STATE.botStarBalance = totalStars;
    console.log(`💰 Bot Balance: ${STATE.botStarBalance} stars`);
    
    return STATE.botStarBalance;
    
  } catch (error) {
    console.error('❌ Error getting balance:', error.message);
    return 0;
  }
}

// ============================================
// ROOT ENDPOINT (FOR TESTING)
// ============================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    message: 'Gift Transactor Bot v2.2',
    endpoints: {
      'POST /claim-gift': 'Claim a prize from inventory',
      'GET /status': 'Get bot status',
      'GET /mappings': 'View gift mappings'
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================
// CLAIM GIFT ENDPOINT
// ============================================

app.post('/claim-gift', async (req, res) => {
  const { userId, prizeId, giftName } = req.body;

  console.log('\n═══════════════════════════════════════════');
  console.log('🎁 GIFT CLAIM REQUEST');
  console.log('═══════════════════════════════════════════');
  console.log(`  Prize ID:  ${prizeId}`);
  console.log(`  Gift:      ${giftName}`);
  console.log(`  User ID:   ${userId}`);

  // ── 1. Validate input ────────────────────
  if (!userId || !prizeId || !giftName) {
    console.log('❌ Missing required fields');
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: userId, prizeId, giftName'
    });
  }

  // ── 2. Verify prize exists in the DB ─────
  let prize;
  try {
    const verifyRes = await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`);

    if (verifyRes.status === 404) {
      console.log('❌ Prize not found in database');
      await logFailedClaim(userId, giftName, prizeId, 'Prize not found in database');
      return res.status(404).json({
        success: false,
        error: 'Prize not found. It may have already been claimed.'
      });
    }

    if (!verifyRes.ok) {
      throw new Error(`Prize store returned ${verifyRes.status}`);
    }

    prize = await verifyRes.json();
    console.log('✅ Prize found in database');
    console.log(`   DB gift_name: ${prize.gift_name}`);
    console.log(`   DB user_id: ${prize.user_id}`);
    console.log(`   DB status: ${prize.status}`);
    
  } catch (err) {
    console.error('❌ Failed to verify prize:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to verify prize' });
  }

  // ── 3. Verify ownership ──────────────────
  if (String(prize.user_id) !== String(userId)) {
    console.log('❌ Ownership mismatch!');
    console.log(`   Prize owner: ${prize.user_id}`);
    console.log(`   Requester:   ${userId}`);
    await logFailedClaim(userId, giftName, prizeId, 'Ownership mismatch');
    return res.status(403).json({
      success: false,
      error: 'You do not own this prize.'
    });
  }

  console.log('✅ Ownership verified');

  // ── 4. Check status is "pending" ─────────
  if (prize.status !== 'pending') {
    console.log(`❌ Prize is not pending (status: ${prize.status})`);
    return res.status(409).json({
      success: false,
      error: `Prize is in "${prize.status}" state and cannot be claimed.`
    });
  }

  console.log('✅ Status is pending');

  // ── 5. Lock the prize → "claiming" ───────
  try {
    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'claiming' })
    });
    console.log('🔒 Prize locked (claiming)');
  } catch (err) {
    console.error('❌ Failed to lock prize:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to lock prize' });
  }

  // ── 6. Look up the Telegram gift ID ──────
  // The giftName coming from WebApp is the Telegram ID (e.g., "d01a849b9ef17642d8f4")
  const telegramGiftId = giftName;
  
  console.log(`🔍 Looking up gift mapping for: ${telegramGiftId}`);
  
  const giftMapping = findGiftByTelegramId(telegramGiftId);
  
  if (!giftMapping) {
    console.log('❌ Gift not found in mappings!');
    console.log(`   Telegram ID: ${telegramGiftId}`);
    console.log(`   Available mappings:`, Object.keys(GIFT_MAPPINGS));
    
    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        status: 'pending', 
        error_message: `Gift ID "${telegramGiftId}" not found in mappings` 
      })
    });
    
    await logFailedClaim(userId, telegramGiftId, prizeId, 'Gift not found in mappings');
    
    return res.status(500).json({ 
      success: false, 
      error: 'Gift not mapped. Contact admin.' 
    });
  }

  console.log(`✅ Gift mapped: ${giftMapping.name} (${giftMapping.stars} stars)`);
  console.log(`   Telegram ID: ${telegramGiftId}`);
  
  // ── 7. Send the gift via Telegram API ────
  try {
    console.log('📤 Sending gift via Telegram...');
    console.log(`   User ID: ${userId}`);
    console.log(`   Gift ID: ${telegramGiftId}`);
    console.log(`   Gift Name: ${giftMapping.name}`);

    await bot.sendGift(
      userId,
      telegramGiftId,
      {
        text: `🎉 Congratulations!\n\nYou claimed: ${giftMapping.name}\nPrize ID: ${prizeId}\n\nEnjoy your gift! 🎁`,
        text_parse_mode: 'Markdown'
      }
    );

    console.log('✅ Gift sent successfully!');

  } catch (err) {
    console.error('❌ Telegram sendGift failed:', err.message);
    console.error('   Full error:', err);

    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'failed',
        error_message: err.message
      })
    });

    await logFailedClaim(userId, giftMapping.name, prizeId, `Telegram API: ${err.message}`);

    return res.status(500).json({
      success: false,
      error: 'Gift sending failed. Please try again later.'
    });
  }

  // ── 8. Confirm success → "claimed" ───────
  try {
    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'claimed' })
    });
    console.log('✅ Prize marked as claimed');
  } catch (err) {
    console.error('⚠️  Failed to mark claimed (gift WAS sent):', err.message);
  }

  // ── 9. Clean up → delete the row ────────
  try {
    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'DELETE'
    });
    console.log('🗑️  Prize row cleaned up');
  } catch (err) {
    console.warn('⚠️  Cleanup failed (non-fatal):', err.message);
  }

  // ── 10. Update statistics ────────────────
  STATE.statistics.totalGiftsSent++;
  STATE.statistics.totalStarsSpent += giftMapping.stars;

  // ── 11. Log and respond ──────────────────
  await updateBotBalance();
  await logSuccessfulClaim(userId, giftMapping.name, prizeId, giftMapping.stars, STATE.botStarBalance);

  console.log('═══════════════════════════════════════════\n');

  res.json({
    success: true,
    message: 'Gift sent successfully!',
    prizeId,
    giftName: giftMapping.name
  });
});

// ============================================
// STATUS ENDPOINT
// ============================================

app.get('/status', async (req, res) => {
  try {
    await updateBotBalance();
    
    res.json({
      success: true,
      balance: STATE.botStarBalance,
      statistics: STATE.statistics,
      totalMappings: Object.keys(GIFT_MAPPINGS).length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// MAPPINGS ENDPOINT
// ============================================

app.get('/mappings', (req, res) => {
  try {
    res.json({
      success: true,
      mappings: GIFT_MAPPINGS,
      total: Object.keys(GIFT_MAPPINGS).length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// BOT COMMANDS
// ============================================

bot.onText(/\/start/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `🎁 *Gift Transactor Bot v2.2*\n\n` +
    `This bot sends Telegram gifts to users.\n\n` +
    `*Gift Mappings:* ${Object.keys(GIFT_MAPPINGS).length} gifts configured\n` +
    `*Balance:* ${STATE.botStarBalance} stars\n\n` +
    `*Commands:*\n` +
    `/status - Bot status\n` +
    `/balance - Check balance\n` +
    `/mappings - View gift mappings\n` +
    `/help - Show help`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/status/, async (msg) => {
  await updateBotBalance();
  
  await bot.sendMessage(msg.chat.id,
    `📊 *Bot Status*\n\n` +
    `*Gift Mappings:* ${Object.keys(GIFT_MAPPINGS).length} gifts\n` +
    `*Bot Balance:* ⭐ ${STATE.botStarBalance} Stars\n\n` +
    `*All-Time Stats:*\n` +
    `Gifts Sent: ${STATE.statistics.totalGiftsSent}\n` +
    `Stars Spent: ${STATE.statistics.totalStarsSpent}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/mappings/, async (msg) => {
  let message = '📦 *Gift Mappings*\n\n';
  
  for (const [telegramId, data] of Object.entries(GIFT_MAPPINGS)) {
    message += `✅ *${data.name}*\n`;
    message += `   Cost: ${data.stars} stars\n`;
    message += `   ID: \`${telegramId}\`\n\n`;
  }
  
  await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/balance/, async (msg) => {
  await updateBotBalance();
  
  await bot.sendMessage(msg.chat.id,
    `💰 *Bot Balance*\n\n` +
    `⭐ ${STATE.botStarBalance} Stars\n\n` +
    `Gifts sent: ${STATE.statistics.totalGiftsSent}\n` +
    `Stars spent: ${STATE.statistics.totalStarsSpent}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `📖 *Help*\n\n` +
    `*How It Works:*\n` +
    `1. WebApp registers prize in Prize Store\n` +
    `2. User clicks "Claim" in WebApp\n` +
    `3. Transactor verifies prize ownership\n` +
    `4. Bot sends gift via Telegram API\n` +
    `5. Prize is marked claimed & deleted\n\n` +
    `*Security Features:*\n` +
    `✅ Prize ownership verification\n` +
    `✅ Status-based locking\n` +
    `✅ No duplicate claims\n` +
    `✅ Automatic cleanup\n\n` +
    `*Important:*\n` +
    `Bot needs stars to send gifts!\n` +
    `Stars come from user payments or admin top-ups.`,
    { parse_mode: 'Markdown' }
  );
});

// ============================================
// STARTUP
// ============================================

async function startGiftBot() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('🎁 GIFT TRANSACTOR BOT v2.2');
  console.log('═══════════════════════════════════════════');
  console.log('');
  
  console.log(`📦 Loaded ${Object.keys(GIFT_MAPPINGS).length} gift mappings`);
  
  await updateBotBalance();
  
  console.log('');
  
  if (LOG_CHAT_ID) {
    const startupMessage = `
⚡️ <b>GIFT BOT ONLINE (v2.2)</b>
━━━━━━━━━━━━━━━━━━━━

✅ <b>Status:</b> Bot started successfully

📦 <b>Gift Mappings:</b> ${Object.keys(GIFT_MAPPINGS).length} gifts configured

💰 <b>Balance:</b> ${STATE.botStarBalance} stars

🔗 <b>Prize Store:</b> ${PRIZE_STORE_URL}

🌐 <b>HTTP Server:</b> Port ${HTTP_PORT}

🕐 <b>Timestamp:</b> ${new Date().toISOString()}
    `.trim();
    
    await sendGiftLog(startupMessage);
    console.log('📊 Startup notification sent to Telegram');
  }
  
  app.listen(HTTP_PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log(`🌐 HTTP Server: http://localhost:${HTTP_PORT}`);
    console.log('');
    console.log('📡 Endpoints:');
    console.log(`   POST /claim-gift - WebApp claims gift`);
    console.log(`   GET  /status - Get bot status`);
    console.log(`   GET  /mappings - View gift mappings`);
    console.log(`   GET  / - Server info`);
    console.log('');
    console.log('✅ Gift Bot Ready!');
    console.log('   WebApp can now send claim requests!');
    console.log('═══════════════════════════════════════════');
    console.log('');
  });
}

startGiftBot().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});




