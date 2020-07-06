#!/bin/bash

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

which genienlp >/dev/null 2>&1 || pip3 install --user 'git+https://github.com/stanford-oval/genienlp@845e4a4b03e3902babc71b3edbc61bf99a5013ac#egg=genienlp'
which genienlp

yarn global add thingpedia-cli

mkdir -p $srcdir/test/embeddings
