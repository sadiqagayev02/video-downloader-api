#!/usr/bin/env python3
# Instagram video məlumatını çıxaran skript

import sys
import json
import re
import requests

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
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
    }
    
    response = requests.get(embed_url, headers=headers, timeout=20)
    response.raise_for_status()
    return response.text

def extract_video_url(html):
    """HTML-dən video URL çıxar"""
    # Bütün mümkün nümunələri yoxla
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
            # Escape olunmuş simvolları düzəlt
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
    # Meta tag-dan
    match = re.search(r'<meta[^>]*name="description"[^>]*content="([^"]+)"', html)
    if match:
        return match.group(1)[:100]
    
    # JSON-dan
    match = re.search(r'"caption":\s*"([^"]+)"', html)
    if match:
        return match.group(1)[:100]
    
    return 'Instagram Video'

def get_media_info(url):
    """Əsas funksiya - video məlumatını qaytar"""
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            return {'error': 'Shortcode tapılmadı'}
        
        # Embed səhifəsini yüklə
        html = get_embed_page(shortcode)
        
        # Video URL çıxar
        video_url = extract_video_url(html)
        if not video_url:
            return {'error': 'Video URL tapılmadı'}
        
        # Thumbnail çıxar
        thumbnail = extract_thumbnail(html)
        
        # Başlıq çıxar
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
    # Command line-dan URL qəbul et
    if len(sys.argv) > 1:
        url = sys.argv[1]
        result = get_media_info(url)
        print(json.dumps(result))
    else:
        print(json.dumps({'error': 'URL tələb olunur'}))
