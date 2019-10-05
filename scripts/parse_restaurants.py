## yelp webpages (manually downloaded) -> links -> parse to JSON data

import extruct
import requests
import json
from w3lib.html import get_base_url


file_list = ["yelp1.htm", "SF.htm", "LA.htm", "MI.htm", "NY.htm", "BO.htm", "CH.htm"]
restaurant_links = []
restaurant_json = []

for file in file_list:
	with open(file, 'r') as f:
		lines = f.readlines()
		for line in lines:
			line = line.strip().split()

			for string in line:
				if string.startswith('href="https://www.yelp.com/biz') and (string.find('?') == -1) and (string.find(':platform') == -1) and string.endswith('"'):
					restaurant_links.append(string[5:])


unique_restaurants = list()
for link in restaurant_links:
	if link not in unique_restaurants:
		unique_restaurants.append(link)


for link in unique_restaurants:
	r = requests.get(link.strip('"'))
	base_url = get_base_url(r.text, r.url)
	data = extruct.extract(r.text, base_url=base_url, syntaxes=['json-ld'])
	
	if len(data['json-ld']) > 0:
		restaurant_json.append(data['json-ld'][0])
	else:
		print (link)
	
	print (len(restaurant_json))


with open("restaurants.json", 'w') as f_out:
	json.dump(restaurant_json, f_out, indent=4, ensure_ascii=False)


	