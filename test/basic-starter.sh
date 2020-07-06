#!/bin/bash

# Test the basic starter code, which in turn tests a full run of everything.

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/basic/* .

starter_gen_and_train basic thingpedia

# get some fake data to test with
cat > thingpedia/eval/annotated.tsv <<EOF
1	get a cat picture	now => @com.thecatapi.get => notify
EOF

# evaluate
sed -i 's/thingpedia_eval_models =/thingpedia_eval_models = small/' Makefile
make experiment=thingpedia eval_set=eval evaluate

rm -fr $workdir
