#!/bin/bash

# Test the wikidata starter code.

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/wikidata/* .

# generate & train
starter_gen_and_train wikidata sports_team

# get some fake data to test with
mkdir sports_team/eval
cat > sports_team/eval/annotated.tsv <<EOF
1	i'm looking for a sports_team	now => @org.wikidata.sports_team => notify
EOF

# evaluate
make experiment=sports_team eval_set=eval model=small evaluate

rm -fr $workdir
