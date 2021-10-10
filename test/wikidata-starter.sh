#!/bin/bash

# Test the wikidata starter code.

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/wikidata/* .
cat > domains.tsv <<EOF
administrative_territorial_entity	Q56061	Q515:city:232	Q515:city:232 Q532:village:10
EOF

cat > bootleg-types.json <<EOF
{}
EOF

cat > bootleg-type-canonicals.json <<EOF
{}
EOF

# download a smaller version of wikidata for testing
mkdir -p raw/wikidata-small
wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb-small/filtered_property_wikidata4.json -P raw/wikidata-small
wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb-small/wikidata_short_1.json -P raw/wikidata-small
wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb-small/wikidata_short_2.json -P raw/wikidata-small
wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb-small/items_wikidata_n.json -P raw/wikidata-small

# generate & train
touch domains.tsv bootleg-types.json bootleg-type-canonicals.json
starter_gen_and_train wikidata city annotation=baseline wikidata_dir=raw/wikidata-small train_batch_tokens=100 val_batch_size=500

# evaluate
make experiment=city model=small evaluate

rm -fr $workdir
