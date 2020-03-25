#!/bin/sh

set -e
set -x

srcdir=`dirname $0`/..

on_error() {
    rm -fr ./test_results_temp/
}
trap on_error ERR INT TERM

mkdir -p ./test_results_temp/

# test requote.js
$(which node) $srcdir/tool/genie.js requote $srcdir/test/data/samples-en-hard.tsv --output ./test_results_temp/samples-en-hard-requoted.tsv --mode replace
cmp --silent ./test_results_temp/samples-en-hard-requoted.tsv $srcdir/test/data/samples-en-hard-requoted.tsv && echo '*** SUCCESS: Test passed! ***' || { echo '*** ERROR: Test has Failed... ***'; exit 1 ;}

$(which node) $srcdir/tool/genie.js requote $srcdir/test/data/samples-en-hard.tsv --output ./test_results_temp/samples-en-hard-qpis.tsv --mode qpis
cmp --silent ./test_results_temp/samples-en-hard-qpis.tsv $srcdir/test/data/samples-en-hard-qpis.tsv && echo '*** SUCCESS: Test passed! ***' || { echo '*** ERROR: Test has Failed... ***'; exit 1 ;}
