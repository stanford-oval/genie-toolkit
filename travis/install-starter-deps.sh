#!/bin/bash

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

which genienlp >/dev/null 2>&1 || pip3 install --user 'git+https://github.com/stanford-oval/genienlp@653424214c27779499eaeb46ef88662490b90a8d#egg=genienlp'
which genienlp

npm install -g thingpedia-cli

mkdir -p $srcdir/test/embeddings
