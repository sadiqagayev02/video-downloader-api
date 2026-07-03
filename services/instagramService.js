// services/instagramService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class InstagramService {
  constructor() {
    // ═══ 10 FƏRKLİ STRATEGİYA (Cookie YOX) ═══
    this.strategies = [
      // iOS Instagram App (ƏN ÇOX İŞLƏYİR)
      {
        name: 'ig_ios_latest',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Instagram 330.1.0 (iPhone16,2; iOS 17_5_1; en_US; en; scale=3.00; 1290x2796; 604829200)'
      },
      {
        name: 'ig_ios_16',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Instagram 275.0.0.27.98 (iPhone14,2; iOS 16_0; en_US; en; scale=3.00; 1170x2532; 458227617)'
      },
      // Android Instagram App
      {
        name: 'ig_android',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Instagram 269.0.0.18.75 (SM-G991B; Android 13; en_US; tr-TR; scale=2.0; 1080x2220; 442025532)'
      },
      // Desktop Browser
      {
        name: 'ig_chrome',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      },
      {
        name: 'ig_firefox',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
      },
      // Mobile Browser
      {
        name: 'ig_safari_mobile',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      },
      {
        name: 'ig_chrome_mobile',
        args: '--extractor-args "instagram:api_timeout=30"',
        ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
      },
      // High Quality
      {
        name: 'ig_high_quality',
        args: '--extractor-args "instagram:video_quality=high;api_timeout=30"',
        ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      // Default (heç nə olmadan)
      {
        name: 'ig_default',
        args: '--socket-timeout 30',
        ua: ''
      },
    ];
  }

  async getInfo(url) {
    let lastError = null;

    // ═══ FAZA 1: yt-dlp strategiyaları ═══
    for (const strategy of this.strategies) {
      try {
        console.log(`📡 Instagram strategiya: ${strategy.name}`);
        const result = await this.tryYtDlp(url, strategy);
        if (result && result.qualities?.length > 0) {
          console.log(`✅ Instagram uğurlu: ${strategy.name}`);
          return result;
        }
      } catch (err) {
        lastError = err;
        console.log(`⚠️ Instagram ${strategy.name} uğursuz: ${err.message.substring(0, 100)}`);
      }
    }

    // ═══ FAZA 2: 3-cü tərəf API fallback (Cookie YOX!) ═══
    console.log('🔄 Instagram: 3-cü tərəf API-lərə keçirəm...');

    const apiFallbacks = [
      { name: 'SnapSave', fn: () => this.trySnapSave(url) },
      { name: 'SaveFromNet', fn: () => this.trySaveFromNet(url) },
      { name: 'Igram', fn: () => this.tryIgram(url) },
    ];

    for (const api of apiFallbacks) {
      try {
        console.log(`📡 Instagram API: ${api.name}`);
        const result = await api.fn();
        if (result && result.qualities?.length > 0) {
          console.log(`✅ Instagram API uğurlu: ${api.name}`);
          return result;
        }
      } catch (err) {
        lastError = err;
        console.log(`⚠️ Instagram ${api.name} uğursuz: ${err.message}`);
      }
    }

    throw new Error(`Instagram məlumat alınmadı: ${lastError?.message || 'Bütün metodlar uğursuz'}`);
  }

  async tryYtDlp(url, strategy) {
    let cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 20`;
    
    if (strategy.args) cmd += ` ${strategy.args}`;
    if (strategy.ua) cmd += ` --add-header "User-Agent:${strategy.ua}"`;
    cmd += ` "${url}"`;

    const { stdout } = await execPromise(cmd, { 
      timeout: 30000, 
      maxBuffer: 10 * 1024 * 1024 
    });
    
    const data = JSON.parse(stdout);
    return this.processData(data);
  }

  // ═══════════════════════════════════════════════════════════════
  // 3-CÜ TƏRƏF API-LƏR (Cookie Tələb Etmir!)
  // ═══════════════════════════════════════════════════════════════

  async trySnapSave(url) {
    try {
      const formData = new URLSearchParams();
      formData.append('url', url);
      formData.append('action', 'post');

      const res = await fetch('https://snapsave.io/action.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://snapsave.io/',
          'Origin': 'https://snapsave.io'
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      // SnapSave base64-encoded JSON qaytarır
      const decodeMatch = html.match(/decode\("([^"]+)"\)/);
      if (!decodeMatch) throw new Error('Decode tapılmadı');

      const decoded = Buffer.from(decodeMatch[1], 'base64').toString('utf8');
      
      // Video URL-ləri tap
      const urlMatches = decoded.match(/href="([^"]+\.mp4[^"]*)"/g) || [];
      if (urlMatches.length === 0) throw new Error('Video URL tapılmadı');

      const videoUrl = urlMatches[0].replace('href="', '').replace('"', '');

      return {
        title: 'Instagram Video',
        thumbnail: '',
        duration: '00:00',
        uploader: '',
        platform: 'instagram',
        qualities: [{
          label: 'HD Video',
          value: 'video',
          formatId: null,
          url: videoUrl,
          filesize: null,
          ext: 'mp4',
          needsMerge: false,
          _source: 'snapsave'
        }]
      };
    } catch (err) {
      throw new Error(`SnapSave: ${err.message}`);
    }
  }

  async trySaveFromNet(url) {
    try {
      const formData = new URLSearchParams();
      formData.append('url', url);

      const res = await fetch('https://savefrom.net/api/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://savefrom.net/'
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.url) throw new Error('URL yoxdur');

      return {
        title: data.title || 'Instagram Video',
        thumbnail: data.thumb || '',
        duration: '00:00',
        uploader: '',
        platform: 'instagram',
        qualities: [{
          label: 'HD Video',
          value: 'video',
          formatId: null,
          url: data.url,
          filesize: null,
          ext: 'mp4',
          needsMerge: false,
          _source: 'savefromnet'
        }]
      };
    } catch (err) {
      throw new Error(`SaveFromNet: ${err.message}`);
    }
  }

  async tryIgram(url) {
    try {
      const formData = new URLSearchParams();
      formData.append('url', url);

      const res = await fetch('https://igram.io/api/instagram/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://igram.io/'
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.download_url) throw new Error('Download URL yoxdur');

      return {
        title: 'Instagram Video',
        thumbnail: data.thumbnail || '',
        duration: '00:00',
        uploader: '',
        platform: 'instagram',
        qualities: [{
          label: 'HD Video',
          value: 'video',
          formatId: null,
          url: data.download_url,
          filesize: null,
          ext: 'mp4',
          needsMerge: false,
          _source: 'igram'
        }]
      };
    } catch (err) {
      throw new Error(`Igram: ${err.message}`);
    }
  }

  processData(data) {
    const qualities = [];

    if (data.formats && data.formats.length > 0) {
      const videoFormats = data.formats.filter(f => 
        f.vcodec !== 'none' && f.acodec !== 'none'
      );

      if (videoFormats.length > 0) {
        const bestVideo = videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        qualities.push({
          label: bestVideo.height ? `${bestVideo.height}p` : 'HD Video',
          value: 'video',
          formatId: bestVideo.format_id,
          url: bestVideo.url,
          filesize: bestVideo.filesize,
          ext: 'mp4',
          needsMerge: false,
          _source: 'instagram_direct'
        });
      }
    }

    const audio = data.formats?.find(f => f.acodec !== 'none' && f.vcodec === 'none');
    if (audio) {
      qualities.push({
        label: 'MP3 (Audio)',
        value: 'audio',
        formatId: audio.format_id,
        url: audio.url,
        filesize: audio.filesize,
        ext: 'm4a',
        needsMerge: false,
        _source: 'instagram_direct'
      });
    }

    if (qualities.length === 0) {
      qualities.push({
        label: 'Video',
        value: 'video',
        formatId: null,
        url: data.url || data.webpage_url,
        filesize: data.filesize,
        ext: 'mp4',
        needsMerge: false,
        _source: 'instagram_direct'
      });
    }

    return {
      title: data.title || data.uploader || 'Instagram Video',
      thumbnail: data.thumbnail || '',
      duration: this.formatDuration(data.duration),
      uploader: data.uploader || '',
      platform: 'instagram',
      qualities
    };
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

module.exports = new InstagramService();
