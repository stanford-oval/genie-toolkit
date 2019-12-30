#!/bin/sh

set -e
set -x
srcdir=`dirname $0`
node $srcdir/unit
node $srcdir/functional
