#!/bin/sh

set -e
set -x

srcdir=`dirname $0`/..

$srcdir/test/test_tools.sh
node $srcdir/test/index.js
$srcdir/test/cmdline.sh


