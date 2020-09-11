geniedir = ../..
developer_key =
thingpedia_cli = thingpedia
thingpedia_url = https://thingpedia.stanford.edu/thingpedia

-include ./config.mk

memsize := 15000
genie = node --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/tool/genie.js

all_experiments = city university company
experiment ?= city

city_class = Q515
city_properties ?= P571,P138,P30,P17,P1376,P131,P206,P625,P6,P1082,P2927,P2044,P421,P190,P47,P2046,P281,P856,P41,P1538,P18,P610,P2936
city_required_properties ?= none

university_class = Q3918
university_properties ?= P6375,P1449,P571,P17,P856,P131,P576,P154,P18,P571,P138,P112,P488,P2828,P1451,P2124,P463,P2196,P2936,P2769,P281,P355,P1830
university_required_properties ?= none

company_class = Q783794
company_properties ?= P154,P452,P571,P138,P112,P169,P1037,P1451,P17,P463,P2403,P2137,P2139,P2295,P3362,P740,P127,P749,P159,P1128,P166,P1056,P856,P1581,P414
company_required_properties ?= none

eval_set ?= eval-synthetic

mode ?= default
default_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt --wikidata-labels
base_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt
manual_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt --wikidata-labels --manual
auto_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt
custom_process_schema_flags ?=

default_annotate_flags =
base_annotate_flags =
manual_annotate_flags = --skip
auto_annotate_flags = --algorithm bert,adj,bart --paraphraser-model ./models/paraphraser-bart
custom_annotate_flags ?=

template_file ?= thingtalk/en/thingtalk.genie
dataset_file ?= emptydataset.tt
synthetic_flags ?= \
	projection_with_filter \
	projection \
	aggregation \
	schema_org \
	filter_join \
	no_stream
generate_flags = $(foreach v,$(synthetic_flags),--set-flag $(v))

target_pruning_size ?= 500
maxdepth ?= 8

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

models/paraphraser-bart:
	mkdir models
	wget --no-verbose https://almond-static.stanford.edu/test-data/paraphraser-bart.tar.xz
	tar -C models -xvf paraphraser-bart.tar.xz

%/wikidata.tt: $(geniedir)/tool/autoqa/wikidata/process-schema.js
	mkdir -p $*/eval-synthetic
	touch $*/eval-synthetic/annotated.tsv
	$(genie) wikidata-process-schema -o $@ --entities $*/entities.json $($(mode)_process_schema_flags)\
	  --domains $($(*)_class) \
	  --properties $($(*)_properties) \
	  --required-properties $($(*)_required_properties)

emptydataset.tt:
	echo 'dataset @empty {}' > $@

shared-parameter-datasets.tsv:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-entity-values --manifest $@ --append-manifest -d shared-parameter-datasets
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-string-values --manifest $@ --append-manifest -d shared-parameter-datasets

%/parameter-datasets.tsv : %/wikidata.tt shared-parameter-datasets.tsv
	sed 's|\tshared-parameter-datasets|\t../shared-parameter-datasets|g' shared-parameter-datasets.tsv > $@
	$(genie) wikidata-make-string-datasets --manifest $@.local -d $*/parameter-datasets --thingpedia $*/wikidata.tt
	cat $@.local >> $@
	rm $@.local

%/constants.tsv: %/parameter-datasets.tsv %/wikidata.tt
	$(genie) sample-constants -o $@ --parameter-datasets $*/parameter-datasets.tsv --thingpedia $*/wikidata.tt --devices org.wikidata
	cat $(geniedir)/data/en-US/constants.tsv >> $@

%/manifest.tt: %/constants.tsv %/wikidata.tt %/parameter-datasets.tsv models/paraphraser-bart
	$(genie) auto-annotate -o $@.tmp --constants $*/constants.tsv --thingpedia $*/wikidata.tt --functions $(experiment) $($(mode)_annotate_flags) --parameter-datasets $*/parameter-datasets.tsv --dataset wikidata
	mv $@.tmp $@

%/synthetic.tsv: %/manifest.tt $(dataset_file) $(geniedir)/languages/thingtalk/en/*.genie
	$(genie) generate \
	  --template $(geniedir)/languages/$(template_file) \
	  --thingpedia $*/manifest.tt --entities $*/entities.json --dataset $(dataset_file) \
	  --target-pruning-size $(target_pruning_size) \
	  -o $@.tmp --no-debug $(generate_flags) --maxdepth $(maxdepth) \
	  --random-seed $@ --id-prefix $*:
	mv $@.tmp $@

%/augmented.tsv : %/synthetic.tsv %/parameter-datasets.tsv
	$(genie) augment -o $@.tmp -l en-US --thingpedia $*/manifest.tt --parameter-datasets $*/parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	  --debug $($(*)_paraphrase) $*/synthetic.tsv
	mv $@.tmp $@

datadir: $(experiment)/augmented.tsv
	mkdir -p $@
	if [ "$(eval_set)" = "eval-synthetic" ] ; then \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	  cp $@/eval.tsv $(experiment)/${eval_set}/annotated.tsv; \
	else \
	  cp $(experiment)/augmented.tsv $@/train.tsv ; \
	  cut -f1-3 $(experiment)/${eval_set}/annotated.tsv > $@/eval.tsv ; \
	fi
	touch $@

train:
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

evaluate: $(experiment)/$(eval_set)/annotated.tsv $(experiment)/manifest.tt
	$(genie) evaluate-server --url "file://$(abspath $(experiment)/models/$(model))" --thingpedia $(experiment)/manifest.tt $(experiment)/$(eval_set)/annotated.tsv --debug --csv-prefix $(eval_set) --csv --min-complexity 1 --max-complexity 3 -o $(experiment)/$(eval_set)/$(model).results.tmp | tee $(experiment)/$(eval_set)/$(model).debug
	mv $(experiment)/$(eval_set)/$(model).results.tmp $(experiment)/$(eval_set)/$(model).results

annotate: $(experiment)/manifest.tt
	$(genie) manual-annotate \
	  --server "file://$(abspath $(experiment)/models/$(model))" \
	  --thingpedia $(experiment)/manifest.tt \
	  --annotated $(experiment)/${eval_set}/annotated.tsv \
	  --dropped $(experiment)/${eval_set}/dropped.tsv \
	  $(experiment)/$(eval_set)/input.txt

clean:
	rm -rf datadir bert-canonical-annotator-in.json bert-canonical-annotator-out.json gpt2-paraphraser-in.tsv gpt2-paraphraser-out.json
	for exp in $(all_experiments) ; do \
		rm -rf $$exp/synthetic* $$exp/entities.json $$exp/parameter-datasets* $$exp/wikidata.tt $$exp/manifest.tt $$exp/augmented.tsv $$exp/constants.tsv $$exp/*.tmp; \
	done
