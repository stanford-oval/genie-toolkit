geniedir ?= ../..
developer_key =
thingpedia_cli = thingpedia
thingpedia_url = https://thingpedia.stanford.edu/thingpedia

-include ./config.mk

all_experiments = thingpedia custom

experiment ?= thingpedia

# per-experiment variables
thingpedia_paraphrase =
thingpedia_test_sets = eval
thingpedia_eval_models =
thingpedia_test_models =

custom_paraphrase =
custom_test_sets = eval
custom_eval_models =
custom_test_models =

# eval (dev) or test
eval_set ?= eval

template_file ?= thingtalk/en/thingtalk.genie
dataset_file ?= $(experiment)/dataset.tt
synthetic_flags ?= \
	aggregation \
	bookkeeping \
	configure_actions \
	policies \
	projection \
	projection_with_filter \
	remote_commands \
	timer \
	schema_org \
	screen_selection \
	undefined_filter
max_depth ?= 7
target_pruning_size ?= 500
generate_flags = --target-pruning-size $(target_pruning_size) $(foreach v,$(synthetic_flags),--set-flag $(v)) --maxdepth $(max_depth)
evalflags ?=

model ?= 1
train_iterations ?= 50000
train_save_every ?= 2000
train_log_every ?= 100
train_nlu_flags ?= \
	--model TransformerLSTM \
	--pretrained_model bert-base-cased \
	--trainable_decoder_embeddings 50 \
	--override_question .
custom_train_nlu_flags ?=

memsize := $(shell echo $$(($$(grep MemTotal /proc/meminfo | sed 's/[^0-9]//g')/1000-2500)))
NODE ?= node
genie ?= $(NODE) --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js

all: train

.PHONY: all train evaluate
.SECONDARY:

thingpedia/thingpedia.tt:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-snapshot -o $@

thingpedia/dataset.tt:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-templates -o $@

thingpedia/entities.json:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-entities -o $@

$(experiment)/synthetic.tsv : $(experiment)/thingpedia.tt $(experiment)/dataset.tt $(experiment)/entities.json $(geniedir)/languages-dist/thingtalk/en/*.genie.js
	$(genie) generate \
	  --template $(geniedir)/languages-dist/$(template_file) \
	  --thingpedia $(experiment)/thingpedia.tt --entities $(experiment)/entities.json --dataset $(experiment)/dataset.tt \
	  -o $@.tmp --no-debug $(generate_flags) --random-seed $@
	mv $@.tmp $@

shared-parameter-datasets.tsv:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-entity-values --manifest $@ --append-manifest -d shared-parameter-datasets
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-string-values --manifest $@ --append-manifest -d shared-parameter-datasets

$(experiment)/augmented.tsv : $($(experiment)_paraphrase) $(experiment)/synthetic.tsv shared-parameter-datasets.tsv
	$(genie) augment -o $@.tmp -l en-US --thingpedia $(experiment)/thingpedia.tt --parameter-datasets shared-parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.1 \
	  --debug $($(experiment)_paraphrase) $(experiment)/synthetic.tsv
	mv $@.tmp $@

datadir: $(experiment)/augmented.tsv $(experiment)/eval/annotated.tsv
	mkdir -p $@
	if test -s $(experiment)/eval/annotated.tsv ; then \
	  cp $(experiment)/augmented.tsv $@/train.tsv ; \
	  cut -f1-3 $(experiment)/eval/annotated.tsv > $@/eval.tsv ; \
	else \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	fi
	touch $@

clean:
	for exp in $(all_experiments) ; do \
		rm -rf $$exp/synthetic* $$exp/augmented.tsv $$exp/constants.tsv ; \
	done

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
	  --train_iterations $(train_iterations) \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  --skip_cache \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

evaluate: $(foreach v,$($(experiment)_$(eval_set)_models),$(experiment)/$(eval_set)/$(v).results)
	for f in $^ ; do echo $$f ; cat $$f ; done

$(experiment)/$(eval_set)/%.results: $(experiment)/models/%/best.pth $(experiment)/$(eval_set)/annotated.tsv $(experiment)/thingpedia.tt
	$(genie) evaluate-server --url "file://$(abspath $(dir $<))" --thingpedia $(experiment)/thingpedia.tt $(experiment)/$(eval_set)/annotated.tsv --debug --csv-prefix $(eval_set) --csv $(evalflags) --max-complexity 3 -o $@.tmp | tee $(experiment)/$(eval_set)/$*.debug
	mv $@.tmp $@

evaluate-all:
	for t in $($(experiment)_test_sets) ; do make eval_set=$$t evaluate ; done
