const { exec } = require('child_process');
const fs = require('fs').promises;
const util = require('util');
const execPromise = util.promisify(exec);

// ─── PROXY TƏNZİMLƏMƏLƏRİ ───────────────────────────────────────────────────
const PROXY_URL = process.env.PROXY_URL || ""; 
const PROXY_ARG = PROXY_URL ? `--proxy "${PROXY_URL}"` : "";

const EXEC_TIMEOUT = 20000;
const DOWNLOAD_TIMEOUT = 200000;

// ─── Cross-platform fayl ölçüsü yoxlaması ────────────────────────────────────
async function getFileSize(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

// ─── Cross-platform fayl silmə ───────────────────────────────────────────────
async function removeFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // mövcud deyilsə ignore et
  }
}

class YtDlpService {
  constructor() {
    // ═══════════════════════════════════════════════════════════════════════
    // YOUTUBE STRATEGİYALARI
    // ═══════════════════════════════════════════════════════════════════════
    this.youtubeStrategies = [
      { name: 'tv_embedded', args: '--extractor-args "youtube:player_client=tv_embedded"' },
      { name: 'ios',         args: '--extractor-args "youtube:player_client=ios" --user-agent "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"' },
      { name: 'android_vr',  args: '--extractor-args "youtube:player_client=android_vr" --user-agent "com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12)"' },
      { name: 'web_creator', args: '--extractor-args "youtube:player_client=web_creator"' },
      { name: 'mweb',        args: '--extractor-args "youtube:player_client=mweb"' },
      { name: 'default',     args: '' },
    ];

    // ═══════════════════════════════════════════════════════════════════════
    // TIKTOK HOSTNAME-LƏRİ
    // ═══════════════════════════════════════════════════════════════════════
    this.tiktokHostnames = [
      'api22-normal-c-useast2a.tiktokv.com',
      'api16-normal-c-useast2a.tiktokv.com',
      'api-normal-c-useast2a.tiktokv.com',
    ];

    // ═══════════════════════════════════════════════════════════════════════
    // INSTAGRAM STRATEGİYALARI - COOKIE YOXdUR, ÇOXLU USER-AGENT
    // ═══════════════════════════════════════════════════════════════════════
    this.instagramStrategies = [
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
      // Default
      {
        name: 'ig_default',
        args: '--socket-timeout 30',
        ua: ''
      },
    ];

    // ═══════════════════════════════════════════════════════════════════════
    // GENERIC WEB - VIDEO URL PATTERNS
    // ═══════════════════════════════════════════════════════════════════════
    this.videoPatterns = [
      /https?:\/\/[^\s"'<>]+\.(mp4|webm|mkv)(\?[^\s"'<>]*)?/gi,
      /https?:\/\/[^\s"'<>]+\.m3u8(\?[^\s"'<>]*)?/gi,
      /file:\s*["']([^"']+)["']/gi,
      /source:\s*["']([^"']+)["']/gi,
      /src=["']([^"']+\.(mp4|webm|m3u8)[^"']*)["']/gi,
      /data-src=["']([^"']+\.(mp4|webm|m3u8)[^"']*)["']/gi,
      /content=["']([^"']+\.(mp4|webm|m3u8)[^"']*)["']/gi,
    ];
  }

  // ─── URL növü ──────────────────────────────────────────────────────────────

  isYouTube(url) {
    return url.includes('youtube.com') || url.includes('youtu.be');
  }

  isTikTok(url) {
    return url.includes('tiktok.com') || url.includes('vt.tiktok.com') || url.includes('vm.tiktok.com');
  }

  isInstagram(url) {
    return url.includes('instagram.com') || url.includes('instagr.am');
  }

  isFacebook(url) {
    return url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com');
  }

  // ─── Info ──────────────────────────────────────────────────────────────────

  async getVideoInfo(url) {
    if (this.isYouTube(url))   return await this.getYouTubeInfo(url);
    if (this.isTikTok(url))    return await this.getTikTokInfo(url);
    if (this.isInstagram(url)) return await this.getInstagramInfo(url);
    if (this.isFacebook(url))  return await this.getFacebookInfo(url);
    return await this.getGenericInfo(url);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // YOUTUBE INFO
  // ═══════════════════════════════════════════════════════════════════════════

  async getYouTubeInfo(url) {
    // 1. youtubei.js cəhd et (PO Token avtomatik yaradır)
    try {
      console.log('📡 YouTube: youtubei.js cəhd edilir...');
      const result = await this.tryYoutubei(url);
      if (result && result.qualities?.length > 0) {
        console.log('✅ YouTube youtubei.js uğurlu');
        return result;
      }
    } catch (err) {
      console.log(`⚠️ YouTube youtubei.js uğursuz: ${err.message.substring(0, 100)}`);
    }

    // 2. Invidious fallback
    const inv = await this.tryInvidious(url);
    if (inv) return inv;

    // 3. yt-dlp strategiyaları
    for (const strategy of this.youtubeStrategies) {
      try {
        console.log(`📡 YouTube strategiya: ${strategy.name}`);
        const data = await this.extractWithArgs(url, strategy.args);
        if (data?.formats) return this.processYouTubeData(data);
      } catch (err) {
        console.log(`⚠️ ${strategy.name} uğursuz: ${err.message.substring(0, 100)}`);
      }
    }
    throw new Error('YouTube: bütün metodlar uğursuz');
  }

  async tryYoutubei(url) {
    try {
      const { Innertube } = require('youtubei.js');
      const videoId = this.extractYouTubeId(url);
      if (!videoId) throw new Error('Video ID tapılmadı');

      const client = await Innertube.create({
        cache: new (require('youtubei.js').Cache.Bundled)(),
        generate_session_locally: true,
      });

      const info = await client.getBasicInfo(videoId);
      
      if (!info.streaming_data) throw new Error('Streaming data yoxdur');

      const formats = info.streaming_data.formats || [];
      const adaptiveFormats = info.streaming_data.adaptive_formats || [];

      const qualities = [];

      // Video formatları
      const videoFormats = adaptiveFormats.filter(f => f.has_video && !f.has_audio);
      const audioFormats = adaptiveFormats.filter(f => f.has_audio && !f.has_video);

      const bestAudio = audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

      // 1080p
      const v1080 = videoFormats.find(f => f.height === 1080);
      if (v1080 && bestAudio) {
        qualities.push({
          label: '1080p HD',
          value: '1080p',
          videoFormatId: v1080.itag?.toString(),
          audioFormatId: bestAudio.itag?.toString(),
          filesize: (v1080.content_length || 0) + (bestAudio.content_length || 0),
          ext: 'mp4',
          needsMerge: true,
          _source: 'youtubei'
        });
      }

      // 720p, 480p, 360p
      for (const res of [720, 480, 360]) {
        const video = videoFormats.find(f => f.height === res);
        if (video && bestAudio) {
          qualities.push({
            label: `${res}p`,
            value: `${res}p`,
            videoFormatId: video.itag?.toString(),
            audioFormatId: bestAudio.itag?.toString(),
            filesize: (video.content_length || 0) + (bestAudio.content_length || 0),
            ext: 'mp4',
            needsMerge: true,
            _source: 'youtubei'
          });
        }
      }

      // Audio
      if (bestAudio) {
        qualities.push({
          label: 'MP3 (Audio)',
          value: 'audio',
          formatId: bestAudio.itag?.toString(),
          filesize: bestAudio.content_length || null,
          ext: 'm4a',
          needsMerge: false,
          _source: 'youtubei'
        });
      }

      return {
        title: info.basic_info.title || 'YouTube Video',
        thumbnail: info.basic_info.thumbnail?.[0]?.url || '',
        duration: this.formatDuration(info.basic_info.duration || 0),
        uploader: info.basic_info.author || '',
        platform: 'youtube',
        qualities
      };
    } catch (err) {
      throw new Error(`youtubei.js: ${err.message}`);
    }
  }

  async tryInvidious(url) {
    const videoId = this.extractYouTubeId(url);
    if (!videoId) return null;

    const instances = [
      'https://invidious.privacyredirect.com',
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://invidious.io.lol',
    ];

    for (const instance of instances) {
      try {
        console.log(`📡 Invidious: ${instance}`);
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: controller.signal });
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          return this.processInvidiousData(data);
        }
      } catch (err) {
        console.log(`⚠️ Invidious ${instance}: ${err.message}`);
      }
    }
    return null;
  }

  extractYouTubeId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  processInvidiousData(data) {
    const qualities = [];

    if (data.formatStreams) {
      for (const fmt of data.formatStreams) {
        if (!fmt.resolution || fmt.resolution === 'null') continue;
        const parts = fmt.resolution.split('x');
        const height = parseInt(parts[parts.length - 1]);
        const label = this.heightToLabel(height);
        if (!label || qualities.find(q => q.label === label)) continue;
        qualities.push({
          label, value: label,
          url: fmt.url, formatId: null,
          ext: 'mp4', needsMerge: false,
          filesize: fmt.size ? parseInt(fmt.size) : null,
          _source: 'invidious',
        });
      }
    }

    if (data.adaptiveFormats) {
      const audio = data.adaptiveFormats
        .filter(f => f.type?.includes('audio'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      if (audio) {
        qualities.push({
          label: 'MP3 (Audio)', value: 'audio',
          url: audio.url, formatId: null,
          ext: 'm4a', needsMerge: false,
          filesize: audio.size ? parseInt(audio.size) : null,
          _source: 'invidious',
        });
      }
    }

    return {
      title:     data.title || 'YouTube Video',
      thumbnail: data.videoThumbnails?.[0]?.url || data.thumbnailUrl || '',
      duration:  this.formatDuration(data.lengthSeconds || 0),
      uploader:  data.author || '',
      platform:  'youtube',
      qualities,
    };
  }

  processYouTubeData(data) {
    const qualities = [];
    const formats   = data.formats || [];

    const audioBest = formats
      .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    const v1080 = formats
      .filter(f => f.height === 1080 && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
      .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];

    if (v1080 && audioBest) {
      qualities.push({
        label: '1080p HD', value: '1080p',
        videoFormatId: v1080.format_id, audioFormatId: audioBest.format_id,
        filesize: (v1080.filesize || 0) + (audioBest.filesize || 0),
        ext: 'mp4', needsMerge: true, _source: 'ytdlp',
      });
    }

    for (const res of [720, 480, 360]) {
      const combined = formats
        .filter(f => f.height === res && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
        .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];

      if (combined) {
        qualities.push({
          label: `${res}p`, value: `${res}p`,
          formatId: combined.format_id, filesize: combined.filesize || null,
          ext: 'mp4', needsMerge: false, _source: 'ytdlp',
        });
      } else if (audioBest) {
        const vOnly = formats
          .filter(f => f.height === res && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
          .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];
        if (vOnly) {
          qualities.push({
            label: `${res}p`, value: `${res}p`,
            videoFormatId: vOnly.format_id, audioFormatId: audioBest.format_id,
            filesize: (vOnly.filesize || 0) + (audioBest.filesize || 0),
            ext: 'mp4', needsMerge: true, _source: 'ytdlp',
          });
        }
      }
    }

    if (audioBest) {
      qualities.push({
        label: 'MP3 (Audio)', value: 'audio',
        formatId: audioBest.format_id, filesize: audioBest.filesize || null,
        ext: 'm4a', needsMerge: false, _source: 'ytdlp',
      });
    }

    return {
      title:     data.title || 'YouTube Video',
      thumbnail: data.thumbnail || '',
      duration:  this.formatDuration(data.duration || 0),
      uploader:  data.uploader || '',
      platform:  'youtube',
      qualities,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIKTOK INFO
  // ═══════════════════════════════════════════════════════════════════════════

  async getTikTokInfo(url) {
    let lastErr = null;

    // 1. yt-dlp strategiyaları
    for (const hostname of this.tiktokHostnames) {
      try {
        console.log(`📡 TikTok info hostname: ${hostname}`);
        const args = `--extractor-args "tiktok:api_hostname=${hostname}" --socket-timeout 15`;
        const data = await this.extractWithArgs(url, args);
        if (data) return this.processTikTokData(data);
      } catch (err) {
        console.log(`⚠️ TikTok hostname ${hostname} uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
      }
    }

    // 2. Default cəhd
    try {
      console.log('📡 TikTok info: default (son cəhd)');
      const data = await this.extractWithArgs(url, '--socket-timeout 15');
      if (data) return this.processTikTokData(data);
    } catch (err) {
      lastErr = err;
    }

    // 3. TikWM API fallback (cookie yoxdur!)
    try {
      console.log('📡 TikTok fallback: TikWM API');
      const result = await this.tryTikWM(url);
      if (result && result.qualities?.length > 0) {
        console.log('✅ TikTok TikWM uğurlu');
        return result;
      }
    } catch (err) {
      console.log(`⚠️ TikTok TikWM uğursuz: ${err.message}`);
      lastErr = err;
    }

    throw new Error(`TikTok məlumat alınmadı: ${lastErr?.message}`);
  }

  async tryTikWM(url) {
    try {
      const formData = new URLSearchParams();
      formData.append('url', url);
      formData.append('hd', '1');

      const res = await fetch('https://www.tikwm.com/api/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: formData.toString(),
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.data || !data.data.play) throw new Error('Video URL yoxdur');

      return {
        title: data.data.title || 'TikTok Video',
        thumbnail: data.data.cover || '',
        duration: this.formatDuration(data.data.duration || 0),
        uploader: data.data.author?.nickname || '',
        platform: 'tiktok',
        qualities: [
          {
            label: 'HD Video',
            value: 'video',
            formatId: null,
            url: data.data.hdplay || data.data.play,
            filesize: null,
            ext: 'mp4',
            needsMerge: false,
            _source: 'tikwm'
          },
          {
            label: 'MP3 (Audio)',
            value: 'audio',
            formatId: null,
            url: data.data.music,
            filesize: null,
            ext: 'm4a',
            needsMerge: false,
            _source: 'tikwm'
          }
        ]
      };
    } catch (err) {
      throw new Error(`TikWM: ${err.message}`);
    }
  }

  processTikTokData(data) {
    return {
      title:     data.title || 'TikTok Video',
      thumbnail: data.thumbnail || '',
      duration:  this.formatDuration(data.duration || 0),
      uploader:  data.uploader || data.channel || '',
      platform:  'tiktok',
      qualities: [
        {
          label: 'HD Video', value: 'video',
          formatId: 'best', url: null, filesize: null,
          ext: 'mp4', needsMerge: false, _source: 'tiktok_direct',
        },
        {
          label: 'MP3 (Audio)', value: 'audio',
          formatId: 'bestaudio', url: null, filesize: null,
          ext: 'm4a', needsMerge: false, _source: 'tiktok_audio',
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTAGRAM INFO - COOKIE YOXdUR!
  // ═══════════════════════════════════════════════════════════════════════════

  async getInstagramInfo(url) {
    let lastErr = null;

    // 1. yt-dlp strategiyaları (çoxlu User-Agent)
    for (const strategy of this.instagramStrategies) {
      try {
        console.log(`📡 Instagram info: ${strategy.name}`);
        
        let args = strategy.args;
        if (strategy.ua) {
          args += ` --add-header "User-Agent:${strategy.ua}"`;
        }
        
        const data = await this.extractWithArgs(url, args);
        if (data) return this.processInstagramData(data);
      } catch (err) {
        console.log(`⚠️ Instagram ${strategy.name} uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
      }
    }

    // 2. 3-cü tərəf API fallback (cookie yoxdur!)
    console.log('🔄 Instagram: 3-cü tərəf API-lərə keçirəm...');

    const apiFallbacks = [
      { name: 'SnapSave', fn: () => this.trySnapSave(url) },
      { name: 'Igram', fn: () => this.tryIgram(url) },
    ];

    for (const api of apiFallbacks) {
      try {
        console.log(`📡 Instagram API: ${api.name}`);
        const result = await api.fn();
        if (result && result.qualities?.length > 0) {
          console.log(`✅ Instagram ${api.name} uğurlu`);
          return result;
        }
      } catch (err) {
        console.log(`⚠️ Instagram ${api.name} uğursuz: ${err.message}`);
        lastErr = err;
      }
    }

    throw new Error(`Instagram məlumat alınmadı: ${lastErr?.message}`);
  }

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

      const decodeMatch = html.match(/decode\("([^"]+)"\)/);
      if (!decodeMatch) throw new Error('Decode tapılmadı');

      const decoded = Buffer.from(decodeMatch[1], 'base64').toString('utf8');
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

  processInstagramData(data) {
    return {
      title:     data.title || data.description?.substring(0, 80) || 'Instagram Video',
      thumbnail: data.thumbnail || '',
      duration:  this.formatDuration(data.duration || 0),
      uploader:  data.uploader || data.channel || '',
      platform:  'instagram',
      qualities: [
        {
          label: 'HD Video', value: 'video',
          formatId: 'best', url: null, filesize: null,
          ext: 'mp4', needsMerge: false, _source: 'instagram_direct',
        },
        {
          label: 'MP3 (Audio)', value: 'audio',
          formatId: 'bestaudio', url: null, filesize: null,
          ext: 'm4a', needsMerge: false, _source: 'instagram_audio',
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FACEBOOK INFO
  // ═══════════════════════════════════════════════════════════════════════════

  async getFacebookInfo(url) {
    let lastErr = null;

    const strategies = [
      '--add-header "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"',
      '--add-header "User-Agent:Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36"',
      '',
    ];

    for (const args of strategies) {
      try {
        console.log(`📡 Facebook info: "${args.substring(0, 40) || 'default'}"`);
        const data = await this.extractWithArgs(url, `${args} --socket-timeout 15`);
        if (data) return this.processFacebookData(data);
      } catch (err) {
        console.log(`⚠️ Facebook info uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
      }
    }

    throw new Error(`Facebook məlumat alınmadı: ${lastErr?.message}`);
  }

  processFacebookData(data) {
    return {
      title:     data.title || data.description?.substring(0, 80) || 'Facebook Video',
      thumbnail: data.thumbnail || '',
      duration:  this.formatDuration(data.duration || 0),
      uploader:  data.uploader || data.channel || '',
      platform:  'facebook',
      qualities: [
        {
          label: 'HD Video', value: 'video',
          formatId: 'best', url: null, filesize: null,
          ext: 'mp4', needsMerge: false, _source: 'facebook_direct',
        },
        {
          label: 'MP3 (Audio)', value: 'audio',
          formatId: 'bestaudio', url: null, filesize: null,
          ext: 'm4a', needsMerge: false, _source: 'facebook_audio',
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERIC INFO - HTML EXTRACT + REFERER DƏSTƏYİ
  // ═══════════════════════════════════════════════════════════════════════════

  async getGenericInfo(url) {
    // 1. yt-dlp cəhd et
    try {
      console.log('📡 Generic: yt-dlp cəhd edilir...');
      const data = await this.extractWithArgs(url, '--socket-timeout 15');
      return this.processGenericData(data, url);
    } catch (err) {
      console.log(`⚠️ Generic yt-dlp uğursuz: ${err.message.substring(0, 100)}`);
    }

    // 2. HTML-dən video URL çıxart
    try {
      console.log('📡 Generic: HTML-dən video URL çıxarılır...');
      const result = await this.extractVideoFromHtml(url);
      if (result && result.qualities?.length > 0) {
        console.log('✅ Generic HTML extract uğurlu');
        return result;
      }
    } catch (err) {
      console.log(`⚠️ Generic HTML extract uğursuz: ${err.message}`);
    }

    throw new Error(`Generic: məlumat alınmadı`);
  }

  async extractVideoFromHtml(url) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      const foundUrls = new Set();

      for (const pattern of this.videoPatterns) {
        const matches = html.matchAll(pattern);
        for (const match of matches) {
          const foundUrl = match[1] || match[0];
          if (foundUrl && foundUrl.startsWith('http')) {
            foundUrls.add(foundUrl);
          }
        }
      }

      if (foundUrls.size === 0) {
        throw new Error('Video URL tapılmadı');
      }

      const videoUrl = Array.from(foundUrls)[0];
      console.log(`✅ HTML-dən video tapıldı: ${videoUrl.substring(0, 80)}`);

      return {
        title: 'Video',
        thumbnail: '',
        duration: '00:00',
        uploader: '',
        platform: 'web',
        qualities: [{
          label: 'Video',
          value: 'video',
          url: videoUrl,
          filesize: null,
          ext: videoUrl.includes('.m3u8') ? 'mp4' : 'mp4',
          needsMerge: false,
          _source: 'html_extract'
        }]
      };
    } catch (err) {
      throw new Error(`HTML extract: ${err.message}`);
    }
  }

  processGenericData(data, url) {
    let platform = 'other';
    if (url.includes('facebook.com') || url.includes('fb.watch')) platform = 'facebook';
    else if (url.includes('twitter.com') || url.includes('x.com')) platform = 'twitter';

    return {
      title:     data.title || 'Video',
      thumbnail: data.thumbnail || '',
      duration:  this.formatDuration(data.duration || 0),
      uploader:  data.uploader || data.channel || '',
      platform,
      qualities: [
        {
          label: 'HD Video', value: 'video',
          formatId: 'best', url: null, filesize: null,
          ext: 'mp4', needsMerge: false, _source: 'generic_direct',
        },
        {
          label: 'MP3 (Audio)', value: 'audio',
          formatId: 'bestaudio', url: null, filesize: null,
          ext: 'm4a', needsMerge: false, _source: 'generic_audio',
        },
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOWNLOAD METODLARI
  // ═══════════════════════════════════════════════════════════════════════════

  async downloadByUrl(directUrl, outputPath) {
    const proxyCmd = PROXY_URL ? `-x "${PROXY_URL}"` : "";
    const cmd = `curl -L ${proxyCmd} --max-time 180 --retry 2 --retry-delay 3 -o "${outputPath}" "${directUrl}"`;
    console.log(`📥 curl download: ${directUrl.substring(0, 80)}...`);
    await execPromise(cmd, { timeout: 190000 });
  }

  async downloadFormat(originalUrl, formatId, outputPath) {
    const cmd = `yt-dlp ${PROXY_ARG} -f "${formatId}" --no-playlist --retries 3 --socket-timeout 20 -o "${outputPath}" "${originalUrl}"`;
    console.log(`📥 yt-dlp format: ${formatId}`);
    await execPromise(cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });
  }

  // ─── Audio download ────────────────────────────────────────────────────────

  async downloadAudio(url, outputPath, platform) {
    console.log(`🎵 downloadAudio: platform=${platform}, url=${url.substring(0, 60)}`);

    if (platform === 'tiktok') {
      return await this.downloadTikTokAudio(url, outputPath);
    }

    let extraArgs = '';
    if (platform === 'instagram') {
      extraArgs = '--extractor-args "instagram:video_quality=high"';
    }

    // Generic audio üçün referer əlavə et
    if (platform === 'web' || platform === 'other') {
      try {
        const urlObj = new URL(url);
        const referer = `${urlObj.protocol}//${urlObj.host}/`;
        extraArgs += ` --referer "${referer}"`;
      } catch {}
    }

    const strategies = [
      {
        name: 'direct_m4a',
        cmd:  `yt-dlp ${PROXY_ARG} ${extraArgs} `
          + `-f "bestaudio[ext=m4a]/bestaudio[ext=aac]" `
          + `--no-playlist --retries 2 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
      {
        name: 'extract_x',
        cmd:  `yt-dlp ${PROXY_ARG} ${extraArgs} `
          + `-f "best" -x --audio-format m4a --audio-quality 0 `
          + `--no-playlist --retries 2 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
      {
        name: 'bestaudio_convert',
        cmd:  `yt-dlp ${PROXY_ARG} ${extraArgs} `
          + `-f "bestaudio" -x --audio-format m4a `
          + `--no-playlist --retries 2 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
    ];

    let lastErr = null;
    for (const strategy of strategies) {
      try {
        console.log(`🎵 Audio strategy: ${strategy.name} (${platform})`);
        await execPromise(strategy.cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

        const size = await getFileSize(outputPath);
        if (size > 0) {
          console.log(`✅ Audio OK (${strategy.name}): ${size} bytes`);
          return;
        }
        throw new Error('Fayl boş gəldi');
      } catch (err) {
        console.log(`⚠️ Audio ${strategy.name} uğursuz: ${err.message.substring(0, 100)}`);
        lastErr = err;
        await removeFile(outputPath);
      }
    }

    throw new Error(`Audio download uğursuz (${platform}): ${lastErr?.message}`);
  }

  // ─── TikTok audio: video yüklə → ffmpeg extract ───────────────────────────

  async downloadTikTokAudio(url, outputPath) {
    console.log(`🎵 TikTok audio: video→ffmpeg strategiyası`);
    let lastErr = null;

    for (const hostname of this.tiktokHostnames) {
      const tmpVideo = outputPath.replace('.m4a', `_tmpvideo.mp4`);

      try {
        console.log(`🎵 TikTok audio → video yüklə (${hostname})`);

        const dlCmd = `yt-dlp ${PROXY_ARG} `
          + `--extractor-args "tiktok:api_hostname=${hostname}" `
          + `-f "best[ext=mp4]/best" `
          + `--no-playlist --retries 2 --socket-timeout 20 `
          + `-o "${tmpVideo}" "${url}"`;

        await execPromise(dlCmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

        const videoSize = await getFileSize(tmpVideo);
        if (videoSize === 0) throw new Error('Video fayl boş gəldi');
        console.log(`✅ TikTok video yükləndi (${hostname}): ${videoSize} bytes`);

        console.log(`🎵 FFmpeg audio extract...`);
        const ffCmd = `ffmpeg -i "${tmpVideo}" -vn -acodec aac -ab 192k -y "${outputPath}"`;
        await execPromise(ffCmd, { timeout: 60000 });

        await removeFile(tmpVideo);

        const audioSize = await getFileSize(outputPath);
        if (audioSize === 0) throw new Error('Audio fayl boş gəldi');

        console.log(`✅ TikTok audio OK (${hostname}): ${audioSize} bytes`);
        return;

      } catch (err) {
        console.log(`⚠️ TikTok audio ${hostname} uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
        await removeFile(tmpVideo);
        await removeFile(outputPath);
      }
    }

    throw new Error(`TikTok audio bütün hostname-lər uğursuz: ${lastErr?.message}`);
  }

  // ─── YouTube audio server-side ────────────────────────────────────────────

  async downloadYoutubeAudio(url, outputPath) {
    console.log(`🎵 YouTube audio server-side: ${url.substring(0, 60)}`);

    const strategies = [
      {
        name: 'format_140',
        cmd:  `yt-dlp ${PROXY_ARG} -f "140/bestaudio[ext=m4a]/bestaudio[ext=aac]" `
          + `--no-playlist --retries 3 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
      {
        name: 'extract_x',
        cmd:  `yt-dlp ${PROXY_ARG} -f "bestaudio" -x --audio-format m4a --audio-quality 0 `
          + `--no-playlist --retries 3 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
      {
        name: 'tv_embedded',
        cmd:  `yt-dlp ${PROXY_ARG} --extractor-args "youtube:player_client=tv_embedded" `
          + `-f "140/bestaudio[ext=m4a]" `
          + `--no-playlist --retries 3 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
      {
        name: 'ios_client',
        cmd:  `yt-dlp ${PROXY_ARG} --extractor-args "youtube:player_client=ios" `
          + `--user-agent "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)" `
          + `-f "140/bestaudio[ext=m4a]" `
          + `--no-playlist --retries 3 --socket-timeout 20 `
          + `-o "${outputPath}" "${url}"`,
      },
    ];

    let lastErr = null;
    for (const strategy of strategies) {
      try {
        console.log(`🎵 YouTube audio strategy: ${strategy.name}`);
        await execPromise(strategy.cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

        const size = await getFileSize(outputPath);
        if (size > 0) {
          console.log(`✅ YouTube audio OK (${strategy.name}): ${size} bytes`);
          return;
        }
        throw new Error('Fayl boş gəldi');
      } catch (err) {
        console.log(`⚠️ YouTube audio ${strategy.name} uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
        await removeFile(outputPath);
      }
    }

    throw new Error(`YouTube audio bütün strategiyalar uğursuz: ${lastErr?.message}`);
  }

  // ─── TikTok video download ────────────────────────────────────────────────

  async downloadTikTok(url, outputPath) {
    let lastErr = null;

    for (const hostname of this.tiktokHostnames) {
      try {
        console.log(`📥 TikTok download hostname: ${hostname}`);
        const cmd = `yt-dlp ${PROXY_ARG} `
          + `--extractor-args "tiktok:api_hostname=${hostname}" `
          + `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
          + `--no-playlist --retries 2 --socket-timeout 20 `
          + `--merge-output-format mp4 `
          + `-o "${outputPath}" "${url}"`;

        await execPromise(cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

        const size = await getFileSize(outputPath);
        if (size > 0) {
          console.log(`✅ TikTok download OK (${hostname}): ${size} bytes`);
          return;
        }
        throw new Error('Fayl boş gəldi');
      } catch (err) {
        console.log(`⚠️ TikTok hostname ${hostname} uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
        await removeFile(outputPath);
      }
    }

    try {
      console.log('📥 TikTok download: son cəhd (default)');
      const cmd = `yt-dlp ${PROXY_ARG} -f "best" --no-playlist --retries 2 --socket-timeout 20 -o "${outputPath}" "${url}"`;
      await execPromise(cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

      const size = await getFileSize(outputPath);
      if (size > 0) {
        console.log(`✅ TikTok download OK (default): ${size} bytes`);
        return;
      }
      throw new Error('Son cəhd də uğursuz');
    } catch (err) {
      lastErr = err;
    }

    throw new Error(`TikTok yükləmə uğursuz: ${lastErr?.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INSTAGRAM DOWNLOAD - COOKIE YOXdUR!
  // ═══════════════════════════════════════════════════════════════════════════

  async downloadInstagram(url, outputPath) {
    let lastErr = null;

    for (const strategy of this.instagramStrategies) {
      try {
        console.log(`📥 Instagram download: ${strategy.name}`);
        
        let args = strategy.args;
        if (strategy.ua) {
          args += ` --add-header "User-Agent:${strategy.ua}"`;
        }
        
        const cmd = `yt-dlp ${PROXY_ARG} `
          + `${args} `
          + `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
          + `--no-playlist --retries 2 --socket-timeout 20 `
          + `--merge-output-format mp4 `
          + `-o "${outputPath}" "${url}"`;

        await execPromise(cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });

        const size = await getFileSize(outputPath);
        if (size > 0) {
          console.log(`✅ Instagram download OK (${strategy.name}): ${size} bytes`);
          return;
        }
        throw new Error('Fayl boş gəldi');
      } catch (err) {
        console.log(`⚠️ Instagram ${strategy.name} uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
        await removeFile(outputPath);
      }
    }

    throw new Error(`Instagram yükləmə uğursuz: ${lastErr?.message}`);
  }

  // ─── Generic/Facebook direct download ─────────────────────────────────────

  async downloadDirect(originalUrl, outputPath, platform) {
    if (platform === 'tiktok')    return await this.downloadTikTok(originalUrl, outputPath);
    if (platform === 'instagram') return await this.downloadInstagram(originalUrl, outputPath);

    // Generic web üçün referer əlavə et
    let refererArg = '';
    if (platform === 'web' || platform === 'other') {
      try {
        const urlObj = new URL(originalUrl);
        const referer = `${urlObj.protocol}//${urlObj.host}/`;
        refererArg = `--referer "${referer}"`;
      } catch {}
    }

    // m3u8 stream varsa, ffmpeg ilə yüklə
    if (originalUrl.includes('.m3u8')) {
      return await this.downloadM3u8Stream(originalUrl, outputPath);
    }

    const cmd = `yt-dlp ${PROXY_ARG} ${refererArg} `
      + `-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
      + `--no-playlist --retries 3 --socket-timeout 20 `
      + `--merge-output-format mp4 `
      + `-o "${outputPath}" "${originalUrl}"`;

    console.log(`📥 yt-dlp direct (${platform}): ${originalUrl.substring(0, 60)}`);
    await execPromise(cmd, { timeout: DOWNLOAD_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });
  }

  // ─── m3u8 stream → MP4 ────────────────────────────────────────────────────

  async downloadM3u8Stream(m3u8Url, outputPath) {
    console.log(`📥 m3u8 stream yüklənir: ${m3u8Url.substring(0, 80)}`);
    
    const cmd = `ffmpeg -i "${m3u8Url}" -c copy -bsf:a aac_adtstoasc -y "${outputPath}"`;
    await execPromise(cmd, { timeout: DOWNLOAD_TIMEOUT });
    
    const size = await getFileSize(outputPath);
    if (size === 0) throw new Error('m3u8 yükləmə uğursuz');
    
    console.log(`✅ m3u8 stream OK: ${size} bytes`);
  }

  // ─── Yardımçılar ───────────────────────────────────────────────────────────

  async extractWithArgs(url, args) {
    const cmd = `yt-dlp ${PROXY_ARG} ${args} --dump-json --no-playlist --socket-timeout 15 "${url}"`;
    console.log(`📡 yt-dlp extract: ${url.substring(0, 60)}`);
    const { stdout } = await execPromise(cmd, {
      timeout: EXEC_TIMEOUT,
      maxBuffer: 20 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  heightToLabel(height) {
    if (height >= 1080) return '1080p HD';
    if (height >= 720)  return '720p';
    if (height >= 480)  return '480p';
    if (height >= 360)  return '360p';
    return null;
  }
}

module.exports = new YtDlpService();
