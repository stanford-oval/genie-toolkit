#!/usr/bin/env python
# coding=utf-8

import requests
import sys
import math
import os

def bing_search_query(query):
    url = 'https://api.cognitive.microsoft.com/bing/v7.0/search'
    payload = {'q': query}
    key = os.environ['BING_KEY']
    headers = {'Ocp-Apim-Subscription-Key': key}

    r = requests.get(url, params=payload, headers=headers)
    # get JSON response
    r = r.json()
    result = r.get('webPages', {}).get('totalEstimatedMatches', {})
    
    if not result:
        result = 0
    print (query, result)

    return result


def bing_search(query, value_list):
    tot = 0
    for value in value_list:
        assert isinstance(value, str)
        new_query = query.replace('VALUE', value)

        result = bing_search_query(new_query)
        result = result * math.pow(10, len(query.split()))  # length factor
        
        tot += result
    return tot


if __name__ == "__main__":
    j = bing_search_query(sys.argv[1])
