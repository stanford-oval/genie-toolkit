#!/bin/sh

set -e
set -x

srcdir=`dirname $0`/..

node $srcdir/test/index.js
$srcdir/test/cmdline.sh
