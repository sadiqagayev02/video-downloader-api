// services/instagramServiceV3.js - TAM YENİ YANAŞMA
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const https = require('https');
const http = require('http');

class InstagramServiceV3 {
  constructor() {
    this.lastSuccessfulMethod = null;
    this.methodStats = new Map();
    this.cache = new Map(); // URL cache
    this.cacheTimeout = 10 * 60 * 1000; // 10 dəqiqə
  }

  async getInfo(url) {
    console.log('📸 Instagram V3 başladı:', url);
    
    const shortcode = this.extractShortcode(url);
    console.log('📸 Shortcode:', shortcode);
    
    if (!shortcode) {
      throw new Error('Instagram URL-dən shortcode tapılmadı');
    }

    // Cache yoxla
    const cached = this.getFromCache(shortcode);
    if (cached) {
      console.log('📸 Cache-dən tapıldı!');
      return cached;
    }

    // Metodları yoxla - ən işlək metodlar birinci
    const methods = [
      { name: 'snapinsta_api', fn: () => this.trySnapInsta(shortcode) },
      { name: 'igram_api', fn: () => this.tryIGram(shortcode) },
      { name: 'saveig_api', fn: () => this.trySaveIG(shortcode) },
      { name: 'insta_downloader', fn: () => this.tryInstaDownloader(shortcode) },
      { name: 'ytdlp_retry', fn: () => this.tryYtdlpRetry(url) },
    ];

    let lastError = null;

    for (const method of methods) {
      try {
        console.log(`📸 [${method.name}] cəhd edilir...`);
        const result = await method.fn();
        
        if (result && result.qualities && result.qualities.length > 0) {
          this.lastSuccessfulMethod = method.name;
          this.recordSuccess(method.name);
          this.saveToCache(shortcode, result);
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

  // ─── Metod 1: SnapInsta API (ən stabil) ─────────────────────────────────
  async trySnapInsta(shortcode) {
    const url = `https://snapinsta.app/api/ajaxSearch`;
    
    return new Promise((resolve, reject) => {
      const postData = `q=https://www.instagram.com/p/${shortcode}/&t=media&lang=en`;
      
      const options = {
        hostname: 'snapinsta.app',
        path: '/api/ajaxSearch',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Origin': 'https://snapinsta.app',
          'Referer': 'https://snapinsta.app/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 20000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json && json.media && json.media.length > 0) {
              const media = json.media[0];
              const qualities = [];
              
              // Video URL-lərini çıxar
              if (media.videoUrl) {
                qualities.push({
                  label: 'HD Video',
                  value: 'video',
                  formatId: 'video',
                  url: media.videoUrl,
                  filesize: null,
                  ext: 'mp4',
                  needsMerge: false,
                  _source: 'snapinsta'
                });
              }
              
              // Şəkil URL-lərini çıxar
              if (media.displayUrl) {
                qualities.push({
                  label: 'Şəkil',
                  value: 'image',
                  formatId: 'image',
                  url: media.displayUrl,
                  filesize: null,
                  ext: 'jpg',
                  needsMerge: false,
                  _source: 'snapinsta'
                });
              }
              
              // Audio üçün video URL-ni istifadə et
              if (media.videoUrl) {
                qualities.push({
                  label: 'MP3 (Audio)',
                  value: 'audio',
                  formatId: 'audio',
                  url: media.videoUrl,
                  filesize: null,
                  ext: 'm4a',
                  needsMerge: false,
                  _source: 'snapinsta'
                });
              }
              
              if (qualities.length > 0) {
                resolve({
                  title: media.title || 'Instagram Video',
                  thumbnail: media.thumbnail || media.displayUrl || '',
                  duration: '00:00',
                  uploader: '',
                  platform: 'instagram',
                  qualities
                });
              } else {
                reject(new Error('SnapInsta-dan keyfiyyət tapılmadı'));
              }
            } else {
              reject(new Error('SnapInsta boş cavab'));
            }
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

      req.write(postData);
      req.end();
    });
  }

  // ─── Metod 2: IGram API ─────────────────────────────────────────────────
  async tryIGram(shortcode) {
    const url = `https://igram.io/api/`;
    
    return new Promise((resolve, reject) => {
      const postData = `url=https://www.instagram.com/p/${shortcode}/`;
      
      const options = {
        hostname: 'igram.io',
        path: '/api/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Origin': 'https://igram.io',
          'Referer': 'https://igram.io/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 20000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            // IGram fərqli formatda qaytarır
            if (json && json.data && json.data.length > 0) {
              const media = json.data[0];
              const qualities = [];
              
              if (media.video_url) {
                qualities.push({
                  label: 'HD Video',
                  value: 'video',
                  formatId: 'video',
                  url: media.video_url,
                  filesize: null,
                  ext: 'mp4',
                  needsMerge: false,
                  _source: 'igram'
                });
              }
              
              if (media.display_url) {
                qualities.push({
                  label: 'Şəkil',
                  value: 'image',
                  formatId: 'image',
                  url: media.display_url,
                  filesize: null,
                  ext: 'jpg',
                  needsMerge: false,
                  _source: 'igram'
                });
              }
              
              if (qualities.length > 0) {
                resolve({
                  title: media.title || 'Instagram Video',
                  thumbnail: media.thumbnail_url || media.display_url || '',
                  duration: '00:00',
                  uploader: media.owner || '',
                  platform: 'instagram',
                  qualities
                });
              } else {
                reject(new Error('IGram-dan keyfiyyət tapılmadı'));
              }
            } else {
              reject(new Error('IGram boş cavab'));
            }
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

      req.write(postData);
      req.end();
    });
  }

  // ─── Metod 3: SaveIG API ────────────────────────────────────────────────
  async trySaveIG(shortcode) {
    const url = `https://saveig.app/api/ajaxSearch`;
    
    return new Promise((resolve, reject) => {
      const postData = `q=https://www.instagram.com/p/${shortcode}/&t=media&lang=en`;
      
      const options = {
        hostname: 'saveig.app',
        path: '/api/ajaxSearch',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Origin': 'https://saveig.app',
          'Referer': 'https://saveig.app/',
          'X-Requested-With': 'XMLHttpRequest',
        },
        timeout: 20000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json && json.media && json.media.length > 0) {
              const media = json.media[0];
              const qualities = [];
              
              if (media.videoUrl) {
                qualities.push({
                  label: 'HD Video',
                  value: 'video',
                  formatId: 'video',
                  url: media.videoUrl,
                  filesize: null,
                  ext: 'mp4',
                  needsMerge: false,
                  _source: 'saveig'
                });
              }
              
              if (media.displayUrl) {
                qualities.push({
                  label: 'Şəkil',
                  value: 'image',
                  formatId: 'image',
                  url: media.displayUrl,
                  filesize: null,
                  ext: 'jpg',
                  needsMerge: false,
                  _source: 'saveig'
                });
              }
              
              if (qualities.length > 0) {
                resolve({
                  title: media.title || 'Instagram Video',
                  thumbnail: media.thumbnail || media.displayUrl || '',
                  duration: '00:00',
                  uploader: '',
                  platform: 'instagram',
                  qualities
                });
              } else {
                reject(new Error('SaveIG-dən keyfiyyət tapılmadı'));
              }
            } else {
              reject(new Error('SaveIG boş cavab'));
            }
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

      req.write(postData);
      req.end();
    });
  }

  // ─── Metod 4: InstaDownloader API ───────────────────────────────────────
  async tryInstaDownloader(shortcode) {
    const url = `https://www.y2mate.com/api/convert`;
    
    return new Promise((resolve, reject) => {
      const postData = `url=https://www.instagram.com/p/${shortcode}/`;
      
      const options = {
        hostname: 'www.y2mate.com',
        path: '/api/convert',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        timeout: 20000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json && json.data && json.data.length > 0) {
              const media = json.data[0];
              const qualities = [];
              
              if (media.url) {
                qualities.push({
                  label: 'HD Video',
                  value: 'video',
                  formatId: 'video',
                  url: media.url,
                  filesize: null,
                  ext: 'mp4',
                  needsMerge: false,
                  _source: 'y2mate'
                });
              }
              
              if (qualities.length > 0) {
                resolve({
                  title: media.title || 'Instagram Video',
                  thumbnail: media.thumbnail || '',
                  duration: '00:00',
                  uploader: '',
                  platform: 'instagram',
                  qualities
                });
              } else {
                reject(new Error('Y2Mate-dən keyfiyyət tapılmadı'));
              }
            } else {
              reject(new Error('Y2Mate boş cavab'));
            }
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

      req.write(postData);
      req.end();
    });
  }

  // ─── Metod 5: yt-dlp son cəhd ───────────────────────────────────────────
  async tryYtdlpRetry(url) {
    try {
      const cmd = `yt-dlp --dump-json --no-playlist --no-check-certificates --socket-timeout 30 --retries 3 --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15" "${url}"`;
      const { stdout } = await execPromise(cmd, { 
        timeout: 35000,
        maxBuffer: 30 * 1024 * 1024 
      });
      
      const data = JSON.parse(stdout);
      if (data && data.formats && data.formats.length > 0) {
        return this.processYtdlpData(data);
      }
    } catch (err) {
      console.log(`yt-dlp retry xətası: ${err.message.substring(0, 100)}`);
    }
    
    throw new Error('yt-dlp retry uğursuz');
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

  // ─── Cache ───────────────────────────────────────────────────────────────
  getFromCache(shortcode) {
    const cached = this.cache.get(shortcode);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  saveToCache(shortcode, data) {
    this.cache.set(shortcode, {
      timestamp: Date.now(),
      data: data
    });
    
    // Köhnə cache-ləri təmizlə
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
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
