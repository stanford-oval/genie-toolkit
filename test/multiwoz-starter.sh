#!/bin/bash

# Test the schema.org starter code.

. $(dirname $0)/common.sh
do_setup
#trap on_error ERR INT TERM

# copy over the starting code
cp -r $srcdir/starter/multiwoz/* .

# set some configuration
cat > config.mk <<EOF
geniedir = ${srcdir}
EOF

# make a dataset (a small one)
make experiment=multidomain subdatasets=1 max_turns=3 target_pruning_size=10 datadir

# train a model (for a few iterations)
make experiment=multidomain model=small train_iterations=4 train_save_every=2 \
  train_log_every=2 custom_train_nlu_flags="--train_batch_tokens 100 --val_batch_size 100" \
  train_pretrained_model=sshleifer/bart-tiny-random train-user

# get some sample data to test with
cat > restaurant/eval/annotated.txt <<'EOF'
====
# SNG0494.json
U: i would like a restaurant in the north with expensive food .
UT: $dialogue @org.thingpedia.dialogue.transaction.execute; now => (@uk.ac.cam.multiwoz.Restaurant.Restaurant()), (area == enum(north) && price_range == enum(expensive)) => notify;
C: $dialogue @org.thingpedia.dialogue.transaction.execute;
C: now => (@uk.ac.cam.multiwoz.Restaurant.Restaurant()), (area == enum(north) && price_range == enum(expensive)) => notify
C: #[results=[
C:   { address="22 Chesterton Road Chesterton", area=enum(north), food="french", id="19264"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("restaurant two two"), phone="01223351880"^^tt:phone_number, postcode="cb43ax", price_range=enum(expensive) },
C:   { address="Milton Road Chesterton", area=enum(north), food="chinese", id="19260"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("hakka"), phone="01223568988"^^tt:phone_number, postcode="cb41jy", price_range=enum(expensive) },
C:   { address="Cambridge City Football Club Milton Road Chesterton", area=enum(north), id="19262"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("city stop restaurant"), phone="01223363270"^^tt:phone_number, postcode="cb41uy", food="european", price_range=enum(expensive) },
C:   { address="169 High Street Chesterton Chesterton", area=enum(north), food="asian oriental", id="19261"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("saigon city"), phone="01223356555"^^tt:phone_number, postcode="cb41nl", price_range=enum(expensive) },
C:   { address="66 Chesterton Road Chesterton", area=enum(north), food="chinese", id="19258"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("hotpot"), phone="01223366552"^^tt:phone_number, postcode="cb41ep", price_range=enum(expensive) }
C: ]];
A: there are 5 places , which type of food do you prefer ?
AT: $dialogue @org.thingpedia.dialogue.transaction.sys_search_question(food);
U: surprise me , i just want something pricey to impress my friends . it ll be a party of 7 .
UT: $dialogue @org.thingpedia.dialogue.transaction.execute; now => @uk.ac.cam.multiwoz.Restaurant.make_reservation(book_day=$?, book_people=7, book_time=$?, restaurant=$?);
C: $dialogue @org.thingpedia.dialogue.transaction.execute;
C: now => (@uk.ac.cam.multiwoz.Restaurant.Restaurant()), (area == enum(north) && price_range == enum(expensive)) => notify
C: #[results=[
C:   { address="22 Chesterton Road Chesterton", area=enum(north), food="french", id="19264"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("restaurant two two"), phone="01223351880"^^tt:phone_number, postcode="cb43ax", price_range=enum(expensive) },
C:   { address="Milton Road Chesterton", area=enum(north), food="chinese", id="19260"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("hakka"), phone="01223568988"^^tt:phone_number, postcode="cb41jy", price_range=enum(expensive) },
C:   { address="Cambridge City Football Club Milton Road Chesterton", area=enum(north), id="19262"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("city stop restaurant"), phone="01223363270"^^tt:phone_number, postcode="cb41uy", food="european", price_range=enum(expensive) },
C:   { address="169 High Street Chesterton Chesterton", area=enum(north), food="asian oriental", id="19261"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("saigon city"), phone="01223356555"^^tt:phone_number, postcode="cb41nl", price_range=enum(expensive) },
C:   { address="66 Chesterton Road Chesterton", area=enum(north), food="chinese", id="19258"^^uk.ac.cam.multiwoz.Restaurant:Restaurant("hotpot"), phone="01223366552"^^tt:phone_number, postcode="cb41ep", price_range=enum(expensive) }
C: ]];
C: now => @uk.ac.cam.multiwoz.Restaurant.make_reservation(book_day=$?, book_people=7, book_time=$?, restaurant=$?);
A: i found 5 restaurants , what day and time would you like to go ?
AT: $dialogue @org.thingpedia.dialogue.transaction.sys_slot_fill(book_day, book_time); now => @uk.ac.cam.multiwoz.Restaurant.make_reservation(book_day=$?, book_people=7, book_time=$?, restaurant=$?);
U: how about monday at 19:15 .
UT: $dialogue @org.thingpedia.dialogue.transaction.execute; now => @uk.ac.cam.multiwoz.Restaurant.make_reservation(book_day=enum(monday), book_people=7, book_time=new Time(19, 15), restaurant=$?);
EOF

# evaluate
sed -i 's/multidomain_eval_nlu_models =/multidomain_eval_nlu_models = small/' Makefile
make experiment=multidomain eval_set=eval evaluate

rm -fr $workdir
