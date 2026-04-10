app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Məlumat: ${url}`);

  try {
    const result = await fetchInfo(url);
    let qualities = [];
    let title = 'Video';
    let thumbnail = '';
    let duration = '00:00';
    let platform = 'youtube';
    let uploader = '';

    if (result._source === 'invidious') {
      const d = result._rawData;
      qualities = buildQualitiesFromInvidious(d);
      title = d.title || 'Video';
      thumbnail = d.videoThumbnails?.[0]?.url || '';
      const secs = d.lengthSeconds || 0;
      duration = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
      uploader = d.author || '';
      platform = 'youtube';
    } else {
      const d = result._rawData;
      qualities = buildQualities(d, url);
      title = d.title || 'Video';
      thumbnail = d.thumbnail || '';
      duration = d.duration
        ? `${Math.floor(d.duration / 60)}:${(d.duration % 60).toString().padStart(2, '0')}`
        : '00:00';
      uploader = d.uploader || d.channel || '';
      if (url.includes('tiktok.com')) platform = 'tiktok';
      else if (url.includes('instagram.com')) platform = 'instagram';
      else if (url.includes('facebook.com')) platform = 'facebook';
    }

    if (qualities.length === 0) {
      return res.status(404).json({ success: false, error: 'Format tapılmadı' });
    }

    res.json({
      success: true,
      data: { title, thumbnail, duration, platform, uploader, qualities },
    });
  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});
