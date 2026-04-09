const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class YouTubeService {

  async getVideoInfo(url) {
    // Sadəcə JSON məlumat al, heç nə yükləmə
    const { stdout } = await execPromise(
      `yt-dlp --dump-json --no-playlist --socket-timeout 30 "${url}"`,
      { timeout: 35000, maxBuffer: 15 * 1024 * 1024 }
    );

    const info = JSON.parse(stdout);
    const formats = info.formats || [];

    const seen = new Set();
    const qualities = [];

    // Ayrı video+audio formatları (DASH — 1080p üçün)
    const videoOnly = formats.filter(f =>
      f.vcodec && f.vcodec !== 'none' &&
      (f.acodec === 'none' || !f.acodec) &&
      f.height && f.url
    );

    // Birləşmiş formatlar (720p, 480p və s.)
    const combined = formats.filter(f =>
      f.vcodec && f.vcodec !== 'none' &&
      f.acodec && f.acodec !== 'none' &&
      f.height && f.url
    );

    // Ən yaxşı audio
    const bestAudio = formats
      .filter(f => f.acodec && f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec) && f.url)
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    // 1080p — DASH (video + audio ayrı URL)
    const v1080 = videoOnly
      .filter(f => f.height >= 1080)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

    if (v1080 && bestAudio && !seen.has('1080p')) {
      seen.add('1080p');
      qualities.push({
        quality: '1080p',
        isDash: true,
        videoUrl: v1080.url,
        audioUrl: bestAudio.url,
        filesize: (v1080.filesize || 0) + (bestAudio.filesize || 0),
      });
    }

    // 720p, 480p, 360p
    for (const height of [720, 480, 360]) {
      const label = `${height}p`;
      if (seen.has(label)) continue;

      const match = combined
        .filter(f => f.height <= height && f.height >= height * 0.85)
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

      if (match) {
        seen.add(label);
        qualities.push({
          quality: label,
          isDash: false,
          videoUrl: match.url,
          audioUrl: null,
          filesize: match.filesize || null,
        });
      } else {
        // Birləşmiş yoxdursa DASH istifadə et
        const vOnly = videoOnly
          .filter(f => f.height <= height && f.height >= height * 0.85)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

        if (vOnly && bestAudio) {
          seen.add(label);
          qualities.push({
            quality: label,
            isDash: true,
            videoUrl: vOnly.url,
            audioUrl: bestAudio.url,
            filesize: (vOnly.filesize || 0) + (bestAudio.filesize || 0),
          });
        }
      }
    }

    // Audio only
    if (bestAudio) {
      qualities.push({
        quality: 'audio',
        isDash: false,
        videoUrl: null,
        audioUrl: bestAudio.url,
        filesize: bestAudio.filesize || null,
      });
    }

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
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = new YouTubeService();
