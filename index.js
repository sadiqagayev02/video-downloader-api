const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const tmpDir = '/tmp/video-downloader';
const COOKIE_PATH = '/tmp/yt-cookies/youtube.txt';

app.use(cors());
app.use(express.json());

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync('/tmp/yt-cookies', { recursive: true });
console.log(`✅ TMP: ${tmpDir}`);

if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ Cookie yaradıldı');
  } catch (e) {
    console.log('⚠️ Cookie xətası:', e.message);
  }
}

function getCookieArg() {
  try {
    fs.accessSync(COOKIE_PATH);
    return `--cookies "${COOKIE_PATH}"`;
  } catch {
    return '';
  }
}

// ─── Innertube client ─────────────────────────────────────────────────────────
let ytClient = null;

async function getYouTubeClient() {
  if (ytClient) return ytClient;
  console.log('🔧 Innertube client yaradılır...');
  const { Innertube } = await import('youtubei.js');
  ytClient = await Innertube.create({ lang: 'en', location: 'US', retrieve_player: false });
  console.log('✅ Innertube client hazırdır');
  return ytClient;
}

getYouTubeClient().catch(e => console.log('⚠️ Innertube init xətası:', e.message));

function extractVideoId(url) {
  try {
    const uri = new URL(url);
    if (uri.hostname === 'youtu.be') return uri.pathname.slice(1).split('?')[0];
    if (uri.pathname.includes('/shorts/')) return uri.pathname.split('/shorts/')[1].split('?')[0];
    return uri.searchParams.get('v');
  } catch { return null; }
}

function formatDuration(secs) {
  if (!secs) return '00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ─── YouTube keyfiyyət siyahısı — URL saxlamadan, tez qaytarır ───────────────
// Stream URL-ləri yükləmə zamanı yt-dlp alacaq
function buildYouTubeQualities(info) {
  const result = [];
  const adaptive = info.streaming_data?.adaptive_formats || [];
  const basic    = info.streaming_data?.formats || [];
  const added    = new Set();
  const heights  = [2160, 1440, 1080, 720, 480, 360];

  for (const h of heights) {
    const hasFmt = basic.find(x => x.height === h)
                || adaptive.find(x => x.height === h && x.mime_type?.startsWith('video/'));
    if (hasFmt && !added.has(h)) {
      added.add(h);
      result.push({
        label: h === 2160 ? '4K Ultra HD'
             : h === 1080 ? '1080p Full HD'
             : h === 720  ? '720p HD'
             : `${h}p`,
        value: String(h),
        ext: 'mp4',
        needsMerge: false,
        filesize: hasFmt.content_length ? parseInt(hasFmt.content_length) : 0,
      });
    }
  }

  const hasAudio = adaptive.some(f => f.mime_type?.startsWith('audio/'));
  if (hasAudio) {
    result.push({
      label: 'MP3 (Audio)',
      value: 'audio',
      ext: 'm4a',
      needsMerge: false,
      filesize: 0,
    });
  }

  return result;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Info — mümkün qədər tez cavab ver ───────────────────────────────────────
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Info: ${url}`);
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  try {
    if (isYoutube) {
      // ── YouTube: retrieve_player=false ilə tez metadata al ────────────────
      const videoId = extractVideoId(url);
      if (!videoId) return res.status(400).json({ error: 'Video ID tapılmadı' });

      const client = await getYouTubeClient();

      // getBasicInfo — streaming_data olmadan, çox tez (~300ms)
      let info;
      try {
        info = await client.getBasicInfo(videoId);
      } catch {
        info = await client.getInfo(videoId);
      }

      const qualities = buildYouTubeQualities(info);
      const secs = info.basic_info?.duration || 0;

      // Əgər qualities boşdursa — standart siyahı qaytır
      const fallbackQualities = qualities.length > 0 ? qualities : [
        { label: '1080p Full HD', value: '1080', ext: 'mp4', needsMerge: false, filesize: 0 },
        { label: '720p HD',       value: '720',  ext: 'mp4', needsMerge: false, filesize: 0 },
        { label: '480p',          value: '480',  ext: 'mp4', needsMerge: false, filesize: 0 },
        { label: '360p',          value: '360',  ext: 'mp4', needsMerge: false, filesize: 0 },
        { label: 'MP3 (Audio)',   value: 'audio',ext: 'm4a', needsMerge: false, filesize: 0 },
      ];

      return res.json({
        success: true,
        data: {
          title:    info.basic_info?.title || 'YouTube Video',
          thumbnail: info.basic_info?.thumbnail?.[0]?.url || '',
          duration: formatDuration(secs),
          platform: 'youtube',
          uploader: info.basic_info?.author || '',
          qualities: fallbackQualities,
        },
      });
    }

    // ── TikTok / Instagram / digər: yt-dlp ilə metadata al ──────────────────
    const cookie = getCookieArg();
    let extraArgs = '';
    if (url.includes('tiktok.com')) {
      extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
    }

    const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 20 ${cookie} ${extraArgs} "${url}"`;
    const { stdout } = await execPromise(cmd, { timeout: 35000 });
    const data = JSON.parse(stdout.trim().split('\n')[0]);

    let platform = 'other';
    if (url.includes('tiktok.com'))    platform = 'tiktok';
    else if (url.includes('instagram.com')) platform = 'instagram';
    else if (url.includes('facebook.com'))  platform = 'facebook';
    else if (url.includes('twitter.com') || url.includes('x.com')) platform = 'twitter';

    // TikTok / Instagram üçün sadə keyfiyyət siyahısı — URL saxlamadan
    const qualities = [{
      label: 'HD Video',
      value: 'video',
      ext: 'mp4',
      needsMerge: false,
      filesize: 0,
    }];

    return res.json({
      success: true,
      data: {
        title:    data.title || 'Video',
        thumbnail: data.thumbnail || '',
        duration: formatDuration(data.duration || 0),
        platform,
        uploader: data.uploader || data.channel || '',
        qualities,
      },
    });

  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Download start ───────────────────────────────────────────────────────────
app.post('/api/download/start', async (req, res) => {
  const { url, quality } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId = crypto.randomBytes(16).toString('hex');
  const cookie = getCookieArg();
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  console.log(`📥 Download: ${url} | keyfiyyət: ${quality}`);

  try {
    const outputExt  = quality === 'audio' ? 'm4a' : 'mp4';
    const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
    let title = 'video';

    if (isYoutube) {
      // ── YouTube: yt-dlp birbaşa yükləyir ─────────────────────────────────
      // Innertube URL-ləri curl ilə yüklədikdə donur — yt-dlp daha etibarlıdır
      let fmtArg;
      if (quality === 'audio') {
        fmtArg = 'bestaudio[ext=m4a]/bestaudio/best';
      } else {
        const h = parseInt(quality);
        if (!isNaN(h)) {
          fmtArg = `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/`
                 + `bestvideo[height=${h}]+bestaudio/`
                 + `best[height=${h}]/best`;
        } else {
          fmtArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';
        }
      }

      console.log(`📥 YouTube yt-dlp: -f "${fmtArg}"`);

      // Title al
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${cookie} "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      await execPromise(
        `yt-dlp -f "${fmtArg}" ${cookie} --merge-output-format ${outputExt} `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isTikTok) {
      // ── TikTok: yt-dlp birbaşa yükləyir — URL ayrıca alınmır ────────────
      console.log('📥 TikTok birbaşa yükləmə');
      const extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${extraArgs} "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${extraArgs} ${cookie} --merge-output-format mp4 `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isInstagram) {
      // ── Instagram ─────────────────────────────────────────────────────────
      console.log('📥 Instagram birbaşa yükləmə');

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${cookie} --merge-output-format mp4 --no-playlist --retries 3 `
        + `-o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      // ── Digər platformalar ────────────────────────────────────────────────
      console.log('📥 Generic yükləmə');
      await execPromise(
        `yt-dlp -f "best" ${cookie} --no-playlist -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );
    }

    // Fayl yoxlaması
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const safeTitle = title
      .replace(/[^\w\s\u0400-\u04FF-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video';

    console.log(`✅ Tamamlandı: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);

    res.json({
      success: true,
      fileId,
      filename: `${safeTitle}.${outputExt}`,
      filesize: stats.size,
    });

  } catch (err) {
    console.error(`❌ Download xətası: ${err.message}`);
    try {
      fs.readdirSync(tmpDir).forEach(f => {
        if (f.includes(fileId)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {}
        }
      });
    } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Download file ────────────────────────────────────────────────────────────
app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['mp4', 'm4a', 'mp3', 'webm']) {
    const filePath = path.join(tmpDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, () => {
        try { fs.unlinkSync(filePath); } catch (_) {}
      });
    }
  }
  res.status(404).json({ error: 'Fayl tapılmadı' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Video Downloader API işləyir!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda işləyir`);
});
