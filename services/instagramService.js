// services/instagramService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class InstagramService {
  async getInfo(url) {
    try {
      const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 "${url}"`;
      const { stdout } = await execPromise(cmd, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
      const data = JSON.parse(stdout);
      
      return this.processData(data);
    } catch (err) {
      throw new Error(`Instagram məlumat alınmadı: ${err.message}`);
    }
  }

  processData(data) {
    const qualities = [];
    
    // Video formatları
    if (data.formats && data.formats.length > 0) {
      // Ən yüksək keyfiyyətli video
      const videoFormats = data.formats.filter(f => f.vcodec !== 'none' && f.acodec !== 'none');
      
      if (videoFormats.length > 0) {
        const bestVideo = videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        qualities.push({
          label: bestVideo.height ? `${bestVideo.height}p` : 'HD Video',
          value: 'video',
          formatId: bestVideo.format_id,
          url: bestVideo.url,
          filesize: bestVideo.filesize,
          ext: 'mp4',
          needsMerge: false,
          _source: 'instagram_direct'
        });
      }
    }

    // Audio formatı
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
        _source: 'instagram_direct'
      });
    }

    // Heç nə tapılmasa
    if (qualities.length === 0) {
      qualities.push({
        label: 'Video',
        value: 'video',
        formatId: null,
        url: data.url || data.webpage_url,
        filesize: data.filesize,
        ext: 'mp4',
        needsMerge: false,
        _source: 'instagram_direct'
      });
    }

    return {
      title: data.title || data.uploader || 'Instagram Video',
      thumbnail: data.thumbnail || '',
      duration: this.formatDuration(data.duration),
      uploader: data.uploader || '',
      platform: 'instagram',
      qualities: qualities
    };
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

module.exports = new InstagramService();
