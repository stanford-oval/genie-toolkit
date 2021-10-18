#!/bin/bash

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

genie="node $srcdir/dist/tool/genie.js"

# create English pot
npm run create-pot custom_skills=org.thingpedia.weather custom_path=$srcdir/test/data/main/

# translate English pot to German
npm run translate-po val_batch_size=100 temperature=0.0 skip_po_creation=false tgt_lang=de non_interactive=true

# translate weather English schema.tt and dataset.tt to German
${genie} translate-schema-annotations --po-file $srcdir/po/de.po -o $srcdir/test/data/main/org.thingpedia.weather/manifest.de.tt $srcdir/test/data/main/org.thingpedia.weather/manifest.tt
${genie} translate-schema-annotations --po-file $srcdir/po/de.po -o $srcdir/test/data/main/org.thingpedia.weather/dataset.de.tt $srcdir/test/data/main/org.thingpedia.weather/dataset.tt

# check diff with expected results
diff -u $srcdir/test/data/main/org.thingpedia.weather/manifest.de.tt $srcdir/test/data/main/org.thingpedia.weather/manifest-expected.de.tt
diff -u $srcdir/test/data/main/org.thingpedia.weather/dataset.de.tt $srcdir/test/data/main/org.thingpedia.weather/dataset-expected.de.tt

rm -fr $workdir
