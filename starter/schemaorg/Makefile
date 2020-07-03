geniedir = ../..
developer_key =
thingpedia_cli = thingpedia
thingpedia_url = https://thingpedia.stanford.edu/thingpedia

-include ./config.mk

memsize := $(shell echo $$(($$(grep MemTotal /proc/meminfo | sed 's/[^0-9]//g')/1000-2500)))
genie = node --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/tool/genie.js

all_experiments = restaurants hotels linkedin recipes products books movies events music

experiment ?= restaurants

restaurants_class_name = org.schema.Restaurant
restaurants_white_list = Restaurant,Review
restaurants_paraphrase =

hotels_class_name = org.schema.Hotel
hotels_white_list = Hotel
hotels_paraphrase =

people_class_name = org.schema.Person
people_white_list = Person
people_paraphrase =

recipes_class_name = org.schema.Recipe
recipes_white_list = Recipe,Review
recipes_paraphrase =

products_class_name = org.schema.Product
products_white_list = Product
products_paraphrase =

books_class_name = org.schema.Book
books_white_list = Book
books_paraphrase =

movies_class_name = org.schema.Movie
movies_white_list = Movie
movies_paraphrase =

events_class_name = org.schema.Event
events_white_list = MusicEvent
events_paraphrase =

music_class_name = org.schema.Music
music_white_list = MusicRecording
music_paraphrase =

eval_set ?= eval

process_schemaorg_flags ?= --manual --wikidata-path ./wikidata-property-labels.json
update_canonical_flags ?= --algorithm bert,adj,bart --paraphraser-model ./models/paraphraser-bart
template_file ?= thingtalk/en/thingtalk.genie
dataset_file ?= emptydataset.tt
synthetic_flags ?= \
	projection_with_filter \
	projection \
	aggregation \
	schema_org \
	filter_join \
	multifilter \
	multifilters \
	no_stream
target_pruning_size ?= 1000
generate_flags = $(foreach v,$(synthetic_flags),--set-flag $(v))
evalflags ?=

model ?= 1
train_iterations ?= 100000
train_save_every ?= 2000
train_log_every ?= 100
train_nlu_flags ?= \
	--train_iterations=$(train_iterations) \
	--dimension=768 \
	--transformer_hidden=768 \
	--transformer_layers=0 \
	--rnn_layers=2 \
	--seq2seq_encoder=Identity \
	--rnn_zero_state=average \
	--context_embeddings=bert-base-uncased@0 \
	--question_embeddings=bert-base-uncased@1 \
	--trainable_encoder_embeddings=0 \
	--trainable_decoder_embeddings=25 \
	--train_context_embeddings \
	--train_context_embeddings_after=80000 \
	--decoder_embeddings= \
	--transformer_lr_multiply=0.5 \
	--train_batch_tokens=4000 \
	--val_batch_size=128
custom_train_nlu_flags ?=

.PHONY: all train evaluate
.SECONDARY:

wikidata-property-labels.json:
	$(genie) autoqa-retrieve-wikidata-labels > $@

models/paraphraser-bart:
	mkdir models
	wget https://almond-static.stanford.edu/test-data/paraphraser-bart.tar.xz
	tar -C models -xvf paraphraser-bart.tar.xz

$(experiment)/schema.org.tt: $(geniedir)/tool/autoqa/process-schemaorg.js ./wikidata-property-labels.json
	$(genie) autoqa-process-schemaorg -o $@ $(process_schemaorg_flags) --class-name $($(experiment)_class_name) --white-list $($(experiment)_white_list)

emptydataset.tt:
	echo 'dataset @empty {}' > $@

$(experiment)/data.json : $(experiment)/schema.org.tt source-data/$(experiment)/*.json $(geniedir)/tool/autoqa/normalize-data.js
	$(genie) autoqa-normalize-data --data-output $@ --thingpedia $(experiment)/schema.org.tt source-data/$(experiment)/*.json --class-name $($(experiment)_class_name)

$(experiment)/schema.trimmed.tt : $(experiment)/schema.org.tt $(experiment)/data.json
	$(genie) autoqa-trim-class --thingpedia $(experiment)/schema.org.tt -o $@ --data ./$(experiment)/data.json --entities $(experiment)/entities.json

$(experiment)/constants.tsv: $(experiment)/parameter-datasets.tsv $(experiment)/schema.trimmed.tt
	$(genie) sample-constants -o $@ --parameter-datasets $(experiment)/parameter-datasets.tsv --thingpedia $(experiment)/schema.trimmed.tt --devices $($(experiment)_class_name)
	cat $(geniedir)/data/en-US/constants.tsv >> $@

$(experiment)/schema.tt: $(experiment)/constants.tsv $(experiment)/schema.trimmed.tt $(experiment)/parameter-datasets.tsv models/paraphraser-bart
	$(genie) autogen-annotations -o $@.tmp --constants $(experiment)/constants.tsv --thingpedia $(experiment)/schema.trimmed.tt --queries $($(experiment)_white_list) $(update_canonical_flags) --parameter-datasets $(experiment)/parameter-datasets.tsv
	mv $@.tmp $@

$(experiment)/synthetic-d%.tsv: $(experiment)/schema.tt $(dataset_file) $(geniedir)/languages/thingtalk/en/*.genie
	$(genie) generate \
	  --template $(geniedir)/languages/$(template_file) \
	  --thingpedia $(experiment)/schema.tt --entities $(experiment)/entities.json --dataset $(dataset_file) \
	  --target-pruning-size $(target_pruning_size) \
	  -o $@.tmp $(generate_flags) --maxdepth $$(echo $* | cut -f1 -d'-') \
	  --random-seed $@ --id-prefix $*:
	mv $@.tmp $@

$(experiment)/synthetic.tsv : $(foreach v,1 2 3,$(experiment)/synthetic-d6-$(v).tsv) $(experiment)/synthetic-d8.tsv
	cat $^ > $@

shared-parameter-datasets.tsv:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-entity-values --manifest $@ --append-manifest -d shared-parameter-datasets
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-string-values --manifest $@ --append-manifest -d shared-parameter-datasets

$(experiment)/parameter-datasets.tsv : $(experiment)/schema.trimmed.tt $(experiment)/data.json shared-parameter-datasets.tsv
	sed 's|\tshared-parameter-datasets|\t../shared-parameter-datasets|g' shared-parameter-datasets.tsv > $@
	$(genie) autoqa-make-string-datasets --manifest $@.local -d $(experiment)/parameter-datasets --thingpedia $(experiment)/schema.trimmed.tt --data $(experiment)/data.json --class-name $($(experiment)_class_name)
	cat $@.local >> $@
	rm $@.local

$(experiment)/augmented.tsv : $($(experiment)_paraphrase) $(experiment)/synthetic.tsv $(experiment)/parameter-datasets.tsv
	$(genie) augment -o $@.tmp -l en-US --thingpedia $(experiment)/schema.tt --parameter-datasets $(experiment)/parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	  --debug $($(experiment)_paraphrase) $(experiment)/synthetic.tsv
	mv $@.tmp $@

datadir: $(experiment)/augmented.tsv $(experiment)/eval/annotated.tsv
	mkdir -p $@
	if test -s $(experiment)/eval/annotated.tsv ; then \
	  cp $(experiment)/augmented.tsv $@/train.tsv ; \
	  cut -f1-3 $(experiment)/eval/annotated.tsv $@/eval.tsv ; \
	else \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	fi
	touch $@

train: datadir
	mkdir -p $(experiment)/models/$(model)
	-rm datadir/almond
	ln -sf . datadir/almond
	genienlp train \
	  --no_commit \
	  --data datadir \
	  --embeddings .embeddings \
	  --save $(experiment)/models/$(model) \
	  --tensorboard_dir $(experiment)/models/$(model) \
	  --cache datadir/.cache \
	  --train_tasks almond \
	  --preserve_case \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  --skip_cache \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

clean:
	rm -rf bert-canonical-annotator-in.json bert-canonical-annotator-out.json gpt2-paraphraser-in.tsv gpt2-paraphraser-out.json synthetic-test.tsv
	for exp in $(all_experiments) ; do \
		rm -rf $$exp/synthetic* $$exp/data.json $$exp/entities.json $$exp/parameter-datasets* $$exp/schema.org.tt $$exp/schema.tt $$exp/schema.trimmed.tt $$exp/augmented.tsv $$exp/constants.tsv ; \
	done

$(experiment)/models/%/best.pth:
	mkdir -p $(experiment)/models/
	aws s3 sync --exclude '*/dataset/*' --exclude '*/cache/*' --exclude 'iteration_*.pth' --exclude '*_optim.pth' s3://geniehai/$(owner)/models/${project}/$(experiment)/$*/ $(experiment)/models/$*/

$(experiment)/$(eval_set)/%.results: $(experiment)/models/%/best.pth $(experiment)/$(eval_set)/annotated.tsv $(experiment)/schema.tt
	$(genie) evaluate-server --url "file://$(abspath $(dir $<))" --thingpedia $(experiment)/schema.tt $(experiment)/$(eval_set)/annotated.tsv --debug --csv-prefix $(eval_set) --csv $(evalflags) --max-complexity 3 -o $@.tmp | tee $(experiment)/$(eval_set)/$*.debug
	mv $@.tmp $@


