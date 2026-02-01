// ============================================
// GIFT CATALOG DATABASE MODULE
// ============================================
// Simple JSON-based database for gift catalog and prize tracking

const fs = require('fs').promises;
const path = require('path');

class GiftCatalogDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = {
      gifts: {},
      prizes: {},
      metadata: {
        lastSync: null,
        version: '2.0'
      }
    };
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  async initialize() {
    try {
      const exists = await this.fileExists(this.filePath);
      
      if (exists) {
        await this.load();
        console.log('✅ Gift catalog loaded from disk');
      } else {
        await this.save();
        console.log('✅ New gift catalog created');
      }
    } catch (error) {
      console.error('❌ Error initializing database:', error);
      throw error;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // FILE OPERATIONS
  // ============================================

  async load() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(data);
    } catch (error) {
      console.error('❌ Error loading database:', error);
      throw error;
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (error) {
      console.error('❌ Error saving database:', error);
      throw error;
    }
  }

  // ============================================
  // GIFT CATALOG OPERATIONS
  // ============================================

  async updateGiftMapping(giftName, telegramId, starCost, displayName) {
  this.data.gifts[giftName] = {
    telegramId: telegramId,
    starCost: starCost,
    displayName: displayName || giftName,
    lastUpdated: new Date().toISOString()
  };
  
  if (telegramId) {
    this.data.metadata.lastSync = new Date().toISOString();
  }
  
  await this.save();
}

getGiftMapping(giftName) {
  return this.data.gifts[giftName] || null;
}

// ✅ NEW METHOD: Reverse lookup by Telegram ID
getGiftMappingByTelegramId(telegramId) {
  const gifts = this.data.gifts;
  
  for (const [giftName, giftData] of Object.entries(gifts)) {
    if (giftData.telegramId === telegramId) {
      return {
        giftName: giftName,
        ...giftData
      };
    }
  }
  
  return null;
}

getAllGiftMappings() {
  return { ...this.data.gifts };
}

  // ============================================
  // PRIZE TRACKING OPERATIONS
  // ============================================

  async registerPrize(prizeId, giftName, userId, username) {
    this.data.prizes[prizeId] = {
      prizeId: prizeId,
      giftName: giftName,
      userId: userId,
      username: username,
      status: 'pending',
      claimedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await this.save();
  }

  async updatePrizeStatus(prizeId, status) {
    if (this.data.prizes[prizeId]) {
      this.data.prizes[prizeId].status = status;
      this.data.prizes[prizeId].updatedAt = new Date().toISOString();
      await this.save();
    }
  }

  getPrize(prizeId) {
    return this.data.prizes[prizeId] || null;
  }

  async getPendingPrizes() {
    return Object.values(this.data.prizes).filter(p => p.status === 'pending');
  }

  async getUserPrizes(userId) {
    return Object.values(this.data.prizes).filter(p => p.userId === userId);
  }

  async deletePrize(prizeId) {
    if (this.data.prizes[prizeId]) {
      delete this.data.prizes[prizeId];
      await this.save();
    }
  }

  // ============================================
  // STATISTICS
  // ============================================

  getStats() {
    const gifts = Object.values(this.data.gifts);
    const prizes = Object.values(this.data.prizes);
    
    const mappedGifts = gifts.filter(g => g.telegramId !== null);
    
    return {
      gifts: {
        total: gifts.length,
        mapped: mappedGifts.length,
        unmapped: gifts.length - mappedGifts.length,
        percentage: gifts.length > 0 
          ? Math.round((mappedGifts.length / gifts.length) * 100) 
          : 0
      },
      prizes: {
        total: prizes.length,
        pending: prizes.filter(p => p.status === 'pending').length,
        sent: prizes.filter(p => p.status === 'sent').length,
        failed: prizes.filter(p => p.status === 'failed').length
      },
      lastSync: this.data.metadata.lastSync
    };
  }

  // ============================================
  // CLEANUP
  // ============================================

  async cleanup(olderThanDays = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    let cleaned = 0;
    
    for (const [prizeId, prize] of Object.entries(this.data.prizes)) {
      const prizeDate = new Date(prize.updatedAt);
      if (prizeDate < cutoffDate && (prize.status === 'sent' || prize.status === 'failed')) {
        delete this.data.prizes[prizeId];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await this.save();
      console.log(`🧹 Cleaned up ${cleaned} old prizes`);
    }
    
    return cleaned;
  }
}

module.exports = GiftCatalogDB;
