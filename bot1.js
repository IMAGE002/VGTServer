// ============================================
// GIFT TRANSACTOR BOT - UPDATED VERSION
// ============================================
// v2.1 - With Prize Store Integration
// 
// REQUIRED ENVIRONMENT VARIABLES:
// - GIFT_BOT_TOKEN=your_bot_token
// - PRIZE_STORE_URL=https://your-prize-store.up.railway.app
// - LOG_CHAT_ID=your_telegram_group_id (optional)
// - GIFT_LOG_TOPIC_ID=5 (optional)
// - GIFT_BOT_PORT=3001 (optional)

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const GiftCatalogDB = require('./gift-catalog-db');

// ============================================
// CONFIGURATION
// ============================================

const GIFT_BOT_TOKEN = process.env.GIFT_BOT_TOKEN;
const PRIZE_STORE_URL = process.env.PRIZE_STORE_URL;
const HTTP_PORT = process.env.GIFT_BOT_PORT || 3001;

// Telegram Group Logging Configuration
const LOG_CHAT_ID = process.env.LOG_CHAT_ID;
const GIFT_LOG_TOPIC_ID = process.env.GIFT_LOG_TOPIC_ID || 5;

if (!GIFT_BOT_TOKEN) {
  console.error('❌ GIFT_BOT_TOKEN is required!');
  process.exit(1);
}

if (!PRIZE_STORE_URL) {
  console.error('❌ PRIZE_STORE_URL is required!');
  console.error('   Example: https://your-prize-store.up.railway.app');
  process.exit(1);
}

console.log('✅ Prize Store URL:', PRIZE_STORE_URL);

// ============================================
// GIFT CATALOG - INITIAL DATA
// ============================================

const INITIAL_GIFT_DATA = {
  'd01a849b9ef17642d8f4': { starCost: 15, displayName: 'Heart' },
  'd01a849bfc7f7938aa86': { starCost: 75, displayName: 'Bear' },
  'd01a849b9e2c54fb0cf1': { starCost: 100, displayName: 'Rose' },
  'd01a849ba490ee9e6308': { starCost: 125, displayName: 'Gift' },
  'd01a849bb0e2c9f42a0a': { starCost: 150, displayName: 'Cake' },
  'd01a849b8c2f0cd6de99': { starCost: 200, displayName: 'Rose Bouquet' },
  'd01a849b9c4de7d48c4e': { starCost: 300, displayName: 'Ring' },
  'd01a849b8de88d0e703d': { starCost: 500, displayName: 'Trophy' },
  'd01a849b92670e79adce': { starCost: 750, displayName: 'Diamond' },
  'd01a849b95b3da4d0acb': { starCost: 1000, displayName: 'Calendar' }
};

// ============================================
// STATE
// ============================================

const STATE = {
  db: null,
  botStarBalance: 0,
  statistics: {
    totalGiftsSent: 0,
    totalStarsSpent: 0
  }
};

const bot = new TelegramBot(GIFT_BOT_TOKEN, { polling: true });
const app = express();

app.use(cors());
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

async function logSystemError(context, error) {
  const message = `
🚨 <b>GIFT BOT ERROR</b>
━━━━━━━━━━━━━━━━━━━━

<b>Context:</b> ${context}
❌ <b>Error:</b> ${error.message || error}

${error.stack ? `<b>Stack:</b>\n<code>${error.stack.substring(0, 500)}</code>\n` : ''}
📅 <b>Time:</b> ${new Date().toISOString()}
  `.trim();
  
  await sendGiftLog(message);
}

// ============================================
// GIFT CATALOG MANAGEMENT
// ============================================

async function syncGiftCatalog() {
  try {
    console.log('🔄 Syncing gift catalog with Telegram...');
    
    const response = await bot.getAvailableGifts();
    
    if (!response || !response.gifts || response.gifts.length === 0) {
      throw new Error('No gifts available from Telegram');
    }
    
    console.log(`\n✅ Found ${response.gifts.length} gifts from Telegram:\n`);
    
    response.gifts.forEach((telegramGift, index) => {
      console.log(`📦 Gift #${index + 1}:`);
      console.log(`   ID: ${telegramGift.id}`);
      console.log(`   Cost: ${telegramGift.star_count} stars`);
      if (telegramGift.total_count) {
        console.log(`   Stock: ${telegramGift.remaining_count}/${telegramGift.total_count}`);
      }
      console.log('');
    });
    
    let autoMapped = 0;
    const existingMappings = STATE.db.getAllGiftMappings();
    
    for (const [giftName, giftData] of Object.entries(INITIAL_GIFT_DATA)) {
      if (existingMappings[giftName]?.telegramId) {
        console.log(`✓ ${giftName} already mapped to ${existingMappings[giftName].telegramId}`);
        continue;
      }
      
      const match = response.gifts.find(tg => tg.star_count === giftData.starCost);
      
      if (match) {
        await STATE.db.updateGiftMapping(
          giftName,
          match.id,
          giftData.starCost,
          giftData.displayName
        );
        autoMapped++;
        console.log(`✅ Auto-mapped ${giftName} -> ${match.id} (${giftData.starCost} stars)`);
      } else {
        console.log(`⚠️  Could not auto-map ${giftName} (${giftData.starCost} stars)`);
      }
    }
    
    console.log(`\n✅ Sync complete! Auto-mapped ${autoMapped} gifts\n`);
    
    const stats = STATE.db.getStats();
    console.log(`📊 Catalog Status: ${stats.gifts.mapped}/${stats.gifts.total} gifts mapped (${stats.gifts.percentage}%)\n`);
    
    return response.gifts;
    
  } catch (error) {
    console.error('❌ Error syncing gift catalog:', error.message);
    await logSystemError('Gift Catalog Sync', error);
    return [];
  }
}

async function initializeDatabase() {
  try {
    STATE.db = new GiftCatalogDB('./gift_catalog.json');
    await STATE.db.initialize();
    
    const existingMappings = STATE.db.getAllGiftMappings();
    if (Object.keys(existingMappings).length === 0) {
      console.log('📦 Initializing default gift catalog...');
      for (const [giftName, giftData] of Object.entries(INITIAL_GIFT_DATA)) {
        await STATE.db.updateGiftMapping(
          giftName,
          null,
          giftData.starCost,
          giftData.displayName
        );
      }
      console.log('✅ Default gift catalog initialized');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  }
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
    await logSystemError('Bot Balance Check', error);
    return 0;
  }
}

// ============================================
// NEW CLAIM-GIFT ENDPOINT WITH PRIZE STORE VERIFICATION
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

  // ── 4. Log what we're processing (no strict verification) ──────────
console.log(`📦 Processing gift claim:`);
console.log(`   Prize ID: ${prizeId}`);
console.log(`   DB gift_name: ${prize.gift_name}`);
console.log(`   DB telegram_gift_id: ${prize.telegram_gift_id || 'N/A'}`);
console.log(`   Requested: ${giftName}`);

console.log('✅ Gift name verified');

  // ── 5. Check status is "pending" ─────────
  if (prize.status !== 'pending') {
    console.log(`❌ Prize is not pending (status: ${prize.status})`);
    return res.status(409).json({
      success: false,
      error: `Prize is in "${prize.status}" state and cannot be claimed.`
    });
  }

  // ── 6. Lock the prize → "claiming" ───────
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

  // ── 7. Look up the Telegram gift ID ──────
const giftNameOrId = prize.gift_name;

console.log(`🔍 Looking up gift: ${giftNameOrId}`);

// Try direct lookup first (friendly name)
let giftMapping = STATE.db.getGiftMapping(giftNameOrId);
let friendlyName = giftNameOrId;

// If not found, try reverse lookup (Telegram ID)
if (!giftMapping) {
  console.log(`⚠️  Not found as friendly name, trying reverse lookup...`);
  
  const reverseMapping = STATE.db.getGiftMappingByTelegramId(giftNameOrId);
  
  if (reverseMapping) {
    giftMapping = reverseMapping;
    friendlyName = reverseMapping.giftName;
    console.log(`✅ Found via reverse lookup: ${friendlyName}`);
  }
}

if (!giftMapping || !giftMapping.telegramId) {
  console.log('❌ Gift not mapped in catalog');
  console.log(`   Searched for: ${giftNameOrId}`);
  
  await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      status: 'pending', 
      error_message: `Gift not mapped: ${giftNameOrId}` 
    })
  });
  
  return res.status(500).json({ 
    success: false, 
    error: 'Gift not mapped. Contact admin.' 
  });
}

console.log(`✅ Gift found: ${friendlyName} -> ${giftMapping.telegramId}`);
console.log(`   Star cost: ${giftMapping.starCost}`);
  
  // ── 8. Send the gift via Telegram API ────
  try {
    console.log('📤 Sending gift via Telegram...');

    await bot.sendGift(
      userId,
      giftMapping.telegramId,
      {
        text: `🎉 Congratulations!\n\nYou claimed: ${giftName}\nPrize ID: ${prizeId}\n\nEnjoy your gift! 🎁`,
        text_parse_mode: 'Markdown'
      }
    );

    console.log('✅ Gift sent successfully!');

  } catch (err) {
    console.error('❌ Telegram sendGift failed:', err.message);

    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'failed',
        error_message: err.message
      })
    });

    await logFailedClaim(userId, giftName, prizeId, `Telegram API: ${err.message}`);

    return res.status(500).json({
      success: false,
      error: 'Gift sending failed. Please try again later.'
    });
  }

  // ── 9. Confirm success → "claimed" ───────
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

  // ── 10. Clean up → delete the row ────────
  try {
    await fetch(`${PRIZE_STORE_URL}/prizes/${prizeId}`, {
      method: 'DELETE'
    });
    console.log('🗑️  Prize row cleaned up');
  } catch (err) {
    console.warn('⚠️  Cleanup failed (non-fatal):', err.message);
  }

  // ── 11. Log and respond ──────────────────
  await updateBotBalance();
  await logSuccessfulClaim(userId, giftName, prizeId, giftMapping.starCost, STATE.botStarBalance);

  console.log('═══════════════════════════════════════════\n');

  res.json({
    success: true,
    message: 'Gift sent successfully!',
    prizeId,
    giftName
  });
});

// ============================================
// SERVER HANDLE
// ============================================

app.get("/", (req, res) => {
  res.send("Server is running. Try /status or /catalog.");
});

// ============================================
// STATUS ENDPOINT
// ============================================

app.get('/status', async (req, res) => {
  try {
    await updateBotBalance();
    
    const dbStats = STATE.db.getStats();
    
    res.json({
      success: true,
      balance: STATE.botStarBalance,
      statistics: STATE.statistics,
      catalog: dbStats.gifts,
      prizes: dbStats.prizes,
      lastSync: dbStats.lastSync
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// CATALOG ENDPOINT
// ============================================

app.get('/catalog', (req, res) => {
  try {
    const mappings = STATE.db.getAllGiftMappings();
    const stats = STATE.db.getStats();
    
    res.json({
      success: true,
      gifts: mappings,
      stats: stats.gifts,
      lastSync: stats.lastSync
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
  const stats = STATE.db.getStats();
  
  await bot.sendMessage(msg.chat.id,
    `🎁 *Gift Transactor Bot v2.1*\n\n` +
    `This bot sends Telegram gifts to users.\n\n` +
    `*Catalog Status:*\n` +
    `Gifts Mapped: ${stats.gifts.mapped}/${stats.gifts.total} (${stats.gifts.percentage}%)\n` +
    `Balance: ${STATE.botStarBalance} stars\n\n` +
    `*Commands:*\n` +
    `/status - Bot status\n` +
    `/syncgifts - Sync with Telegram\n` +
    `/catalog - View gift mappings\n` +
    `/balance - Check balance\n` +
    `/help - Show help`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/status/, async (msg) => {
  await updateBotBalance();
  
  const stats = STATE.db.getStats();
  
  await bot.sendMessage(msg.chat.id,
    `📊 *Bot Status*\n\n` +
    `*Gift Catalog:*\n` +
    `Total Gifts: ${stats.gifts.total}\n` +
    `Mapped: ${stats.gifts.mapped} (${stats.gifts.percentage}%)\n` +
    `Unmapped: ${stats.gifts.unmapped}\n` +
    `Last Sync: ${stats.lastSync || 'Never'}\n\n` +
    `*Bot Balance:*\n` +
    `⭐ ${STATE.botStarBalance} Stars\n\n` +
    `*All-Time Stats:*\n` +
    `Gifts Sent: ${STATE.statistics.totalGiftsSent}\n` +
    `Stars Spent: ${STATE.statistics.totalStarsSpent}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/syncgifts/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '🔄 Syncing gift catalog with Telegram...');
  
  await syncGiftCatalog();
  
  const stats = STATE.db.getStats();
  
  await bot.sendMessage(msg.chat.id,
    `${stats.gifts.percentage === 100 ? '✅' : '⚠️'} Sync complete!\n\n` +
    `Mapped: ${stats.gifts.mapped}/${stats.gifts.total} (${stats.gifts.percentage}%)\n\n` +
    `${stats.gifts.unmapped > 0 ? 'Some gifts need manual mapping. Check logs.' : 'All gifts mapped successfully!'}`
  );
});

bot.onText(/\/catalog/, async (msg) => {
  const mappings = STATE.db.getAllGiftMappings();
  
  let message = '📦 *Gift Catalog*\n\n';
  
  for (const [giftName, giftData] of Object.entries(mappings)) {
    const status = giftData.telegramId ? '✅' : '❌';
    message += `${status} *${giftName}*\n`;
    message += `   Cost: ${giftData.starCost} stars\n`;
    if (giftData.telegramId) {
      message += `   ID: \`${giftData.telegramId}\`\n`;
    } else {
      message += `   ID: _Not mapped_\n`;
    }
    message += '\n';
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
    `✅ Gift name validation\n` +
    `✅ Status-based locking\n` +
    `✅ No duplicate claims\n\n` +
    `*Setup (First Time):*\n` +
    `1. Set PRIZE_STORE_URL env var\n` +
    `2. Run /syncgifts to map gifts\n` +
    `3. Ensure bot has stars in balance\n` +
    `4. WebApp can now claim gifts!\n\n` +
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
  console.log('🎁 GIFT TRANSACTOR BOT v2.1');
  console.log('═══════════════════════════════════════════');
  console.log('');
  
  await initializeDatabase();
  
  const stats = STATE.db.getStats();
  if (stats.gifts.percentage < 100) {
    console.log('⚠️  Some gifts not mapped. Run /syncgifts to auto-map.');
  }
  
  await updateBotBalance();
  
  console.log('');
  
  if (LOG_CHAT_ID) {
    const dbStats = STATE.db.getStats();
    
    const startupMessage = `
⚡️ <b>GIFT BOT ONLINE (v2.1)</b>
━━━━━━━━━━━━━━━━━━━━

✅ <b>Status:</b> Bot started successfully

📦 <b>Gift Catalog:</b>
   ${dbStats.gifts.percentage === 100 ? '✅' : '⚠️'} ${dbStats.gifts.mapped}/${dbStats.gifts.total} gifts mapped (${dbStats.gifts.percentage}%)
   Last Sync: ${dbStats.lastSync || 'Never'}

💰 <b>Balance:</b> ${STATE.botStarBalance} stars

🔗 <b>Prize Store:</b> ${PRIZE_STORE_URL}

🌐 <b>HTTP Server:</b> Port ${HTTP_PORT}

🆕 <b>New in v2.1:</b>
   • Prize Store integration
   • Ownership verification
   • Gift name validation
   • Status-based locking
   • Auto cleanup after claim

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
    console.log(`   GET  /catalog - View gift catalog`);
    console.log('');
    console.log('✅ Gift Bot Ready!');
    console.log('   WebApp can now send claim requests!');
    console.log('   Run /syncgifts to map Telegram gifts');
    console.log('═══════════════════════════════════════════');
    console.log('');
  });
}

startGiftBot().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});






