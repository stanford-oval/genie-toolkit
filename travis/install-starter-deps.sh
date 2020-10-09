#!/bin/bash

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

which genienlp >/dev/null 2>&1 || pip3 install --user 'git+https://github.com/stanford-oval/genienlp@198d544aad36996cdb4eda811f2ce2b78f50a3f9#egg=genienlp'
which genienlp

npm install -g thingpedia-cli

mkdir -p $srcdir/test/embeddings
