import argparse
import json
import os

parser = argparse.ArgumentParser()

parser.add_argument('--in_file', type=str, help='input file to read from')
parser.add_argument('--out_folder', type=str, help='output folder to write to')

args = parser.parse_args()

if not os.path.exists(args.out_folder):
    os.makedirs(args.out_folder)

with open(args.in_file) as fin:
    ontology = json.load(fin)

cur_dir = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(os.path.dirname(cur_dir), 'shared-parameter-datasets.tsv'), 'w') as paramFile:
    paramFile.write('\t'.join(['string', 'en-US', 'tt:short_free_text', f'shared-parameter-datasets/tt:short_free_text.tsv']) + '\n')
    for domain_intent in ontology:
        domain, intent = domain_intent.split(' ')
        if domain.endswith('s'):
            domain = domain[:-1]
        if not domain[0].isupper():
            domain = domain.capitalize()
        for slot, values in ontology[domain_intent].items():
            fname = f'mtod.{domain}:{slot}'
            paramFile.write('\t'.join(['string', 'en-US', fname, f'shared-parameter-datasets/{fname}.tsv']) + '\n')
            with open(os.path.join(args.out_folder, f'{fname}.tsv'), 'w') as fout:
                    for val in values:
                        val = str(val)
                        fout.write('\t'.join([val, val.lower(),'1.0']) + '\n')
