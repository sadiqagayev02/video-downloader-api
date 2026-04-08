// L) routes/download.js
const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const ytdlpService = require('../services/ytdlpService');
const mergeService = require('../services/mergeService');
const cleanupService = require('../services/cleanupService');

const tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';

// Download başlat
router.post('/start', async (req, res) => {
  const { url, quality } = req.body;
  
  if (!url || !quality) {
    return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });
  }

  const fileId = crypto.randomBytes(16).toString('hex');
  console.log(`📥 Download başladı: ${url}, keyfiyyət: ${quality}, ID: ${fileId}`);

  try {
    // Video məlumatını al
    const videoInfo = await ytdlpService.getVideoInfo(url);
    const selectedQuality = videoInfo.qualities.find(q => q.value === quality);
    
    if (!selectedQuality) {
      throw new Error(`Keyfiyyət tapılmadı: ${quality}`);
    }

    let outputPath;

    if (selectedQuality.needsMerge) {
      // Merge tələb olunur (video + audio ayrı)
      console.log('🔄 Merge rejimi aktiv');
      
      const videoPath = path.join(tmpDir, `video_${fileId}.mp4`);
      const audioPath = path.join(tmpDir, `audio_${fileId}.m4a`);
      outputPath = path.join(tmpDir, `out_${fileId}.mp4`);

      // Video və audionu ayrıca yüklə
      await ytdlpService.downloadFormat(url, selectedQuality.videoFormatId, videoPath);
      await ytdlpService.downloadFormat(url, selectedQuality.audioFormatId, audioPath);
      
      // Merge et
      await mergeService.mergeVideoAudio(videoPath, audioPath, outputPath);
      
      // Müvəqqəti faylları təmizlə
      await mergeService.cleanupFiles(videoPath, audioPath);
      
    } else {
      // Birbaşa yükləmə
      console.log('📀 Birbaşa yükləmə rejimi');
      const ext = selectedQuality.ext || 'mp4';
      outputPath = path.join(tmpDir, `out_${fileId}.${ext}`);
      await ytdlpService.downloadFormat(url, selectedQuality.formatId, outputPath);
    }

    // Fayl ölçüsünü yoxla
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) {
      throw new Error('Yüklənmiş fayl boşdur');
    }

    console.log(`✅ Download tamamlandı: ${outputPath} (${stats.size} bytes)`);
    
    res.json({
      success: true,
      fileId: fileId,
      filename: `${videoInfo.title.replace(/[^a-zA-Z0-9]/g, '_')}.${selectedQuality.ext || 'mp4'}`,
      filesize: stats.size
    });

  } catch (err) {
    console.error('❌ Download xətası:', err.message);
    // Təmizlik et
    try {
      const files = await fs.readdir(tmpDir);
      for (const file of files) {
        if (file.includes(fileId)) {
          await fs.unlink(path.join(tmpDir, file));
        }
      }
    } catch (cleanErr) {
      // Ignore
    }
    res.status(500).json({ error: err.message });
  }
});

// Faylı yüklə
router.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const possibleExts = ['mp4', 'm4a'];
  let filePath = null;

  // Faylı axtar
  for (const ext of possibleExts) {
    const testPath = path.join(tmpDir, `out_${fileId}.${ext}`);
    try {
      await fs.access(testPath);
      filePath = testPath;
      break;
    } catch (err) {
      // Fayl yoxdur
    }
  }

  if (!filePath) {
    return res.status(404).json({ error: 'Fayl tapılmadı' });
  }

  console.log(`📤 Fayl göndərilir: ${filePath}`);
  
  // Göndərdikdən sonra sil
  res.download(filePath, (err) => {
    if (err) {
      console.error('❌ Fayl göndərilərkən xəta:', err);
    }
    // Faylı sil
    cleanupService.cleanupFile(filePath);
  });
});

module.exports = router;