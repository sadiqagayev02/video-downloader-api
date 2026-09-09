// services/instagramServiceV3.js - ƏSAS YENİ VERSİYA
// Cookie'suz, çox qatlı, özünü yeniləyən sistem

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const https = require('https');
const http = require('http');

class InstagramServiceV3 {
  constructor() {
    this.methodStats = new Map(); // Hansı metod neçə dəfə uğurlu olub
    this.currentMethod = null;
    this.lastSuccessfulMethod = null;
    
    // Bütün metodlar sıra ilə cəhd ediləcək
    this.methods = [
      'instagram_web_api',      // 1. Instagram Web API (ən sürətli)
      'instagram_embed_api',    // 2. Embed API (çox stabil)
      'ytdlp_mobile',           // 3. yt-dlp mobil client
      'ytdlp_web',              // 4. yt-dlp web client
      'instagram_graphql',      // 5. GraphQL API
      'instagram_oembed',       // 6. oEmbed API (ən stabil)
      'ytdlp_generic',          // 7. yt-dlp generic
      'direct_cdn',             // 8. Birbaşa CDN URL
    ];

    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
    ];
  }

  async getInfo(url) {
    const shortcode = this.extractShortcode(url);
    if (!shortcode) {
      throw new Error('Instagram URL düzgün deyil');
    }

    console.log(`📸 Instagram: ${shortcode} üçün məlumat alınır...`);

    // Əvvəlki uğurlu metodla başla (əgər varsa)
    if (this.lastSuccessfulMethod) {
      try {
        console.log(`📸 Keçən uğurlu metod: ${this.lastSuccessfulMethod}`);
        return await this.tryMethod(this.lastSuccessfulMethod, url, shortcode);
      } catch (err) {
        console.log(`⚠️ Keçən metod uğursuz: ${err.message.substring(0, 50)}`);
      }
    }

    // Bütün metodları sıra ilə cəhd et
    let lastError = null;
    for (const method of this.methods) {
      try {
        console.log(`📸 [${method}] cəhd edilir...`);
        const result = await this.tryMethod(method, url, shortcode);
        
        if (result && result.qualities && result.qualities.length > 0) {
          this.lastSuccessfulMethod = method;
          this.recordSuccess(method);
          console.log(`✅ [${method}] UĞURLU!`);
          return result;
        }
      } catch (err) {
        console.log(`❌ [${method}] uğursuz: ${err.message.substring(0, 80)}`);
        lastError = err;
        this.recordFailure(method);
      }
    }

    throw new Error(`Instagram bütün metodlar uğursuz: ${lastError?.message}`);
  }

  async tryMethod(method, url, shortcode) {
    switch (method) {
      case 'instagram_web_api':
        return await this.getViaWebAPI(shortcode);
      
      case 'instagram_embed_api':
        return await this.getViaEmbedAPI(shortcode);
      
      case 'ytdlp_mobile':
        return await this.getViaYtdlp(url, 'mobile');
      
      case 'ytdlp_web':
        return await this.getViaYtdlp(url, 'web');
      
      case 'instagram_graphql':
        return await this.getViaGraphQL(shortcode);
      
      case 'instagram_oembed':
        return await this.getViaOEmbed(url);
      
      case 'ytdlp_generic':
        return await this.getViaYtdlp(url, 'generic');
      
      case 'direct_cdn':
        return await this.getViaDirectCDN(url);
      
      default:
        throw new Error(`Naməlum metod: ${method}`);
    }
  }

  // ─── 1. Instagram Web API ────────────────────────────────────────────────
  async getViaWebAPI(shortcode) {
    const endpoint = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
    const data = await this.httpGet(endpoint);
    
    if (!data || !data.items || data.items.length === 0) {
      throw new Error('Web API boş cavab');
    }

    return this.processWebAPIData(data.items[0]);
  }

  // ─── 2. Instagram Embed API ──────────────────────────────────────────────
  async getViaEmbedAPI(shortcode) {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const html = await this.httpGetRaw(embedUrl);
    
    // Embed HTML-dən JSON məlumatı çıxar
    const jsonMatch = html.match(/window\.__additionalDataLoaded\('extra',(.*?)\);<\/script>/);
    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('Embed JSON tapılmadı');
    }

    const data = JSON.parse(jsonMatch[1]);
    return this.processEmbedData(data);
  }

  // ─── 3-4. yt-dlp metodları ───────────────────────────────────────────────
  async getViaYtdlp(url, clientType) {
    const ua = this.getRandomUA(clientType);
    
    const strategies = {
      mobile: [
        '--extractor-args "instagram:api=web"',
        '--extractor-args "instagram:prefer_authenticated=false"',
      ],
      web: [
        '--extractor-args "instagram:api=graphql"',
        '--add-header "x-ig-app-id:936619743392459"',
      ],
      generic: [
        '--no-check-certificates',
        '--extractor-args "instagram:prefer_embedded=true"',
      ]
    };

    const args = strategies[clientType] || strategies.generic;

    for (const extraArg of args) {
      try {
        const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 15 --user-agent "${ua}" ${extraArg} "${url}"`;
        const { stdout } = await execPromise(cmd, { 
          timeout: 20000,
          maxBuffer: 20 * 1024 * 1024 
        });
        
        const data = JSON.parse(stdout);
        if (data && data.formats && data.formats.length > 0) {
          return this.processYtdlpData(data);
        }
      } catch (err) {
        // Bu strategiya uğursuz, digərinə keç
        continue;
      }
    }

    throw new Error('yt-dlp ilə məlumat alınmadı');
  }

  // ─── 5. GraphQL API ──────────────────────────────────────────────────────
  async getViaGraphQL(shortcode) {
    const endpoint = `https://www.instagram.com/graphql/query/?query_hash=2c4c2e343a8f64c625ba02b2aa12c7f8&variables=${encodeURIComponent(JSON.stringify({shortcode}))}`;
    const data = await this.httpGet(endpoint);
    
    const media = data?.data?.shortcode_media;
    if (!media) throw new Error('GraphQL cavabında media yoxdur');

    return this.processGraphQLData(media);
  }

  // ─── 6. oEmbed API (çox stabil) ─────────────────────────────────────────
  async getViaOEmbed(url) {
    const endpoint = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`;
    const data = await this.httpGet(endpoint);
    
    if (!data || !data.thumbnail_url) {
      throw new Error('oEmbed məlumatı yoxdur');
    }

    // oEmbed yalnız thumbnail verir, video üçün embed API lazımdır
    const shortcode = this.extractShortcode(url);
    return await this.getViaEmbedAPI(shortcode);
  }

  // ─── 8. Direct CDN ───────────────────────────────────────────────────────
  async getViaDirectCDN(url) {
    // Son çarə - birbaşa yükləmə linki tapmaq
    try {
      const shortcode = this.extractShortcode(url);
      const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
      
      const cmd = `yt-dlp --get-url --no-playlist "${embedUrl}"`;
      const { stdout } = await execPromise(cmd, { timeout: 10000 });
      
      const directUrl = stdout.trim();
      if (directUrl && directUrl.startsWith('http')) {
        return {
          title: 'Instagram Video',
          thumbnail: '',
          duration: '00:00',
          uploader: '',
          platform: 'instagram',
          qualities: [{
            label: 'HD Video',
            value: 'video',
            formatId: 'direct',
            url: directUrl,
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: 'direct_cdn'
          }]
        };
      }
    } catch (err) {
      throw new Error('CDN URL tapılmadı');
    }
  }

  // ─── HTTP köməkçiləri ────────────────────────────────────────────────────
  httpGet(url) {
    return new Promise((resolve, reject) => {
      const ua = this.getRandomUA('web');
      const options = {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        }
      };

      https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('JSON parse xətası'));
          }
        });
      }).on('error', reject);
    });
  }

  httpGetRaw(url) {
    return new Promise((resolve, reject) => {
      const ua = this.getRandomUA('web');
      const options = {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      };

      https.get(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }

  // ─── Data emalı ──────────────────────────────────────────────────────────
  processWebAPIData(item) {
    const qualities = [];
    
    // Video variantları
    if (item.video_versions) {
      const seenHeights = new Set();
      for (const video of item.video_versions) {
        const height = video.height || 0;
        if (!seenHeights.has(height) && height > 0) {
          seenHeights.add(height);
          qualities.push({
            label: `${height}p`,
            value: `${height}p`,
            formatId: `web_${height}`,
            url: video.url,
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: 'instagram_web_api'
          });
        }
      }
    }

    // Audio
    if (item.video_versions && item.video_versions.length > 0) {
      qualities.push({
        label: 'MP3 (Audio)',
        value: 'audio',
        formatId: 'audio',
        url: item.video_versions[0].url,
        filesize: null,
        ext: 'm4a',
        needsMerge: false,
        _source: 'instagram_web_api'
      });
    }

    return {
      title: item.caption?.text?.substring(0, 100) || 'Instagram Video',
      thumbnail: item.image_versions2?.candidates?.[0]?.url || '',
      duration: this.formatDuration(item.video_duration || 0),
      uploader: item.user?.username || '',
      platform: 'instagram',
      qualities
    };
  }

  processEmbedData(data) {
    const qualities = [];
    const media = data?.shortcode_media || data?.media || data;

    if (media.video_versions) {
      const seenHeights = new Set();
      for (const video of media.video_versions) {
        const height = video.height || 0;
        if (!seenHeights.has(height) && height > 0) {
          seenHeights.add(height);
          qualities.push({
            label: `${height}p`,
            value: `${height}p`,
            formatId: `embed_${height}`,
            url: video.url,
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: 'instagram_embed'
          });
        }
      }
    }

    if (media.video_versions && media.video_versions.length > 0) {
      qualities.push({
        label: 'MP3 (Audio)',
        value: 'audio',
        formatId: 'audio',
        url: media.video_versions[0].url,
        filesize: null,
        ext: 'm4a',
        needsMerge: false,
        _source: 'instagram_embed'
      });
    }

    return {
      title: media.caption?.text?.substring(0, 100) || 'Instagram Video',
      thumbnail: media.image_versions2?.candidates?.[0]?.url || '',
      duration: this.formatDuration(media.video_duration || 0),
      uploader: media.user?.username || '',
      platform: 'instagram',
      qualities
    };
  }

  processGraphQLData(media) {
    return this.processEmbedData(media);
  }

  processYtdlpData(data) {
    const qualities = [];
    
    if (data.formats) {
      const videoFormats = data.formats
        .filter(f => f.vcodec !== 'none')
        .sort((a, b) => (b.height || 0) - (a.height || 0));

      const seenHeights = new Set();
      for (const format of videoFormats) {
        const height = format.height || 0;
        if (!seenHeights.has(height) && height > 0) {
          seenHeights.add(height);
          qualities.push({
            label: `${height}p`,
            value: `${height}p`,
            formatId: format.format_id,
            url: format.url,
            filesize: format.filesize,
            ext: 'mp4',
            needsMerge: false,
            _source: 'ytdlp'
          });
        }
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
        _source: 'ytdlp'
      });
    }

    return {
      title: data.title || 'Instagram Video',
      thumbnail: data.thumbnail || '',
      duration: this.formatDuration(data.duration || 0),
      uploader: data.uploader || '',
      platform: 'instagram',
      qualities
    };
  }

  // ─── Köməkçi funksiyalar ─────────────────────────────────────────────────
  extractShortcode(url) {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;
      
      const matches = path.match(/\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/);
      if (matches && matches[1]) {
        return matches[1];
      }
      
      if (path.includes('/stories/')) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length >= 3) {
          return parts[2];
        }
      }
      
      return null;
    } catch {
      return null;
    }
  }

  getRandomUA(type = 'web') {
    if (type === 'mobile') {
      const mobileUAs = this.userAgents.filter(ua => 
        ua.includes('iPhone') || ua.includes('Android')
      );
      return mobileUAs[Math.floor(Math.random() * mobileUAs.length)];
    }
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  recordSuccess(method) {
    const stats = this.methodStats.get(method) || { success: 0, fail: 0 };
    stats.success++;
    this.methodStats.set(method, stats);
  }

  recordFailure(method) {
    const stats = this.methodStats.get(method) || { success: 0, fail: 0 };
    stats.fail++;
    this.methodStats.set(method, stats);
  }

  getStats() {
    return Object.fromEntries(this.methodStats);
  }
}

module.exports = new InstagramServiceV3();
