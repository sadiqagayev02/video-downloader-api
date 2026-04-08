// G) services/tiktokService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class TikTokService {
  async getInfo(url) {
    try {
      const cmd = `yt-dlp --dump-json --no-playlist --extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com" "${url}"`;
      const { stdout } = await execPromise(cmd, { timeout: 30000 });
      const data = JSON.parse(stdout);
      
      return this.processData(data);
    } catch (err) {
      throw new Error(`TikTok məlumat alınmadı: ${err.message}`);
    }
  }

  processData(data) {
    const qualities = [];
    
    // Ən yaxşı video formatı
    if (data.formats && data.formats.length > 0) {
      const bestVideo = data.formats.find(f => f.vcodec !== 'none' && f.height >= 720) || data.formats[0];
      qualities.push({
        label: bestVideo.height >= 720 ? 'HD Video' : 'SD Video',
        value: 'video',
        formatId: bestVideo.format_id,
        url: bestVideo.url,
        filesize: bestVideo.filesize,
        ext: 'mp4',
        needsMerge: false
      });
    }

    // Audio formatı
    const audio = data.formats?.find(f => f.acodec !== 'none' && f.vcodec === 'none');
    if (audio) {
      qualities.push({
        label: 'Yalnız səs',
        value: 'audio',
        formatId: audio.format_id,
        url: audio.url,
        filesize: audio.filesize,
        ext: 'm4a',
        needsMerge: false
      });
    }

    return {
      title: data.title,
      thumbnail: data.thumbnail,
      duration: this.formatDuration(data.duration),
      uploader: data.uploader || data.channel,
      platform: 'tiktok',
      qualities: qualities
    };
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

module.exports = new TikTokService();