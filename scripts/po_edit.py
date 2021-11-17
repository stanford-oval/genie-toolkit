#!/usr/bin/env python3
# coding=utf-8
#
# This file is part of Genie
#
# Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
#
# Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>

import argparse
import os
import re
import polib

parser = argparse.ArgumentParser('PO parser')

parser.add_argument('-i', '--input_file', type=str)
parser.add_argument('-o', '--output_file', type=str)
parser.add_argument('--translated_file', type=str)

parser.add_argument('--transformation', choices=['prepare_for_translation', 'create_final'], type=str)

args = parser.parse_args()

PUNCTUATIONS = {
                '.', '?', '!', ',', # english
                '؟', '،', # persian
                '？', '。',# cjk
                }
PERIODS = {'.', '。'}
SPECIAL_CHARS = {':', '#'}

placeholder_regex_fw = "|".join(
    [
        r"<\${.+?}>",  # <${placeholder}>
        r"\${.+?}",  # ${placeholder}
        r"<\$.+?>",  # <placeholder>
        r"\$.+",  # placeholder
        r"[({|})]",  # {x|y} ^(x|y)
        r"\[[^\]]+\]" # flags such as [plural=other]
    ]
)

# wrap in () so re.split return placeholders too
# this ensure the order of outputs phrases is poutputerved when constructing the output
placeholder_regex_fw = '(' + placeholder_regex_fw + ')'

multi_option_regex_bw = re.compile('[{(](.+? \| )(.+? \| )*.+?[})]')

# total of 7 entries, all in describe.ts
# update if more are added later
UNTRANSLATABLE_LINES = {
              '${op_key:select:',
              '${input_param[pos]:select:',
              '${index:ordinal:',
              '${filter[pos]:select:',

              # do not translate the POS tags in the "default" key
              'base',
              'preposition',
              'property',
              'passive_verb',
              'verb',
              }

def prepare_for_translation():
    if not os.path.exists(args.input_file):
        raise ValueError(f'Input file: {args.input_file} is not found')
    pofile = polib.pofile(args.input_file)
    with open(args.output_file, 'w') as fout:
        for entry in pofile:
            line = entry.msgid
            base_id = ':'.join(entry.occurrences[0])

            # skip these lines
            if any(line.startswith(string) for string in UNTRANSLATABLE_LINES):
                continue

            line = line.strip('\n').strip('"')
            line = re.sub(r"\s{2,}", " ", line)
            parts = re.split(placeholder_regex_fw, line)

            for i, p in enumerate(parts):
                id_ = base_id + '/' + str(i)

                p = p.strip()

                # skip placeholders
                if i % 2 == 1:
                    continue

                # skip empty strings
                if p == '':
                    continue

                # skip punctuations and special characters
                if p in PUNCTUATIONS:
                    continue
                if p in SPECIAL_CHARS:
                    continue

                fout.write(id_ + '\t' + p + '\n')

def clean_translated_output(text):
    text = text.strip()
    text = re.sub(r"\s{2,}", " ", text)

    if text == '':
        return ''

    # translation likes ending phrases in periods
    # remove them here
    # post-editors add it back if necessary
    if text[-1] in PERIODS:
        text = text[:-1]
        text = text.strip()

    if multi_option_regex_bw.search(text):
        text = text.replace(' | ', '|')
        text = text.replace('{ ', '{')
        text = text.replace(' }', '}')
        text = text.replace('( ', '(')
        text = text.replace(' )', ')')

    return text


def create_final():
    pofile = polib.pofile(args.input_file)

    translated_mapping = {}
    with open(args.translated_file, 'r') as fin:
        for line in fin:
            id_, sent, _ = line.strip('\n').split('\t')
            task_name, id_ = id_.split('/', 1)
            translated_mapping[id_] = sent.strip()


    # modifies entries inplace
    for entry in pofile:
        # Add fuzzy to indicate translation need post-editing
        entry.flags += ['fuzzy']

        line = entry.msgid
        base_id = ':'.join(entry.occurrences[0])

        line = line.strip('\n').strip('"')
        line = re.sub(r"\s{2,}", " ", line)
        parts = re.split(placeholder_regex_fw, line)

        for i, part in enumerate(parts):
            if base_id + '/' + str(i) in translated_mapping:
                sent = translated_mapping[base_id + '/' + str(i)]
                sent = sent.strip()
                parts[i] = sent

        output = ' '.join(parts)
        output = clean_translated_output(output)

        entry.msgstr = output

    pofile.save(args.output_file)


if __name__ == '__main__':

    if args.transformation == 'prepare_for_translation':
        prepare_for_translation()
    elif args.transformation == 'create_final':
        create_final()
