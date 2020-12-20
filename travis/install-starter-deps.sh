#!/bin/bash

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

which genienlp >/dev/null 2>&1 || pip3 install --user 'genienlp>=0.6.0a1'
which genienlp

npm install -g thingpedia-cli

mkdir -p $srcdir/test/embeddings
