geniedir = ../..
developer_key =

experiment ?= country
thingpedia_url = https://thingpedia.stanford.edu/thingpedia

-include ./config.mk

memsize := 15000
genie = node --require ts-node/register --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js
all_experiments = city country star university company people artist athlete sports-team tv-series

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

eval_set ?= eval_synthetic

mode ?= default
default_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt --wikidata-labels
base_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt
manual_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt --wikidata-labels --manual
auto_process_schema_flags = --schemaorg-manifest ./schemaorg-manifest.tt --wikidata-labels
custom_process_schema_flags ?=

default_annotate_flags =
base_annotate_flags =
manual_annotate_flags = --skip
auto_annotate_flags = --algorithm bert,adj,bart --paraphraser-model ./models/paraphraser-bart
custom_annotate_flags ?=
auto_auto_annotate_dependencies = models/paraphraser-bart
manual_process_schema_dependencies = $(geniedir)/tool/autoqa/wikidata/manual-annotations.js

use_preprocessed_datasets = true

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

models/paraphraser-bart:
	mkdir models
	wget --no-verbose https://almond-static.stanford.edu/test-data/paraphraser-bart.tar.xz
	tar -C models -xvf paraphraser-bart.tar.xz

%/wikidata.tt: $(experiment)/parameter-datasets.tsv $(geniedir)/tool/autoqa/wikidata/process-schema.js $($(mode)_process_schema_dependencies)
	mkdir -p $(dir $@)
	$(genie) wikidata-process-schema  -o $@.tmp --entities $(experiment)/entities.json \
		--domains $(class) \
		--domain-canonicals $(canonical) \
		--parameter-datasets $*/parameter-datasets.tsv \
		--properties $(shell cat $(dir $@)properties.txt) \
		$(process_schemaorg_flags)
	mv $@.tmp $@

emptydataset.tt:
	echo 'dataset @empty {}' > $@

shared-parameter-datasets.tsv:
	$(genie) download-entity-values --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) \
	   --manifest $@ --append-manifest -d shared-parameter-datasets
	$(genie) download-string-values --thingpedia-url $(thingpedia_url) --developer-key $(developer_key) \
	   --manifest $@ --append-manifest -d shared-parameter-datasets


%/parameter-datasets.tsv : shared-parameter-datasets.tsv
	mkdir -p $(canonical)
	mkdir -p datadir

	if [ "$(use_preprocessed_datasets)" = "true" ] ; then \
	  curl https://almond-static.stanford.edu/research/csqa/filtered_property_wikidata4.json  --output datadir/filtered_property_wikidata4.json ; \
	  curl https://almond-static.stanford.edu/research/csqa/${experiment}/instances.txt  --output ${experiment}/instances.txt; \
	  curl https://almond-static.stanford.edu/research/csqa/${experiment}/property_item_map.json  --output ${experiment}/property_item_map.json; \
	  curl https://almond-static.stanford.edu/research/csqa/${experiment}/property_item_values.json  --output ${experiment}/property_item_values.json; \
	  curl https://almond-static.stanford.edu/research/csqa/${experiment}/instance_item_values.json  --output ${experiment}/instance_item_values.json; \
	else \
	  curl https://zenodo.org/record/4052427/files/wikidata_proc_json.zip --output wikidata_proc_json.zip ; \
	  unzip wikidata_proc_json.zip ; \
	  mv 'wikidata_proc_json 2'/* datadir ; \
	  rm -r 'wikidata_proc_json 2' ; \
	fi

	$(genie) wikidata-preprocess-data \
		--domain $(class) \
		--domain-canonical $(canonical) \
		--input datadir \
		--output ./ \
		$(process_schemaorg_flags)
	cat shared-parameter-datasets.tsv >> $(experiment)/parameter-datasets.tsv

%/constants.tsv: %/parameter-datasets.tsv %/wikidata.tt
	$(genie) sample-constants -o $@.tmp --parameter-datasets $*/parameter-datasets.tsv --thingpedia $*/wikidata.tt --devices org.wikidata
	cat $(geniedir)/data/en-US/constants.tsv >> $@.tmp
	mv $@.tmp $@

%/manifest.tt: %/constants.tsv %/wikidata.tt %/parameter-datasets.tsv $($(mode)_auto_annotate_dependencies)
	$(genie) auto-annotate -o $@.tmp \
	--constants $*/constants.tsv \
	--thingpedia $*/wikidata.tt \
	--functions $($(*)_canonical) \
	$($(mode)_annotate_flags) \
	--parameter-datasets $*/parameter-datasets.tsv \
	--dataset wikidata
	mv $@.tmp $@

%/synthetic.tsv: %/manifest.tt $(dataset_file) $(geniedir)/languages-dist/thingtalk/en/*.js
	$(genie) generate \
	  --template $(geniedir)/languages-dist/$(template_file) \
	  --thingpedia $*/manifest.tt --entities $*/entities.json --dataset $(dataset_file) \
	  --target-pruning-size $(target_pruning_size) \
	  -o $@.tmp --no-debug $(generate_flags) $(custom_generate_flags) --maxdepth $(maxdepth) \
	  --random-seed $@ --id-prefix $*:
	mv $@.tmp $@

%/augmented.tsv : %/synthetic.tsv %/parameter-datasets.tsv
	$(genie) augment -o $@.tmp -l en-US --thingpedia $*/manifest.tt --parameter-datasets $*/parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	  --debug $($(*)_paraphrase) $*/synthetic.tsv
	mv $@.tmp $@

%/valid.tsv :
	mkdir -p datadir
	if [ "$(use_preprocessed_datasets)" = "true" ] ; then \
		curl https://almond-static.stanford.edu/research/csqa/${experiment}/valid.json  --output ${experiment}/valid.json ; \
	else \
		curl https://zenodo.org/record/3268649/files/CSQA_v9.zip --output CSQA_v9.zip ; \
		unzip CSQA_v9.zip ; \
		mv CSQA_v9 datadir/csqa ; \
	fi

	$(genie) wikidata-convert-csqa \
		--domain $(class) \
		--domain-canonical $(canonical) \
		--input datadir/csqa \
		--output . \
		--dataset valid
	$(genie) typecheck -o $(experiment)/valid_annotated.tsv --dropped $(experiment)/valid_dropped.tsv --thingpedia $(experiment)/manifest.tt $(experiment)/valid.tsv
	mv $(experiment)/valid_annotated.tsv $(experiment)/valid.tsv

datadir: $(experiment)/augmented.tsv $(experiment)/valid.tsv
	mkdir -p $@
	if [ "$(eval_set)" = "eval_synthetic" ] ; then \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	  mkdir -p $(experiment)/$(eval_set) ; \
	  cp $(experiment)/valid.tsv $(experiment)/$(eval_set)/annotated.tsv; \
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
	  --train_iterations $(train_iterations) \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  --skip_cache \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

%/eval_synthetic/annotated.tsv:
	mkdir -p $*/eval_synthetic
	wget https://almond-static.stanford.edu/test-data/wikidata/$*/eval-synthetic.tsv -O $@

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
	rm -rf datadir bert-canonical-annotator-in.json bert-canonical-annotator-out.json gpt2-paraphraser-in.tsv gpt2-paraphraser-out.json
	for exp in $(all_experiments) ; do \
		rm -rf $$exp/synthetic* $$exp/entities.json $$exp/parameter-datasets* $$exp/wikidata.tt $$exp/manifest.tt $$exp/augmented.tsv $$exp/constants.tsv $$exp/*.tmp; \
	done
