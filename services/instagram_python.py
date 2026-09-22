#!/usr/bin/env python3
"""
Instagram media extractor — cookie + yt-dlp fallback
"""

import sys
import json
import re
import gzip
import html as html_module
import urllib.request
import urllib.parse
import subprocess
import os


# ─── Konfiqurasiya ───────────────────────────────────────────────────────────

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

INSTAGRAM_COOKIE_PATH = '/tmp/yt-cookies/instagram.txt'


# ─── Yardımçı funksiyalar ────────────────────────────────────────────────────

def extract_shortcode(url):
    patterns = [
        r'/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def http_get(url, headers=None, timeout=20):
    if headers is None:
        headers = {}
    req = urllib.request.Request(url, headers=headers)
    response = urllib.request.urlopen(req, timeout=timeout)
    raw = response.read()
    if response.headers.get('Content-Encoding', '').lower() == 'gzip':
        raw = gzip.decompress(raw)
    return raw.decode('utf-8', errors='replace')


def unescape_json_url(url):
    if not url:
        return url
    url = url.replace('\\/', '/')
    url = url.replace('\\u002F', '/')
    url = url.replace('\\u0026', '&')
    url = url.replace('&amp;', '&')
    url = url.replace('\\', '')
    url = url.rstrip(',')
    return url


def decode_html_entities(text):
    if not text:
        return text
    return html_module.unescape(text)


# ─── STRATEGİYA 1: yt-dlp + cookie (ƏSAS, ƏN ETİBARLI) ──────────────────────

def try_ytdlp_with_cookie(url):
    """
    yt-dlp ilə Instagram məlumatı al.
    Cookie varsa istifadə et.
    Birdən çox JSON ola bilər (carousel) — hər sətri ayrı parse et.
    """
    try:
        cmd = ['yt-dlp', '--dump-json', '--no-playlist', '--socket-timeout', '20']

        # Cookie faylı varsa əlavə et
        if os.path.exists(INSTAGRAM_COOKIE_PATH):
            cmd.extend(['--cookies', INSTAGRAM_COOKIE_PATH])
            print(f'DEBUG ytdlp: cookie istifadə olunur', file=sys.stderr)
        else:
            print(f'DEBUG ytdlp: cookie YOXDUR', file=sys.stderr)

        # User-Agent əlavə et
        cmd.extend(['--user-agent', DESKTOP_UA])
        cmd.append(url)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=45
        )

        if result.returncode != 0:
            print(f'DEBUG ytdlp stderr: {result.stderr[:300]}', file=sys.stderr)
            return None

        # ─── DÜZƏLİŞ: Hər sətri ayrı parse et ────────────────────────────
        lines = [ln.strip() for ln in result.stdout.splitlines() if ln.strip()]
        parsed_items = []
        for ln in lines:
            try:
                parsed_items.append(json.loads(ln))
            except json.JSONDecodeError as e:
                print(f'DEBUG ytdlp parse sətri atlandı: {e}', file=sys.stderr)

        if not parsed_items:
            return None

        # Carousel ola bilər → video olan ilk item-i seç
        for item in parsed_items:
            formats = item.get('formats', [])
            has_video = any(
                f.get('vcodec') and f.get('vcodec') != 'none'
                for f in formats
            ) or item.get('url', '').endswith('.mp4')
            if has_video:
                print(f'DEBUG ytdlp: {len(parsed_items)} item tapıldı, video olan seçildi', file=sys.stderr)
                return item

        # Video yoxdursa, ilk item-i qaytar
        print(f'DEBUG ytdlp: {len(parsed_items)} item tapıldı, ilki istifadə olunur', file=sys.stderr)
        return parsed_items[0]

    except Exception as e:
        print(f'DEBUG ytdlp xəta: {e}', file=sys.stderr)
        return None

def process_ytdlp_data(data):
    """yt-dlp JSON-ndan bizim formatda media məlumatı çıxar"""
    video_url = None
    audio_url = None

    # Formatları yoxla
    formats = data.get('formats', [])

    # Ən yaxşı video (həm video, həm audio)
    combined = [
        f for f in formats
        if f.get('vcodec') != 'none' and f.get('acodec') != 'none'
    ]
    if combined:
        best = sorted(combined, key=lambda x: x.get('height', 0) or 0, reverse=True)[0]
        video_url = best.get('url')

    # Heç nə tapılmasa, birbaşa `url` sahəsini yoxla
    if not video_url:
        video_url = data.get('url') or data.get('webpage_url')

    # Audio — video varsa, eyni URL-dən ffmpeg ilə çıxarılır
    if video_url:
        audio_url = video_url

    if not video_url:
        return None

    # Başlıq
    title = data.get('title') or data.get('description', '')[:80] or 'Instagram Video'
    thumbnail = data.get('thumbnail', '')
    uploader = data.get('uploader') or data.get('channel', '')

    return {
        'title': title[:100],
        'thumbnail': thumbnail,
        'uploader': uploader,
        'video_url': video_url,
        'audio_url': audio_url,
    }


# ─── STRATEGİYA 2: GraphQL API (cookie ilə) ─────────────────────────────────

def try_graphql_with_cookie(shortcode):
    """Cookie ilə GraphQL sorğusu"""
    try:
        if not os.path.exists(INSTAGRAM_COOKIE_PATH):
            return None

        # Cookie faylını oxu
        cookies = {}
        with open(INSTAGRAM_COOKIE_PATH, 'r') as f:
            for line in f:
                if line.startswith('#') or not line.strip():
                    continue
                parts = line.strip().split('\t')
                if len(parts) >= 7:
                    cookies[parts[5]] = parts[6]

        if 'sessionid' not in cookies:
            return None

        cookie_header = '; '.join([f'{k}={v}' for k, v in cookies.items()])

        api_url = f'https://i.instagram.com/api/v1/media/{shortcode}/info/'
        headers = {
            'User-Agent': (
                'Instagram 219.0.0.12.117 Android '
                '(30/11; 420dpi; 1080x2340; samsung; SM-G991B; o1s; exynos2100; en_US; 304940619)'
            ),
            'Cookie': cookie_header,
            'X-IG-App-ID': '936619743392459',
            'Accept': '*/*',
        }

        raw = http_get(api_url, headers, timeout=15)
        data = json.loads(raw)

        items = data.get('items') or []
        if not items:
            return None

        item = items[0]
        video_versions = item.get('video_versions') or []

        if not video_versions:
            return None

        video_url = video_versions[0].get('url')

        caption = item.get('caption') or {}
        title = caption.get('text', '')[:100] if isinstance(caption, dict) else 'Instagram Video'
        uploader = (item.get('user') or {}).get('username', '')

        image_versions = item.get('image_versions2') or {}
        candidates = image_versions.get('candidates') or []
        thumbnail = candidates[0].get('url', '') if candidates else ''

        return {
            'title': title or 'Instagram Video',
            'thumbnail': thumbnail,
            'uploader': uploader,
            'video_url': video_url,
            'audio_url': video_url,
        }

    except Exception as e:
        print(f'DEBUG GraphQL: {e}', file=sys.stderr)
        return None


# ─── ƏSAS FUNKSİYA ────────────────────────────────────────────────────────────

def get_media_info(url):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            return {'error': 'Shortcode tapılmadı'}

        print(f'DEBUG: Shortcode = {shortcode}', file=sys.stderr)

        media = None

        # ─── 1: yt-dlp + cookie (ƏSAS) ──────────────────────────────────────
        print('DEBUG: [1/3] yt-dlp + cookie...', file=sys.stderr)
        ytdlp_data = try_ytdlp_with_cookie(url)
        if ytdlp_data:
            media = process_ytdlp_data(ytdlp_data)
            if media:
                print('DEBUG: ✅ yt-dlp uğurlu', file=sys.stderr)

        # ─── 2: GraphQL + cookie ────────────────────────────────────────────
        if not media:
            print('DEBUG: [2/3] GraphQL + cookie...', file=sys.stderr)
            media = try_graphql_with_cookie(shortcode)
            if media:
                print('DEBUG: ✅ GraphQL uğurlu', file=sys.stderr)

        # ─── 3: Embed HTML (son şans) ───────────────────────────────────────
        if not media:
            print('DEBUG: [3/3] Embed HTML...', file=sys.stderr)
            try:
                embed_url = f'https://www.instagram.com/p/{shortcode}/embed/captioned/'
                headers = {
                    'User-Agent': DESKTOP_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate',
                }

                # Cookie faylını header-ə əlavə et
                if os.path.exists(INSTAGRAM_COOKIE_PATH):
                    cookies = {}
                    with open(INSTAGRAM_COOKIE_PATH, 'r') as f:
                        for line in f:
                            if line.startswith('#') or not line.strip():
                                continue
                            parts = line.strip().split('\t')
                            if len(parts) >= 7:
                                cookies[parts[5]] = parts[6]
                    if cookies:
                        headers['Cookie'] = '; '.join([f'{k}={v}' for k, v in cookies.items()])

                html = http_get(embed_url, headers)

                # Video URL axtar
                video_url = None
                patterns = [
                    r'"video_versions":\s*\[\s*\{[^}]*?"url":\s*"([^"]+)"',
                    r'"video_url":\s*"([^"]+)"',
                    r'"(https:\\/\\/[^"]*?\.mp4[^"]*?)"',
                ]
                for pattern in patterns:
                    m = re.search(pattern, html)
                    if m:
                        video_url = unescape_json_url(m.group(1))
                        if video_url:
                            break

                if video_url:
                    thumb_match = re.search(r'"display_url":\s*"([^"]+)"', html)
                    thumbnail = unescape_json_url(thumb_match.group(1)) if thumb_match else ''

                    title_match = re.search(r'"caption":\s*"([^"]+)"', html)
                    title = decode_html_entities(title_match.group(1))[:100] if title_match else 'Instagram Video'

                    media = {
                        'title': title,
                        'thumbnail': thumbnail,
                        'uploader': '',
                        'video_url': video_url,
                        'audio_url': video_url,
                    }
                    print('DEBUG: ✅ Embed HTML uğurlu', file=sys.stderr)

            except Exception as e:
                print(f'DEBUG Embed: {e}', file=sys.stderr)

        # ─── Nəticə ─────────────────────────────────────────────────────────
        if not media or not media.get('video_url'):
            print('DEBUG: ❌ BÜTÜN STRATEGİYALAR UĞURSUZ', file=sys.stderr)
            return {'error': 'Video URL tapılmadı — bütün strategiyalar uğursuz'}

        print(f'DEBUG: ✅ Video URL tapıldı', file=sys.stderr)

        qualities = [
            {
                'label': 'HD Video',
                'value': 'video',
                'formatId': 'direct',
                'url': media['video_url'],
                'filesize': None,
                'ext': 'mp4',
                'needsMerge': False,
                '_source': 'instagram_direct',
            },
            {
                'label': 'MP3 (Audio)',
                'value': 'audio',
                'formatId': 'audio',
                'url': media['audio_url'] or media['video_url'],
                'filesize': None,
                'ext': 'm4a',
                'needsMerge': False,
                '_source': 'instagram_direct_audio',
            },
        ]

        return {
            'success': True,
            'data': {
                'title': media.get('title') or 'Instagram Video',
                'thumbnail': media.get('thumbnail') or '',
                'duration': '00:00',
                'platform': 'instagram',
                'uploader': media.get('uploader') or '',
                'shortcode': shortcode,
                'qualities': qualities,
            },
        }

    except Exception as e:
        print(f'DEBUG: Xəta = {e}', file=sys.stderr)
        return {'error': str(e)}


if __name__ == '__main__':
    if len(sys.argv) > 1:
        result = get_media_info(sys.argv[1])
        print(json.dumps(result))
    else:
        print(json.dumps({'error': 'URL tələb olunur'}))
