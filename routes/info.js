// routes/info.js

const express = require('express');
const router = express.Router();
const ytdlpService = require('../services/ytdlpService');

router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Info: ${url}`);

  try {
    const result = await ytdlpService.getVideoInfo(url);
    
    if (!result || !result.qualities || result.qualities.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Format tapılmadı' 
      });
    }

    res.json({
      success: true,
      data: {
        title: result.title || 'Video',
        thumbnail: result.thumbnail || '',
        duration: result.duration || '00:00',
        platform: result.platform || 'other',
        uploader: result.uploader || '',
        qualities: result.qualities,
      },
    });
  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;