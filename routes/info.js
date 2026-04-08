// K) routes/info.js
const express = require('express');
const router = express.Router();
const ytdlpService = require('../services/ytdlpService');
const instagramService = require('../services/instagramService');
const tiktokService = require('../services/tiktokService');
const facebookService = require('../services/facebookService');

router.post('/', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL tələb olunur' });
  }

  console.log(`📡 Məlumat sorğusu: ${url}`);

  try {
    let result;
    
    if (url.includes('tiktok.com')) {
      result = await tiktokService.getInfo(url);
    } else if (url.includes('instagram.com')) {
      result = await instagramService.getInfo(url);
    } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
      result = await facebookService.getInfo(url);
    } else {
      result = await ytdlpService.getVideoInfo(url);
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('❌ Info xətası:', err.message);
    
    let errorMessage = err.message;
    if (err.message.includes('Sign in') || err.message.includes('bot')) {
      errorMessage = 'YouTube bu videonu blokladı';
    } else if (err.message.includes('Private')) {
      errorMessage = 'Bu video özəldir';
    } else if (err.message.includes('429')) {
      errorMessage = 'Həddən çox sorğu — gözləyin';
    }
    
    res.status(500).json({ 
      success: false, 
      error: errorMessage 
    });
  }
});

module.exports = router;