#!/bin/bash

# Test the wikidata starter code.

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/wikidata/* .

# generate & train
starter_gen_and_train wikidata country

# get some fake data to test with
mkdir country/eval
cat > country/eval/annotated.tsv <<EOF
1	i'm looking for a sports_team	now => @org.wikidata.sports_team => notify
EOF

# evaluate
make experiment=country eval_set=eval model=small use_preprocessed_wikidata=true evaluate

rm -fr $workdir
