// services/youtubeService.js
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class YouTubeService {
  // [YENİ] cookiePath parametri əlavə edildi
  async getVideoInfo(url, cookiePath = null) {
    const cookieArg = cookiePath ? `--cookies "${cookiePath}"` : '';

    const { stdout } = await execPromise(
      `yt-dlp ${cookieArg} --dump-json --no-playlist --socket-timeout 30 "${url}"`,
      { timeout: 35000, maxBuffer: 15 * 1024 * 1024 }
    );
    
    const info = JSON.parse(stdout);
    const formats = info.formats || [];
    const seen = new Set();
    const qualities = [];
    
    const videoOnly = formats.filter(f =>
      f.vcodec && f.vcodec !== 'none' &&
      (f.acodec === 'none' || !f.acodec) &&
      f.height && f.url
    );
    
    const combined = formats.filter(f =>
      f.vcodec && f.vcodec !== 'none' &&
      f.acodec && f.acodec !== 'none' &&
      f.height && f.url
    );
    
    const bestAudio = formats
      .filter(f => f.acodec && f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec) && f.url)
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
    
    // 1080p
    const v1080 = videoOnly
      .filter(f => f.height >= 1080)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      
    if (v1080 && bestAudio && !seen.has('1080p')) {
      seen.add('1080p');
      qualities.push({
        label: '1080p Full HD', value: '1080p',
        videoFormatId: v1080.format_id, audioFormatId: bestAudio.format_id,
        url: v1080.url,
        filesize: (v1080.filesize || 0) + (bestAudio.filesize || 0),
        ext: 'mp4', needsMerge: true, _source: 'ytdlp'
      });
    }
    
    // 720p, 480p, 360p
    for (const height of [720, 480, 360]) {
      const value = `${height}p`;
      if (seen.has(value)) continue;
      
      const match = combined
        .filter(f => f.height <= height && f.height >= height * 0.85)
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        
      if (match) {
        seen.add(value);
        const label = height === 720 ? '720p HD' : `${height}p`;
        qualities.push({
          label, value,
          formatId: match.format_id, url: match.url,
          filesize: match.filesize || null,
          ext: 'mp4', needsMerge: false, _source: 'ytdlp'
        });
      } else {
        const vOnly = videoOnly
          .filter(f => f.height <= height && f.height >= height * 0.85)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
          
        if (vOnly && bestAudio) {
          seen.add(value);
          const label = height === 720 ? '720p HD (DASH)' : `${height}p (DASH)`;
          qualities.push({
            label, value,
            videoFormatId: vOnly.format_id, audioFormatId: bestAudio.format_id,
            url: vOnly.url,
            filesize: (vOnly.filesize || 0) + (bestAudio.filesize || 0),
            ext: 'mp4', needsMerge: true, _source: 'ytdlp'
          });
        }
      }
    }
    
    // 1440p, 4K
    for (const height of [2160, 1440]) {
      const vHigh = videoOnly
        .filter(f => f.height >= height)
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        
      if (vHigh && bestAudio) {
        const value = height === 2160 ? '2160p' : '1440p';
        const label = height === 2160 ? '4K Ultra HD' : '1440p QHD';
        if (!seen.has(value)) {
          seen.add(value);
          qualities.push({
            label, value,
            videoFormatId: vHigh.format_id, audioFormatId: bestAudio.format_id,
            url: vHigh.url,
            filesize: (vHigh.filesize || 0) + (bestAudio.filesize || 0),
            ext: 'mp4', needsMerge: true, _source: 'ytdlp'
          });
        }
      }
    }
    
    // Audio only
    if (bestAudio) {
      qualities.push({
        label: 'MP3 (Audio)', value: 'audio',
        formatId: bestAudio.format_id, url: bestAudio.url,
        filesize: bestAudio.filesize || null,
        ext: 'm4a', needsMerge: false, _source: 'ytdlp'
      });
    }
    
    qualities.sort((a, b) => {
      const aVal = a.value === 'audio' ? -1 : parseInt(a.value.replace('p', ''));
      const bVal = b.value === 'audio' ? -1 : parseInt(b.value.replace('p', ''));
      return bVal - aVal;
    });
    
    return {
      title: info.title || 'YouTube Video',
      thumbnail: info.thumbnail || '',
      duration: this.formatDuration(info.duration || 0),
      platform: 'youtube',
      uploader: info.uploader || '',
      qualities,
    };
  }
  
  formatDuration(seconds) {
    if (!seconds) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}

module.exports = new YouTubeService();
