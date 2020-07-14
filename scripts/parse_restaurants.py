# This file is part of Genie
#
# Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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

        try:
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

                if urlpatterns:
                    for pat in urlpatterns:
                        if pat(linkurl):
                            queue.insert(0, linkurl.split('?')[0])
                            break
                elif linkurl.startswith(base_url):
                    queue.insert(0, linkurl)
        except Exception as e:
            print(e, file=sys.stderr)

def main():
    output = []

    outputfile = '__'.join(x.replace(' ', '_') for x in sys.argv[1:]) + '.json'

    try:
        initials = []
        for city in sys.argv[1:]:
            initials.append('https://www.yelp.com/search?find_desc=Restaurants&find_loc=' + city)
        for initial in initials:
            navigate(initial, [
                lambda url: url.startswith('https://www.yelp.com/biz/'),
            ], output, limit=1000)
    finally:
        with open(outputfile, 'w') as fp:
            json.dump(output, fp, indent=2, ensure_ascii=False)

main()
