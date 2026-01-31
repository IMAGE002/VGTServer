// ============================================
// GIFT TRANSACTOR BOT - SIMPLIFIED & CORRECT
// ============================================
// Listens directly to WebApp claim requests
// Similar to how purchase system works

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');

// ============================================
// CONFIGURATION
// ============================================

const GIFT_BOT_TOKEN = process.env.GIFT_BOT_TOKEN;
const HTTP_PORT = process.env.GIFT_BOT_PORT || 3001;

// Telegram Group Logging Configuration
const LOG_CHAT_ID = process.env.LOG_CHAT_ID;
const GIFT_LOG_TOPIC_ID = process.env.GIFT_LOG_TOPIC_ID || 5; // Topic for gift transactions

if (!GIFT_BOT_TOKEN) {
  console.error('❌ GIFT_BOT_TOKEN is required!');
  process.exit(1);
}

// ============================================
// GIFT CATALOG
// ============================================

const GIFT_CATALOG = {
  'Heart': {
    telegramId: null,      // Will be populated from getAvailableGifts()
    starCost: 15,
    displayName: 'Heart'
  },
  'Bear': {
    telegramId: null,
    starCost: 75,
    displayName: 'Bear'
  },
  'Rose': {
    telegramId: null,
    starCost: 100,
    displayName: 'Rose'
  },
  'Gift': {
    telegramId: null,
    starCost: 125,
    displayName: 'Gift'
  },
  'Cake': {
    telegramId: null,
    starCost: 150,
    displayName: 'Cake'
  },
  'Rose Bouquet': {
    telegramId: null,
    starCost: 200,
    displayName: 'Rose Bouquet'
  },
  'Ring': {
    telegramId: null,
    starCost: 300,
    displayName: 'Ring'
  },
  'Trophy': {
    telegramId: null,
    starCost: 500,
    displayName: 'Trophy'
  },
  'Diamond': {
    telegramId: null,
    starCost: 750,
    displayName: 'Diamond'
  },
  'Calendar': {
    telegramId: null,
    starCost: 1000,
    displayName: 'Calendar'
  }
};

// ============================================
// STATE
// ============================================

const STATE = {
  catalogLoaded: false,
  botStarBalance: 0,
  sentGifts: [],
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
// LOAD GIFT CATALOG
// ============================================

async function loadGiftCatalog() {
  try {
    console.log('📦 Fetching available gifts from Telegram...');
    
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
    
    console.log('⚠️  ACTION REQUIRED:');
    console.log('Update GIFT_CATALOG with actual Telegram Gift IDs!\n');
    
    const mappedGifts = Object.values(GIFT_CATALOG).filter(g => g.telegramId !== null);
    
    if (mappedGifts.length === 0) {
      console.warn('⚠️  WARNING: No gifts mapped yet!');
      STATE.catalogLoaded = false;
    } else {
      console.log(`✅ ${mappedGifts.length}/${Object.keys(GIFT_CATALOG).length} gifts mapped\n`);
      STATE.catalogLoaded = true;
    }
    
    return response.gifts;
    
  } catch (error) {
    console.error('❌ Error loading gift catalog:', error.message);
    await logSystemError('Gift Catalog Loading', error);
    STATE.catalogLoaded = false;
    return [];
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
// WebApp sends claim request directly here (like purchase flow)

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
    
    // Check catalog loaded
    if (!STATE.catalogLoaded) {
      console.log('❌ Catalog not loaded');
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        'Gift catalog not loaded. Admin must run /loadgifts command.',
        {
          catalogLoaded: false
        }
      );
      
      return res.status(500).json({
        success: false,
        error: 'Gift catalog not loaded. Admin must run /loadgifts command.'
      });
    }
    
    // Get gift from catalog
    const gift = GIFT_CATALOG[giftName];
    
    if (!gift) {
      console.log('❌ Invalid gift name');
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        `Gift "${giftName}" not found in catalog`,
        {
          catalogLoaded: STATE.catalogLoaded,
          availableGifts: Object.keys(GIFT_CATALOG).join(', ')
        }
      );
      
      return res.status(400).json({
        success: false,
        error: `Gift "${giftName}" not found in catalog`,
        availableGifts: Object.keys(GIFT_CATALOG)
      });
    }
    
    // Check if gift is mapped
    if (!gift.telegramId) {
      console.log('❌ Gift not mapped to Telegram ID');
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        `Gift "${giftName}" not mapped to Telegram ID. Contact admin.`,
        {
          catalogLoaded: STATE.catalogLoaded,
          giftMapped: false
        }
      );
      
      return res.status(500).json({
        success: false,
        error: `Gift "${giftName}" not mapped to Telegram ID. Contact admin.`
      });
    }
    
    console.log(`  Telegram Gift ID: ${gift.telegramId}`);
    console.log(`  Cost: ${gift.starCost} stars`);
    
    // Check bot balance
    await updateBotBalance();
    
    if (STATE.botStarBalance < gift.starCost) {
      console.log('❌ Insufficient balance!');
      console.log(`   Need: ${gift.starCost} stars`);
      console.log(`   Have: ${STATE.botStarBalance} stars`);
      
      await logFailedClaim(
        userId,
        giftName,
        prizeId,
        'Bot has insufficient balance to send this gift',
        {
          catalogLoaded: STATE.catalogLoaded,
          giftMapped: true,
          balance: STATE.botStarBalance,
          required: gift.starCost,
          shortfall: gift.starCost - STATE.botStarBalance
        }
      );
      
      return res.status(400).json({
        success: false,
        error: 'Bot has insufficient balance to send this gift',
        required: gift.starCost,
        available: STATE.botStarBalance
      });
    }
    
    // SEND THE GIFT VIA TELEGRAM API
    console.log('📤 Sending gift to user via Telegram...');
    
    const result = await bot.sendGift(
      userId,
      gift.telegramId,
      {
        text: `🎉 Congratulations!\n\nYou claimed: ${giftName}\nPrize ID: ${prizeId}\n\nEnjoy your gift! 🎁`,
        pay_for_upgrade: false
      }
    );
    
    console.log('✅ GIFT SENT SUCCESSFULLY!');
    
    // Update balance after sending
    await updateBotBalance();
    
    // Log transaction
    const transaction = {
      id: Date.now(),
      userId: userId,
      giftName: giftName,
      telegramGiftId: gift.telegramId,
      prizeId: prizeId,
      starCost: gift.starCost,
      timestamp: new Date().toISOString(),
      balanceAfter: STATE.botStarBalance
    };
    
    STATE.sentGifts.push(transaction);
    STATE.statistics.totalGiftsSent++;
    STATE.statistics.totalStarsSpent += gift.starCost;
    
    console.log(`💰 New Balance: ${STATE.botStarBalance} stars`);
    console.log('═══════════════════════════════════════════\n');
    
    // Log successful claim to Telegram channel
    await logSuccessfulClaim(
      userId,
      giftName,
      prizeId,
      gift.starCost,
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
    
    // Log failed claim to Telegram channel
    await logFailedClaim(
      req.body.userId || 'UNKNOWN',
      req.body.giftName || 'UNKNOWN',
      req.body.prizeId || 'UNKNOWN',
      `Telegram API Error: ${error.message}`,
      {
        errorCode: error.code,
        catalogLoaded: STATE.catalogLoaded,
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
    
    const mappedGifts = Object.keys(GIFT_CATALOG).filter(
      name => GIFT_CATALOG[name].telegramId !== null
    );
    
    res.json({
      success: true,
      catalogLoaded: STATE.catalogLoaded,
      balance: STATE.botStarBalance,
      statistics: STATE.statistics,
      availableGifts: mappedGifts,
      totalGifts: Object.keys(GIFT_CATALOG).length
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

app.get('/history', (req, res) => {
  res.json({
    success: true,
    sentGifts: STATE.sentGifts,
    statistics: STATE.statistics
  });
});

// ============================================
// BOT COMMANDS
// ============================================

bot.onText(/\/start/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `🎁 *Gift Transactor Bot*\n\n` +
    `This bot sends Telegram gifts to users.\n\n` +
    `*Status:*\n` +
    `Catalog: ${STATE.catalogLoaded ? '✅ Loaded' : '❌ Not Loaded'}\n` +
    `Balance: ${STATE.botStarBalance} stars\n\n` +
    `*Commands:*\n` +
    `/status - Bot status\n` +
    `/loadgifts - Load gift catalog\n` +
    `/balance - Check balance\n` +
    `/help - Show help`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/status/, async (msg) => {
  await updateBotBalance();
  
  const mappedGifts = Object.values(GIFT_CATALOG).filter(g => g.telegramId !== null).length;
  const totalGifts = Object.keys(GIFT_CATALOG).length;
  
  await bot.sendMessage(msg.chat.id,
    `📊 *Bot Status*\n\n` +
    `Catalog: ${STATE.catalogLoaded ? '✅ Loaded' : '❌ Not Loaded'}\n` +
    `Gifts Mapped: ${mappedGifts}/${totalGifts}\n` +
    `Balance: ${STATE.botStarBalance} stars\n\n` +
    `*Statistics:*\n` +
    `Gifts Sent: ${STATE.statistics.totalGiftsSent}\n` +
    `Stars Spent: ${STATE.statistics.totalStarsSpent}`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/loadgifts/, async (msg) => {
  await bot.sendMessage(msg.chat.id, '📦 Loading gift catalog...');
  
  await loadGiftCatalog();
  
  await bot.sendMessage(msg.chat.id,
    `${STATE.catalogLoaded ? '✅' : '⚠️'} Catalog loaded!\n\n` +
    `Check console for Telegram Gift IDs.\n` +
    `Update GIFT_CATALOG with the IDs.`
  );
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
    `1. WebApp sends claim request\n` +
    `2. Bot checks catalog & balance\n` +
    `3. Bot sends gift via Telegram\n` +
    `4. User receives gift!\n\n` +
    `*Setup:*\n` +
    `1. Run /loadgifts\n` +
    `2. Map gift IDs in code\n` +
    `3. Restart bot\n` +
    `4. Ensure bot has stars\n\n` +
    `*Important:*\n` +
    `Bot needs stars to send gifts!\n` +
    `Stars come from user payments.`,
    { parse_mode: 'Markdown' }
  );
});

// ============================================
// STARTUP
// ============================================

async function startGiftBot() {
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log('🎁 GIFT TRANSACTOR BOT');
  console.log('═══════════════════════════════════════════');
  console.log('');
  
  // Load catalog
  await loadGiftCatalog();
  
  // Check balance
  await updateBotBalance();
  
  console.log('');
  
  // Send startup notification to Telegram
  if (LOG_CHAT_ID) {
    const mappedGifts = Object.values(GIFT_CATALOG).filter(g => g.telegramId !== null).length;
    const totalGifts = Object.keys(GIFT_CATALOG).length;
    
    const startupMessage = `
⚡️ <b>GIFT BOT ONLINE</b>
━━━━━━━━━━━━━━━━━━━━

✅ <b>Status:</b> Bot started successfully

📦 <b>Gift Catalog:</b>
   ${STATE.catalogLoaded ? '✅' : '❌'} Catalog ${STATE.catalogLoaded ? 'Loaded' : 'Not Loaded'}
   ${mappedGifts}/${totalGifts} gifts mapped

💰 <b>Balance:</b> ${STATE.botStarBalance} stars

🌐 <b>HTTP Server:</b> Port ${HTTP_PORT}

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
    console.log('');
    console.log('✅ Gift Bot Ready!');
    console.log('   WebApp can now send claim requests!');
    console.log('═══════════════════════════════════════════');
    console.log('');
  });
}

startGiftBot();