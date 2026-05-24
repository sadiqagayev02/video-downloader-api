// services/cleanupService.js
const fs = require('fs').promises;
const path = require('path');

class CleanupService {
  constructor() {
    this.tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';
    this.audioDir = process.env.AUDIO_DIR || '/tmp/audio-downloader';
    this.maxAge = 30 * 60 * 1000; // 30 dəqiqə
    this.cleanupInterval = null;
  }

  startCleanup() {
    // Əvvəlki interval varsa təmizlə
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Hər 15 dəqiqədə təmizlik (Render disk limiti üçün daha tez-tez)
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
      this.cleanupAudioDir();
    }, 15 * 60 * 1000);
    
    // Başlanğıcda bir dəfə
    setTimeout(() => {
      this.cleanup();
      this.cleanupAudioDir();
    }, 5000);
    
    console.log('🧹 Təmizlik servisi işə salındı (15 dəqiqə interval)');
  }

  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('🧹 Təmizlik servisi dayandırıldı');
    }
  }

  async cleanup() {
    await this.cleanupDirectory(this.tmpDir, 'video');
  }

  async cleanupAudioDir() {
    await this.cleanupDirectory(this.audioDir, 'audio');
  }

  async cleanupDirectory(dir, label) {
    try {
      // Qovluq yoxdursa yarat
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
        console.log(`📁 ${label} qovluğu yaradıldı: ${dir}`);
        return;
      }

      const files = await fs.readdir(dir);
      const now = Date.now();
      let deletedCount = 0;
      let totalSize = 0;

      for (const file of files) {
        // Gizli faylları keç
        if (file.startsWith('.')) continue;
        
        const filePath = path.join(dir, file);
        try {
          const stats = await fs.stat(filePath);
          const age = now - stats.mtimeMs;

          if (age > this.maxAge) {
            totalSize += stats.size;
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch (err) {
          // Fayl silinibsə və ya əlçatmazdırsa keç
          if (err.code !== 'ENOENT') {
            console.log(`⚠️ Fayl yoxlanıla bilmədi: ${file} - ${err.message}`);
          }
        }
      }

      if (deletedCount > 0) {
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        console.log(`🧹 ${label}: ${deletedCount} köhnə fayl silindi (${sizeMB} MB)`);
      }
    } catch (err) {
      console.error(`❌ ${label} təmizlik xətası:`, err.message);
    }
  }

  async cleanupFile(filePath) {
    try {
      await fs.access(filePath);
      const stats = await fs.stat(filePath);
      await fs.unlink(filePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(`🗑️ Fayl silindi: ${path.basename(filePath)} (${sizeMB} MB)`);
    } catch (err) {
      // Fayl artıq yoxdursa problem deyil
      if (err.code !== 'ENOENT') {
        console.log(`⚠️ Fayl silinə bilmədi: ${filePath}`);
      }
    }
  }

  // Təcili təmizlik - bütün tmp faylları sil
  async emergencyCleanup() {
    console.log('🚨 Təcili təmizlik başladı...');
    await this.cleanupDirectory(this.tmpDir, 'video');
    await this.cleanupDirectory(this.audioDir, 'audio');
    console.log('✅ Təcili təmizlik tamamlandı');
  }

  // Disk istifadəsini yoxla
  async getDiskUsage() {
    try {
      const videoSize = await this.getDirectorySize(this.tmpDir);
      const audioSize = await this.getDirectorySize(this.audioDir);
      const totalMB = ((videoSize + audioSize) / (1024 * 1024)).toFixed(2);
      return { videoSize, audioSize, totalMB };
    } catch (err) {
      console.error('Disk yoxlama xətası:', err.message);
      return { videoSize: 0, audioSize: 0, totalMB: '0.00' };
    }
  }

  async getDirectorySize(dir) {
    try {
      const files = await fs.readdir(dir);
      let total = 0;
      for (const file of files) {
        if (file.startsWith('.')) continue;
        try {
          const stats = await fs.stat(path.join(dir, file));
          total += stats.size;
        } catch (err) {
          // Keç
        }
      }
      return total;
    } catch {
      return 0;
    }
  }
}

module.exports = new CleanupService();