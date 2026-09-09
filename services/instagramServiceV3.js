// services/instagramServiceV3.js
const https = require('https');
const http = require('http');

class InstagramServiceV3 {
  constructor() {
    this.lastSuccessfulMethod = null;
  }

  async getInfo(url) {
    console.log('📸 Instagram V3:', url);
    
    const shortcode = this.extractShortcode(url);
    if (!shortcode) {
      throw new Error('Instagram URL düzgün deyil');
    }

    // Embed səhifəsini yüklə
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    console.log('📸 Embed URL:', embedUrl);

    try {
      // 1. Embed səhifəsini yüklə
      const html = await this.loadEmbedPage(embedUrl);
      
      // 2. HTML-dən video URL-ni tap
      const videoUrl = this.extractVideoUrl(html);
      
      if (!videoUrl) {
        throw new Error('Video URL tapılmadı');
      }

      console.log('✅ Video URL tapıldı!');

      // 3. Keyfiyyət siyahısı yarat
      return {
        title: 'Instagram Video',
        thumbnail: '',
        duration: '00:00',
        uploader: '',
        platform: 'instagram',
        qualities: [
          {
            label: 'HD Video',
            value: 'video',
            formatId: 'direct',
            url: videoUrl,
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: 'instagram_embed_direct'
          },
          {
            label: 'MP3 (Audio)',
            value: 'audio',
            formatId: 'audio',
            url: videoUrl,
            filesize: null,
            ext: 'm4a',
            needsMerge: false,
            _source: 'instagram_embed_direct'
          }
        ]
      };
    } catch (err) {
      console.error('❌ Instagram V3 xətası:', err.message);
      throw err;
    }
  }

  // Embed səhifəsini yüklə
  loadEmbedPage(url) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'www.instagram.com',
        path: url.replace('https://www.instagram.com', ''),
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        },
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        let html = '';
        
        res.on('data', (chunk) => {
          html += chunk;
        });
        
        res.on('end', () => {
          resolve(html);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });

      req.end();
    });
  }

  // HTML-dən video URL çıxar
  extractVideoUrl(html) {
    // Bütün mümkün nümunələri yoxla
    const patterns = [
      /https:\/\/[^"']*\.mp4[^"']*/g,  // .mp4 URL
      /https:\/\/[^"']*video[^"']*/g,   // video URL
      /"video_url":"([^"]+)"/,          // video_url JSON
      /"url":"(https:\/\/[^"]*\.mp4[^"]*)"/, // url JSON
      /https:\/\/instagram\.f[^"']*\.mp4[^"']*/g, // instagram CDN
      /https:\/\/scontent[^"']*\.mp4[^"']*/g, // scontent CDN
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[0]) {
        // URL-i təmizlə
        let videoUrl = match[0];
        // Escape olunmuş simvolları düzəlt
        videoUrl = videoUrl.replace(/\\\//g, '/');
        videoUrl = videoUrl.replace(/\\u0026/g, '&');
        return videoUrl;
      }
    }

    return null;
  }

  // Shortcode çıxar
  extractShortcode(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const matches = path.match(/\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
      if (matches && matches[1]) {
        return matches[1];
      }
      
      return null;
    } catch {
      return null;
    }
  }
}

module.exports = new InstagramServiceV3();
