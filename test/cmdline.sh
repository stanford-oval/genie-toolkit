#!/bin/sh

set -e
set -x

srcdir=`dirname $0`/..

node $srcdir/tool/genie.js && exit 1 || true

node $srcdir/tool/genie.js --help

# generate
node $srcdir/tool/genie.js generate --help

node $srcdir/tool/genie.js generate -o /dev/null -l en 
