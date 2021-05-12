geniedir = ../..
developer_key =

experiment ?= country
thingpedia_url = https://thingpedia.stanford.edu/thingpedia

-include ./config.mk

memsize := 15000
genie = node --require ts-node/register --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js
all_experiments = city country star university company people artist athlete sports_team tv_series

city_class = Q515
city_canonical = city
city_required_properties ?= none

country_class = Q6256
country_canonical = country
country_required_properties ?= none

star_class = Q523
star_canonical = star
star_required_properties ?= none

university_class = Q3918
university_canonical = university
university_required_properties ?= none

company_class = Q783794
company_canonical = company
company_required_properties ?= none

people_class = Q5
people_canonical = people
people_required_properties ?= none

artist_class = Q5
artist_canonical = artist
artist_required_properties ?= P800

athlete_class = Q5
athlete_canonical = athlete
athlete_required_properties ?= P641

sports_team_class = Q12973014
sports_team_canonical = sports_team
sports_team_required_properties ?= none

tv_series_class = Q5398426
tv_series_canonical = tv_series
tv_series_required_properties ?= none

class = $($(experiment)_class)
canonical = $($(experiment)_canonical)

eval_set ?= eval

all_annotation_strategies = baseline auto manual
annotation ?= baseline

paraphraser_options ?= --paraphraser-model ./models/paraphraser-bart --batch-size 32

baseline_process_schemaorg_flags =
auto_process_schemaorg_flags =
manual_process_schemaorg_flags = --manual

baseline_annotate_flags =
auto_annotate_flags = --algorithms bart-paraphrase $(paraphraser_options)
manual_annotate_flags =

process_schemaorg_flags ?= $($(annotation)_process_schemaorg_flags)
annotate_flags ?= $($(annotation)_annotate_flags)

use_preprocessed_wikidata = true
use_csqa_valid = true
use_preprocessed_csqa_valid = 

annotate_with_entity_id = true

dataset_file ?= emptydataset.tt
synthetic_flags ?= \
	projection_with_filter \
	projection \
	aggregation \
	schema_org \
	filter_join \
	no_stream 
generate_flags = $(foreach v,$(synthetic_flags),--set-flag $(v)) $(if $(annotate_with_entity_id),--set-flag entity_id,)
custom_generate_flags ?=

target_pruning_size ?= 500
maxdepth ?= 8

model ?= 1
train_iterations ?= 20000
train_save_every ?= 2000
train_log_every ?= 100
train_batch_tokens ?= 400
val_batch_size ?= 3000
train_nlu_flags ?= \
	--model TransformerLSTM \
	--pretrained_model bert-base-cased \
	--trainable_decoder_embeddings 50 \
	--override_question . \
	--train_batch_tokens=$(train_batch_tokens) \
	--val_batch_size=$(val_batch_size)
custom_train_nlu_flags ?=

annotate_offset ?= 1

.PHONY: train evaluate annotate demo clean
.SECONDARY:

common-words.txt:
	curl -O https://almond-static.stanford.edu/test-data/common-words.txt

models/paraphraser-bart:
	mkdir -p models
	curl -O https://almond-static.stanford.edu/test-data/paraphraser-bart-large-speedup-megabatch-5m.tar.xz
	tar -C models -xvf paraphraser-bart.tar.xz

emptydataset.tt:
	echo 'dataset @empty {}' > $@

shared-parameter-datasets.tsv:
	$(genie) download-entity-values --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) \
	   --manifest $@ --append-manifest -d shared-parameter-datasets
	$(genie) download-string-values --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) \
	   --manifest $@ --append-manifest -d shared-parameter-datasets

%/items.json:
	curl https://almond-static.stanford.edu/research/csqa/$*/items.json --output $@ --create-dirs

%/predicates.json:
	curl https://almond-static.stanford.edu/research/csqa/$*/predicates.json --output $@ --create-dirs

%/values.json:
	curl https://almond-static.stanford.edu/research/csqa/$*/values.json --output $@ --create-dirs

%/types.json: 
	curl https://almond-static.stanford.edu/research/csqa/$*/types.json --output $@ --create-dirs

%/symmetric-properties.txt: 
	curl https://almond-static.stanford.edu/research/csqa/$*/symmetric-properties.txt --output $@ --create-dirs

raw/csqa-wikidata/filtered_property_wikidata4.json: 
	curl https://almond-static.stanford.edu/research/csqa/filtered_property_wikidata4.json --output $@ --create-dirs

raw/csqa-wikidata:
	curl https://zenodo.org/record/4052427/files/wikidata_proc_json.zip --output wikidata_proc_json.zip 
	mkdir -p raw/csqa-wikidata
	unzip wikidata_proc_json.zip
	mv 'wikidata_proc_json 2'/* raw/csqa-wikidata
	rm -r 'wikidata_proc_json 2'

%/parameter-datasets.tsv: shared-parameter-datasets.tsv raw/csqa-wikidata/filtered_property_wikidata4.json \
	                      $(if ${use_preprocessed_wikidata},%/items.json %/predicates.json %/values.json %/types.json %/symmetric-properties.txt,raw/csqa-wikidata)
	mkdir -p $*/parameter-datasets
	$(genie) wikidata-preprocess-data \
	  --domain $(class) \
	  --domain-canonical $(canonical) \
	  --wikidata raw/csqa-wikidata/wikidata_short_1.json raw/csqa-wikidata/wikidata_short_2.json \
	  --wikidata-entity-list raw/csqa-wikidata/items_wikidata_n.json \
	  --wikidata-property-list raw/csqa-wikidata/filtered_property_wikidata4.json \
	  --filtered-properties $*/properties.txt \
	  --symmetric-properties $*/symmetric-properties.txt \
	  --manifest $*/parameter-datasets.tsv.tmp \
	  --output-dir $*/parameter-datasets \
	  $(process_schemaorg_flags)
	mv $*/parameter-datasets.tsv.tmp $*/parameter-datasets.tsv
	sed -e "s|$(echo -e '\t')shared-parameter-datasets|$(echo -e '\t')../shared-parameter-datasets|g" shared-parameter-datasets.tsv >> $@

%/wikidata.tt: %/parameter-datasets.tsv $(geniedir)/tool/autoqa/wikidata/process-schema.js
	mkdir -p $(dir $@)
	$(genie) wikidata-process-schema  -o $@.tmp --entities $(experiment)/entities.json \
	  --domains $(class) \
	  --domain-canonicals $(canonical) \
	  --property-labels raw/csqa-wikidata/filtered_property_wikidata4.json \
	  --subtypes $*/subtypes.json \
	  --parameter-datasets $*/parameter-datasets.tsv \
	  --properties $(shell cat $*/properties.txt) \
	  $(process_schemaorg_flags)
	mv $@.tmp $@

%/constants.tsv: %/wikidata.tt %/parameter-datasets.tsv
	$(genie) sample-constants -o $@.tmp --parameter-datasets $*/parameter-datasets.tsv --thingpedia $*/wikidata.tt --devices org.wikidata
	cat $(geniedir)/data/en-US/constants.tsv >> $@.tmp
	mv $@.tmp $@

%/manifest.tt: %/wikidata.tt %/constants.tsv %/parameter-datasets.tsv $(if $(findstring auto,$(annotation)),models/paraphraser-bart,) common-words.txt
	$(genie) auto-annotate -o $@.tmp \
	  --constants $*/constants.tsv \
	  --thingpedia $*/wikidata.tt \
	  --functions $($(*)_canonical) \
	  $(annotate_flags) \
	  --parameter-datasets $*/parameter-datasets.tsv \
	  --dataset wikidata
	mv $@.tmp $@

%/synthetic.tsv: %/manifest.tt $(dataset_file)
	$(genie) generate \
	  --thingpedia $*/manifest.tt --entities $*/entities.json --dataset $(dataset_file) \
	  --target-pruning-size $(target_pruning_size) \
	  -o $@.tmp --no-debug $(generate_flags) $(custom_generate_flags) --maxdepth $(maxdepth) \
	  --random-seed $@ --id-prefix $*:
	mv $@.tmp $@

%/augmented.tsv: %/synthetic.tsv %/parameter-datasets.tsv %/manifest.tt
	$(genie) augment -o $@.tmp -l en-US --thingpedia $*/manifest.tt --parameter-datasets $*/parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	  $(if $(annotate_with_entity_id),--entity-id,) \
	  --debug $($(*)_paraphrase) $*/synthetic.tsv
	mv $@.tmp $@

raw/valid:
	mkdir -p raw
	curl -O https://almond-static.stanford.edu/research/csqa/valid.tar.xz
	tar -C raw -xf valid.tar.xz

raw/test:
	mkdir -p raw
	curl -O https://almond-static.stanford.edu/research/csqa/test.tar.xz
	tar -C raw -xf test.tar.xz

%/valid.json: 
	curl https://almond-static.stanford.edu/research/csqa/$*/valid.json  --output $*/valid.json

%/valid.tsv: %/manifest.tt $(if $(use_preprocessed_csqa_valid),%/valid.json,raw/valid)
	$(genie) wikidata-convert-csqa \
	  --domain $(class) \
	  --domain-canonical $(canonical) \
	  --input raw/valid \
	  --output $@\
	  --wikidata-property-list raw/csqa-wikidata/filtered_property_wikidata4.json \
	  --items $*/items.json \
	  --values $*/values.json \
	  --filtered-examples $*/valid.json \
	  $(if $(annotate_with_entity_id),--entity-id,)

%/valid_annotated.tsv: %/manifest.tt %/valid.tsv
	$(genie) typecheck -o $*/valid_annotated.tsv --dropped $*/valid_dropped.tsv --thingpedia $*/manifest.tt $*/valid.tsv $(if $(annotate_with_entity_id),--entity-id,)

%/valid/annotated.tsv: %/valid_annotated.tsv
	mkdir -p $*/valid
	cp $*/valid_annotated.tsv $*/valid/annotated.tsv

datadir: $(experiment)/augmented.tsv $(if $(use_csqa_valid),$(experiment)/valid_annotated.tsv,)
	mkdir -p $@
	mkdir -p $(experiment)/$(eval_set)

	if test -s $(experiment)/${eval_set}/annotated.tsv ; then \
	  cp $(experiment)/augmented.tsv $@/train.tsv ; \
	  cut -f1-3 $(experiment)/${eval_set}/annotated.tsv > $@/eval.tsv ; \
	elif [ "$(use_csqa_valid)" = "true" ] ; then \
	  cp $(experiment)/augmented.tsv $@/train.tsv ; \
	  cp $(experiment)/valid_annotated.tsv $@/eval.tsv; \
	  cp $(experiment)/valid_annotated.tsv $(experiment)/$(eval_set)/annotated.tsv;\
	else \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	  mkdir -p $(experiment)/$(eval_set) ; \
	  cp $@/eval.tsv $(experiment)/$(eval_set)/annotated.tsv; \
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
	  --train_iterations $(train_iterations) \
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
	  --offset $(annotate_offset) \
	  $(experiment)/$(eval_set)/input.txt

demo: $(experiment)/manifest.tt
	$(genie) wikidata-demo \
	  --manifest $(experiment)/manifest.tt \
	  --model "file://$(abspath $(experiment)/models/$(model))"

clean:
	rm -rf datadir valid.tar.xz test.tar.xz paraphraser-bart.tar.xz wikidata_proc_json.zip
	rm -f paraphraser-in.tsv paraphraser-out.json bert-canonical-annotator-in.json bert-canonical-annotator-out.json 
	for exp in $(all_experiments) ; do \
	  rm -rf $$exp/synthetic* $$exp/entities.json $$exp/parameter-datasets* $$exp/wikidata.tt $$exp/manifest.tt $$exp/augmented.tsv $$exp/constants.tsv $$exp/*.tmp; \
	  rm -rf $$exp/valid.json $$exp/valid.tsv $$exp/valid_dropped.tsv $$exp/valid_annotated.tsv;\
	done
