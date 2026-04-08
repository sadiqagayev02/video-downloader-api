// I) services/facebookService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FacebookService {
  async getInfo(url) {
    try {
      const cmd = `yt-dlp --dump-json --no-playlist "${url}"`;
      const { stdout } = await execPromise(cmd, { timeout: 30000 });
      const data = JSON.parse(stdout);
      
      return this.processData(data);
    } catch (err) {
      throw new Error(`Facebook məlumat alınmadı: ${err.message}`);
    }
  }

  processData(data) {
    const qualities = [];
    
    if (data.formats && data.formats.length > 0) {
      // HD versiya
      const hdVideo = data.formats.find(f => f.height >= 720 && f.vcodec !== 'none');
      if (hdVideo) {
        qualities.push({
          label: 'HD',
          value: 'hd',
          formatId: hdVideo.format_id,
          url: hdVideo.url,
          filesize: hdVideo.filesize,
          ext: 'mp4',
          needsMerge: false
        });
      }

      // SD versiya
      const sdVideo = data.formats.find(f => f.height < 720 && f.height >= 360 && f.vcodec !== 'none');
      if (sdVideo) {
        qualities.push({
          label: 'SD',
          value: 'sd',
          formatId: sdVideo.format_id,
          url: sdVideo.url,
          filesize: sdVideo.filesize,
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
    }

    return {
      title: data.title || data.uploader || 'Facebook Video',
      thumbnail: data.thumbnail,
      duration: this.formatDuration(data.duration),
      uploader: data.uploader,
      platform: 'facebook',
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

module.exports = new FacebookService();