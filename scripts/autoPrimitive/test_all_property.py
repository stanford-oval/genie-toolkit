#!/usr/bin/env python
# coding=utf-8

from autoPrimitive import *


table = 'restaurants'
table_file = 'restaurants.json'
results = []
	
property_name_list = ['name', 'servesCuisine', 'aggregateRating.ratingValue', 'aggregateRating.reviewCount', 'address.addressRegion', 'address.addressLocality']
property_canonical_list = ['name', 'serve cuisine', 'rating', 'review', 'state', 'city']

for (property_name, property_canonical) in zip(property_name_list, property_canonical_list):
	value_list, numeric = read_data(table, table_file, property_name)
	
	patterns = equal_pattern_rank(table, property_name, property_canonical, value_list, numeric)
	results.append(parse_name(table, property_canonical, value_list, patterns[:4]))

	if numeric:
		comparative_patterns = comparative_pattern_rank(table, property_canonical, value_list)
		results.append(parse_name(table, property_canonical, value_list, comparative_patterns[:4]))

for result in results:
	print (result)