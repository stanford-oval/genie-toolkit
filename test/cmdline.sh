#!/bin/bash

set -e
set -x

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

workdir=`mktemp -t -d genie-XXXXXX`
workdir=`realpath $workdir`
on_error() {
    rm -fr $workdir
}
trap on_error ERR INT TERM

oldpwd=`pwd`
cd $workdir

node $srcdir/tool/genie.js && exit 1 || true

node $srcdir/tool/genie.js --help

# download-*
node $srcdir/tool/genie.js download-snapshot --help
node $srcdir/tool/genie.js download-dataset --help

node $srcdir/tool/genie.js download-snapshot -o thingpedia.json --snapshot -1
node $srcdir/tool/genie.js download-dataset -o dataset.tt

# generate
node $srcdir/tool/genie.js generate --help
node $srcdir/tool/genie.js generate --maxdepth 2 --thingpedia thingpedia.json --dataset dataset.tt \
  --template $srcdir/languages/en/thingtalk.genie -o /dev/null -l en

# sample
node $srcdir/tool/genie.js sample -o synthetic-sampled.tsv \
  --constants $srcdir/data/en-US/constants.tsv --sampling-control $srcdir/test/data/easy-hard-functions.tsv < $srcdir/test/data/synthetic.tsv
diff -u $srcdir/test/data/expected-synthetic-sampled.tsv synthetic-sampled.tsv

# make paraphrasing hits
node $srcdir/tool/genie.js mturk-make-paraphrase-hits -o mturk-paraphrasing.csv < synthetic-sampled.tsv
diff -u $srcdir/test/data/expected-mturk-paraphrasing.csv mturk-paraphrasing.csv

# time passes...

# make validation hits
node $srcdir/tool/genie.js mturk-make-validation-hits -o mturk-validation.csv --thingpedia thingpedia.json < $srcdir/test/data/paraphrasing-results.csv
diff -u $srcdir/test/data/expected-mturk-validation.csv mturk-validation.csv

# more time passes...

node $srcdir/tool/genie.js mturk-validate -o paraphrase.tsv -l en-US --thingpedia thingpedia.json \
  --paraphrasing-input $srcdir/test/data/paraphrasing-results.csv \
  --validation-input $srcdir/test/data/validation-results.csv \
  --paraphrasing-rejects ./paraphrasing-rejects.csv \
  --validation-rejects ./validation-rejects.csv \
  --validation-count 3 --validation-threshold 3
diff -u $srcdir/test/data/expected-paraphrase1.tsv paraphrase.tsv
diff -u $srcdir/test/data/expected-paraphrasing-rejects.csv paraphrasing-rejects.csv
diff -u $srcdir/test/data/expected-validation-rejects.csv validation-rejects.csv

# now test we can validate without validation results (auto validation only)

node $srcdir/tool/genie.js mturk-validate -o paraphrase.tsv -l en-US --thingpedia thingpedia.json \
  --paraphrasing-input $srcdir/test/data/paraphrasing-results.csv \
  --paraphrasing-rejects /dev/null \
  --validation-threshold 0
diff -u $srcdir/test/data/expected-paraphrase2.tsv paraphrase.tsv

# test that we can skip the reject files
node $srcdir/tool/genie.js mturk-validate -o paraphrase.tsv -l en-US --thingpedia thingpedia.json \
  --paraphrasing-input $srcdir/test/data/paraphrasing-results.csv \
  --validation-input $srcdir/test/data/validation-results.csv \
  --validation-count 3 --validation-threshold 3
diff -u $srcdir/test/data/expected-paraphrase1.tsv paraphrase.tsv

# yay we have a dataset, time to augment it...

node $srcdir/tool/genie.js compile-ppdb -o compiled-ppdb.bin $srcdir/test/data/ppdb-2.0-xs-lexical
node $srcdir/tool/genie.js augment $srcdir/test/data/synthetic.tsv paraphrase.tsv --thingpedia thingpedia.json \
  --ppdb compiled-ppdb.bin --parameter-datasets $srcdir/test/data/parameter-datasets.tsv \
  -o /dev/null \
  --ppdb-synthetic-fraction 0.5 --ppdb-paraphrase-fraction 1.0 \
  --quoted-fraction 0.1
