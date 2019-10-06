## yelp webpages (manually downloaded) -> links -> parse to JSON data

import extruct
import requests
import json
import sys
import urllib.parse
from bs4 import BeautifulSoup

from w3lib.html import get_base_url

def navigate(initial, urlpatterns, output, limit=10):
    queue = [initial]
    visited = set()

    while len(queue) > 0 and len(visited) < limit:
        next = queue.pop()
        if next in visited:
            continue

        visited.add(next)
        print(f'Calling {next}', file=sys.stderr)
        response = requests.get(next)
        base_url = get_base_url(response.text, response.url)

        data = extruct.extract(response.text, base_url=base_url, syntaxes=['json-ld'])
        if len(data['json-ld']) > 0:
            output.append(data['json-ld'][0])

        soup = BeautifulSoup(response.text, 'html5lib')

        for link in soup.find_all('a'):
            if not 'href' in link.attrs:
                continue
            linkurl = urllib.parse.urljoin(base_url, link['href'])
            if linkurl in visited:
                continue

            for pat in urlpatterns:
                if pat(linkurl):
                    queue.append(linkurl)
                    break

def main():
    output = []
    for initial in [
        'https://www.yelp.com/search?cflt=restaurants&find_loc=San%20Francisco%2C%20CA',
        'https://www.yelp.com/search?cflt=restaurants&find_loc=Los%20Angeles%2C%20CA',
        'https://www.yelp.com/search?cflt=restaurants&find_loc=Seattle%20WA',
    ]:
        navigate(initial, [
            lambda url: url.startswith('https://www.yelp.com/biz/') and (url.find('?') == -1) and (url.find(':platform') == -1)
        ], output, limit=50)

    json.dump(output, sys.stdout, indent=2, ensure_ascii=False)
main()
