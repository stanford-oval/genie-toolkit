#!/bin/bash

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

node $srcdir/dist/tool/genie.js && exit 1 || true

node $srcdir/dist/tool/genie.js --help

git config thingpedia.url https://almond-dev.stanford.edu/thingpedia
git config thingpedia.developer-key 88c03add145ad3a3aa4074ffa828be5a391625f9d4e1d0b034b445f18c595656

# download commands

node $srcdir/dist/tool/genie.js download-snapshot -o thingpedia.tt --entities entities.json --snapshot -1
node $srcdir/dist/tool/genie.js download-snapshot -o thingpedia.tt --snapshot -1
node $srcdir/dist/tool/genie.js download-snapshot --thingpedia-url https://almond.stanford.edu/thingpedia -o thingpedia12.tt --snapshot 12
diff -u thingpedia12.tt $srcdir/test/data/en-US/expected-thingpedia12.tt
node $srcdir/dist/tool/genie.js download-templates -o dataset.tt

node $srcdir/dist/tool/genie.js download-entities -o entities.json
node $srcdir/dist/tool/genie.js download-entity-values -d parameters --manifest parameters/parameter-datasets.tsv

node $srcdir/dist/tool/genie.js download-strings -o strings.json
node $srcdir/dist/tool/genie.js download-string-values -d parameters --manifest parameters/parameter-datasets.tsv --append-manifest

## test requote.js
# replace mode
node $srcdir/dist/tool/genie.js requote $srcdir/test/data/en-US/samples-en-hard.tsv --output ./samples-en-hard-requoted.tsv --mode replace
diff -u $srcdir/test/data/en-US/samples-en-hard-requoted.tsv ./samples-en-hard-requoted.tsv
# qpis mode
node $srcdir/dist/tool/genie.js requote $srcdir/test/data/en-US/samples-en-hard.tsv --output ./samples-en-hard-qpis.tsv --mode qpis
diff -u $srcdir/test/data/en-US/samples-en-hard-qpis.tsv ./samples-en-hard-qpis.tsv


# (requote) collect erred examples in a separate folder
node $srcdir/dist/tool/genie.js requote $srcdir/test/data/en-US/samples-erred.tsv --output ./samples-erred-requoted.tsv --output-errors ./samples-erred.tsv --skip-errors  --mode replace
test -s ./samples-erred-requoted.tsv || exit 1
test -s ./samples-erred.tsv || exit 1


## test augment.js and requote.js
# first augment input dataset
node $srcdir/dist/tool/genie.js augment $srcdir/test/data/fa/para-restaurants-fixed.tsv --output ./para-restaurants-aug.tsv --random-seed 123 -l en-US --param-local fa --thingpedia $srcdir/data/fa/restaurants/schema.tt --parameter-datasets $srcdir/data/fa/restaurants/parameter-datasets.tsv --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 1 --no-quote-paraphrasing-expand-factor 1 --quoted-fraction 0.0 --debug
# then requote the augmented dataset and assert the result matches the input dataset
node $srcdir/dist/tool/genie.js requote ./para-restaurants-aug.tsv --output ./para-restaurants-aug-req.tsv --mode replace
diff -u --left-column <(cut -f2- ./para-restaurants-aug-req.tsv) <(cut -f2- $srcdir/test/data/fa/para-restaurants-fixed.tsv)

# preprocess string datasets
node $srcdir/dist/tool/genie.js preprocess-string-dataset -o com.spotify:genre.tsv $srcdir/test/data/en-US/spotify-genres.txt
diff -u com.spotify:genre.tsv $srcdir/test/data/en-US/expected-spotify-genre.tsv

# generate
node $srcdir/dist/tool/genie.js generate --help
node $srcdir/dist/tool/genie.js generate --maxdepth 2 \
  --thingpedia thingpedia.tt --entities entities.json --dataset dataset.tt \
  --template $srcdir/languages-dist/thingtalk/en/thingtalk.genie -o /dev/null -l en

# sample
node $srcdir/dist/tool/genie.js sample -o synthetic-sampled.tsv \
  --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --constants $srcdir/data/en-US/constants.tsv --sampling-control $srcdir/test/data/en-US/easy-hard-functions.tsv $srcdir/test/data/en-US/synthetic.tsv
diff -u $srcdir/test/data/en-US/expected-synthetic-sampled.tsv synthetic-sampled.tsv

# make paraphrasing hits
node $srcdir/dist/tool/genie.js mturk-make-paraphrase-hits -o mturk-paraphrasing.csv < synthetic-sampled.tsv
diff -u $srcdir/test/data/en-US/expected-mturk-paraphrasing.csv mturk-paraphrasing.csv

# time passes...

# make validation hits
node $srcdir/dist/tool/genie.js mturk-make-validation-hits -o mturk-validation.csv --thingpedia $srcdir/test/data/en-US/thingpedia.tt < $srcdir/test/data/en-US/paraphrasing-results.csv
diff -u $srcdir/test/data/en-US/expected-mturk-validation.csv mturk-validation.csv

# more time passes...

node $srcdir/dist/tool/genie.js mturk-validate -o paraphrase1.tsv -l en-US --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
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

node $srcdir/dist/tool/genie.js mturk-validate -o paraphrase2.tsv -l en-US --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --paraphrasing-input $srcdir/test/data/en-US/paraphrasing-results.csv \
  --paraphrasing-rejects /dev/null \
  --validation-threshold 0
diff -u $srcdir/test/data/en-US/expected-paraphrase2.tsv paraphrase2.tsv

# test that we can skip the reject files
#node $srcdir/dist/tool/genie.js mturk-validate -o paraphrase1.tsv -l en-US --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
#  --paraphrasing-input $srcdir/test/data/en-US/paraphrasing-results.csv \
#  --validation-input $srcdir/test/data/en-US/validation-results.csv \
#  --validation-count 3 --validation-threshold 3
#	diff -u $srcdir/test/data/en-US/expected-paraphrase1.tsv paraphrase1.tsv

# yay we have a dataset, time to augment it...

node $srcdir/dist/tool/genie.js augment $srcdir/test/data/en-US/augment-input.tsv $srcdir/test/data/en-US/synthetic.tsv --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --param-locale en --parameter-datasets $srcdir/test/data/en-US/parameter-datasets.tsv \
  -o everything.tsv \
  --quoted-fraction 0.1 \
  --synthetic-expand-factor 3
node $srcdir/dist/tool/genie.js requote ./everything.tsv --output ./everything-req.tsv --mode replace
#cp everything-req.tsv $srcdir/test/data/en-US/expected-everything-req.tsv
diff -u $srcdir/test/data/en-US/expected-everything-req.tsv everything-req.tsv
#cp everything.tsv $srcdir/test/data/en-US/expected-everything.tsv
diff -u $srcdir/test/data/en-US/expected-everything.tsv everything.tsv

node $srcdir/dist/tool/genie.js augment $srcdir/test/data/en-US/augment-input.tsv $srcdir/test/data/en-US/synthetic.tsv --thingpedia $srcdir/test/data/en-US/thingpedia.tt \
  --param-locale en --parameter-datasets $srcdir/test/data/en-US/parameter-datasets.tsv \
  -o everything-nonrequotable.tsv \
  --quoted-fraction 0.1 \
  --synthetic-expand-factor 3 \
  --no-requotable
#cp everything-nonrequotable.tsv $srcdir/test/data/en-US/expected-everything-nonrequotable.tsv
diff -u $srcdir/test/data/en-US/expected-everything-nonrequotable.tsv everything-nonrequotable.tsv

# and split it in various ways
node $srcdir/dist/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null --test /dev/null \
  --split-strategy id --eval-probability 0.5
node $srcdir/dist/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null \
  --split-strategy raw-sentence --eval-probability 0.5
node $srcdir/dist/tool/genie.js split-train-eval everything.tsv \
  --train train.tsv --eval eval.tsv \
  --split-strategy sentence --eval-probability 0.5
node $srcdir/dist/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null \
  --split-strategy program --eval-probability 0.5
node $srcdir/dist/tool/genie.js split-train-eval everything.tsv \
  --train /dev/null --eval /dev/null \
  --split-strategy combination --eval-probability 0.5

rm -fr $workdir
