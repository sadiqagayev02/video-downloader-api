const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class YouTubeService {
  async getVideoInfo(url) {
    try {
      // Video məlumatlarını JSON olaraq al
      const { stdout } = await execPromise(`yt-dlp -j "${url}"`, { 
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      });
      
      const info = JSON.parse(stdout);
      
      const qualities = [];
      const formats = info.formats || [];
      
      // Keyfiyyətləri yığ
      for (const f of formats) {
        if (f.height && f.vcodec !== 'none') {
          const label = `${f.height}p`;
          if (!qualities.find(q => q.value === label)) {
            qualities.push({ label: label, value: label });
          }
        }
      }
      
      // Böyükdən kiçiyə sırala
      qualities.sort((a, b) => parseInt(b.value) - parseInt(a.value));
      
      // Audio əlavə et
      qualities.push({ label: 'Audio (MP3)', value: 'audio' });
      
      return {
        title: info.title || 'YouTube Video',
        thumbnail: info.thumbnail || '',
        duration: this.formatDuration(info.duration || 0),
        platform: 'youtube',
        uploader: info.uploader || 'Unknown',
        qualities: qualities.slice(0, 6)
      };
    } catch (error) {
      console.error('Info error:', error.message);
      throw new Error('YouTube məlumatları alınmadı');
    }
  }

  async getDownloadUrl(url, quality) {
    try {
      let format;
      
      if (quality === 'audio') {
        format = 'bestaudio';
      } else {
        const height = parseInt(quality);
        if (!isNaN(height)) {
          format = `bestvideo[height<=${height}]+bestaudio`;
        } else {
          format = 'best';
        }
      }
      
      // Sadəcə URL almaq üçün
      const { stdout } = await execPromise(`yt-dlp -g -f "${format}" "${url}"`, {
        timeout: 30000
      });
      
      const videoUrl = stdout.trim().split('\n')[0];
      
      if (!videoUrl) {
        throw new Error('URL alınmadı');
      }
      
      return videoUrl;
    } catch (error) {
      console.error('Download error:', error.message);
      throw new Error('Download URL alınmadı');
    }
  }

  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = new YouTubeService();