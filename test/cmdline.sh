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
node $srcdir/tool/genie.js generate --maxdepth 2 --thingpedia thingpedia.json --dataset dataset.tt \
  --template $srcdir/languages/en/thingtalk.genie -o /dev/null -l en

# sample
node $srcdir/tool/genie.js sample -o synthetic-sampled.tsv \
  --constants $srcdir/data/en-US/constants.tsv --sampling-control $srcdir/test/easy-hard-functions.tsv < $srcdir/test/synthetic.tsv
diff -u $srcdir/test/expected-synthetic-sampled.tsv synthetic-sampled.tsv

# make paraphrasing hits
node $srcdir/tool/genie.js mturk-make-paraphrase-hits -o mturk-paraphrasing.csv < synthetic-sampled.tsv
diff -u $srcdir/test/expected-mturk-paraphrasing.csv mturk-paraphrasing.csv

# time passes...

# make validation hits
node $srcdir/tool/genie.js mturk-make-validation-hits -o mturk-validation.csv --thingpedia thingpedia.json < paraphrasing-results.csv
diff -u $srcdir/test/expected-mturk-validation.csv mturk-validation.csv

# more time passes...

node $srcdi/tool/genie.js mturk-validate -o paraphrase.tsv -l en-US --thingpedia ../thingpedia.json \
  --paraphrasing-input $srcdir/test/paraphrasing-results.csv \
  --validation-input $srcdir/test/validation-results.csv \
  --paraphrasing-rejects ./paraphrasing-rejects.csv \
  --validation-rejects ./validation-rejects.csv
  --validation-count 3 --validation-threshold 3
diff -u $srcdir/test/expected-paraphrase1.tsv paraphrase.tsv
diff -u $srcdir/test/expected-paraphrasing-rejects.csv paraphrasing-rejects.csv
diff -u $srcdir/test/expected-validation-rejects.csv validation-rejects.csv

# now test we can validate without validation results (auto validation only)

node $srcdi/tool/genie.js mturk-validate -o paraphrase.tsv -l en-US --thingpedia ../thingpedia.json \
  --paraphrasing-input $srcdir/test/paraphrasing-results.csv \
  --paraphrasing-rejects /dev/null \
  --validation-threshold 0
diff -u $srcdir/test/expected-paraphrase2.tsv paraphrase.tsv

# test that we can skip the reject files
node $srcdi/tool/genie.js mturk-validate -o paraphrase.tsv -l en-US --thingpedia ../thingpedia.json \
  --paraphrasing-input $srcdir/test/paraphrasing-results.csv \
  --validation-input $srcdir/test/validation-results.csv \
  --validation-count 3 --validation-threshold 3
diff -u $srcdir/test/expected-paraphrase1.tsv paraphrase.tsv
