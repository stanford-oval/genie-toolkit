#!/bin/bash

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

genie="node $srcdir/dist/tool/genie.js"
test_skill_path=$srcdir/data/builtins/org.thingpedia.builtin.thingengine.builtin

# create English pot
npm run create-pot

# translate English pot to German
npm run translate-po val_batch_size=200 temperature=0.0 skip_po_creation=false tgt_lang=de non_interactive=true

# translate weather English schema.tt and dataset.tt to German
${genie} translate-schema-annotations --po-file $srcdir/po/de.po -o ${test_skill_path}/manifest.de.tt ${test_skill_path}/manifest.tt
${genie} translate-schema-annotations --po-file $srcdir/po/de.po -o ${test_skill_path}/dataset.de.tt ${test_skill_path}/dataset.tt

# copy the files (uncomment to update tests)
#cp ${test_skill_path}/manifest.de.tt $srcdir/test/data/builtins/org.thingpedia.builtin.thingengine.builtin/manifest-expected.de.tt
#cp ${test_skill_path}/dataset.de.tt $srcdir/test/data/builtins/org.thingpedia.builtin.thingengine.builtin/dataset-expected.de.tt

# check diff with expected results
diff -w -u ${test_skill_path}/manifest.de.tt $srcdir/test/data/builtins/org.thingpedia.builtin.thingengine.builtin/manifest-expected.de.tt
diff -w -u ${test_skill_path}/dataset.de.tt $srcdir/test/data/builtins/org.thingpedia.builtin.thingengine.builtin/dataset-expected.de.tt

rm -fr $workdir
