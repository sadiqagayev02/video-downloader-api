// F) services/cleanupService.js
const fs = require('fs').promises;
const path = require('path');

class CleanupService {
  constructor() {
    this.tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';
    this.maxAge = 30 * 60 * 1000; // 30 dəqiqə
  }

  startCleanup() {
    // Hər 30 dəqiqədə təmizlik
    setInterval(() => this.cleanup(), 30 * 60 * 1000);
    // Başlanğıcda bir dəfə
    this.cleanup();
    console.log('🧹 Təmizlik servisi işə salındı');
  }

  async cleanup() {
    try {
      const files = await fs.readdir(this.tmpDir);
      const now = Date.now();
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(this.tmpDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > this.maxAge) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }

      if (deletedCount > 0) {
        console.log(`🧹 ${deletedCount} köhnə fayl silindi`);
      }
    } catch (err) {
      console.error('❌ Təmizlik xətası:', err.message);
    }
  }

  async cleanupFile(filePath) {
    try {
      await fs.unlink(filePath);
      console.log(`🗑️ Fayl silindi: ${filePath}`);
    } catch (err) {
      // Səhvi ignore et
    }
  }
}

module.exports = new CleanupService();