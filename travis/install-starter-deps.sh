#!/bin/bash

set -e
set -x
set -o pipefail

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

pip3 install --upgrade pip
which genienlp >/dev/null 2>&1 || pip3 install 'genienlp==v0.7.0a3'
which genienlp

mkdir -p $srcdir/test/embeddings
