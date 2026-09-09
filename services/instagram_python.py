#!/usr/bin/env python3
# Debug versiyası - nə gördüyünü göstərir

import sys
import json
import re
import urllib.request

def extract_shortcode(url):
    patterns = [
        r'/(?:p|reel|tv|reels)/([A-Za-z0-9_-]+)',
    ]
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
    }
    
    req = urllib.request.Request(embed_url, headers=headers)
    response = urllib.request.urlopen(req, timeout=20)
    html = response.read().decode('utf-8')
    return html

def get_media_info(url):
    try:
        shortcode = extract_shortcode(url)
        if not shortcode:
            return {'error': 'Shortcode tapılmadı'}
        
        print(f'DEBUG: Shortcode: {shortcode}', file=sys.stderr)
        
        html = get_embed_page(shortcode)
        
        print(f'DEBUG: HTML uzunluğu: {len(html)}', file=sys.stderr)
        
        # HTML-in ilk 1000 hərfini göstər
        print(f'DEBUG: HTML başlanğıcı: {html[:500]}', file=sys.stderr)
        
        # Bütün URL-ləri tap
        all_urls = re.findall(r'https?://[^\s"\']+', html)
        print(f'DEBUG: {len(all_urls)} URL tapıldı', file=sys.stderr)
        
        # İlk 10 URL-i göstər
        for i, u in enumerate(all_urls[:10]):
            print(f'DEBUG: URL {i}: {u[:100]}', file=sys.stderr)
        
        # .mp4 axtar
        mp4_urls = re.findall(r'https?://[^\s"\']+\.mp4[^\s"\']*', html)
        print(f'DEBUG: {len(mp4_urls)} MP4 URL tapıldı', file=sys.stderr)
        
        # video_versions axtar
        if 'video_versions' in html:
            print('DEBUG: video_versions TAPILDI', file=sys.stderr)
        else:
            print('DEBUG: video_versions YOXDUR', file=sys.stderr)
        
        # scontent axtar
        if 'scontent' in html:
            print('DEBUG: scontent TAPILDI', file=sys.stderr)
        else:
            print('DEBUG: scontent YOXDUR', file=sys.stderr)
        
        return {'error': 'Debug məlumatı stderr-də', 'debug': True}
        
    except Exception as e:
        return {'error': str(e)}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        url = sys.argv[1]
        result = get_media_info(url)
        print(json.dumps(result))
