geniedir ?= ../..

-include ./arguments.config
-include ./config.mk

all: datadir

.PHONY: all
.SECONDARY:

$(experiment)/shared-parameter-datasets : $(bitoddir)/ontology_merged/en/ontology.json
	mkdir -p $@
	python3 scripts/convert_ontology.py --in_file $< --out_folder $@

$(experiment)/db : $(bitoddir)/db/exported/en/$(experiment)s.jsonl
	mkdir -p $@
	python3 scripts/convert_db.py --in_file $< --out_file $@/en/restaurant/database.json

$(experiment)/synthetic-%.txt : $(schema_deps) $(dataset_file)
	$(genie) generate-dialogs \
	  --locale en-US --target-language thingtalk \
	  --thingpedia $(experiment)/schema.tt --entities $(experiment)/entities.json --dataset $(dataset_file) \
	  -o $@.tmp -f txt $(generate_flags) --no-debug $(custom_gen_flags) --random-seed $@ \
	  -n $(target_size) -B $(minibatch_size)
	mv $@.tmp $@

$(experiment)/synthetic.txt: $(foreach v,$(subdataset_ids),$(experiment)/synthetic-$(v).txt)
	cat $^ > $@

$(experiment)/synthetic-%.user.tsv : $(experiment)/synthetic-%.txt $(schema_deps)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --deduplicate \
	  --thingpedia $(experiment)/schema.tt --side user --flags S --id-prefix $*: \
	  -o $@.tmp $<
	mv $@.tmp $@

$(experiment)/synthetic.user.tsv: $(foreach v,$(subdataset_ids),$(experiment)/synthetic-$(v).user.tsv)
	$(genie) deduplicate --contextual -o $@.tmp $^
	mv $@.tmp $@

$(experiment)/synthetic-%.agent.tsv : $(experiment)/synthetic-%.txt $(schema_deps)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --deduplicate \
	  --thingpedia $(experiment)/schema.tt --side agent --flags S --id-prefix $*: \
	  -o $@.tmp $<
	mv $@.tmp $@

$(experiment)/synthetic.agent.tsv: $(foreach v,$(subdataset_ids),$(experiment)/synthetic-$(v).agent.tsv)
	$(genie) deduplicate --contextual -o $@.tmp $^
	mv $@.tmp $@

$(experiment)/augmented.user.tsv : $(experiment)/synthetic.user.tsv $($(experiment)_paraphrase_user) shared-parameter-datasets.tsv
	$(genie) augment -o $@.tmp \
	  --locale en-US --target-language thingtalk --contextual \
	  --thingpedia $(experiment)/schema.tt --parameter-datasets shared-parameter-datasets.tsv \
	  --synthetic-expand-factor 2 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	   $($(experiment)_paraphrase_user) $(experiment)/synthetic.user.tsv --parallelize $(parallel)
	mv $@.tmp $@

# NOTE: there is no augmentation of agent sentences! The agent networks (policy & NLG) operate with QUOTED tokens exclusively

datadir/agent: $(experiment)/synthetic.agent.tsv $(experiment)/eval/agent.tsv
	mkdir -p $@
	cp $(experiment)/synthetic.agent.tsv $@/
	if test -s $(experiment)/eval/agent.tsv ; then \
	  cp $(experiment)/synthetic.agent.tsv $@/train.tsv ; \
	  cp $(experiment)/eval/agent.tsv $@/eval.tsv ; \
	else \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy raw-sentence \
	    --contextual --eval-on-synthetic $(experiment)/synthetic.agent.tsv ; \
	fi
	touch $@

datadir/user: $(experiment)/augmented.user.tsv $(experiment)/eval/user.tsv
	mkdir -p $@
	cp $(experiment)/synthetic.user.tsv $@/
	if test -s $(experiment)/eval/user.tsv ; then \
	  cp $(experiment)/augmented.user.tsv $@/train.tsv ; \
	  cp $(experiment)/eval/user.tsv $@/eval.tsv ; \
	else \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --contextual --eval-on-synthetic $(experiment)/augmented.user.tsv ; \
	fi
	touch $@

datadir: datadir/agent datadir/user $(foreach v,$(subdataset_ids),$(experiment)/synthetic-$(v).txt)
	cat $(experiment)/synthetic-*.txt > $@/synthetic.txt
	touch $@

clean:
	for exp in $(all_experiments) ; do \
		rm -rf $$exp/synthetic* $$exp/data.json $$exp/parameter-datasets* $$exp/augmented* $$exp/constants.tsv ; \
	done

$(experiment)/$(eval_set)/agent.tsv : $(experiment)/$(eval_set)/annotated.txt $(schema_deps)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --no-tokenized \
	  --thingpedia $(experiment)/schema.tt --side agent --flags E \
	  -o $@.tmp $<
	mv $@.tmp $@

$(experiment)/$(eval_set)/user.tsv : $(experiment)/$(eval_set)/annotated.txt $(schema_deps)
	$(genie) dialog-to-contextual \
	  --locale en-US --target-language thingtalk --no-tokenized \
	  --thingpedia $(experiment)/schema.tt --side user --flags E \
	  -o $@.tmp $<
	mv $@.tmp $@


train-user: datadir
	mkdir -p $(experiment)/models/$(model)
	ln -sf . datadir/almond
	genienlp train \
	  --no_commit \
	  --data datadir \
	  --embeddings .embeddings \
	  --save $(experiment)/models/$(model) \
	  --tensorboard_dir $(experiment)/models/$(model) \
	  --cache datadir/.cache \
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

evaluate: $(foreach v,$($(experiment)_$(eval_set)_nlu_models),$(experiment)/$(eval_set)/$(v).dialogue.results)
	for f in $^ ; do echo $$f ; cat $$f ; done

$(experiment)/$(eval_set)/%.dialogue.results: $(experiment)/models/%/best.pth $(experiment)/$(eval_set)/annotated.txt $(experiment)/schema.tt shared-parameter-datasets.tsv
	mkdir -p $(experiment)/$(eval_set)/$(dir $*)
	$(genie) evaluate-dialog \
	  --url "file://$(abspath $(dir $<))" \
	  --thingpedia $(experiment)/schema.tt \
	  --target-language thingtalk \
	  $(experiment)/$(eval_set)/annotated.txt \
	  --database-file $(experiment)/database-map.tsv \
	  --parameter-datasets shared-parameter-datasets.tsv \
	  --debug --csv-prefix $(eval_set) --csv $(evalflags) \
	  -o $@.tmp | tee $(experiment)/$(eval_set)/$*.dialogue.debug
	mv $@.tmp $@
