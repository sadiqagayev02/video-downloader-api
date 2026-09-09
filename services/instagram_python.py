#!/usr/bin/env python3
# Instagram video məlumatını çıxaran skript
# Standart kitabxanalarla (requests olmadan)

import sys
import json
import re
import urllib.request
import urllib.error

def extract_shortcode(url):
    """URL-dən shortcode çıxar"""
    patterns = [
        r'/(?:p|reel|tv|reels)/([A-Za-z0-9_-]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None

def get_embed_page(shortcode):
    """Embed səhifəsini yüklə"""
    embed_url = f'https://www.instagram.com/p/{shortcode}/embed/captioned/'
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    
    req = urllib.request.Request(embed_url, headers=headers)
    response = urllib.request.urlopen(req, timeout=20)
    html = response.read().decode('utf-8')
    return html

def extract_video_url(html):
    """HTML-dən video URL çıxar"""
    patterns = [
        r'https://[^"\'\s]+\.mp4[^"\'\s]*',
        r'https://instagram\.f[^"\'\s]+\.mp4[^"\'\s]*',
        r'https://scontent[^"\'\s]+\.mp4[^"\'\s]*',
        r'"video_url":"([^"]+)"',
        r'"url":"(https://[^"]*\.mp4[^"]*)"',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            url = match.group(1) if match.lastindex else match.group(0)
            url = url.replace('\\/', '/')
            url = url.replace('\\u0026', '&')
            return url
    
    return None

def extract_thumbnail(html):
    """HTML-dən thumbnail çıxar"""
    patterns = [
        r'"thumbnail_url":"([^"]+)"',
        r'"display_url":"([^"]+)"',
        r'https://[^"\'\s]+\.jpg[^"\'\s]*',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, html)
        if match:
            url = match.group(1) if match.lastindex else match.group(0)
            url = url.replace('\\/', '/')
            url = url.replace('\\u0026', '&')
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
    """Əsas funksiya"""
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            return {'error': 'Shortcode tapılmadı'}
        
        html = get_embed_page(shortcode)
        
        video_url = extract_video_url(html)
        if not video_url:
            return {'error': 'Video URL tapılmadı'}
        
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
        return {'error': str(e)}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        url = sys.argv[1]
        result = get_media_info(url)
        print(json.dumps(result))
    else:
        print(json.dumps({'error': 'URL tələb olunur'}))
