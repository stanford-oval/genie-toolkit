#!/usr/bin/env python
# coding=utf-8

from bingSearch import *
from word_forms.word_forms import get_word_forms
import json
import collections
import random
import stanfordnlp


def read_data(table, table_file, property_name):
    value_list = []

    f = open(table_file, encoding='utf-8')
    data = json.load(f)
    property_list = property_name.strip().split('.')

    if len(property_list) > 2: # currently only handel two levels
        print ("The hierarchy of property is larger than 2!")
        raise

    for restaurant in data:
        if (len(restaurant[property_list[0]]) == 0):
            continue

        if len(property_list) == 1:
            value_list.append(restaurant[property_list[0]])
        else:
            if isinstance(restaurant[property_list[0]], list):
                value_list.append(restaurant[property_list[0]][0][property_list[1]])
            else:
                value_list.append(restaurant[property_list[0]][property_list[1]])

    random.seed( 10 )
    values = random.sample(value_list, 10)

    if isinstance(values[0], float) or isinstance(values[0], int):
        numeric = True
    else:
        numeric = False

    return [str(value) for value in values], numeric


def get_ed_ing(property_canonical):
    propEd = None
    propIng = None

    v_words = list(get_word_forms(property_canonical)['v'])
    for word in v_words:
        if word.endswith("ed"):
            propEd = word
            print (f"propEd: {propEd}")
        if word.endswith("ing"):
            propIng = word
            print (f"propIng: {propIng}")

    return propEd, propIng


def phrase_start_with_verb(property_canonical):
    property_list = property_canonical.strip().split()

    if len(property_list) < 2: # not a phrase
        return None, None

    nlp = stanfordnlp.Pipeline(processors='tokenize,mwt,pos', use_gpu=False)
    doc = nlp(property_canonical)

    if doc.sentences[0].words[0].upos != 'VERB': # not start with a verb
        print (property_list[0], doc.sentences[0].words[0].upos)
        return None, None

    propVerb = property_list[0]
    propNoun = ' '.join(property_list[1:])
    print (f"propVerb: {propVerb}")
    print (f"propNoun: {propNoun}")

    return propVerb, propNoun


def equal_pattern_rank(table, property_name, property_canonical, value_list, numeric):
    dic = dict()
    value = 'VALUE' # a placeholder

    if property_name == 'name':
        return [('value', 2), ('value_table', 1)]

    if property_name == 'geo':
        return [('table_near_value', 2), ('table_around_value', 1)]

    if not numeric:
        # dic['value_property'] = bing_search('"' + value + property_canonical + '"')
        dic['value_table'] = bing_search('"' + value + ' ' + table + '"', value_list)
        dic['table_with_value'] = bing_search('"' + table + ' ' + 'with' + ' ' + value + '"', value_list)

    dic['table_with_value_property'] = bing_search('"' + table + ' ' + 'with' + ' ' + value + ' ' + property_canonical + '"', value_list)
    dic['table_property_value'] = bing_search('"' + table + ' ' + property_canonical + ' ' + value + '"', value_list)
    dic['value_property_table'] = bing_search('"' + value + ' ' + property_canonical + ' ' + table + '"', value_list)

    propEd, propIng = get_ed_ing(property_canonical)

    if propEd:
        dic['table_propEd_value'] = bing_search('"' + table + ' ' + propEd + ' ' + value + '"', value_list)
        dic['value_propEd_table'] = bing_search('"' + value + ' ' + propEd + ' ' + table + '"', value_list)
    if propIng:
        dic['table_propIng_value'] = bing_search('"' + table + ' ' + propIng + ' ' + value + '"', value_list)
        dic['value_propIng_table'] = bing_search('"' + value + ' ' + propIng + ' ' + table + '"', value_list)

    propVerb, propNoun = phrase_start_with_verb(property_canonical)

    if propVerb and propNoun:
        # dic['value_propNoun'] = bing_search('"' + value + propNoun + '"')
        dic['table_propVerb_value'] = bing_search('"' + table + ' ' + propVerb + ' ' + value + '"', value_list)
        dic['table_with_value_propNoun'] = bing_search('"' + table + ' ' + 'with' + ' ' + value + ' ' + propNoun + '"', value_list)
        dic['table_propVerb_value_propNoun'] = bing_search('"' + table + ' ' + propVerb + ' ' + value + ' ' + propNoun + '"', value_list)
        dic['value_propNoun_table'] = bing_search('"' + value + ' ' + propNoun + ' ' + table + '"', value_list)

    if property_name.strip().split('.')[0] == 'address':
        dic['table_in_value'] = bing_search('"' + table + ' ' + 'in' + ' ' + value + '"', value_list)
        dic['table_in_value_property'] = bing_search('"' + table + ' ' + 'in' + ' ' + value + ' ' + property_canonical + '"', value_list)

    sort_dic = sorted(dic.items(), key=lambda x: (-x[1], x[0]))

    return sort_dic


def comparative_pattern_rank(table, property_canonical, value_list):
    dic = dict()
    value = 'VALUE'

    dic['table_with_at_least_value_property'] = bing_search('"' + table + ' ' + 'with at least' + ' ' + value + ' ' + property_canonical + '"', value_list)
    dic['table_with_more_than_value_property'] = bing_search('"' + table + ' ' + 'with more than' + ' ' + value + ' ' + property_canonical + '"', value_list)

    propEd, propIng = get_ed_ing(property_canonical)

    if propEd:
        dic['table_propEd_at_least_value'] = bing_search('"' + table + ' ' + propEd + ' ' + 'at least' + ' ' + value + '"', value_list)
        dic['table_propEd_more_than_value'] = bing_search('"' + table + ' ' + propEd + ' ' + 'more than' + ' ' + value + '"', value_list)
    if propIng:
        dic['table_propIng_at_least_value'] = bing_search('"' + table + ' ' + propIng + ' ' + 'at least' + ' ' + value + '"', value_list)
        dic['table_propIng_more_than_value'] = bing_search('"' + table + ' ' + propIng + ' ' + 'more than' + ' ' + value + '"', value_list)

    sort_dic = sorted(dic.items(), key=lambda x: (-x[1], x[0]))

    return sort_dic


def parse_name(table, property_canonical, value_list, patterns):
    dic = dict()

    dic['table'] = table
    dic['value'] = value_list[0]
    dic['property'] = property_canonical
    dic['with'] = 'with'
    dic['in'] = 'in'
    dic['at'] = 'at'
    dic['least'] = 'least'
    dic['more'] = 'more'
    dic['than'] = 'than'

    propEd, propIng = get_ed_ing(property_canonical)
    if propEd:
        dic['propEd'] = propEd
    if propIng:
        dic['propIng'] = propIng

    propVerb, propNoun = phrase_start_with_verb(property_canonical)
    if propVerb and propNoun:
        dic['propVerb'] = propVerb
        dic['propNoun'] = propNoun

    result_list = list()
    for pattern in patterns:
        name = pattern[0]
        name = name.split('_')
        parsed_name = ' '.join([dic[word] for word in name])
        result_list.append((parsed_name, int(pattern[1])))

    return result_list

def main():
    #table = 'restaurants'
    #table_file = 'restaurants.json'
    table = sys.argv[1]
    table_file = sys.argv[2]

    # property_name = 'address.postalCode'
    property_name = 'address.addressLocality'
    property_canonical = 'city'

    value_list, numeric = read_data(table, table_file, property_name)

    patterns = equal_pattern_rank(table, property_name, property_canonical, value_list, numeric)
    print (parse_name(table, property_canonical, value_list, patterns[:4]))
    # print (patterns[:4])

    if numeric:
        print ("\nbelow are comparative patterns:")
        comparative_patterns = comparative_pattern_rank(table, property_canonical, value_list)
        print (parse_name(table, property_canonical, value_list, comparative_patterns[:4]))

if __name__ == "__main__":
    main()
