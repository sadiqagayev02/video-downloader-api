// D) services/ytdlpService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;

class YtDlpService {
  constructor() {
    this.youtubeStrategies = [
      { name: 'invidious', useInvidious: true },
      { name: 'tv_embedded', args: '--extractor-args youtube:player_client=tv_embedded' },
      { name: 'ios', args: '--extractor-args youtube:player_client=ios --user-agent "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"' },
      { name: 'android_vr', args: '--extractor-args youtube:player_client=android_vr --user-agent "com.google.android.apps.youtube.vr.oculus/1.56.21 (Linux; U; Android 12)"' },
      { name: 'web_creator', args: '--extractor-args youtube:player_client=web_creator' },
      { name: 'mweb', args: '--extractor-args youtube:player_client=mweb --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"' }
    ];
  }

  async getVideoInfo(url) {
    // Əvvəl Invidious ilə cəhd et
    const invidiousResult = await this.tryInvidious(url);
    if (invidiousResult) return invidiousResult;

    // Sonra digər strategiyalar
    for (const strategy of this.youtubeStrategies) {
      if (strategy.name === 'invidious') continue;
      
      try {
        console.log(`📡 YouTube strategiya: ${strategy.name}`);
        const result = await this.extractWithStrategy(url, strategy.args);
        if (result && result.formats) {
          return this.processYouTubeData(result, url);
        }
      } catch (err) {
        console.log(`⚠️ Strategiya ${strategy.name} uğursuz: ${err.message}`);
      }
    }

    throw new Error('YouTube: bütün metodlar uğursuz');
  }

  async tryInvidious(url) {
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;

    const instances = [
      'https://invidious.privacyredirect.com',
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://invidious.io.lol'
    ];

    for (const instance of instances) {
      try {
        console.log(`📡 Invidious cəhdi: ${instance}`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json();
          return this.processInvidiousData(data);
        }
      } catch (err) {
        console.log(`⚠️ Invidious ${instance} xətası: ${err.message}`);
      }
    }
    return null;
  }

  extractVideoId(url) {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
      /youtube\.com\/shorts\/([^&\n?#]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  async extractWithStrategy(url, args) {
    const cmd = `yt-dlp ${args} --dump-json --no-playlist --socket-timeout 15 "${url}"`;
    const { stdout } = await execPromise(cmd, { timeout: 30000 });
    return JSON.parse(stdout);
  }

  processInvidiousData(data) {
    const qualities = [];
    
    // Formatları emal et
    if (data.formatStreams) {
      for (const fmt of data.formatStreams) {
        if (fmt.resolution && fmt.resolution !== 'null') {
          const height = parseInt(fmt.resolution.split('x')[1]);
          const label = this.getQualityLabel(height);
          if (label && !qualities.find(q => q.label === label)) {
            qualities.push({
              label: label,
              value: label.toLowerCase().replace(' ', ''),
              url: fmt.url,
              ext: 'mp4',
              needsMerge: false,
              filesize: fmt.size ? parseInt(fmt.size) : null
            });
          }
        }
      }
    }

    // Audio formatı
    if (data.adaptiveFormats) {
      const audio = data.adaptiveFormats.find(f => f.type?.includes('audio'));
      if (audio) {
        qualities.push({
          label: 'Yalnız səs',
          value: 'audio',
          url: audio.url,
          ext: 'm4a',
          needsMerge: false,
          filesize: audio.size ? parseInt(audio.size) : null
        });
      }
    }

    return {
      title: data.title,
      thumbnail: data.videoThumbnails?.[0]?.url || data.thumbnailUrl,
      duration: this.formatDuration(data.lengthSeconds),
      uploader: data.author,
      platform: 'youtube',
      qualities: qualities
    };
  }

  processYouTubeData(data, originalUrl) {
    const qualities = this.extractQualities(data.formats);
    return {
      title: data.title,
      thumbnail: data.thumbnail,
      duration: this.formatDuration(data.duration),
      uploader: data.uploader,
      platform: 'youtube',
      qualities: qualities
    };
  }

  extractQualities(formats) {
    const qualities = [];
    const qualityMap = new Map();

    // 1080p (video + audio ayrı)
    const video1080p = formats.find(f => f.height === 1080 && f.vcodec !== 'none' && f.acodec === 'none');
    const audioBest = formats.find(f => f.acodec !== 'none' && f.vcodec === 'none');
    
    if (video1080p && audioBest) {
      qualities.push({
        label: '1080p HD',
        value: '1080p',
        videoFormatId: video1080p.format_id,
        audioFormatId: audioBest.format_id,
        filesize: (video1080p.filesize || 0) + (audioBest.filesize || 0),
        ext: 'mp4',
        needsMerge: true
      });
    }

    // 720p, 480p, 360p (combined formatları)
    const resolutions = [720, 480, 360];
    for (const res of resolutions) {
      const combined = formats.find(f => f.height === res && f.vcodec !== 'none' && f.acodec !== 'none');
      if (combined) {
        qualities.push({
          label: `${res}p`,
          value: `${res}p`,
          formatId: combined.format_id,
          filesize: combined.filesize,
          ext: 'mp4',
          needsMerge: false
        });
      } else {
        // Ayrı video + audio
        const video = formats.find(f => f.height === res && f.vcodec !== 'none' && f.acodec === 'none');
        if (video && audioBest) {
          qualities.push({
            label: `${res}p`,
            value: `${res}p`,
            videoFormatId: video.format_id,
            audioFormatId: audioBest.format_id,
            filesize: (video.filesize || 0) + (audioBest.filesize || 0),
            ext: 'mp4',
            needsMerge: true
          });
        }
      }
    }

    // Audio only
    if (audioBest) {
      qualities.push({
        label: 'Yalnız səs',
        value: 'audio',
        formatId: audioBest.format_id,
        filesize: audioBest.filesize,
        ext: 'm4a',
        needsMerge: false
      });
    }

    return qualities;
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}` : `${m}:${s.toString().padStart(2, '0')}`;
  }

  getQualityLabel(height) {
    const labels = { 1080: '1080p HD', 720: '720p', 480: '480p', 360: '360p' };
    return labels[height] || null;
  }

  async downloadFormat(url, formatId, outputPath) {
    const cmd = `yt-dlp -f ${formatId} -o "${outputPath}" "${url}"`;
    await execPromise(cmd, { timeout: 300000 });
    return outputPath;
  }
}

module.exports = new YtDlpService();