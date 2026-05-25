const express        = require('express');
const router         = express.Router();
const fs             = require('fs').promises;
const path           = require('path');
const crypto         = require('crypto');
const { exec }       = require('child_process');
const util           = require('util');
const execPromise    = util.promisify(exec);
const ytdlpService   = require('../services/ytdlpService');
const mergeService   = require('../services/mergeService');
const cleanupService = require('../services/cleanupService');

const tmpDir          = process.env.TMP_DIR || '/tmp/video-downloader';
const REQUEST_TIMEOUT = 120000;

// ─── MP4 → MP3 çevrilmə (FFmpeg) ───────────────────────────────────────────
async function toMp3(inputPath, outputPath) {
  console.log(`🎵 MP4 → MP3 çevrilir: ${path.basename(inputPath)}`);
  await execPromise(`ffmpeg -i "${inputPath}" -vn -acodec libmp3lame -q:a 2 -y "${outputPath}"`);
  console.log(`✅ MP3 çevrildi: ${path.basename(outputPath)}`);
}

// ─── Download başlat ──────────────────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { url, quality, platform } = req.body;

  if (!url || !quality) {
    return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });
  }

  const fileId = crypto.randomBytes(16).toString('hex');
  console.log(`📥 Download başladı: ${url.substring(0, 60)}, keyfiyyət: ${quality}, platform: ${platform || 'auto'}, ID: ${fileId}`);

  const timeoutHandle = setTimeout(() => {
    if (!res.headersSent) {
      console.error('⏱️ Request timeout');
      res.status(503).json({ error: 'Server vaxtı keçdi. Yenidən cəhd edin.', retryable: true });
    }
  }, REQUEST_TIMEOUT);

  try {
    await ensureTmpDir();

    console.log(`📡 Video info alınır...`);
    const videoInfo       = await ytdlpService.getVideoInfo(url);
    const selectedQuality = videoInfo.qualities.find(q => q.value === quality);

    console.log(`✅ Info alındı: "${videoInfo.title}" | platform: ${videoInfo.platform}`);
    console.log(`📋 Mövcud keyfiyyətlər: ${videoInfo.qualities.map(q => q.value).join(', ')}`);

    if (!selectedQuality) {
      throw new Error(
        `Keyfiyyət tapılmadı: "${quality}". Mövcud: ${videoInfo.qualities.map(q => q.value).join(', ')}`
      );
    }

    console.log(`🎯 Seçilən: label="${selectedQuality.label}" source="${selectedQuality._source}"`);

    const source = selectedQuality._source || '';

    // ── Audio yoxlaması ──────────────────────────────────────────────────────
    const isAudio = quality === 'audio' ||
      selectedQuality.ext === 'm4a' ||
      selectedQuality.ext === 'mp3' ||
      source.includes('audio');

    console.log(`🔍 isAudio: ${isAudio}`);

    let outputPath;
    let ext;

    // ── AUDIO DOWNLOAD ───────────────────────────────────────────────────────
    if (isAudio) {
      ext        = 'm4a';
      outputPath = path.join(tmpDir, `out_${fileId}.m4a`);
      const detectedPlatform = platform || videoInfo.platform || 'other';

      console.log(`🎵 AUDIO download: platform=${detectedPlatform}, source=${source}`);

      if (source === 'tiktok_audio' || detectedPlatform === 'tiktok') {
        await ytdlpService.downloadTikTokAudio(url, outputPath);
      } else if (source === 'instagram_audio' || detectedPlatform === 'instagram') {
        await ytdlpService.downloadAudio(url, outputPath, 'instagram');
      } else if (source === 'facebook_audio' || detectedPlatform === 'facebook') {
        await ytdlpService.downloadAudio(url, outputPath, 'facebook');
      } else if (detectedPlatform === 'youtube') {
        console.log(`🎵 YouTube audio server-side download`);
        await ytdlpService.downloadYoutubeAudio(url, outputPath);
      } else if (selectedQuality.url) {
        await ytdlpService.downloadByUrl(selectedQuality.url, outputPath);
      } else if (selectedQuality.formatId &&
          selectedQuality.formatId !== 'bestaudio' &&
          selectedQuality.formatId !== 'bestaudio[ext=m4a]') {
        await ytdlpService.downloadFormat(url, selectedQuality.formatId, outputPath);
      } else {
        await ytdlpService.downloadAudio(url, outputPath, detectedPlatform);
      }

    // ── VIDEO DOWNLOAD ───────────────────────────────────────────────────────
    } else {
      ext        = selectedQuality.ext || 'mp4';
      outputPath = path.join(tmpDir, `out_${fileId}.${ext}`);
      const detectedPlatform = platform || videoInfo.platform || 'other';

      console.log(`🎬 VIDEO download: source=${source}, platform=${detectedPlatform}`);

      if (selectedQuality.needsMerge) {
        console.log('🔄 Merge rejimi');
        const videoPath = path.join(tmpDir, `video_${fileId}.mp4`);
        const audioPath = path.join(tmpDir, `audio_${fileId}.m4a`);
        outputPath      = path.join(tmpDir, `out_${fileId}.mp4`);

        await ytdlpService.downloadFormat(url, selectedQuality.videoFormatId, videoPath);
        await ytdlpService.downloadFormat(url, selectedQuality.audioFormatId, audioPath);
        await mergeService.mergeVideoAudio(videoPath, audioPath, outputPath);
        await mergeService.cleanupFiles(videoPath, audioPath);
        console.log(`✅ Merge tamamlandı`);

      } else if (source === 'tiktok_direct') {
        console.log('🎵 TikTok video fallback chain');
        outputPath = path.join(tmpDir, `out_${fileId}.mp4`);
        await ytdlpService.downloadTikTok(url, outputPath);

      } else if (source === 'instagram_direct') {
        console.log('📸 Instagram video fallback chain');
        outputPath = path.join(tmpDir, `out_${fileId}.mp4`);
        await ytdlpService.downloadInstagram(url, outputPath);

      } else if (source === 'facebook_direct' || source === 'generic_direct') {
        console.log(`👤 Facebook/Generic direct (${detectedPlatform})`);
        outputPath = path.join(tmpDir, `out_${fileId}.mp4`);
        await ytdlpService.downloadDirect(url, outputPath, detectedPlatform);

      } else if (selectedQuality.url) {
        console.log('📀 CDN URL yükləmə');
        await ytdlpService.downloadByUrl(selectedQuality.url, outputPath);

      } else if (selectedQuality.formatId) {
        console.log(`📀 Format ID yükləmə: ${selectedQuality.formatId}`);
        await ytdlpService.downloadFormat(url, selectedQuality.formatId, outputPath);

      } else {
        throw new Error('Yükləmə üçün nə URL nə də formatId tapıldı');
      }
    }

    // ── Fayl yoxlaması ───────────────────────────────────────────────────────
    const stats = await fs.stat(outputPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    // ─── MP3 ÇEVİRMƏ (əgər tələb olunubsa) ───────────────────────────────────
    if (quality === 'mp3' || quality === 'audio') {
      console.log(`🎵 MP3 tələb olundu, MP4 → MP3 çevrilir...`);
      const mp3Path = outputPath.replace(/\.(mp4|m4a)$/, '.mp3');
      await toMp3(outputPath, mp3Path);
      await fs.unlink(outputPath); // MP4/M4A faylını sil
      outputPath = mp3Path;
      ext = 'mp3';
      console.log(`✅ MP3 hazırdır: ${path.basename(outputPath)}`);
    }

    const sizeMB    = (stats.size / 1024 / 1024).toFixed(1);
    const safeTitle = (videoInfo.title || 'video')
      .replace(/[^\w\s\u0400-\u04FF\u0600-\u06FF-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video';

    console.log(`✅ Tamamlandı: ${outputPath} (${sizeMB} MB)`);

    clearTimeout(timeoutHandle);

    if (!res.headersSent) {
      res.json({
        success:  true,
        fileId,
        filename: `${safeTitle}.${ext}`,
        filesize: stats.size,
      });
    }

  } catch (err) {
    clearTimeout(timeoutHandle);
    console.error('❌ Download xətası:', err.message);

    try {
      const files = await fs.readdir(tmpDir);
      for (const file of files) {
        if (file.includes(fileId)) {
          await fs.unlink(path.join(tmpDir, file)).catch(() => {});
        }
      }
    } catch (_) {}

    if (!res.headersSent) {
      const isRetryable = err.message.includes('uğursuz') ||
        err.message.includes('timeout') ||
        err.message.includes('network');

      res.status(500).json({
        error: err.message,
        retryable: isRetryable,
      });
    }
  }
});

// ─── Faylı göndər ─────────────────────────────────────────────────────────────
router.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;

  if (!/^[a-f0-9]{32}$/.test(fileId)) {
    return res.status(400).json({ error: 'Yanlış fayl ID' });
  }

  const exts   = ['mp4', 'm4a', 'mp3', 'webm', 'mkv'];
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
    console.log(`⚠️ Fayl tapılmadı: ${fileId}`);
    return res.status(404).json({ error: 'Fayl tapılmadı və ya vaxtı keçib' });
  }

  const stats  = await fs.stat(filePath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`📤 Göndərilir: ${path.basename(filePath)} (${sizeMB} MB)`);

  res.download(filePath, (err) => {
    if (err && !res.headersSent) {
      console.error('❌ Göndərmə xətası:', err);
    }
    cleanupService.cleanupFile(filePath);
    console.log(`🧹 Temp fayl silindi: ${path.basename(filePath)}`);
  });
});

// ─── Yardımçı ─────────────────────────────────────────────────────────────────
async function ensureTmpDir() {
  try {
    await fs.access(tmpDir);
  } catch {
    await fs.mkdir(tmpDir, { recursive: true });
    console.log(`📁 Temp qovluq yaradıldı: ${tmpDir}`);
  }

  try {
    const files = await fs.readdir(tmpDir);
    const now   = Date.now();
    let deleted  = 0;
    for (const file of files) {
      const filePath = path.join(tmpDir, file);
      const stat     = await fs.stat(filePath).catch(() => null);
      if (stat && now - stat.mtimeMs > 60 * 60 * 1000) {
        await fs.unlink(filePath).catch(() => {});
        deleted++;
      }
    }
    if (deleted > 0) console.log(`🧹 ${deleted} köhnə fayl silindi`);
  } catch (_) {}
}

module.exports = router;
