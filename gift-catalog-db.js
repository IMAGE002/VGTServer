// ============================================
// GIFT CATALOG DATABASE SYSTEM
// ============================================
// Version: 2.0 - Production Ready
// Compatible with: Railway, Heroku, Local
// No external dependencies - uses only Node.js built-ins

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class GiftCatalogDB {
  constructor(dbPath = './gift_catalog.json') {
    // Auto-detect Railway environment and use volume path
    if (process.env.RAILWAY_ENVIRONMENT && !dbPath.includes('/app/data/')) {
      dbPath = '/app/data/gift_catalog.json';
      console.log('🚂 Railway detected - using volume storage');
    }
    
    // Ensure directory exists (important for Railway volumes)
    const dir = path.dirname(dbPath);
    if (!fsSync.existsSync(dir)) {
      try {
        fsSync.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      } catch (error) {
        console.error(`❌ Error creating directory ${dir}:`, error.message);
      }
    }
    
    this.dbPath = dbPath;
    this.catalog = {
      gifts: {},           // gift_name -> { telegramId, starCost, displayName }
      prizes: {},          // prize_id -> { giftName, userId, username, claimedAt }
      lastSync: null,      // Last time catalog was synced with Telegram
      version: '2.0'
    };
    
    console.log(`💾 Database path: ${this.dbPath}`);
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  async initialize() {
    try {
      await this.load();
      console.log('✅ Gift catalog database loaded');
      console.log(`📊 Gifts: ${Object.keys(this.catalog.gifts).length}`);
      console.log(`📊 Prizes: ${Object.keys(this.catalog.prizes).length}`);
      return true;
    } catch (error) {
      console.log('📦 Creating new gift catalog database...');
      await this.save();
      return true;
    }
  }

  // ============================================
  // FILE OPERATIONS
  // ============================================

  async load() {
    const data = await fs.readFile(this.dbPath, 'utf8');
    this.catalog = JSON.parse(data);
    
    // Migrate old version if needed
    if (!this.catalog.version || this.catalog.version === '1.0') {
      this.catalog.version = '2.0';
      await this.save();
      console.log('⬆️  Migrated database to v2.0');
    }
    
    console.log(`📖 Loaded catalog v${this.catalog.version} with ${Object.keys(this.catalog.gifts).length} gifts`);
  }

  async save() {
    try {
      // Ensure directory exists before saving
      const dir = path.dirname(this.dbPath);
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }
      
      await fs.writeFile(
        this.dbPath, 
        JSON.stringify(this.catalog, null, 2),
        'utf8'
      );
      console.log('💾 Gift catalog saved');
    } catch (error) {
      console.error('❌ Error saving catalog:', error.message);
      throw error;
    }
  }

  // ============================================
  // GIFT CATALOG MANAGEMENT
  // ============================================

  async updateGiftMapping(giftName, telegramGiftId, starCost, displayName) {
    this.catalog.gifts[giftName] = {
      telegramId: telegramGiftId,
      starCost: starCost,
      displayName: displayName || giftName,
      updatedAt: new Date().toISOString()
    };
    await this.save();
    console.log(`✅ Updated mapping: ${giftName} -> ${telegramGiftId}`);
  }

  async bulkUpdateGifts(giftsArray) {
    // giftsArray format: [{ name, telegramId, starCost, displayName }]
    for (const gift of giftsArray) {
      this.catalog.gifts[gift.name] = {
        telegramId: gift.telegramId,
        starCost: gift.starCost,
        displayName: gift.displayName || gift.name,
        updatedAt: new Date().toISOString()
      };
    }
    this.catalog.lastSync = new Date().toISOString();
    await this.save();
    console.log(`✅ Bulk updated ${giftsArray.length} gift mappings`);
  }

  getGiftMapping(giftName) {
    return this.catalog.gifts[giftName] || null;
  }

  getAllGiftMappings() {
    return { ...this.catalog.gifts };
  }

  isCatalogComplete() {
    const mappedCount = Object.values(this.catalog.gifts).filter(
      g => g.telegramId !== null
    ).length;
    const totalCount = Object.keys(this.catalog.gifts).length;
    return mappedCount === totalCount && totalCount > 0;
  }

  getCatalogCompletionPercentage() {
    const mappedCount = Object.values(this.catalog.gifts).filter(
      g => g.telegramId !== null
    ).length;
    const totalCount = Object.keys(this.catalog.gifts).length;
    return totalCount > 0 ? Math.round((mappedCount / totalCount) * 100) : 0;
  }

  // ============================================
  // PRIZE TRACKING
  // ============================================

  async registerPrize(prizeId, giftName, userId, username) {
    // Check if prize already exists
    if (this.catalog.prizes[prizeId]) {
      console.log(`⚠️  Prize ${prizeId} already exists - updating`);
    }
    
    this.catalog.prizes[prizeId] = {
      giftName: giftName,
      userId: userId,
      username: username || null,
      claimedAt: new Date().toISOString(),
      status: 'pending' // pending, sent, failed
    };
    await this.save();
    console.log(`📝 Registered prize: ${prizeId} -> ${giftName} (User: ${userId})`);
  }

  async updatePrizeStatus(prizeId, status, telegramChargeId = null) {
    if (!this.catalog.prizes[prizeId]) {
      throw new Error(`Prize not found: ${prizeId}`);
    }
    
    this.catalog.prizes[prizeId].status = status;
    this.catalog.prizes[prizeId].updatedAt = new Date().toISOString();
    
    if (telegramChargeId) {
      this.catalog.prizes[prizeId].telegramChargeId = telegramChargeId;
    }
    
    await this.save();
    console.log(`📊 Updated prize ${prizeId} status: ${status}`);
  }

  getPrize(prizeId) {
    return this.catalog.prizes[prizeId] || null;
  }

  async getUserPrizes(userId) {
    return Object.entries(this.catalog.prizes)
      .filter(([_, prize]) => prize.userId === userId)
      .map(([prizeId, prize]) => ({ prizeId, ...prize }));
  }

  async getPendingPrizes() {
    return Object.entries(this.catalog.prizes)
      .filter(([_, prize]) => prize.status === 'pending')
      .map(([prizeId, prize]) => ({ prizeId, ...prize }));
  }

  async getFailedPrizes() {
    return Object.entries(this.catalog.prizes)
      .filter(([_, prize]) => prize.status === 'failed')
      .map(([prizeId, prize]) => ({ prizeId, ...prize }));
  }

  async deletePrize(prizeId) {
    if (!this.catalog.prizes[prizeId]) {
      return false;
    }
    delete this.catalog.prizes[prizeId];
    await this.save();
    console.log(`🗑️  Deleted prize: ${prizeId}`);
    return true;
  }

  // ============================================
  // STATISTICS
  // ============================================

  getStats() {
    const totalGifts = Object.keys(this.catalog.gifts).length;
    const mappedGifts = Object.values(this.catalog.gifts).filter(
      g => g.telegramId !== null
    ).length;
    
    const totalPrizes = Object.keys(this.catalog.prizes).length;
    const sentPrizes = Object.values(this.catalog.prizes).filter(
      p => p.status === 'sent'
    ).length;
    const pendingPrizes = Object.values(this.catalog.prizes).filter(
      p => p.status === 'pending'
    ).length;
    const failedPrizes = Object.values(this.catalog.prizes).filter(
      p => p.status === 'failed'
    ).length;

    // Calculate total stars value of prizes
    let totalStarsValue = 0;
    Object.values(this.catalog.prizes).forEach(prize => {
      const gift = this.catalog.gifts[prize.giftName];
      if (gift && gift.starCost) {
        totalStarsValue += gift.starCost;
      }
    });

    return {
      gifts: {
        total: totalGifts,
        mapped: mappedGifts,
        unmapped: totalGifts - mappedGifts,
        percentage: totalGifts > 0 ? Math.round((mappedGifts / totalGifts) * 100) : 0
      },
      prizes: {
        total: totalPrizes,
        sent: sentPrizes,
        pending: pendingPrizes,
        failed: failedPrizes,
        totalStarsValue: totalStarsValue
      },
      lastSync: this.catalog.lastSync,
      dbPath: this.dbPath,
      environment: process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local',
      version: this.catalog.version
    };
  }

  // ============================================
  // HEALTH CHECK
  // ============================================

  async healthCheck() {
    try {
      // Test read
      await this.load();
      
      // Test write
      const testData = { ...this.catalog };
      testData.healthCheck = new Date().toISOString();
      await fs.writeFile(
        this.dbPath,
        JSON.stringify(testData, null, 2),
        'utf8'
      );
      
      // Restore original
      await this.save();
      
      return {
        status: 'healthy',
        dbPath: this.dbPath,
        readable: true,
        writable: true,
        environment: process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        dbPath: this.dbPath,
        error: error.message,
        environment: process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Local',
        timestamp: new Date().toISOString()
      };
    }
  }

  // ============================================
  // EXPORT / IMPORT
  // ============================================

  async exportCatalog() {
    return JSON.stringify(this.catalog, null, 2);
  }

  async importCatalog(jsonData) {
    const imported = JSON.parse(jsonData);
    
    // Validate structure
    if (!imported.gifts || !imported.prizes) {
      throw new Error('Invalid catalog format');
    }
    
    this.catalog = imported;
    await this.save();
    console.log('✅ Catalog imported successfully');
  }
  
  // ============================================
  // BACKUP / RESTORE
  // ============================================
  
  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = this.dbPath.replace('.json', `_backup_${timestamp}.json`);
      await fs.writeFile(backupPath, JSON.stringify(this.catalog, null, 2), 'utf8');
      console.log(`💾 Backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error('❌ Backup failed:', error.message);
      throw error;
    }
  }
  
  async restoreFromBackup(backupPath) {
    try {
      const data = await fs.readFile(backupPath, 'utf8');
      this.catalog = JSON.parse(data);
      await this.save();
      console.log(`✅ Restored from backup: ${backupPath}`);
    } catch (error) {
      console.error('❌ Restore failed:', error.message);
      throw error;
    }
  }

  // ============================================
  // CLEANUP UTILITIES
  // ============================================

  async cleanupOldPrizes(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    let removed = 0;
    
    for (const [prizeId, prize] of Object.entries(this.catalog.prizes)) {
      const prizeDate = new Date(prize.claimedAt);
      
      // Only cleanup sent prizes older than cutoff
      if (prize.status === 'sent' && prizeDate < cutoffDate) {
        delete this.catalog.prizes[prizeId];
        removed++;
      }
    }
    
    if (removed > 0) {
      await this.save();
      console.log(`🧹 Cleaned up ${removed} old prizes`);
    }
    
    return removed;
  }

  async retryFailedPrizes() {
    const failedPrizes = await this.getFailedPrizes();
    
    for (const prize of failedPrizes) {
      prize.status = 'pending';
      prize.retryCount = (prize.retryCount || 0) + 1;
      prize.retriedAt = new Date().toISOString();
      this.catalog.prizes[prize.prizeId] = prize;
    }
    
    await this.save();
    console.log(`🔄 Reset ${failedPrizes.length} failed prizes to pending`);
    
    return failedPrizes;
  }
}

module.exports = GiftCatalogDB;
