-include ./config.mk

# dev or test
eval_set ?= dev
# model to train or evaluate
model ?= 1

devices ?= $(foreach d,$(wildcard */manifest.tt),$(patsubst %/manifest.tt,%,$(d)))
pkgfiles = $(wildcard */package.json)

# hyperparameters that can be overridden on the cmdline
dataset_file ?= everything/dataset.tt
schema_file ?= everything/schema.tt
paraphrase_files ?= $(wildcard everything/paraphrase.tsv $(foreach d,$(devices),$(d)/eval/paraphrase.tsv))
eval_files ?= $(wildcard everything/$(eval_set)/annotated.txt $(foreach d,$(devices),$(d)/$(eval_set)/annotated.txt))
fewshot_files ?= $(wildcard everything/fewshot/annotated.txt $(foreach d,$(devices),$(d)/fewshot/annotated.txt))

synthetic_flags ?= \
	aggregation \
	bookkeeping \
	configure_actions \
	policies \
	projection \
	projection_with_filter \
	timer \
	schema_org \
	screen_selection \
	undefined_filter
	
max_depth ?= 7
target_pruning_size ?= 500
generate_flags = --target-pruning-size $(target_pruning_size) $(foreach v,$(synthetic_flags),--set-flag $(v)) --maxdepth $(max_depth)
evalflags ?=

train_iterations ?= 30000
train_save_every ?= 2000
train_log_every ?= 100
train_nlu_flags ?= \
	--model TransformerSeq2Seq \
	--pretrained_model facebook/bart-large \
	--lr_multiply 0.01 \
	--warmup 20 \
	--gradient_accumulation_steps 20 \
	--eval_set_name eval \
	--train_batch_tokens 2000 \
	--val_batch_size 4000 \
	--override_question= \
	--preserve_case \
	--preprocess_special_tokens
custom_train_nlu_flags ?=

geniedir ?= node_modules/genie-toolkit
memsize ?= 8500
parallel ?= 1
genie ?= node --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js

thingpedia_url ?= https://thingpedia.stanford.edu/thingpedia
developer_key ?= $(shell git config --get thingpedia.developer-key)


.PRECIOUS: %/node_modules
.PHONY: all clean lint train evaluate
.SECONDARY:

all: train

$(schema_file): $(addsuffix /manifest.tt,$(devices))
	cat $^ > $@.tmp
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

$(dataset_file): $(addsuffix /dataset.tt,$(devices))
	cat $^ > $@.tmp
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

entities.json:
	$(genie) download-entities --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) -o $@

everything/synthetic-%.tsv : $(schema_file) $(dataset_file) entities.json
	$(genie) generate \
	  --thingpedia $(schema_file) \
	  --dataset $(dataset_file) \
	  --entities entities.json \
	  --maxdepth $$(echo $* | cut -f1 -d'-') \
	  -o $@.tmp \
	  --no-debug \
	  --random-seed $@ \
	  $(generate_flags) \
	  $(custom_gen_flags) 
	mv $@.tmp $@

everything/synthetic.tsv: $(foreach v,1 2 3,everything/synthetic-d6-$(v).tsv) everything/synthetic-d$(maxdepth).tsv
	cat $^ > $@

parameter_dataset_url = https://almond-static.stanford.edu/test-data/parameter-datasets-en-US-20211206.tar.xz
parameter-datasets.tsv:
	wget --no-verbose $(parameter_dataset_url) -O parameter-datasets.tar.xz
	tar xf parameter-datasets.tar.xz

everything/augmented.tsv : $(paraphrase_files) everything/synthetic.tsv $(schema_file) entities.json parameter-datasets.tsv
	$(genie) augment \
	  -o $@.tmp \
	  -l en-US \
	  --thingpedia $(schema_file) \
	  --entities entities.json \
	  --parameter-datasets parameter-datasets.tsv \
	  --synthetic-expand-factor 1 \
	  --quoted-paraphrasing-expand-factor 60 \
	  --no-quote-paraphrasing-expand-factor 20 \
	  --quoted-fraction 0.1 \
	  --debug \
	  $(paraphrase_files) everything/synthetic.tsv 
	mv $@.tmp $@

everything/eval/annotated.tsv: $(addsuffix /$(eval_set)/annotated.tsv,$(devices))
	cat $^ > $@.tmp
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

datadir: everything/augmented.tsv everything/eval/annotated.tsv
	mkdir -p $@
	if test -s everything/eval/annotated.tsv ; then \
	  cp everything/augmented.tsv $@/train.tsv ; \
	  cut -f1-3 everything/eval/annotated.tsv > $@/eval.tsv ; \
	else \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv.tmp \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic everything/augmented.tsv ; \
	  $(genie) typecheck \
	    -o $@/eval.tsv \
		--dropped $@/eval-dropped.tsv \
		--thingpedia $(schema_file) \
		$@/eval.tsv.tmp ; \
	  cp $@/eval.tsv everything/eval/annotated.tsv ; \
	fi
	touch $@

clean:
	rm -fr entities.json
	rm -rf everything/schema*.tt everything/dataset.tt everything/synthetic* parameter-datasets* everything/augmented*

train: datadir
	mkdir -p everything/models/$(model)
	-rm datadir/almond
	ln -sf . datadir/almond
	genienlp train \
	  --no_commit \
	  --data datadir \
	  --embeddings .embeddings \
	  --save everything/models/$(model) \
	  --tensorboard_dir everything/models/$(model) \
	  --train_tasks almond \
	  --preserve_case \
	  --train_iterations $(train_iterations) \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

everything/eval/%.results: everything/models/%/best.pth everything/eval/annotated.tsv $(schema_file)
	$(genie) evaluate-server \
	  --url "file://$(abspath $(dir $<))" \
	  --thingpedia $(schema_file) \
	  everything/eval/annotated.tsv \
	  --debug \
	  --csv-prefix $(eval_set) \
	  --csv \
	  $(evalflags) \
	  --max-complexity 3 \
	  -o $@.tmp | tee everything/eval/$*.debug
	mv $@.tmp $@

evaluate: everything/eval/$(model).results
	@cat everything/eval/$(model).results

