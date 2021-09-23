#!/bin/bash

set -e
set -x

for folder in ./data/builtins/* ; do
    node ./dist/tool/genie.js lint-device \
        --manifest $folder/manifest.tt --dataset $folder/dataset.tt \
        --thingpedia-dir ./data/builtins
done
