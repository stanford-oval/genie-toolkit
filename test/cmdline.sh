#!/bin/sh

set -e
set -x

srcdir=`dirname $0`/..

node $srcdir/tool/genie.js && exit 1 || true

node $srcdir/tool/genie.js --help

# download-*
node $srcdir/tool/genie.js download-snapshot --help
node $srcdir/tool/genie.js download-dataset --help

node $srcdir/tool/genie.js download-snapshot -o thingpedia.json --snapshot -1
node $srcdir/tool/genie.js download-dataset -o dataset.tt

# generate
node $srcdir/tool/genie.js generate --help

node $srcdir/tool/genie.js generate -o /dev/null -l en 
