#!/bin/bash

set -e
set -x

srcdir=`dirname $0`/..
srcdir=`realpath $srcdir`

export TMPDIR=$srcdir
workdir=`mktemp -d $TMPDIR/genie-XXXXXX`
workdir=`realpath $workdir`

on_error() {
    rm -fr $workdir
}
trap on_error ERR INT TERM

oldpwd=`pwd`
cd $workdir

node $srcdir/tool/genie.js && exit 1 || true

node $srcdir/tool/genie.js --help


## test requote.js
# replace mode
node $srcdir/tool/genie.js requote $srcdir/test/data/en-US/samples-en-hard.tsv --output ./samples-en-hard-requoted.tsv --mode replace
diff -u $srcdir/test/data/en-US/samples-en-hard-requoted.tsv ./samples-en-hard-requoted.tsv
# qpis mode
node $srcdir/tool/genie.js requote $srcdir/test/data/en-US/samples-en-hard.tsv --output ./samples-en-hard-qpis.tsv --mode qpis
diff -u $srcdir/test/data/en-US/samples-en-hard-qpis.tsv ./samples-en-hard-qpis.tsv


## test augment.js and requote.js
# first augment input dataset
node $srcdir/tool/genie.js augment $srcdir/test/data/fa/para-restaurants-fixed.tsv --output ./para-restaurants-aug.tsv --random-seed 123 -l en-US --param-local fa --thingpedia $srcdir/data/fa/restaurants/schema.tt --parameter-datasets $srcdir/data/fa/restaurants/parameter-datasets.tsv --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 1 --no-quote-paraphrasing-expand-factor 1 --quoted-fraction 0.0 --debug
# then requote the augmented dataset and assert the result matches the input dataset
node $srcdir/tool/genie.js requote ./para-restaurants-aug.tsv --output ./para-restaurants-aug-req.tsv --mode replace
diff -u --left-column <(cut -f2- ./para-restaurants-aug-req.tsv) <(cut -f2- $srcdir/test/data/fa/para-restaurants-fixed.tsv)


# download-*
node $srcdir/tool/genie.js download-snapshot --help
node $srcdir/tool/genie.js download-dataset --help

node $srcdir/tool/genie.js download-snapshot -o thingpedia.tt --entities entities.json --snapshot -1
node $srcdir/tool/genie.js download-dataset -o dataset.tt

node $srcdir/tool/genie.js dataset -i dataset.tt -o foo.tt --thingpedia thingpedia.tt --actions clean

# generate
node $srcdir/tool/genie.js generate --help
node $srcdir/tool/genie.js generate --maxdepth 2 \
  --thingpedia thingpedia.tt --entities entities.json --dataset dataset.tt \
  --template $srcdir/languages/thingtalk/en/thingtalk.genie -o /dev/null -l en

# sample
node $srcdir/tool/genie.js sample -o synthetic-sampled.tsv \
  --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --constants $srcdir/data/en-US/constants.tsv --sampling-control $srcdir/test/data/en-US/easy-hard-functions.tsv $srcdir/test/data/en-US/synthetic.tsv
diff -u $srcdir/test/data/en-US/expected-synthetic-sampled.tsv synthetic-sampled.tsv

# make paraphrasing hits
node $srcdir/tool/genie.js mturk-make-paraphrase-hits -o mturk-paraphrasing.csv < synthetic-sampled.tsv
diff -u $srcdir/test/data/en-US/expected-mturk-paraphrasing.csv mturk-paraphrasing.csv

# time passes...

# make validation hits
node $srcdir/tool/genie.js mturk-make-validation-hits -o mturk-validation.csv --thingpedia $srcdir/test/data/en-US/thingpedia.tt < $srcdir/test/data/en-US/paraphrasing-results.csv
diff -u $srcdir/test/data/en-US/expected-mturk-validation.csv mturk-validation.csv

# more time passes...

node $srcdir/tool/genie.js mturk-validate -o paraphrase1.tsv -l en-US --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --paraphrasing-input $srcdir/test/data/en-US/paraphrasing-results.csv \
  --validation-input $srcdir/test/data/en-US/validation-results.csv \
  --paraphrasing-rejects ./paraphrasing-rejects.csv \
  --validation-rejects ./validation-rejects.csv \
  --validation-count 3 --validation-threshold 3 \
  --debug
diff -u $srcdir/test/data/en-US/expected-paraphrase1.tsv paraphrase1.tsv
diff -u $srcdir/test/data/en-US/expected-paraphrasing-rejects.csv paraphrasing-rejects.csv
diff -u $srcdir/test/data/en-US/expected-validation-rejects.csv validation-rejects.csv

# now test we can validate without validation results (auto validation only)

node $srcdir/tool/genie.js mturk-validate -o paraphrase2.tsv -l en-US --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --paraphrasing-input $srcdir/test/data/en-US/paraphrasing-results.csv \
  --paraphrasing-rejects /dev/null \
  --validation-threshold 0
diff -u $srcdir/test/data/en-US/expected-paraphrase2.tsv paraphrase2.tsv

# test that we can skip the reject files
#node $srcdir/tool/genie.js mturk-validate -o paraphrase1.tsv -l en-US --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
#  --paraphrasing-input $srcdir/test/data/en-US/paraphrasing-results.csv \
#  --validation-input $srcdir/test/data/en-US/validation-results.csv \
#  --validation-count 3 --validation-threshold 3
#	diff -u $srcdir/test/data/en-US/expected-paraphrase1.tsv paraphrase1.tsv

# yay we have a dataset, time to augment it...

node $srcdir/tool/genie.js augment paraphrase1.tsv $srcdir/test/data/en-US/synthetic.tsv --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --param-locale en --parameter-datasets $srcdir/test/data/en-US/parameter-datasets.tsv \
  -o everything.tsv \
  --quoted-fraction 0.1 \
  --synthetic-expand-factor 3
node $srcdir/tool/genie.js requote ./everything.tsv --output ./everything-req.tsv --mode replace
diff -u $srcdir/test/data/en-US/expected-everything-req.tsv everything-req.tsv
diff -u $srcdir/test/data/en-US/expected-everything.tsv everything.tsv

# and split it in various ways
node $srcdir/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null --test /dev/null \
  --split-strategy id --eval-probability 0.5
node $srcdir/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null \
  --split-strategy raw-sentence --eval-probability 0.5
node $srcdir/tool/genie.js split-train-eval everything.tsv \
  --train train.tsv --eval eval.tsv \
  --split-strategy sentence --eval-probability 0.5
node $srcdir/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null \
  --split-strategy program --eval-probability 0.5
node $srcdir/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null \
  --split-strategy combination --eval-probability 0.5

## now the same thing, but contextual

# generate-contextual
#node $srcdir/tool/genie.js extract-contexts -l en-US -o contexts.txt \
#   --thingpedia $srcdir/test/data/en-US/thingpedia.tt $srcdir/test/data/en-US/synthetic.tsv
#node $srcdir/tool/genie.js generate-contextual --maxdepth 3 \
#    --thingpedia $srcdir/test/data/en-US/thingpedia.tt --entities entities.json --dataset dataset.tt \
#   --template $srcdir/languages/thingtalk/en/contextual.genie -o /dev/null -l en contexts.txt
#node $srcdir/tool/genie.js contextualize -o /dev/null -l en --context contexts.txt $srcdir/test/data/en-US/synthetic.tsv
#
#node $srcdir/tool/genie.js sample -o synthetic-contextual-sampled.tsv \
#  --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
#  --contextual --context-source $srcdir/test/data/en-US/synthetic-context-source.tsv \
#  --constants $srcdir/data/en-US/constants.tsv --sampling-control $srcdir/test/data/en-US/easy-hard-functions.tsv \
#  $srcdir/test/data/en-US/synthetic-contextual.tsv
#diff -u $srcdir/test/data/en-US/expected-synthetic-contextual-sampled.tsv synthetic-contextual-sampled.tsv
#
#node $srcdir/tool/genie.js mturk-make-paraphrase-hits -o mturk-contextual-paraphrasing.csv \
#  --sentences-per-task 3 < synthetic-contextual-sampled.tsv
#diff -u $srcdir/test/data/en-US/expected-contextual-mturk-paraphrasing.csv mturk-contextual-paraphrasing.csv

rm -fr $workdir
