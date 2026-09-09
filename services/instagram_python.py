#!/usr/bin/env python3
import sys
import json
import re
import gzip
import urllib.request
import io

def extract_shortcode(url):
    patterns = [r'/(?:p|reel|tv|reels)/([A-Za-z0-9_-]+)']
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def get_embed_page(shortcode):
    embed_url = f'https://www.instagram.com/p/{shortcode}/embed/captioned/'
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',  # gzip istəyirik
        'Connection': 'keep-alive',
    }
    
    req = urllib.request.Request(embed_url, headers=headers)
    response = urllib.request.urlopen(req, timeout=20)
    
    # Gzip sıxılmasını yoxla
    content_encoding = response.headers.get('Content-Encoding', '')
    
    if 'gzip' in content_encoding:
        # Gzip ilə sıxılmış cavabı aç
        compressed_data = response.read()
        html = gzip.decompress(compressed_data).decode('utf-8')
    else:
        # Normal cavab
        html = response.read().decode('utf-8')
    
    return html

def extract_video_url(html):
    """HTML-dən video URL çıxar"""
    patterns = [
        r'https://instagram\.f[^"\'\\s]+/o1/v/[^"\'\\s]+',  # Video CDN
        r'https://[^"\'\\s]+/o1/v/[^"\'\\s]+\.mp4[^"\'\\s]*',  # Video .mp4
        r'"video_url":"([^"]+)"',  # JSON format
        r'https://[^"\'\\s]+\.mp4[^"\'\\s]*',  # Hər hansı .mp4
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            url = match.group(1) if match.lastindex else match.group(0)
            url = url.replace('\\/', '/')
            url = url.replace('&amp;', '&')
            url = url.rstrip(',')
            return url
    
    return None

def extract_thumbnail(html):
    """HTML-dən thumbnail çıxar"""
    patterns = [
        r'https://instagram\.f[^"\'\\s]+/v/t51\.8278[^"\'\\s]+',
        r'"thumbnail_url":"([^"]+)"',
        r'"display_url":"([^"]+)"',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            url = match.group(1) if match.lastindex else match.group(0)
            url = url.replace('\\/', '/')
            url = url.replace('&amp;', '&')
            url = url.rstrip(',')
            return url
    
    return ''

def extract_title(html):
    """HTML-dən başlıq çıxar"""
    match = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]+)"', html)
    if match:
        return match.group(1)[:100]
    
    match = re.search(r'"caption":\s*"([^"]+)"', html)
    if match:
        return match.group(1)[:100]
    
    return 'Instagram Video'

def get_media_info(url):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            return {'error': 'Shortcode tapılmadı'}
        
        print(f'DEBUG: Shortcode: {shortcode}', file=sys.stderr)
        
        html = get_embed_page(shortcode)
        
        print(f'DEBUG: HTML uzunluğu: {len(html)}', file=sys.stderr)
        
        # Video URL axtar
        video_url = extract_video_url(html)
        if not video_url:
            # Debug üçün ilk 500 hərfi göstər
            print(f'DEBUG: HTML başlanğıcı: {html[:500]}', file=sys.stderr)
            return {'error': 'Video URL tapılmadı'}
        
        print(f'DEBUG: Video URL tapıldı!', file=sys.stderr)
        
        thumbnail = extract_thumbnail(html)
        title = extract_title(html)
        
        return {
            'success': True,
            'data': {
                'title': title,
                'thumbnail': thumbnail,
                'duration': '00:00',
                'platform': 'instagram',
                'uploader': '',
                'shortcode': shortcode,
                'qualities': [
                    {
                        'label': 'HD Video',
                        'value': 'video',
                        'formatId': 'direct',
                        'url': video_url,
                        'filesize': None,
                        'ext': 'mp4',
                        'needsMerge': False,
                        '_source': 'python_embed'
                    },
                    {
                        'label': 'MP3 (Audio)',
                        'value': 'audio',
                        'formatId': 'audio',
                        'url': video_url,
                        'filesize': None,
                        'ext': 'm4a',
                        'needsMerge': False,
                        '_source': 'python_embed'
                    }
                ]
            }
        }
    except Exception as e:
        print(f'DEBUG: Xəta: {str(e)}', file=sys.stderr)
        return {'error': str(e)}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        url = sys.argv[1]
        result = get_media_info(url)
        print(json.dumps(result))
    else:
        print(json.dumps({'error': 'URL tələb olunur'}))
