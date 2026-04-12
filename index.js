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

// ─── YouTube Innertube client ─────────────────────────────────────────────────
let ytClient = null;

async function getYouTubeClient() {
  if (ytClient) return ytClient;
  console.log('🔧 Innertube client yaradılır...');
  const { Innertube } = await import('youtubei.js');
  ytClient = await Innertube.create({
    lang: 'en',
    location: 'US',
    retrieve_player: true,
  });
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
  } catch {
    return null;
  }
}

// ─── YouTube keyfiyyətləri (Innertube) ───────────────────────────────────────
function buildQualitiesFromInnertube(info) {
  const result = [];
  const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
  const basicFormats = info.streaming_data?.formats || [];
  const added = new Set();
  const heights = [2160, 1440, 1080, 720, 480, 360];

  // Progressiv (audio+video birlikdə)
  for (const h of heights) {
    const f = basicFormats.find(x => x.height === h);
    if (f?.url && !added.has(h)) {
      added.add(h);
      result.push({
        label: h === 2160 ? '4K Ultra HD' : h === 1080 ? '1080p Full HD' : h === 720 ? '720p HD' : `${h}p`,
        value: String(h),
        url: f.url,
        filesize: f.content_length ? parseInt(f.content_length) : 0,
        ext: 'mp4',
        needsMerge: false,
      });
    }
  }

  // Adaptive video-only
  for (const h of heights) {
    if (added.has(h)) continue;
    const f = adaptiveFormats.find(x => x.height === h && x.mime_type?.startsWith('video/'));
    if (f?.url) {
      added.add(h);
      result.push({
        label: h === 2160 ? '4K Ultra HD' : h === 1080 ? '1080p Full HD' : h === 720 ? '720p HD' : `${h}p`,
        value: String(h),
        url: f.url,
        filesize: f.content_length ? parseInt(f.content_length) : 0,
        ext: 'mp4',
        needsMerge: false,
      });
    }
  }

  // Audio only
  const audioFormats = adaptiveFormats
    .filter(f => f.mime_type?.startsWith('audio/') && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (audioFormats.length > 0) {
    result.push({
      label: 'MP3 (Audio)',
      value: 'audio',
      url: audioFormats[0].url,
      filesize: audioFormats[0].content_length ? parseInt(audioFormats[0].content_length) : 0,
      ext: 'm4a',
      needsMerge: false,
    });
  }

  return result;
}

// ─── yt-dlp ilə info al (TikTok / Instagram / digər) ─────────────────────────
async function fetchInfoYtdlp(url) {
  const cookie = getCookieArg();
  let extraArgs = '';
  if (url.includes('tiktok.com')) {
    extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
  }
  const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 ${cookie} ${extraArgs} "${url}"`;
  console.log('📡 yt-dlp info:', url);
  const { stdout } = await execPromise(cmd, { timeout: 45000 });
  return JSON.parse(stdout.trim().split('\n')[0]);
}

// ─── TikTok / Instagram keyfiyyətləri ────────────────────────────────────────
function buildQualitiesYtdlp(data, url) {
  const formats = data.formats || [];
  const result = [];

  if (url.includes('instagram.com') || url.includes('tiktok.com')) {
    // Ən yaxşı video+audio birlikdə format
    const best = formats
      .filter(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];

    if (best) {
      return [{
        label: best.height >= 720 ? 'HD Video' : 'SD Video',
        value: 'video',
        // URL saxlamıram — yükləmə zamanı yt-dlp özü alacaq (403 olmur)
        url: null,
        formatId: best.format_id,
        filesize: best.filesize || best.filesize_approx || 0,
        ext: 'mp4',
        needsMerge: false,
        _directDownload: true,  // yükləmə zamanı yt-dlp birbaşa işləyəcək
      }];
    }

    // Format tapılmadısa belə bir seçim qaytar — yt-dlp özü seçsin
    return [{
      label: 'Video',
      value: 'video',
      url: null,
      formatId: 'best',
      filesize: 0,
      ext: 'mp4',
      needsMerge: false,
      _directDownload: true,
    }];
  }

  // Digər platformalar üçün
  const progressive = formats.filter(f =>
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    f.url && !f.manifest_url
  );

  const heights = [2160, 1080, 720, 480, 360];
  const added = new Set();

  for (const h of heights) {
    const f = progressive.find(x => x.height === h);
    if (f && !added.has(h)) {
      added.add(h);
      result.push({
        label: h === 2160 ? '4K' : h === 1080 ? '1080p Full HD' : h === 720 ? '720p HD' : `${h}p`,
        value: String(h),
        url: f.url,
        formatId: f.format_id,
        filesize: f.filesize || f.filesize_approx || 0,
        ext: f.ext || 'mp4',
        needsMerge: false,
        _directDownload: false,
      });
    }
  }

  if (result.length === 0 && formats.length > 0) {
    const f = formats[formats.length - 1];
    result.push({
      label: 'Best',
      value: 'best',
      url: f.url || null,
      formatId: f.format_id || 'best',
      filesize: f.filesize || 0,
      ext: f.ext || 'mp4',
      needsMerge: false,
      _directDownload: true,
    });
  }

  return result;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Info ─────────────────────────────────────────────────────────────────────
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

      const client = await getYouTubeClient();
      const info = await client.getInfo(videoId);

      qualities = buildQualitiesFromInnertube(info);
      title = info.basic_info?.title || 'Video';
      thumbnail = info.basic_info?.thumbnail?.[0]?.url || '';
      const secs = info.basic_info?.duration || 0;
      duration = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
      uploader = info.basic_info?.author || '';
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

// ─── Download start ───────────────────────────────────────────────────────────
app.post('/api/download/start', async (req, res) => {
  const { url, quality } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId = crypto.randomBytes(16).toString('hex');
  console.log(`📥 Download başladı: ${url}, keyfiyyət: ${quality}`);

  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');
  const cookie = getCookieArg();

  try {
    const outputExt = quality === 'audio' ? 'm4a' : 'mp4';
    const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
    let title = 'video';

    if (isYoutube) {
      // ── YouTube: Innertube URL-dən yüklə, uğursuzsa yt-dlp ────────────────
      const videoId = extractVideoId(url);
      let downloaded = false;

      if (videoId) {
        try {
          const client = await getYouTubeClient();
          const info = await client.getInfo(videoId);
          title = info.basic_info?.title || 'video';

          const adaptiveFormats = info.streaming_data?.adaptive_formats || [];
          const basicFormats = info.streaming_data?.formats || [];

          let targetUrl = null;

          if (quality === 'audio') {
            const audioFmt = adaptiveFormats
              .filter(f => f.mime_type?.startsWith('audio/') && f.url)
              .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
            if (audioFmt) targetUrl = audioFmt.url;
          } else {
            const h = parseInt(quality);
            const fmt = basicFormats.find(f => f.height === h && f.url)
              || adaptiveFormats.find(f => f.height === h && f.mime_type?.startsWith('video/') && f.url);
            if (fmt) targetUrl = fmt.url;
          }

          if (targetUrl) {
            console.log(`📥 Innertube URL ilə yükləmə: ${quality}`);
            await execPromise(
              `curl -L --max-time 300 --retry 2 -o "${outputPath}" "${targetUrl}"`,
              { timeout: 310000 }
            );
            const stats = fs.statSync(outputPath);
            if (stats.size > 0) downloaded = true;
          }
        } catch (innerErr) {
          console.log(`⚠️ Innertube download uğursuz: ${innerErr.message} — yt-dlp cəhd edilir`);
        }
      }

      // Innertube uğursuzsa yt-dlp ilə cəhd et
      if (!downloaded) {
        console.log(`📥 yt-dlp ilə YouTube yükləmə: ${quality}`);
        let fmtArg = quality === 'audio'
          ? 'bestaudio[ext=m4a]/bestaudio'
          : `bestvideo[height=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height=${quality}]/best`;

        await execPromise(
          `yt-dlp -f "${fmtArg}" ${cookie} --merge-output-format mp4 -o "${outputPath}" "${url}"`,
          { timeout: 300000 }
        );
      }

    } else if (isTikTok || isInstagram) {
      // ── TikTok / Instagram: yt-dlp birbaşa yükləyir (URL ayrıca alınmır) ──
      console.log(`📥 ${isTikTok ? 'TikTok' : 'Instagram'} birbaşa yükləmə`);

      let extraArgs = '';
      if (isTikTok) {
        extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      }

      // Əvvəlcə title al
      try {
        const data = await fetchInfoYtdlp(url);
        title = data.title || 'video';
      } catch (_) {}

      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${extraArgs} ${cookie} --merge-output-format mp4 --no-playlist `
        + `--retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      // ── Digər platformalar ────────────────────────────────────────────────
      console.log(`📥 Generic yükləmə`);
      try {
        const data = await fetchInfoYtdlp(url);
        title = data.title || 'video';
      } catch (_) {}

      await execPromise(
        `yt-dlp -f "best" ${cookie} -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const safeTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 80) || 'video';
    console.log(`✅ Tamamlandı: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

    res.json({
      success: true,
      fileId,
      filename: `${safeTitle}.${outputExt}`,
      filesize: stats.size,
    });

  } catch (err) {
    console.error(`❌ Download xətası: ${err.message}`);
    // Müvəqqəti faylları təmizlə
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
