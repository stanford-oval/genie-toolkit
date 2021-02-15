#!/bin/bash

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

pip3 install --upgrade pip
which genienlp >/dev/null 2>&1 || pip3 install --user 'git+https://github.com/stanford-oval/genienlp@8f48731ed1e907f2c2a469922d9b86eb8baa7631#egg=genienlp'
which genienlp

npm install -g thingpedia-cli

mkdir -p $srcdir/test/embeddings
