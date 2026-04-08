// H) services/instagramService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class InstagramService {
  async getInfo(url) {
    try {
      const cmd = `yt-dlp --dump-json --no-playlist "${url}"`;
      const { stdout } = await execPromise(cmd, { timeout: 30000 });
      const data = JSON.parse(stdout);
      
      return this.processData(data);
    } catch (err) {
      throw new Error(`Instagram məlumat alınmadı: ${err.message}`);
    }
  }

  processData(data) {
    const qualities = [];
    
    // Orijinal keyfiyyət
    if (data.formats && data.formats.length > 0) {
      const bestVideo = data.formats[0]; // Instagram ən yaxşını birinci verir
      qualities.push({
        label: 'Orijinal keyfiyyət',
        value: 'original',
        formatId: bestVideo.format_id,
        url: bestVideo.url,
        filesize: bestVideo.filesize,
        ext: 'mp4',
        needsMerge: false
      });
    }

    // Audio
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
      title: data.title || data.uploader || 'Instagram Video',
      thumbnail: data.thumbnail,
      duration: this.formatDuration(data.duration),
      uploader: data.uploader,
      platform: 'instagram',
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

module.exports = new InstagramService();