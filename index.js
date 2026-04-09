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

// TMP qovluqlarını yarat
fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync('/tmp/yt-cookies', { recursive: true });
console.log(`✅ TMP: ${tmpDir}`);

// Cookie faylını env-dən yarat
if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ YouTube cookie faylı yaradıldı');
  } catch (e) {
    console.log('⚠️ Cookie yazıla bilmədi:', e.message);
  }
}

// ─── Cookie argümanı ───────────────────────────────────────────────────────────
function getCookieArg() {
  try {
    fs.accessSync(COOKIE_PATH);
    return `--cookies "${COOKIE_PATH}"`;
  } catch {
    return '';
  }
}

// ─── YouTube strategiyaları ────────────────────────────────────────────────────
const YT_STRATEGIES = [
  '--extractor-args "youtube:player_client=tv_embedded"',
  '--extractor-args "youtube:player_client=ios" --user-agent "com.google.ios.youtube/19.29.1 (iPhone14,3; U; CPU iPhone OS 15_6 like Mac OS X)"',
  '--extractor-args "youtube:player_client=android_vr"',
  '--extractor-args "youtube:player_client=web_creator"',
  '--extractor-args "youtube:player_client=mweb"',
];

// ─── yt-dlp ilə info al ───────────────────────────────────────────────────────
async function fetchInfo(url) {
  const cookie = getCookieArg();
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  if (!isYoutube) {
    let extraArgs = '';
    if (url.includes('tiktok.com')) {
      extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
    }
    const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 ${cookie} ${extraArgs} "${url}"`;
    console.log('📡 Sorğu:', cmd);
    const { stdout } = await execPromise(cmd, { timeout: 45000 });
    return JSON.parse(stdout.trim().split('\n')[0]);
  }

  // YouTube: strategiyaları sıraya görə sına
  for (let i = 0; i < YT_STRATEGIES.length; i++) {
    const cmd = `yt-dlp ${YT_STRATEGIES[i]} --dump-json --no-playlist --socket-timeout 30 ${cookie} "${url}"`;
    console.log(`🔄 YouTube strategiya ${i + 1}/${YT_STRATEGIES.length}`);
    try {
      const { stdout } = await execPromise(cmd, { timeout: 45000 });
      console.log(`✅ Strategiya ${i + 1} uğurlu`);
      return JSON.parse(stdout.trim().split('\n')[0]);
    } catch (e) {
      console.log(`❌ Strategiya ${i + 1}: ${e.message.substring(0, 100)}`);
    }
  }
  throw new Error('Bütün YouTube strategiyaları uğursuz — region Frankfurt-a dəyiş və ya cookie əlavə et');
}

// ─── Keyfiyyətlər siyahısı ────────────────────────────────────────────────────
function buildQualities(data, url) {
  const formats = data.formats || [];
  const result = [];

  if (url.includes('instagram.com')) {
    // Instagram: audio+video birlikdə olan ən yaxşı mp4
    const vids = formats
      .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    if (vids.length > 0) {
      const f = vids[0];
      return [{
        label: f.height ? `${f.height}p` : 'HD',
        value: String(f.height || 'best'),
        formatId: f.format_id,
        url: f.url,
        filesize: f.filesize || f.filesize_approx || 0,
        ext: 'mp4',
        needsMerge: false,
      }];
    }
    // Fallback
    if (formats.length > 0) {
      const f = formats[formats.length - 1];
      return [{
        label: 'HD', value: 'best', formatId: f.format_id,
        url: f.url, filesize: f.filesize || 0, ext: f.ext || 'mp4', needsMerge: false,
      }];
    }
    return [];
  }

  // YouTube / TikTok / Facebook
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
      else if (h === 1440) label = '2K Quad HD';
      else if (h === 1080) label = '1080p Full HD';
      else if (h === 720) label = '720p HD';

      result.push({
        label, value: String(h), formatId: f.format_id,
        url: f.url, filesize: f.filesize || f.filesize_approx || 0,
        ext: f.ext || 'mp4', needsMerge: false,
      });
    }
  }

  // Audio only
  const audios = formats
    .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url)
    .sort((a, b) => (b.abr || 0) - (a.abr || 0));

  if (audios.length > 0) {
    const a = audios[0];
    result.push({
      label: 'Yalnız səs', value: 'audio', formatId: a.format_id,
      url: a.url, filesize: a.filesize || a.filesize_approx || 0,
      ext: a.ext || 'm4a', needsMerge: false,
    });
  }

  // Heç nə tapılmadısa
  if (result.length === 0 && formats.length > 0) {
    const f = formats[formats.length - 1];
    result.push({
      label: 'Best', value: 'best', formatId: f.format_id,
      url: f.url, filesize: f.filesize || 0, ext: f.ext || 'mp4', needsMerge: false,
    });
  }

  return result;
}

// ─── /api/health ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── /api/info ────────────────────────────────────────────────────────────────
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Məlumat: ${url}`);

  try {
    const data = await fetchInfo(url);
    const qualities = buildQualities(data, url);

    if (qualities.length === 0) {
      return res.status(404).json({ success: false, error: 'Yüklənə bilən format tapılmadı' });
    }

    let platform = 'youtube';
    if (url.includes('tiktok.com')) platform = 'tiktok';
    else if (url.includes('instagram.com')) platform = 'instagram';
    else if (url.includes('facebook.com')) platform = 'facebook';

    res.json({
      success: true,
      data: {
        title: data.title || 'Video',
        thumbnail: data.thumbnail || '',
        duration: data.duration
          ? `${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, '0')}`
          : '00:00',
        platform,
        uploader: data.uploader || data.channel || 'Unknown',
        qualities,
      },
    });
  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({
      success: false,
      error: err.message,
      hint: (err.message.includes('429') || err.message.includes('bot'))
        ? 'YouTube IP bloku — Render regionunu Frankfurt-a dəyiş'
        : null,
    });
  }
});

// ─── /api/download/start ──────────────────────────────────────────────────────
app.post('/api/download/start', async (req, res) => {
  const { url, quality } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId = crypto.randomBytes(16).toString('hex');
  console.log(`📥 Download: ${url}, ${quality}`);

  try {
    const data = await fetchInfo(url);

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

// ─── /api/download/file/:fileId ───────────────────────────────────────────────
app.get('/api/download/file/:fileId', async (req, res) => {
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

// ─── / ────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Video Downloader API işləyir!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda işləyir`);
});
