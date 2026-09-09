// routes/info.js - YENİLƏNMİŞ
const express = require('express');
const router = express.Router();
const ytdlpService = require('../services/ytdlpService');
const instagramServiceV3 = require('../services/instagramServiceV3');

router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Info: ${url}`);

  try {
    // Instagram üçün yeni V3 servis
    if (url.includes('instagram.com') || url.includes('instagr.am')) {
      console.log('📸 Instagram V3 servis istifadə olunur...');
      const result = await instagramServiceV3.getInfo(url);
      
      if (!result || !result.qualities || result.qualities.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Format tapılmadı' 
        });
      }

      return res.json({
        success: true,
        data: {
          title: result.title || 'Instagram Video',
          thumbnail: result.thumbnail || '',
          duration: result.duration || '00:00',
          platform: 'instagram',
          uploader: result.uploader || '',
          qualities: result.qualities,
        },
      });
    }

    // Digər platformalar üçün köhnə service
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
    res.status(500).json({ 
      success: false, 
      error: 'Instagram məlumatı alınmadı. Bir az sonra yenidən cəhd edin.',
      details: err.message 
    });
  }
});

// Statistikalar üçün
router.get('/instagram-stats', (req, res) => {
  res.json({ 
    success: true, 
    stats: instagramServiceV3.getStats() 
  });
});

module.exports = router;
