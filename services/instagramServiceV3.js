// services/instagramServiceV3.js - TAM YENİLƏNMİŞ
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const https = require('https');
const http = require('http');

class InstagramServiceV3 {
  constructor() {
    this.lastSuccessfulMethod = null;
    this.methodStats = new Map();
  }

  async getInfo(url) {
    console.log('📸 Instagram V3 başladı:', url);
    
    const shortcode = this.extractShortcode(url);
    console.log('📸 Shortcode:', shortcode);
    
    if (!shortcode) {
      throw new Error('Instagram URL-dən shortcode tapılmadı');
    }

    // ƏSAS: Bütün metodları yoxla
    const methods = [
      { name: 'instagram_web_api_v2', fn: () => this.tryWebAPIv2(shortcode) },
      { name: 'ytdlp_no_check', fn: () => this.tryYtdlpNoCheck(url) },
      { name: 'ytdlp_extractor_args', fn: () => this.tryYtdlpExtractorArgs(url) },
      { name: 'instagram_public_api', fn: () => this.tryPublicAPI(shortcode) },
      { name: 'ytdlp_embed', fn: () => this.tryYtdlpEmbed(url, shortcode) },
      { name: 'instagram_embed_page', fn: () => this.tryEmbedPage(shortcode) },
    ];

    let lastError = null;

    for (const method of methods) {
      try {
        console.log(`📸 [${method.name}] cəhd edilir...`);
        const result = await method.fn();
        
        if (result && result.qualities && result.qualities.length > 0) {
          this.lastSuccessfulMethod = method.name;
          this.recordSuccess(method.name);
          console.log(`✅ [${method.name}] UĞURLU!`);
          return result;
        } else {
          console.log(`⚠️ [${method.name}] boş nəticə`);
        }
      } catch (err) {
        console.log(`❌ [${method.name}] uğursuz: ${err.message.substring(0, 100)}`);
        lastError = err;
        this.recordFailure(method.name);
      }
    }

    throw new Error(`Instagram bütün metodlar uğursuz: ${lastError?.message}`);
  }

  // ─── Metod 1: Web API v2 (fərqli parametrlərlə) ──────────────────────────
  async tryWebAPIv2(shortcode) {
    const endpoints = [
      `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`,
      `https://www.instagram.com/reel/${shortcode}/?__a=1&__d=dis`,
      `https://www.instagram.com/tv/${shortcode}/?__a=1&__d=dis`,
    ];

    for (const endpoint of endpoints) {
      try {
        const data = await this.httpRequest(endpoint);
        
        if (data && data.items && data.items.length > 0) {
          return this.processWebAPIData(data.items[0]);
        }
        
        if (data && data.graphql && data.graphql.shortcode_media) {
          return this.processGraphQLData(data.graphql.shortcode_media);
        }
      } catch (err) {
        continue;
      }
    }

    throw new Error('Web API v2 uğursuz');
  }

  // ─── Metod 2: yt-dlp certificate yoxlanışı olmadan ──────────────────────
  async tryYtdlpNoCheck(url) {
    const cmd = `yt-dlp --dump-json --no-playlist --no-check-certificates --socket-timeout 20 "${url}"`;
    
    try {
      const { stdout } = await execPromise(cmd, { 
        timeout: 25000,
        maxBuffer: 30 * 1024 * 1024 
      });
      
      const data = JSON.parse(stdout);
      if (data && data.formats && data.formats.length > 0) {
        return this.processYtdlpData(data);
      }
    } catch (err) {
      console.log(`yt-dlp no-check xətası: ${err.message.substring(0, 100)}`);
    }
    
    throw new Error('yt-dlp no-check uğursuz');
  }

  // ─── Metod 3: yt-dlp fərqli extractor args ilə ──────────────────────────
  async tryYtdlpExtractorArgs(url) {
    const strategies = [
      '--extractor-args "instagram:api=graphql"',
      '--extractor-args "instagram:prefer_embedded=true"',
      '--extractor-args "instagram:prefer_authenticated=false"',
      '--extractor-args "instagram:video_quality=high"',
      '--extractor-args "instagram:api=web" --add-header "x-ig-app-id:936619743392459"',
    ];

    for (const args of strategies) {
      try {
        const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 15 ${args} "${url}"`;
        const { stdout } = await execPromise(cmd, { 
          timeout: 20000,
          maxBuffer: 30 * 1024 * 1024 
        });
        
        const data = JSON.parse(stdout);
        if (data && data.formats && data.formats.length > 0) {
          return this.processYtdlpData(data);
        }
      } catch (err) {
        continue;
      }
    }

    throw new Error('yt-dlp extractor args uğursuz');
  }

  // ─── Metod 4: Instagram Public API (i.instagram.com) ─────────────────────
  async tryPublicAPI(shortcode) {
    const endpoints = [
      `https://i.instagram.com/api/v1/media/${shortcode}/info/`,
      `https://www.instagram.com/api/v1/media/${shortcode}/info/`,
    ];

    for (const endpoint of endpoints) {
      try {
        const data = await this.httpRequest(endpoint, {
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
        });
        
        if (data && data.items && data.items.length > 0) {
          return this.processPublicAPIData(data.items[0]);
        }
      } catch (err) {
        continue;
      }
    }

    throw new Error('Public API uğursuz');
  }

  // ─── Metod 5: yt-dlp embed URL ilə ───────────────────────────────────────
  async tryYtdlpEmbed(url, shortcode) {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    
    try {
      const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 20 "${embedUrl}"`;
      const { stdout } = await execPromise(cmd, { 
        timeout: 25000,
        maxBuffer: 30 * 1024 * 1024 
      });
      
      const data = JSON.parse(stdout);
      if (data && data.formats && data.formats.length > 0) {
        return this.processYtdlpData(data);
      }
    } catch (err) {
      console.log(`Embed yt-dlp xətası: ${err.message.substring(0, 100)}`);
    }

    throw new Error('Embed yt-dlp uğursuz');
  }

  // ─── Metod 6: Embed səhifəsini birbaşa analiz et ────────────────────────
  async tryEmbedPage(shortcode) {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    
    return new Promise((resolve, reject) => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      
      const options = {
        hostname: 'www.instagram.com',
        path: `/p/${shortcode}/embed/captioned/`,
        method: 'GET',
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 20000,
      };

      const req = https.request(options, (res) => {
        let html = '';
        
        res.on('data', (chunk) => {
          html += chunk;
        });
        
        res.on('end', () => {
          try {
            // Bütün JSON nümunələrini yoxla
            const patterns = [
              /window\.__additionalDataLoaded\('extra',(.*?)\);<\/script>/,
              /window\._sharedData = (.*?);<\/script>/,
              /<script type="text\/javascript">window\._sharedData = (.*?);<\/script>/,
              /"shortcode_media":(.*?)\}\}/,
              /"video_url":"(.*?)"/,
              /"display_url":"(.*?)"/,
            ];

            for (const pattern of patterns) {
              const match = html.match(pattern);
              if (match && match[1]) {
                const result = this.parseEmbedContent(match[1], match[0]);
                if (result) {
                  resolve(result);
                  return;
                }
              }
            }

            reject(new Error('Embed səhifəsində media tapılmadı'));
          } catch (err) {
            reject(err);
          }
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

  // ─── HTTP Request ────────────────────────────────────────────────────────
  httpRequest(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: {
          'User-Agent': ua,
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          ...extraHeaders,
        },
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('JSON parse xətası'));
          }
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

  // ─── Embed məzmun analizi ────────────────────────────────────────────────
  parseEmbedContent(content, fullMatch) {
    try {
      // JSON obyektini çıxar
      const jsonStr = content.trim();
      if (jsonStr.startsWith('{') || jsonStr.startsWith('[')) {
        const data = JSON.parse(jsonStr);
        return this.processEmbedData(data);
      }
      
      // Video URL birbaşa
      if (content.startsWith('http') && content.includes('video')) {
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
            url: content.replace(/\\\//g, '/'),
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: 'embed_direct'
          }]
        };
      }
    } catch (err) {
      console.log('Parse xətası:', err.message);
    }
    
    return null;
  }

  // ─── Data emalı ──────────────────────────────────────────────────────────
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

  processWebAPIData(item) {
    return this.processMediaItem(item, 'web_api');
  }

  processPublicAPIData(item) {
    return this.processMediaItem(item, 'public_api');
  }

  processGraphQLData(media) {
    return this.processMediaItem(media, 'graphql');
  }

  processEmbedData(data) {
    const media = data?.shortcode_media || data?.media || data?.graphql?.shortcode_media || data;
    return this.processMediaItem(media, 'embed');
  }

  processMediaItem(media, source) {
    const qualities = [];
    
    if (media && media.video_versions) {
      const seenHeights = new Set();
      for (const video of media.video_versions) {
        const height = video.height || 0;
        if (!seenHeights.has(height) && height > 0) {
          seenHeights.add(height);
          qualities.push({
            label: `${height}p`,
            value: `${height}p`,
            formatId: `${source}_${height}`,
            url: video.url,
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: source
          });
        }
      }

      if (media.video_versions.length > 0) {
        qualities.push({
          label: 'MP3 (Audio)',
          value: 'audio',
          formatId: 'audio',
          url: media.video_versions[0].url,
          filesize: null,
          ext: 'm4a',
          needsMerge: false,
          _source: source
        });
      }
    }

    // Şəkil üçün
    if (media && media.image_versions2?.candidates?.length > 0) {
      qualities.push({
        label: 'Şəkil (Original)',
        value: 'image',
        formatId: 'image',
        url: media.image_versions2.candidates[0].url,
        filesize: null,
        ext: 'jpg',
        needsMerge: false,
        _source: source
      });
    }

    return {
      title: media?.caption?.text?.substring(0, 100) || 'Instagram Media',
      thumbnail: media?.image_versions2?.candidates?.[0]?.url || '',
      duration: this.formatDuration(media?.video_duration || 0),
      uploader: media?.user?.username || media?.owner?.username || '',
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

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
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
