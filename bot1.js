// ============================================
// GIFT TRANSACTOR BOT - WITH PERSISTENT CATALOG
// ============================================
// v2.0 - Database-driven gift catalog system
// No more forced catalog loading!

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const GiftCatalogDB = require('./gift-catalog-db');

// ============================================
// CONFIGURATION
// ============================================

const GIFT_BOT_TOKEN = process.env.GIFT_BOT_TOKEN;
const HTTP_PORT = process.env.GIFT_BOT_PORT || 3001;

// Telegram Group Logging Configuration
const LOG_CHAT_ID = process.env.LOG_CHAT_ID;
const GIFT_LOG_TOPIC_ID = process.env.GIFT_LOG_TOPIC_ID || 5;

if (!GIFT_BOT_TOKEN) {
  console.error('❌ GIFT_BOT_TOKEN is required!');
  process.exit(1);
}

// ============================================
// GIFT CATALOG - INITIAL DATA
// ============================================
// This is only used for initial setup
// After first load, everything comes from database

const INITIAL_GIFT_DATA = {
  'Heart': { starCost: 15, displayName: 'Heart' },
  'Bear': { starCost: 75, displayName: 'Bear' },
  'Rose': { starCost: 100, displayName: 'Rose' },
  'Gift': { starCost: 125, displayName: 'Gift' },
  'Cake': { starCost: 150, displayName: 'Cake' },
  'Rose Bouquet': { starCost: 200, displayName: 'Rose Bouquet' },
  'Ring': { starCost: 300, displayName: 'Ring' },
  'Trophy': { starCost: 500, displayName: 'Trophy' },
  'Diamond': { starCost: 750, displayName: 'Diamond' },
  'Calendar': { starCost: 1000, displayName: 'Calendar' }
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

async function logFailedClaim(userId, giftName, prizeId, error, errorContext = {}) {
  const message = `
❌ <b>GIFT CLAIM FAILED</b>
━━━━━━━━━━━━━━━━━━━━

👤 <b>User ID:</b> <code>${userId}</code>
🎁 <b>Gift:</b> ${giftName}
🆔 <b>Prize ID:</b> <code>${prizeId}</code>
❌ <b>Error:</b> ${error}
📅 <b>Time:</b> ${new Date().toISOString()}

${errorContext.catalogLoaded !== undefined ? `<b>Catalog Loaded:</b> ${errorContext.catalogLoaded ? '✅' : '❌'}\n` : ''}${errorContext.giftMapped !== undefined ? `<b>Gift Mapped:</b> ${errorContext.giftMapped ? '✅' : '❌'}\n` : ''}${errorContext.balance !== undefined ? `<b>Bot Balance:</b> ${errorContext.balance} stars\n` : ''}${errorContext.required !== undefined ? `<b>Required:</b> ${errorContext.required} stars\n` : ''}${errorContext.shortfall !== undefined ? `<b>Shortfall:</b> ${errorContext.shortfall} stars\n` : ''}
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
    
    // Display all available gifts
    response.gifts.forEach((telegramGift, index) => {
      console.log(`📦 Gift #${index + 1}:`);
      console.log(`   ID: ${telegramGift.id}`);
      console.log(`   Cost: ${telegramGift.star_count} stars`);
      if (telegramGift.total_count) {
        console.log(`   Stock: ${telegramGift.remaining_count}/${telegramGift.total_count}`);
      }
      console.log('');
    });
    
    // Try to auto-map gifts by matching star costs
    let autoMapped = 0;
    const existingMappings = STATE.db.getAllGiftMappings();
    
    for (const [giftName, giftData] of Object.entries(INITIAL_GIFT_DATA)) {
      // Skip if already mapped
      if (existingMappings[giftName]?.telegramId) {
        console.log(`✓ ${giftName} already mapped to ${existingMappings[giftName].telegramId}`);
        continue;
      }
      
      // Find matching Telegram gift by star cost
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
    
    // Initialize default gift data if catalog is empty
    const existingMappings = STATE.db.getAllGiftMappings();
    if (Object.keys(existingMappings).length === 0) {
      console.log('📦 Initializing default gift catalog...');
      for (const [giftName, giftData] of Object.entries(INITIAL_GIFT_DATA)) {
        await STATE.db.updateGiftMapping(
          giftName,
          null, // No Telegram ID yet
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
// WEBAPP ENDPOINT - CLAIM GIFT
// ============================================

app.post('/claim-gift', async (req, res) => {
  try {
    const { userId, prizeId, giftName } = req.body;
    
    console.log('\n═══════════════════════════════════════════');
    console.log('🎁 GIFT CLAIM REQUEST FROM WEBAPP');
    console.log('═══════════════════════════════════════════');
    console.log(`  User ID: ${userId}`);
    console.log(`  Prize ID: ${prizeId}`);
    console.log(`  Gift Name: ${giftName}`);
    
    // Validate request
    if (!userId || !prizeId || !giftName) {
      console.log('❌ Missing required fields');
      
      await logFailedClaim(
        userId || 'UNKNOWN',
        giftName || 'UNKNOWN',
        prizeId || 'UNKNOWN',
        'Missing required fields: userId, prizeId, or giftName',
        {}
      );
      
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userId, prizeId, giftName'
      });
    }
    
    // Get gift mapping from database
    const giftMapping = STATE.db.getGiftMapping(giftName);
    
    if (!giftMapping) {
      console.log('❌ Gift not found in catalog');
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        `Gift "${giftName}" not found in catalog`,
        {
          availableGifts: Object.keys(STATE.db.getAllGiftMappings()).join(', ')
        }
      );
      
      return res.status(400).json({
        success: false,
        error: `Gift "${giftName}" not found in catalog`,
        availableGifts: Object.keys(STATE.db.getAllGiftMappings())
      });
    }
    
    // Check if gift is mapped to Telegram ID
    if (!giftMapping.telegramId) {
      console.log('❌ Gift not mapped to Telegram ID');
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        `Gift "${giftName}" not mapped to Telegram ID. Run /syncgifts to map.`,
        {
          giftMapped: false
        }
      );
      
      return res.status(500).json({
        success: false,
        error: `Gift "${giftName}" not mapped to Telegram ID. Contact admin.`
      });
    }
    
    console.log(`  Telegram Gift ID: ${giftMapping.telegramId}`);
    console.log(`  Cost: ${giftMapping.starCost} stars`);
    
    // Check bot balance
    await updateBotBalance();
    
    if (STATE.botStarBalance < giftMapping.starCost) {
      console.log('❌ Insufficient balance!');
      console.log(`   Need: ${giftMapping.starCost} stars`);
      console.log(`   Have: ${STATE.botStarBalance} stars`);
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        'Bot has insufficient balance to send this gift',
        {
          giftMapped: true,
          balance: STATE.botStarBalance,
          required: giftMapping.starCost,
          shortfall: giftMapping.starCost - STATE.botStarBalance
        }
      );
      
      return res.status(400).json({
        success: false,
        error: 'Bot has insufficient balance to send this gift',
        required: giftMapping.starCost,
        available: STATE.botStarBalance
      });
    }
    
    // Register prize in database
    await STATE.db.registerPrize(prizeId, giftName, userId, null);
    
    // SEND THE GIFT VIA TELEGRAM API
    console.log('📤 Sending gift to user via Telegram...');
    
    // CORRECT sendGift API call according to official docs:
    // sendGift(user_id, gift_id, options)
    const result = await bot.sendGift(
      userId,                      // user_id (Integer)
      giftMapping.telegramId,      // gift_id (String)
      {
        text: `🎉 Congratulations!\n\nYou claimed: ${giftName}\nPrize ID: ${prizeId}\n\nEnjoy your gift! 🎁`,
        text_parse_mode: 'Markdown'  // Optional: format the text
      }
    );
    
    console.log('✅ GIFT SENT SUCCESSFULLY!');
    
    // Update prize status
    await STATE.db.updatePrizeStatus(prizeId, 'sent');
    
    // Update balance after sending
    await updateBotBalance();
    
    // Update statistics
    STATE.statistics.totalGiftsSent++;
    STATE.statistics.totalStarsSpent += giftMapping.starCost;
    
    console.log(`💰 New Balance: ${STATE.botStarBalance} stars`);
    console.log('═══════════════════════════════════════════\n');
    
    // Log successful claim to Telegram channel
    await logSuccessfulClaim(
      userId,
      giftName,
      prizeId,
      giftMapping.starCost,
      STATE.botStarBalance
    );
    
    // Return success to WebApp
    res.json({
      success: true,
      message: 'Gift sent successfully!',
      prizeId: prizeId,
      giftName: giftName,
      botBalance: STATE.botStarBalance
    });
    
  } catch (error) {
    console.error('❌ ERROR SENDING GIFT:', error);
    console.error('   Message:', error.message);
    console.error('   Code:', error.code);
    console.log('═══════════════════════════════════════════\n');
    
    // Update prize status to failed
    if (req.body.prizeId) {
      try {
        await STATE.db.updatePrizeStatus(req.body.prizeId, 'failed');
      } catch (dbError) {
        console.error('❌ Error updating prize status:', dbError);
      }
    }
    
    // Log failed claim to Telegram channel
    await logFailedClaim(
      req.body.userId || 'UNKNOWN',
      req.body.giftName || 'UNKNOWN',
      req.body.prizeId || 'UNKNOWN',
      `Telegram API Error: ${error.message}`,
      {
        errorCode: error.code,
        balance: STATE.botStarBalance
      }
    );
    
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
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
// HISTORY ENDPOINT
// ============================================

app.get('/history', async (req, res) => {
  try {
    const userId = req.query.userId;
    
    if (userId) {
      // Get prizes for specific user
      const userPrizes = await STATE.db.getUserPrizes(parseInt(userId));
      res.json({
        success: true,
        userId: userId,
        prizes: userPrizes,
        statistics: STATE.statistics
      });
    } else {
      // Get all pending prizes
      const pendingPrizes = await STATE.db.getPendingPrizes();
      res.json({
        success: true,
        pendingPrizes: pendingPrizes,
        statistics: STATE.statistics
      });
    }
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
    `🎁 *Gift Transactor Bot v2.0*\n\n` +
    `This bot sends Telegram gifts to users.\n\n` +
    `*Catalog Status:*\n` +
    `Gifts Mapped: ${stats.gifts.mapped}/${stats.gifts.total} (${stats.gifts.percentage}%)\n` +
    `Balance: ${STATE.botStarBalance} stars\n\n` +
    `*Prize Statistics:*\n` +
    `Total Prizes: ${stats.prizes.total}\n` +
    `Sent: ${stats.prizes.sent}\n` +
    `Pending: ${stats.prizes.pending}\n` +
    `Failed: ${stats.prizes.failed}\n\n` +
    `*Commands:*\n` +
    `/status - Bot status\n` +
    `/syncgifts - Sync with Telegram\n` +
    `/catalog - View gift mappings\n` +
    `/balance - Check balance\n` +
    `/pending - View pending prizes\n` +
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
    `*Prize Statistics:*\n` +
    `Total: ${stats.prizes.total}\n` +
    `Sent: ${stats.prizes.sent}\n` +
    `Pending: ${stats.prizes.pending}\n` +
    `Failed: ${stats.prizes.failed}\n\n` +
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

bot.onText(/\/pending/, async (msg) => {
  const pending = await STATE.db.getPendingPrizes();
  
  if (pending.length === 0) {
    await bot.sendMessage(msg.chat.id, '✅ No pending prizes!');
    return;
  }
  
  let message = `⏳ *Pending Prizes* (${pending.length})\n\n`;
  
  pending.slice(0, 10).forEach(prize => {
    message += `🎁 *${prize.giftName}*\n`;
    message += `   Prize ID: \`${prize.prizeId}\`\n`;
    message += `   User: ${prize.userId}\n`;
    message += `   Claimed: ${new Date(prize.claimedAt).toLocaleString()}\n\n`;
  });
  
  if (pending.length > 10) {
    message += `\n_...and ${pending.length - 10} more_`;
  }
  
  await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `📖 *Help*\n\n` +
    `*How It Works:*\n` +
    `1. WebApp sends claim request\n` +
    `2. Bot looks up gift in database\n` +
    `3. Bot sends gift via Telegram API\n` +
    `4. Database tracks the prize\n\n` +
    `*Setup (First Time):*\n` +
    `1. Run /syncgifts to map Telegram gifts\n` +
    `2. Ensure bot has stars in balance\n` +
    `3. WebApp can now claim gifts!\n\n` +
    `*Key Features:*\n` +
    `✅ Persistent gift catalog (no reloading!)\n` +
    `✅ Prize ownership tracking\n` +
    `✅ Auto-mapping by star cost\n` +
    `✅ Full transaction history\n\n` +
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
  console.log('🎁 GIFT TRANSACTOR BOT v2.0');
  console.log('═══════════════════════════════════════════');
  console.log('');
  
  // Initialize database
  await initializeDatabase();
  
  // Sync with Telegram (optional on startup)
  const stats = STATE.db.getStats();
  if (stats.gifts.percentage < 100) {
    console.log('⚠️  Some gifts not mapped. Run /syncgifts to auto-map.');
  }
  
  // Check balance
  await updateBotBalance();
  
  console.log('');
  
  // Send startup notification to Telegram
  if (LOG_CHAT_ID) {
    const dbStats = STATE.db.getStats();
    
    const startupMessage = `
⚡️ <b>GIFT BOT ONLINE (v2.0)</b>
━━━━━━━━━━━━━━━━━━━━

✅ <b>Status:</b> Bot started successfully

📦 <b>Gift Catalog:</b>
   ${dbStats.gifts.percentage === 100 ? '✅' : '⚠️'} ${dbStats.gifts.mapped}/${dbStats.gifts.total} gifts mapped (${dbStats.gifts.percentage}%)
   Last Sync: ${dbStats.lastSync || 'Never'}

📊 <b>Prize Statistics:</b>
   Total: ${dbStats.prizes.total}
   Sent: ${dbStats.prizes.sent}
   Pending: ${dbStats.prizes.pending}
   Failed: ${dbStats.prizes.failed}

💰 <b>Balance:</b> ${STATE.botStarBalance} stars

🌐 <b>HTTP Server:</b> Port ${HTTP_PORT}

🆕 <b>New Features:</b>
   • Persistent gift catalog database
   • No forced catalog loading
   • Prize ownership tracking
   • Transaction history

🕐 <b>Timestamp:</b> ${new Date().toISOString()}
    `.trim();
    
    await sendGiftLog(startupMessage);
    console.log('📊 Startup notification sent to Telegram');
  }
  
  // Start HTTP server
  app.listen(HTTP_PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log(`🌐 HTTP Server: http://localhost:${HTTP_PORT}`);
    console.log('');
    console.log('📡 Endpoints:');
    console.log(`   POST /claim-gift - WebApp claims gift`);
    console.log(`   GET  /status - Get bot status`);
    console.log(`   GET  /history - Transaction history`);
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
