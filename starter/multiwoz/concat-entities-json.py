#!/usr/bin/python3

import sys
import json

out = { 'result': 'ok', 'data': [] }
for fn in sys.argv[1:]:
    with open(fn) as fp:
        out['data'] += json.load(fp)['data']
json.dump(out, sys.stdout, indent=2)
print()
