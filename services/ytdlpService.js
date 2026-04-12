// services/ytdlpService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class YtDlpService {
  constructor() {
    this.youtubeStrategies = [
      { name: 'tv_embedded', args: '--extractor-args "youtube:player_client=tv_embedded"' },
      { name: 'ios', args: '--extractor-args "youtube:player_client=ios" --user-agent "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"' },
      { name: 'android_vr', args: '--extractor-args "youtube:player_client=android_vr" --user-agent "com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12)"' },
      { name: 'web_creator', args: '--extractor-args "youtube:player_client=web_creator"' },
      { name: 'mweb', args: '--extractor-args "youtube:player_client=mweb"' },
      { name: 'default', args: '' },
    ];
  }

  // ─── URL növü ────────────────────────────────────────────────────────────

  isYouTube(url) {
    return url.includes('youtube.com') || url.includes('youtu.be');
  }

  isTikTok(url) {
    return url.includes('tiktok.com') || url.includes('vt.tiktok.com');
  }

  isInstagram(url) {
    return url.includes('instagram.com') || url.includes('instagr.am');
  }

  // ─── Info ─────────────────────────────────────────────────────────────────

  async getVideoInfo(url) {
    if (this.isYouTube(url)) return await this.getYouTubeInfo(url);
    if (this.isTikTok(url))  return await this.getTikTokInfo(url);
    return await this.getGenericInfo(url);
  }

  // ─── YouTube Info ────────────────────────────────────────────────────────

  async getYouTubeInfo(url) {
    // Əvvəl Invidious
    const inv = await this.tryInvidious(url);
    if (inv) return inv;

    // Sonra yt-dlp strategiyaları
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
          label,
          value: label,
          url: fmt.url,
          formatId: null,
          ext: 'mp4',
          needsMerge: false,
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
          label: 'MP3 (Audio)',
          value: 'audio',
          url: audio.url,
          formatId: null,
          ext: 'm4a',
          needsMerge: false,
          filesize: audio.size ? parseInt(audio.size) : null,
          _source: 'invidious',
        });
      }
    }

    const secs = data.lengthSeconds || 0;
    return {
      title: data.title || 'YouTube Video',
      thumbnail: data.videoThumbnails?.[0]?.url || data.thumbnailUrl || '',
      duration: this.formatDuration(secs),
      uploader: data.author || '',
      platform: 'youtube',
      qualities,
    };
  }

  processYouTubeData(data) {
    const qualities = [];
    const formats = data.formats || [];

    const audioBest = formats
      .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    // 1080p DASH
    const v1080 = formats
      .filter(f => f.height === 1080 && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
      .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];

    if (v1080 && audioBest) {
      qualities.push({
        label: '1080p HD',
        value: '1080p',
        videoFormatId: v1080.format_id,
        audioFormatId: audioBest.format_id,
        filesize: (v1080.filesize || 0) + (audioBest.filesize || 0),
        ext: 'mp4',
        needsMerge: true,
        _source: 'ytdlp',
      });
    }

    for (const res of [720, 480, 360]) {
      const combined = formats
        .filter(f => f.height === res && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
        .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];

      if (combined) {
        qualities.push({
          label: `${res}p`,
          value: `${res}p`,
          formatId: combined.format_id,
          filesize: combined.filesize || null,
          ext: 'mp4',
          needsMerge: false,
          _source: 'ytdlp',
        });
      } else if (audioBest) {
        const vOnly = formats
          .filter(f => f.height === res && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
          .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];
        if (vOnly) {
          qualities.push({
            label: `${res}p`,
            value: `${res}p`,
            videoFormatId: vOnly.format_id,
            audioFormatId: audioBest.format_id,
            filesize: (vOnly.filesize || 0) + (audioBest.filesize || 0),
            ext: 'mp4',
            needsMerge: true,
            _source: 'ytdlp',
          });
        }
      }
    }

    if (audioBest) {
      qualities.push({
        label: 'MP3 (Audio)',
        value: 'audio',
        formatId: audioBest.format_id,
        filesize: audioBest.filesize || null,
        ext: 'm4a',
        needsMerge: false,
        _source: 'ytdlp',
      });
    }

    return {
      title: data.title || 'YouTube Video',
      thumbnail: data.thumbnail || '',
      duration: this.formatDuration(data.duration || 0),
      uploader: data.uploader || '',
      platform: 'youtube',
      qualities,
    };
  }

  // ─── TikTok Info ─────────────────────────────────────────────────────────
  // TikTok üçün yalnız metadata lazımdır (title, thumbnail, duration).
  // Real yükləmə download.js-də yt-dlp ilə birbaşa aparılır — URL ayrıca alınmır.

  async getTikTokInfo(url) {
    const strategies = [
      '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"',
      '--extractor-args "tiktok:api_hostname=api16-normal-c-useast2a.tiktokv.com"',
      '',
    ];

    let lastErr = null;
    for (const args of strategies) {
      try {
        console.log(`📡 TikTok info: "${args || 'default'}"`);
        const data = await this.extractWithArgs(url, args);
        if (data) return this.processTikTokData(data);
      } catch (err) {
        console.log(`⚠️ TikTok info uğursuz: ${err.message.substring(0, 120)}`);
        lastErr = err;
      }
    }
    throw new Error(`TikTok məlumat alınmadı: ${lastErr?.message}`);
  }

  processTikTokData(data) {
    // TikTok üçün yalnız bir seçim: "video" — yükləmə zamanı yt-dlp özü ən yaxşısını seçir
    const qualities = [
      {
        label: 'HD Video',
        value: 'video',
        formatId: 'best',   // yt-dlp birbaşa yükləyəcək
        url: null,
        filesize: null,
        ext: 'mp4',
        needsMerge: false,
        _source: 'tiktok_direct',
      },
    ];

    return {
      title: data.title || 'TikTok Video',
      thumbnail: data.thumbnail || '',
      duration: this.formatDuration(data.duration || 0),
      uploader: data.uploader || data.channel || '',
      platform: 'tiktok',
      qualities,
    };
  }

  // ─── Generic Info (Instagram, Twitter, Facebook) ──────────────────────────

  async getGenericInfo(url) {
    try {
      const data = await this.extractWithArgs(url, '');
      return this.processGenericData(data, url);
    } catch (err) {
      throw new Error(`Məlumat alınmadı: ${err.message}`);
    }
  }

  processGenericData(data, url) {
    const qualities = [
      {
        label: 'Video',
        value: 'video',
        formatId: 'best',
        url: null,
        filesize: null,
        ext: 'mp4',
        needsMerge: false,
        _source: 'generic_direct',
      },
    ];

    let platform = 'other';
    if (url.includes('instagram.com')) platform = 'instagram';
    else if (url.includes('facebook.com')) platform = 'facebook';
    else if (url.includes('twitter.com') || url.includes('x.com')) platform = 'twitter';

    return {
      title: data.title || 'Video',
      thumbnail: data.thumbnail || '',
      duration: this.formatDuration(data.duration || 0),
      uploader: data.uploader || data.channel || '',
      platform,
      qualities,
    };
  }

  // ─── Download metodları ───────────────────────────────────────────────────

  // Birbaşa CDN URL-dən yüklə (Invidious audio/video)
  async downloadByUrl(directUrl, outputPath) {
    const cmd = `curl -L --max-time 300 --retry 2 --retry-delay 3 -o "${outputPath}" "${directUrl}"`;
    console.log(`📥 curl download: ${directUrl.substring(0, 80)}...`);
    await execPromise(cmd, { timeout: 310000 });
  }

  // yt-dlp format ID ilə yüklə (YouTube DASH, combined)
  async downloadFormat(originalUrl, formatId, outputPath) {
    const cmd = `yt-dlp -f "${formatId}" --no-playlist --retries 3 -o "${outputPath}" "${originalUrl}"`;
    console.log(`📥 yt-dlp format: ${formatId}`);
    await execPromise(cmd, { timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
  }

  // yt-dlp ilə birbaşa yüklə — TikTok/Instagram/generic üçün
  // URL ayrıca alınmır, yt-dlp hər şeyi özü idarə edir → 403 olmur
  async downloadDirect(originalUrl, outputPath, platform) {
    let extraArgs = '';

    if (platform === 'tiktok') {
      extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
    }

    const cmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
      + `${extraArgs} --no-playlist --retries 3 --merge-output-format mp4 `
      + `-o "${outputPath}" "${originalUrl}"`;

    console.log(`📥 yt-dlp direct (${platform}): ${originalUrl}`);
    await execPromise(cmd, { timeout: 300000, maxBuffer: 5 * 1024 * 1024 });
  }

  // ─── Yardımçılar ──────────────────────────────────────────────────────────

  async extractWithArgs(url, args) {
    const cmd = `yt-dlp ${args} --dump-json --no-playlist --socket-timeout 30 "${url}"`;
    console.log(`📡 yt-dlp: ${cmd}`);
    const { stdout } = await execPromise(cmd, {
      timeout: 45000,
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
