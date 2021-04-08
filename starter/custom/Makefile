-include ./config.mk

NULL =

# dev or test
eval_set ?= dev
# model to train or evaluate
model ?=

devices ?= $(foreach d,$(wildcard */manifest.tt),$(patsubst %/manifest.tt,%,$(d)))
pkgfiles = $(wildcard */package.json)

# hyperparameters that can be overridden on the cmdline
template_file ?= thingtalk/en/dialogue.genie
dataset_file ?= everything/dataset.tt
schema_file ?= everything/schema.tt
paraphrases_user ?= $(wildcard everything/paraphrase.tsv $(foreach d,$(devices),$(d)/eval/paraphrase.tsv))
eval_files ?= $(wildcard everything/$(eval_set)/annotated.txt $(foreach d,$(devices),$(d)/eval/$(eval_set)/annotated.txt))
fewshot_train_files ?= $(wildcard everything/train/annotated.txt $(foreach d,$(devices),$(d)/eval/train/annotated.txt))

synthetic_flags ?= \
	dialogues \
	aggregation \
	multifilters \
	nostream \
	notablejoin \
	projection \
	projection_with_filter \
	schema_org \
	undefined_filter \
	$(NULL)

target_pruning_size ?= 250
minibatch_size ?= 1000
target_size ?= 1
subdatasets ?= 6
subdataset_ids := $(shell seq 1 $(subdatasets))
max_turns ?= 4
max_depth ?= 8
debug_level ?= 1
subsample_thingpedia ?= 1
update_canonical_flags ?= --algorithm bert,adj,bart --paraphraser-model ./models/paraphraser-bart
synthetic_expand_factor ?= 1
quoted_paraphrase_expand_factor ?= 25
noquote_paraphrase_expand_factor ?= 1
quoted_fraction ?= 0.05

generate_flags ?= $(foreach v,$(synthetic_flags),--set-flag $(v)) --target-pruning-size $(target_pruning_size) --max-turns $(max_turns) --maxdepth $(max_depth)
custom_gen_flags ?=

template_deps = \
	$(geniedir)/languages-dist/thingtalk/*.js \
	$(geniedir)/languages-dist/thingtalk/en/*.js \
	$(geniedir)/languages-dist/thingtalk/en/dlg/*.js \
	$(geniedir)/languages-dist/thingtalk/dialogue_acts/*.js

train_iterations ?= 50000
train_save_every ?= 2000
train_log_every ?= 100
train_pretrained_model ?= facebook/bart-large
train_nlu_flags ?= \
	--model TransformerSeq2Seq \
	--pretrained_model $(train_pretrained_model) \
	--warmup 20 --gradient_accumulation_steps 20 \
	--preprocess_special_tokens
custom_train_nlu_flags ?=

evalflags ?=

# configuration (should be set in config.mk)
eslint ?= node_modules/.bin/eslint

geniedir ?= node_modules/genie-toolkit
memsize ?= 8500
parallel ?= 7
genie ?= node --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js

thingpedia_url ?= https://dev.almond.stanford.edu/thingpedia
developer_key ?= invalid

.PRECIOUS: %/node_modules
.PHONY: all clean lint train-user evaluate
.SECONDARY:

all: $(pkgfiles:%/package.json=build/%.zip)
	@:

build/%.zip: % %/node_modules
	mkdir -p `dirname $@`
	cd $< ; zip -x '*.tt' '*.yml' 'node_modules/.bin/*' 'icon.png' 'secrets.json' 'eval/*' 'simulation/*' 'database-map.tsv' -r $(abspath $@) .

%/node_modules: %/package.json %/package-lock.json
	mkdir -p $@
	cd `dirname $@` ; npm install --only=prod --no-optional
	touch $@

%: %/package.json %/*.js %/node_modules
	touch $@

$(schema_file): $(addsuffix /manifest.tt,$(devices))
	cat $^ > $@.tmp
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

$(dataset_file): $(addsuffix /dataset.tt,$(devices))
	cat $^ > $@.tmp
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

everything/database-map.tsv: $(wildcard $(addsuffix /database-map.tsv,$(devices)))
	touch $@.tmp
	for f in $^ ; do \
	  sed 's|\t|\t../../'`dirname $$f`'/|g' $$f >> $@.tmp ; \
	done
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

entities.json:
	$(genie) download-entities --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) -o $@

parameter-datasets.tsv:
	$(genie) download-entity-values --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) \
	   --manifest $@.tmp --append-manifest -d parameter-datasets
	$(genie) download-string-values --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) \
	   --manifest $@.tmp --append-manifest -d parameter-datasets
	mv $@.tmp $@

.embeddings/paraphraser-bart:
	mkdir -p .embeddings
	wget -c --no-verbose https://almond-static.stanford.edu/test-data/paraphraser-bart.tar.xz
	tar -C .embeddings -xvf paraphraser-bart.tar.xz

everything/synthetic-%.txt : $(schema_file) $(dataset_file) $(template_deps) entities.json
	if test $(subsample_thingpedia) = 1 ; then \
	  cp $(schema_file) everything/schema-$*.tt ; \
	else \
	  $(genie) subsample-thingpedia \
	    -o everything/schema-$*.tt \
	    --fraction $(subsample_thingpedia) \
	    --random-seed $@ \
	    $(schema_file) ; \
	fi
	$(genie) generate-dialogs \
	  --locale en-US --target-language thingtalk \
	  --template $(geniedir)/languages-dist/$(template_file) \
	  --thingpedia everything/schema-$*.tt --entities entities.json --dataset $(dataset_file) \
	  -o $@.tmp -f txt $(generate_flags) --debug $(debug_level) $(custom_gen_flags) --random-seed $@ \
	  -n $(target_size) -B $(minibatch_size)
	mv $@.tmp $@

everything/synthetic.txt: $(foreach v,$(subdataset_ids),everything/synthetic-$(v).txt)
	cat $^ > $@

everything/synthetic-%.user.tsv : everything/synthetic-%.txt $(schema_file)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --deduplicate \
	  --thingpedia $(schema_file) --side user --flags S --id-prefix $*: \
	  -o $@.tmp $<
	mv $@.tmp $@

everything/synthetic.user.tsv: $(foreach v,$(subdataset_ids),everything/synthetic-$(v).user.tsv)
	$(genie) deduplicate --contextual -o $@.tmp $^
	mv $@.tmp $@

everything/synthetic-%.agent.tsv : everything/synthetic-%.txt $(schema_file)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --deduplicate \
	  --thingpedia $(schema_file) --side agent --flags S --id-prefix $*: \
	  -o $@.tmp $<
	mv $@.tmp $@

everything/synthetic.agent.tsv: $(foreach v,$(subdataset_ids),everything/synthetic-$(v).agent.tsv)
	$(genie) deduplicate --contextual -o $@.tmp $^
	mv $@.tmp $@

everything/augmented.user.tsv : everything/synthetic.user.tsv $(schema_file) $(paraphrases_user) parameter-datasets.tsv
	$(genie) augment -o $@.tmp \
	  --locale en-US \
	  --target-language thingtalk --contextual \
	  --thingpedia $(schema_file) \
	  --parameter-datasets parameter-datasets.tsv \
	  --synthetic-expand-factor $(synthetic_expand_factor) \
	  --quoted-paraphrasing-expand-factor $(quoted_paraphrase_expand_factor) \
	  --no-quote-paraphrasing-expand-factor $(noquote_paraphrase_expand_factor) \
	  --quoted-fraction $(quoted_fraction) \
	  --debug \
	  --parallelize $(parallel) \
	  $(paraphrases_user) $<
	mv $@.tmp $@

everything/augmented.agent.tsv : everything/synthetic.agent.tsv $(schema_file) $(paraphrases_agent) parameter-datasets.tsv
	$(genie) augment -o $@.tmp \
	  --locale en-US \
	  --target-language thingtalk --contextual \
	  --thingpedia $(schema_file) \
	  --parameter-datasets parameter-datasets.tsv \
	  --synthetic-expand-factor $(synthetic_expand_factor) \
	  --quoted-paraphrasing-expand-factor $(quoted_paraphrase_expand_factor) \
	  --no-quote-paraphrasing-expand-factor $(noquote_paraphrase_expand_factor) \
	  --quoted-fraction $(quoted_fraction) \
	  --debug \
	  --parallelize $(parallel) \
	  $(paraphrases_agent) $<
	mv $@.tmp $@

everything/$(eval_set)/agent.tsv : $(eval_files) $(schema_file)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --no-tokenized \
	  --thingpedia $(schema_file) --side agent --flags E \
	  -o $@.tmp $(eval_files)
	mv $@.tmp $@

everything/$(eval_set)/user.tsv : $(eval_files) $(schema_file)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --no-tokenized \
	  --thingpedia $(schema_file) --side user --flags E \
	  -o $@.tmp $(eval_files)
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

everything/train/user.tsv : $(fewshot_train_files) $(schema_file)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --no-tokenized \
	  --thingpedia $(schema_file) --side user \
	  -o $@.tmp $(fewshot_train_files)
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

everything/train/agent.tsv : $(fewshot_train_files) $(schema_file)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --no-tokenized \
	  --thingpedia $(schema_file) --side agent \
	  -o $@.tmp $(fewshot_train_files)
	if test -f $@ && cmp $@.tmp $@ ; then rm $@.tmp ; else mv $@.tmp $@ ; fi

everything/$(eval_set)/%.dialogue.results: everything/models/%/best.pth $(eval_files) $(schema_file) everything/database-map.tsv parameter-datasets.tsv
	mkdir -p everything/$(eval_set)/$(dir $*)
	$(genie) evaluate-dialog \
	  --url "file://$(abspath $(dir $<))" \
	  --thingpedia $(schema_file) \
	  --target-language thingtalk \
	  --database-file everything/database-map.tsv \
	  --parameter-datasets parameter-datasets.tsv \
	  --debug --csv-prefix $(eval_set) --csv $(evalflags) \
	  -o $@.tmp $(eval_files) > everything/$(eval_set)/$*.dialogue.debug.tmp
	mv everything/$(eval_set)/$*.dialogue.debug.tmp everything/$(eval_set)/$*.dialogue.debug
	mv $@.tmp $@

everything/$(eval_set)/%.nlu.results: everything/models/%/best.pth everything/$(eval_set)/user.tsv $(schema_file)
	mkdir -p everything/$(eval_set)/$(dir $*)
	$(genie) evaluate-server \
	  --url "file://$(abspath $(dir $<))" \
	  --thingpedia $(schema_file) -l en-US \
	  --contextual \
	  --split-by-device --complexity-metric turn_number --max-complexity 3 \
	  --debug --csv-prefix $(eval_set) --csv $(evalflags) \
	  -o $@.tmp everything/$(eval_set)/user.tsv > everything/$(eval_set)/$*.nlu.debug.tmp
	mv everything/$(eval_set)/$*.nlu.debug.tmp everything/$(eval_set)/$*.nlu.debug
	mv $@.tmp $@

datadir/agent: everything/synthetic.agent.tsv everything/augmented.agent.tsv everything/dev/agent.tsv
	mkdir -p $@
	cp everything/synthetic.agent.tsv $@/
	cp everything/augmented.agent.tsv $@/train.tsv ; \
	cp everything/dev/agent.tsv $@/eval.tsv ; \
	touch $@

datadir/nlg: everything/synthetic.agent.tsv everything/dev/agent.tsv
	mkdir -p $@
	cp everything/synthetic.agent.tsv $@/train.tsv ; \
	cp everything/dev/agent.tsv $@/eval.tsv ; \
	touch $@

datadir/user: everything/synthetic.user.tsv everything/augmented.user.tsv everything/dev/user.tsv
	mkdir -p $@
	cp everything/synthetic.user.tsv $@/
	cp everything/augmented.user.tsv $@/train.tsv ; \
	cp everything/dev/user.tsv $@/eval.tsv ; \
	touch $@

datadir/fewshot: everything/train/user.tsv everything/dev/user.tsv everything/train/agent.tsv everything/dev/agent.tsv
	mkdir -p $@/user $@/agent
	cp everything/train/user.tsv $@/user/train.tsv
	cp everything/dev/user.tsv $@/user/eval.tsv
	cp everything/train/agent.tsv $@/agent/train.tsv
	cp everything/dev/agent.tsv $@/agent/eval.tsv
	touch $@

datadir: datadir/agent datadir/nlg datadir/user datadir/fewshot $(foreach v,$(subdataset_ids),everything/synthetic-$(v).txt)
	cat everything/synthetic-*.txt > $@/synthetic.txt
	$(genie) measure-training-set $@ > $@/stats
	touch $@

clean:
	rm -fr build/
	rm -fr entities.json
	rm -rf everything/schema*.tt everything/dataset.tt everything/synthetic* parameter-datasets* everything/augmented*

lint:
	any_error=0 ; \
	for d in $(devices) ; do \
		echo $$d ; \
		$(genie) lint-device --thingpedia-url $(thingpedia_url) --manifest $$d/manifest.tt --dataset $$d/dataset.tt || any_error=$$? ; \
		test ! -f $$d/package.json || $(eslint) $$d/*.js || any_error=$$? ; \
	done ; \
	exit $$any_error

train-user:
	mkdir -p everything/models/$(model)
	-rm datadir/almond
	ln -sf . datadir/almond
	genienlp train \
	  --no_commit \
	  --data datadir \
	  --save everything/models/$(model) \
	  --tensorboard_dir everything/models/$(model) \
	  --train_tasks almond_dialogue_nlu \
	  --preserve_case \
	  --train_iterations $(train_iterations) \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  --skip_cache \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

evaluate: everything/$(eval_set)/$(model).dialogue.results everything/$(eval_set)/$(model).nlu.results
	@echo everything/$(eval_set)/$(model).dialogue.results
	@cat everything/$(eval_set)/$(model).dialogue.results
