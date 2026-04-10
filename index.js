// Invidious serverləri (birindən cavab gəlməsə növbətisini sına)
const INVIDIOUS_INSTANCES = [
  'https://invidious.snopyta.org',
  'https://vid.puffyan.us',
  'https://invidious.kavin.rocks',
  'https://yt.artemislena.eu',
  'https://invidious.flokinet.to',
];

async function fetchYouTubeViaInvidious(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log(`🔄 Invidious cəhd: ${instance}`);
      
      const response = await fetch(
        `${instance}/api/v1/videos/${videoId}?fields=title,author,lengthSeconds,videoThumbnails,adaptiveFormats,formatStreams`,
        { signal: AbortSignal.timeout(10000) }
      );
      
      if (!response.ok) {
        console.log(`❌ ${instance}: ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      console.log(`✅ Invidious uğurlu: ${instance}`);
      return data;
    } catch (e) {
      console.log(`❌ ${instance}: ${e.message.substring(0, 60)}`);
    }
  }
  throw new Error('Bütün Invidious serverləri cavab vermədi');
}

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

function buildQualitiesFromInvidious(data) {
  const result = [];
  
  // adaptiveFormats — video və audio ayrı (yüksək keyfiyyət)
  const adaptiveFormats = data.adaptiveFormats || [];
  // formatStreams — video+audio birlikdə (aşağı keyfiyyət, amma merge lazım deyil)
  const formatStreams = data.formatStreams || [];
  
  const heights = [2160, 1440, 1080, 720, 480, 360];
  const added = new Set();

  // Əvvəlcə formatStreams-dən progressiv formatları tap (audio+video birlikdə)
  for (const h of heights) {
    const f = formatStreams.find(x => x.resolution === `${h}p`);
    if (f && !added.has(h)) {
      added.add(h);
      result.push({
        label: h === 2160 ? '4K Ultra HD' : h === 1080 ? '1080p Full HD' : h === 720 ? '720p HD' : `${h}p`,
        value: String(h),
        url: f.url,
        filesize: f.clen ? parseInt(f.clen) : 0,
        ext: 'mp4',
        needsMerge: false,
      });
    }
  }

  // adaptiveFormats-dan yüksək keyfiyyət video-only (merge lazımdır amma URL var)
  for (const h of heights) {
    if (added.has(h)) continue;
    const f = adaptiveFormats.find(x => 
      x.type?.startsWith('video/') && 
      x.resolution === `${h}p`
    );
    if (f) {
      added.add(h);
      result.push({
        label: h === 2160 ? '4K Ultra HD' : h === 1080 ? '1080p Full HD' : h === 720 ? '720p HD' : `${h}p`,
        value: String(h),
        url: f.url,
        filesize: f.clen ? parseInt(f.clen) : 0,
        ext: 'mp4',
        needsMerge: false,
      });
    }
  }

  // Audio only
  const audioFormats = adaptiveFormats
    .filter(f => f.type?.startsWith('audio/'))
    .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
  
  if (audioFormats.length > 0) {
    const a = audioFormats[0];
    result.push({
      label: 'Yalnız səs',
      value: 'audio',
      url: a.url,
      filesize: a.clen ? parseInt(a.clen) : 0,
      ext: 'm4a',
      needsMerge: false,
    });
  }

  return result;
}

async function fetchInfo(url) {
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  if (isYoutube) {
    const videoId = extractVideoId(url);
    if (!videoId) throw new Error('YouTube video ID tapılmadı');
    
    const data = await fetchYouTubeViaInvidious(videoId);
    
    return {
      _source: 'invidious',
      _rawData: data,
    };
  }

  // TikTok / Instagram / Facebook — yt-dlp ilə
  const cookie = getCookieArg();
  let extraArgs = '';
  if (url.includes('tiktok.com')) {
    extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
  }
  const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 ${cookie} ${extraArgs} "${url}"`;
  console.log('📡 yt-dlp sorğu:', cmd);
  const { stdout } = await execPromise(cmd, { timeout: 45000 });
  return { _source: 'ytdlp', _rawData: JSON.parse(stdout.trim().split('\n')[0]) };
}
