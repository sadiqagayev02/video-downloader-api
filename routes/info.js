// routes/info.js
const express = require('express');
const router = express.Router();
const youtubeService = require('../services/youtubeService');   // ← yeni ad
const instagramService = require('../services/instagramService');
const tiktokService = require('../services/tiktokService');
const facebookService = require('../services/facebookService');

// URL-dən platformanı müəyyən et
function detectPlatform(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('tiktok.com'))    return 'tiktok';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
  return 'youtube'; // default — yt-dlp çoxunu dəstəkləyir
}

router.post('/', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ success: false, error: 'Düzgün URL daxil edin' });
  }

  const platform = detectPlatform(url.trim());
  console.log(`📡 [${platform.toUpperCase()}] Məlumat sorğusu: ${url}`);

  try {
    let result;

    switch (platform) {
      case 'tiktok':
        result = await tiktokService.getInfo(url);
        break;
      case 'instagram':
        result = await instagramService.getInfo(url);
        break;
      case 'facebook':
        result = await facebookService.getInfo(url);
        break;
      default:
        result = await youtubeService.getVideoInfo(url);   // ← yeni service
    }

    console.log(`✅ [${platform.toUpperCase()}] "${result.title}" — ${result.qualities?.length ?? 0} keyfiyyət`);

    return res.json({ success: true, data: result });

  } catch (err) {
    console.error(`❌ [${platform.toUpperCase()}] Xəta:`, err.message);
    return res.status(500).json({
      success: false,
      error: mapError(err.message),
    });
  }
});

// Xəta mesajlarını istifadəçi üçün sadələşdir
function mapError(msg) {
  if (!msg) return 'Naməlum xəta';
  if (msg.includes('Sign in') || msg.includes('bot') || msg.includes('blocked'))
    return 'YouTube bu videonu blokladı. Bir az sonra cəhd edin';
  if (msg.includes('Private'))
    return 'Bu video özəldir';
  if (msg.includes('429') || msg.includes('Too Many'))
    return 'Həddən çox sorğu — bir neçə saniyə gözləyin';
  if (msg.includes('Unavailable') || msg.includes('not available'))
    return 'Video mövcud deyil və ya silinib';
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT'))
    return 'Serverlə əlaqə zaman aşımına uğradı';
  return msg;
}

module.exports = router;
