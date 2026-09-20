#!/usr/bin/env python3
"""
Instagram media extractor - 2025 format
4 strategiya ilə işləyir:
  1. GraphQL API (embed saytının daxili API-si)
  2. JSON-LD (structured data)
  3. HTML embed regex (yeni format)
  4. oEmbed fallback
"""

import sys
import json
import re
import gzip
import html as html_module
import urllib.request
import urllib.parse


# ─── Konfiqurasiya ───────────────────────────────────────────────────────────

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.5 Mobile/15E148 Safari/604.1"
)


# ─── Yardımçı funksiyalar ────────────────────────────────────────────────────

def extract_shortcode(url):
    """URL-dən shortcode çıxar"""
    patterns = [
        r'/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)',
        r'instagram\.com/([A-Za-z0-9_-]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def http_get(url, headers=None, timeout=20):
    """Sadə HTTP GET — gzip dəstəyi ilə"""
    if headers is None:
        headers = {}
    req = urllib.request.Request(url, headers=headers)
    response = urllib.request.urlopen(req, timeout=timeout)
    raw = response.read()
    if response.headers.get('Content-Encoding', '').lower() == 'gzip':
        raw = gzip.decompress(raw)
    return raw.decode('utf-8', errors='replace')


def unescape_json_url(url):
    """JSON escape-lərini təmizlə"""
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
    """HTML entity-ləri decode et"""
    if not text:
        return text
    return html_module.unescape(text)


# ─── Strategiya 1: GraphQL API (embed saytının daxili API-si) ────────────────

def try_graphql_api(shortcode):
    """
    Instagram embed səhifəsi GraphQL sorğusu ilə media məlumatı qaytarır.
    Bu, 2024-cü ildən sonra əsas üsuldur.
    """
    try:
        api_url = f'https://www.instagram.com/api/v1/media/{shortcode}/info/'
        headers = {
            'User-Agent': DESKTOP_UA,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-IG-App-ID': '936619743392459',
            'Referer': f'https://www.instagram.com/p/{shortcode}/',
            'Origin': 'https://www.instagram.com',
        }
        raw = http_get(api_url, headers)
        data = json.loads(raw)

        items = data.get('items') or []
        if not items:
            return None

        item = items[0]
        return _process_media_item(item, shortcode)

    except Exception as e:
        print(f'DEBUG GraphQL: {e}', file=sys.stderr)
        return None


def _process_media_item(item, shortcode):
    """GraphQL item-dən media məlumatı çıxar"""
    result = {
        'shortcode': shortcode,
        'title': 'Instagram Video',
        'thumbnail': '',
        'uploader': '',
        'video_url': None,
        'audio_url': None,
    }

    # Caption
    caption = item.get('caption') or {}
    if isinstance(caption, dict):
        result['title'] = (caption.get('text') or '')[:100] or result['title']
    elif isinstance(caption, str):
        result['title'] = caption[:100] or result['title']

    # Uploader
    user = item.get('user') or {}
    result['uploader'] = user.get('username', '')

    # Media növü
    media_type = item.get('media_type')  # 1=photo, 2=video, 8=carousel
    video_versions = item.get('video_versions') or []

    # Carousel — ilk videonu götür
    if media_type == 8:
        carousel = item.get('carousel_media') or []
        for c in carousel:
            if c.get('video_versions'):
                video_versions = c['video_versions']
                item = c
                break

    # Video URL — ən yüksək keyfiyyət
    if video_versions:
        best = video_versions[0]  # Instagram ilkini ən yüksək verir
        result['video_url'] = best.get('url')

    # Thumbnail
    image_versions = item.get('image_versions2') or {}
    candidates = image_versions.get('candidates') or []
    if candidates:
        result['thumbnail'] = candidates[0].get('url', '')

    # Audio — video varsa, eyni URL-dən ffmpeg ilə çıxarılır
    if result['video_url']:
        result['audio_url'] = result['video_url']

    return result


# ─── Strategiya 2: JSON-LD ────────────────────────────────────────────────────

def try_json_ld(html):
    """HTML-də <script type="application/ld+json"> axtar"""
    try:
        patterns = [
            r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>',
            r'<script[^>]*type=\'application/ld\+json\'[^>]*>(.*?)</script>',
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, html, re.DOTALL):
                try:
                    data = json.loads(match.group(1).strip())
                    url = _extract_from_json_ld(data)
                    if url:
                        return url
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        print(f'DEBUG JSON-LD: {e}', file=sys.stderr)
    return None


def _extract_from_json_ld(data):
    """JSON-LD strukturundan video URL çıxar"""
    if isinstance(data, list):
        for item in data:
            res = _extract_from_json_ld(item)
            if res:
                return res
        return None

    if not isinstance(data, dict):
        return None

    # video → contentUrl
    if data.get('@type') in ('VideoObject', 'Video'):
        url = data.get('contentUrl') or data.get('embedUrl')
        if url:
            return url

    # Rekursiv axtarış
    for value in data.values():
        if isinstance(value, (dict, list)):
            res = _extract_from_json_ld(value)
            if res:
                return res

    return None


# ─── Strategiya 3: HTML embed regex (yeni format) ────────────────────────────

def try_html_regex(html):
    """HTML-dən video URL çıxar — genişləndirilmiş pattern-lər"""
    patterns = [
        # JSON escaped formatlar (2024+)
        r'"video_versions":\s*\[\s*\{[^}]*?"url":\s*"([^"]+)"',
        r'"video_url":\s*"([^"]+)"',
        r'"contentUrl":\s*"([^"]+)"',
        r'"playable_url":\s*"([^"]+)"',
        r'"playable_url_quality_hd":\s*"([^"]+)"',
        # CDN URL formatları
        r'"(https:\\/\\/instagram[^"]*?\.mp4[^"]*?)"',
        r'"(https:\\/\\/[^"]*?\.mp4[^"]*?)"',
        # HTML attribute-lar
        r'<meta[^>]*property="og:video"[^>]*content="([^"]+)"',
        r'<meta[^>]*property="og:video:secure_url"[^>]*content="([^"]+)"',
        r'<video[^>]*src="([^"]+)"',
        r'<source[^>]*src="([^"]+)"',
    ]

    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            url = unescape_json_url(match.group(1))
            if url and ('http' in url):
                return url

    return None


# ─── Strategiya 4: oEmbed fallback ────────────────────────────────────────────

def try_oembed(shortcode):
    """Rəsmi oEmbed API — thumbnail üçün"""
    try:
        embed_url = f'https://www.instagram.com/p/{shortcode}/'
        api_url = (
            'https://api.instagram.com/oembed/?url='
            + urllib.parse.quote(embed_url, safe='')
        )
        headers = {'User-Agent': DESKTOP_UA}
        raw = http_get(api_url, headers, timeout=10)
        data = json.loads(raw)

        return {
            'shortcode': shortcode,
            'title': (data.get('title') or 'Instagram Video')[:100],
            'thumbnail': data.get('thumbnail_url', ''),
            'uploader': data.get('author_name', ''),
            'video_url': None,
            'audio_url': None,
        }
    except Exception as e:
        print(f'DEBUG oEmbed: {e}', file=sys.stderr)
        return None


# ─── Əsas funksiya ────────────────────────────────────────────────────────────

def get_media_info(url):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            return {'error': 'Shortcode tapılmadı'}

        print(f'DEBUG: Shortcode = {shortcode}', file=sys.stderr)

        # Media nəticələrini yığ
        media = {
            'shortcode': shortcode,
            'title': 'Instagram Video',
            'thumbnail': '',
            'uploader': '',
            'video_url': None,
            'audio_url': None,
        }

        # ─── Strategiya 1: GraphQL (ən etibarlı) ────────────────────────────
        print('DEBUG: [1/4] GraphQL API...', file=sys.stderr)
        gql_result = try_graphql_api(shortcode)
        if gql_result and gql_result.get('video_url'):
            print('DEBUG: ✅ GraphQL uğurlu', file=sys.stderr)
            media.update(gql_result)
        else:
            print('DEBUG: ❌ GraphQL uğursuz', file=sys.stderr)

            # ─── Strategiya 2-4: HTML əsaslı ─────────────────────────────
            try:
                embed_url = f'https://www.instagram.com/p/{shortcode}/embed/captioned/'
                headers = {
                    'User-Agent': DESKTOP_UA,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate',
                }
                html = http_get(embed_url, headers)
                print(f'DEBUG: HTML uzunluğu = {len(html)}', file=sys.stderr)

                print('DEBUG: [2/4] JSON-LD...', file=sys.stderr)
                video_url = try_json_ld(html)

                if not video_url:
                    print('DEBUG: [3/4] HTML regex...', file=sys.stderr)
                    video_url = try_html_regex(html)

                if video_url:
                    media['video_url'] = video_url
                    media['audio_url'] = video_url
                    print('DEBUG: ✅ HTML-dən tapıldı', file=sys.stderr)

                # Thumbnail + title
                thumb_match = re.search(
                    r'"display_url":\s*"([^"]+)"', html
                ) or re.search(
                    r'<meta[^>]*property="og:image"[^>]*content="([^"]+)"', html
                )
                if thumb_match:
                    media['thumbnail'] = unescape_json_url(thumb_match.group(1))

                title_match = re.search(
                    r'<meta[^>]*property="og:title"[^>]*content="([^"]+)"', html
                ) or re.search(
                    r'<meta[^>]*name="description"[^>]*content="([^"]+)"', html
                )
                if title_match:
                    media['title'] = decode_html_entities(title_match.group(1))[:100]

            except Exception as e:
                print(f'DEBUG HTML: {e}', file=sys.stderr)

        # ─── Strategiya 4: oEmbed (yalnız thumbnail üçün) ────────────────────
        if not media.get('thumbnail') or not media.get('uploader'):
            print('DEBUG: [4/4] oEmbed...', file=sys.stderr)
            oembed = try_oembed(shortcode)
            if oembed:
                if not media.get('thumbnail') and oembed.get('thumbnail'):
                    media['thumbnail'] = oembed['thumbnail']
                if not media.get('uploader') and oembed.get('uploader'):
                    media['uploader'] = oembed['uploader']
                if not media.get('title') and oembed.get('title'):
                    media['title'] = oembed['title']

        # ─── Nəticə ─────────────────────────────────────────────────────────
        video_url = media.get('video_url')

        if not video_url:
            print('DEBUG: ❌ BÜTÜN STRATEGİYALAR UĞURSUZ', file=sys.stderr)
            return {'error': 'Video URL tapılmadı — bütün strategiyalar uğursuz'}

        print(f'DEBUG: ✅ Video URL tapıldı', file=sys.stderr)

        # Flutter gözləyir: qualities[]
        qualities = [
            {
                'label': 'HD Video',
                'value': 'video',
                'formatId': 'direct',
                'url': video_url,
                'filesize': None,
                'ext': 'mp4',
                'needsMerge': False,
                '_source': 'instagram_direct',
            },
            {
                'label': 'MP3 (Audio)',
                'value': 'audio',
                'formatId': 'audio',
                'url': video_url,   # Flutter ffmpeg ilə çevirəcək (və ya server)
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
