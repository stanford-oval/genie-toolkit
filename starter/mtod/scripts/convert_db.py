import argparse
import json
import os

parser = argparse.ArgumentParser()

parser.add_argument('--in_file', type=str, help='input file to read from')
parser.add_argument('--out_file', type=str, help='output file to write to')

args = parser.parse_args()

if not os.path.exists(os.path.dirname(args.out_file)):
    os.makedirs(os.path.dirname(args.out_file))

with open(args.in_file) as fin:
    all_outs = []
    for line in fin:
        line = json.loads(line)

        if 'uuid' in line:
            continue

        line['id'] = {'value': line['_id'], 'display': line['name']}
        del line['_id']

        all_outs.append(line)

with open(args.out_file, 'w') as fout:
    json.dump(all_outs, fout, ensure_ascii=False, indent=True)

