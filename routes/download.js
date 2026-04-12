// routes/download.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const ytdlpService = require('../services/ytdlpService');
const mergeService = require('../services/mergeService');
const cleanupService = require('../services/cleanupService');

const tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';

// ─── Download başlat ──────────────────────────────────────────────────────────
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
      throw new Error(
        `Keyfiyyət tapılmadı: "${quality}". Mövcud: ${videoInfo.qualities.map(q => q.value).join(', ')}`
      );
    }

    const ext = selectedQuality.ext || 'mp4';
    let outputPath = path.join(tmpDir, `out_${fileId}.${ext}`);

    const source = selectedQuality._source || '';

    if (selectedQuality.needsMerge) {
      // ── DASH: video + audio ayrı yüklə, birləşdir (YouTube 1080p) ─────────
      console.log('🔄 Merge rejimi');
      const videoPath = path.join(tmpDir, `video_${fileId}.mp4`);
      const audioPath = path.join(tmpDir, `audio_${fileId}.m4a`);
      outputPath = path.join(tmpDir, `out_${fileId}.mp4`);

      await ytdlpService.downloadFormat(url, selectedQuality.videoFormatId, videoPath);
      await ytdlpService.downloadFormat(url, selectedQuality.audioFormatId, audioPath);
      await mergeService.mergeVideoAudio(videoPath, audioPath, outputPath);
      await mergeService.cleanupFiles(videoPath, audioPath);

    } else if (source === 'tiktok_direct' || source === 'generic_direct') {
      // ── TikTok / Instagram / generic: yt-dlp birbaşa yükləyir ────────────
      // URL ayrıca alınmır → imzalı URL köhnəlmir → 403 olmur
      console.log(`🎯 Birbaşa yt-dlp yükləmə: ${videoInfo.platform}`);
      outputPath = path.join(tmpDir, `out_${fileId}.mp4`);
      await ytdlpService.downloadDirect(url, outputPath, videoInfo.platform);

    } else if (selectedQuality.url) {
      // ── Invidious birbaşa CDN URL (YouTube audio/video) ───────────────────
      console.log(`📀 CDN URL yükləmə`);
      await ytdlpService.downloadByUrl(selectedQuality.url, outputPath);

    } else if (selectedQuality.formatId) {
      // ── yt-dlp format ID ilə (YouTube combined) ───────────────────────────
      console.log(`📀 Format ID yükləmə: ${selectedQuality.formatId}`);
      await ytdlpService.downloadFormat(url, selectedQuality.formatId, outputPath);

    } else {
      throw new Error('Yükləmə üçün nə URL nə də formatId tapıldı');
    }

    // Fayl yoxlaması
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const safeTitle = (videoInfo.title || 'video')
      .replace(/[^\w\s\u0400-\u04FF-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video';

    console.log(`✅ Tamamlandı: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

    res.json({
      success: true,
      fileId,
      filename: `${safeTitle}.${ext}`,
      filesize: stats.size,
    });

  } catch (err) {
    console.error('❌ Download xətası:', err.message);

    // Müvəqqəti faylları təmizlə
    try {
      const files = await fs.readdir(tmpDir);
      for (const file of files) {
        if (file.includes(fileId)) {
          await fs.unlink(path.join(tmpDir, file)).catch(() => {});
        }
      }
    } catch (_) {}

    res.status(500).json({ error: err.message });
  }
});

// ─── Faylı göndər ────────────────────────────────────────────────────────────
router.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const exts = ['mp4', 'm4a', 'mp3', 'webm', 'mkv'];
  let filePath = null;

  for (const ext of exts) {
    const testPath = path.join(tmpDir, `out_${fileId}.${ext}`);
    try {
      await fs.access(testPath);
      filePath = testPath;
      break;
    } catch (_) {}
  }

  if (!filePath) {
    return res.status(404).json({ error: 'Fayl tapılmadı' });
  }

  console.log(`📤 Göndərilir: ${filePath}`);
  res.download(filePath, (err) => {
    if (err) console.error('❌ Göndərmə xətası:', err);
    cleanupService.cleanupFile(filePath);
  });
});

module.exports = router;
