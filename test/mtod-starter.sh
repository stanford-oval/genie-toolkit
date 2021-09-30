#!/bin/bash

# Test the schema.org starter code.

. $(dirname $0)/common.sh
do_setup
#trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/mtod/* .

# set some configuration
cat > config.mk <<EOF
geniedir = ${srcdir}
EOF

# make a dataset (a small one)
make -B experiment=restaurant subdatasets=1 max_turns=3 target_pruning_size=10 datadir

# train a model (for a few iterations)
make experiment=restaurant model=small train_iterations=4 train_save_every=2 \
  train_log_every=2 custom_train_nlu_flags="--train_batch_tokens 100 --val_batch_size 500" \
  train_pretrained_model=sshleifer/bart-tiny-random train-user

# get some sample data to test with
cat > restaurant/eval/annotated.txt <<'EOF'
====
# 654
U: hi ! make reservation .
UT: $dialogue @org.thingpedia.dialogue.transaction.execute;
UT: @mtod.Restaurant.Restaurant();
UT: @mtod.Restaurant.make_reservation();
C: $dialogue @org.thingpedia.dialogue.transaction.execute;
C: @mtod.Restaurant.Restaurant()
C: #[results=[
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="str:QUOTED_STRING::17:", price_level=enum moderate, dietary_restrictions=enum kosher, rating=2, location="str:QUOTED_STRING::33:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum vegan, rating=9, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum kosher, rating=2, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum cheap, dietary_restrictions=enum vegetarian_friendly, rating=2, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum moderate, dietary_restrictions=enum gluten_free, rating=2, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="str:QUOTED_STRING::39:", price_level=enum moderate, dietary_restrictions=enum gluten_free, rating=3, location="str:QUOTED_STRING::14:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum vegan, rating=2, location="str:QUOTED_STRING::9:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="str:QUOTED_STRING::3:", price_level=enum moderate, dietary_restrictions=enum halal, rating=2, location="str:QUOTED_STRING::45:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum moderate, dietary_restrictions=enum halal, rating=8, location="str:QUOTED_STRING::20:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum kosher, rating=3, location="str:QUOTED_STRING::34:" }
C: ]]
C: #[count=50]
C: #[more=true];
C: @mtod.Restaurant.make_reservation();
A: i have GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 or GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 .
AT: $dialogue @org.thingpedia.dialogue.transaction.sys_recommend_two;
AT: @mtod.Restaurant.make_reservation();
U: what 's your favorite ?
UT: $dialogue @org.thingpedia.dialogue.transaction.ask_recommend;
UT: @mtod.Restaurant.make_reservation();
C: $dialogue @org.thingpedia.dialogue.transaction.ask_recommend;
C: @mtod.Restaurant.Restaurant()
C: #[results=[
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="str:QUOTED_STRING::17:", price_level=enum moderate, dietary_restrictions=enum kosher, rating=2, location="str:QUOTED_STRING::33:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum vegan, rating=9, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum kosher, rating=2, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum cheap, dietary_restrictions=enum vegetarian_friendly, rating=2, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum moderate, dietary_restrictions=enum gluten_free, rating=2, location="mtod.Restaurant" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="str:QUOTED_STRING::39:", price_level=enum moderate, dietary_restrictions=enum gluten_free, rating=3, location="str:QUOTED_STRING::14:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum vegan, rating=2, location="str:QUOTED_STRING::9:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="str:QUOTED_STRING::3:", price_level=enum moderate, dietary_restrictions=enum halal, rating=2, location="str:QUOTED_STRING::45:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum moderate, dietary_restrictions=enum halal, rating=8, location="str:QUOTED_STRING::20:" },
C:   { id="str:ENTITY_mtod.Restaurant:Restaurant::0:"^^mtod.Restaurant:Restaurant, cuisine="mtod.Restaurant", price_level=enum expensive, dietary_restrictions=enum kosher, rating=3, location="str:QUOTED_STRING::34:" }
C: ]]
C: #[count=50]
C: #[more=true];
C: @mtod.Restaurant.make_reservation();
A: i see GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 , or GENERIC_ENTITY_mtod.Restaurant:Restaurant_0 .
AT: $dialogue @org.thingpedia.dialogue.transaction.sys_recommend_many;
AT: @mtod.Restaurant.make_reservation();
U: i would like to see its type of food .
UT: $dialogue @org.thingpedia.dialogue.transaction.execute;
UT: [cuisine] of @mtod.Restaurant.Restaurant();
UT: @mtod.Restaurant.make_reservation();
EOF

# evaluate
make experiment=restaurant restaurant_eval_nlu_models=small eval_set=eval evaluate

rm -fr $workdir
