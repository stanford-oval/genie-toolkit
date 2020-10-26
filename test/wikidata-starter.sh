#!/bin/bash

# Test the wikidata starter code.

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/wikidata/* .

# generate & train
starter_gen_and_train wikidata city

# get some fake data to test with
mkdir city/eval
cat > city/eval/annotated.tsv <<EOF
1	i'm looking for a city	now => @org.wikidata.city => notify
EOF

# evaluate
make experiment=city eval_set=eval model=small evaluate

rm -fr $workdir
