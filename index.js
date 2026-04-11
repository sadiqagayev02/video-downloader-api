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

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.syncpundit.io',
  'https://api.piped.projectsegfau.lt',
  'https://pipedapi.bocchi.rocks',
  'https://pipedapi.darkness.services',
  'https://piped-api.garudalinux.org',
];

function extractVideoId(url) {
  try {
    const uri = new URL(url);
    if (uri.hostname === 'youtu.be') {
      return uri.pathname.slice(1).split('?')[0];
    }
    if (uri.pathname.includes('/shorts/')) {
      return uri.pathname.split('/shorts/')[1].split('?')[0];
    }
    return uri.searchParams.get('v');
  } catch {
    return null;
  }
}

async function fetchYouTubeViaPiped(videoId) {
  for (const instance of PIPED_INSTANCES) {
    try {
      console.log(`🔄 Piped: ${instance}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(
        `${instance}/streams/${videoId}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!response.ok) {
        console.log(`❌ ${instance}: HTTP ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (!data || data.error) {
        console.log(`❌ ${instance}: ${data?.error || 'boş cavab'}`);
        continue;
      }
      console.log(`✅ Piped uğurlu: ${instance}`);
      return data;
    } catch (e) {
      console.log(`❌ ${instance}: ${e.message.substring(0, 80)}`);
    }
  }
  throw new Error('Bütün Piped serverləri cavab vermədi');
}

function buildQualitiesFromPiped(data) {
  const result = [];
  const videoStreams = data.videoStreams || [];
  const audioStreams = data.audioStreams || [];
  const added = new Set();
  const heights = [2160, 1440, 1080, 720, 480, 360];

  for (const h of heights) {
    const f = videoStreams.find(x =>
      x.quality === `${h}p` ||
      x.quality === `${h}p60` ||
      parseInt(x.quality) === h
    );
    if (f && f.url && !added.has(h)) {
      added.add(h);
      let label = `${h}p`;
      if (h === 2160) label = '4K Ultra HD';
      else if (h === 1080) label = '1080p Full HD';
      else if (h === 720) label = '720p HD';
      result.push({
        label,
        value: String(h),
        url: f.url,
        filesize: f.contentLength ? parseInt(f.contentLength) : 0,
        ext: 'mp4',
        needsMerge: false,
      });
    }
  }

  const bestAudio = [...audioStreams].sort(
    (a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0)
  )[0];

  if (bestAudio) {
    result.push({
      label: 'Yalnız səs',
      value: 'audio',
      url: bestAudio.url,
      filesize: bestAudio.contentLength ? parseInt(bestAudio.contentLength) : 0,
      ext: 'm4a',
      needsMerge: false,
    });
  }

  return result;
}

async function fetchInfoYtdlp(url) {
  const cookie = getCookieArg();
  let extraArgs = '';
  if (url.includes('tiktok.com')) {
    extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
  }
  const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 ${cookie} ${extraArgs} "${url}"`;
  console.log('📡 yt-dlp:', cmd);
  const { stdout } = await execPromise(cmd, { timeout: 45000 });
  return JSON.parse(stdout.trim().split('\n')[0]);
}

function buildQualitiesYtdlp(data, url) {
  const formats = data.formats || [];
  const result = [];

  if (url.includes('instagram.com')) {
    const vids = formats
      .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));
    if (vids.length > 0) {
      const f = vids[0];
      return [{
        label: f.height ? `${f.height}p` : 'HD',
        value: String(f.height || 'best'),
        url: f.url,
        filesize: f.filesize || f.filesize_approx || 0,
        ext: 'mp4',
        needsMerge: false,
      }];
    }
    if (formats.length > 0) {
      const f = formats[formats.length - 1];
      return [{
        label: 'HD', value: 'best',
        url: f.url, filesize: f.filesize || 0,
        ext: f.ext || 'mp4', needsMerge: false,
      }];
    }
    return [];
  }

  const progressive = formats.filter(f =>
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    f.url && !f.manifest_url
  );
  const videoOnly = formats.filter(f =>
    f.vcodec && f.vcodec !== 'none' &&
    (!f.acodec || f.acodec === 'none') &&
    f.url && !f.manifest_url
  );

  const heights = [2160, 1440, 1080, 720, 480, 360];
  const added = new Set();

  for (const h of heights) {
    const f = progressive.find(x => x.height === h) || videoOnly.find(x => x.height === h);
    if (f && !added.has(h)) {
      added.add(h);
      let label = `${h}p`;
      if (h === 2160) label = '4K Ultra HD';
      else if (h === 1080) label = '1080p Full HD';
      else if (h === 720) label = '720p HD';
      result.push({
        label, value: String(h),
        url: f.url, filesize: f.filesize || f.filesize_approx || 0,
        ext: f.ext || 'mp4', needsMerge: false,
      });
    }
  }

  const audios = formats
    .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url)
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));

  if (audios.length > 0) {
    const a = audios[0];
    result.push({
      label: 'Yalnız səs', value: 'audio',
      url: a.url, filesize: a.filesize || a.filesize_approx || 0,
      ext: a.ext || 'm4a', needsMerge: false,
    });
  }

  if (result.length === 0 && formats.length > 0) {
    const f = formats[formats.length - 1];
    result.push({
      label: 'Best', value: 'best',
      url: f.url, filesize: f.filesize || 0,
      ext: f.ext || 'mp4', needsMerge: false,
    });
  }

  return result;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Məlumat: ${url}`);
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  try {
    let qualities = [];
    let title = 'Video';
    let thumbnail = '';
    let duration = '00:00';
    let platform = 'unknown';
    let uploader = '';

    if (isYoutube) {
      const videoId = extractVideoId(url);
      if (!videoId) return res.status(400).json({ error: 'YouTube video ID tapılmadı' });

      const data = await fetchYouTubeViaPiped(videoId);
      qualities = buildQualitiesFromPiped(data);
      title = data.title || 'Video';
      thumbnail = data.thumbnailUrl || '';
      const secs = data.duration || 0;
      duration = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
      uploader = data.uploader || '';
      platform = 'youtube';
    } else {
      const data = await fetchInfoYtdlp(url);
      qualities = buildQualitiesYtdlp(data, url);
      title = data.title || 'Video';
      thumbnail = data.thumbnail || '';
      const secs = data.duration || 0;
      duration = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
      uploader = data.uploader || data.channel || '';
      if (url.includes('tiktok.com')) platform = 'tiktok';
      else if (url.includes('instagram.com')) platform = 'instagram';
      else if (url.includes('facebook.com')) platform = 'facebook';
    }

    if (qualities.length === 0) {
      return res.status(404).json({ success: false, error: 'Format tapılmadı' });
    }

    res.json({
      success: true,
      data: { title, thumbnail, duration, platform, uploader, qualities },
    });
  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/download/start', async (req, res) => {
  const { url, quality } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId = crypto.randomBytes(16).toString('hex');
  console.log(`📥 Download: ${url}, ${quality}`);

  try {
    const data = await fetchInfoYtdlp(url);
    let formatId = quality;

    if (quality === 'audio') {
      const a = (data.formats || []).find(f => f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
      if (a) formatId = a.format_id;
    } else {
      const h = parseInt(quality);
      const f = (data.formats || []).find(f => f.height === h && f.vcodec !== 'none');
      if (f) formatId = f.format_id;
    }

    const outputExt = quality === 'audio' ? 'm4a' : 'mp4';
    const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
    const cookie = getCookieArg();

    await execPromise(
      `yt-dlp -f "${formatId}" -o "${outputPath}" ${cookie} "${url}"`,
      { timeout: 300000 }
    );

    const stats = fs.statSync(outputPath);
    const safeTitle = (data.title || 'video').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 80);

    res.json({
      success: true,
      fileId,
      filename: `${safeTitle}.${outputExt}`,
      filesize: stats.size,
    });
  } catch (err) {
    console.error(`❌ Download xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['mp4', 'm4a']) {
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
