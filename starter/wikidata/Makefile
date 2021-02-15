geniedir = ../..
developer_key =
experiment ?= city
thingpedia_cli = thingpedia
thingpedia_url = https://thingpedia.stanford.edu/thingpedia

-include ./config.mk

memsize := 15000
genie = node --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js

all_experiments = city country star university company people artist athlete sports-team tv-series

city_class = Q515
city_canonical = city
city_properties ?= P571,P138,P30,P17,P1376,P131,P206,P625,P6,P1082,P2927,P2044,P421,P190,P47,P2046,P281,P856,P41,P1538,P18,P610,P2936
city_required_properties ?= none

country_class = Q6256
country_canonical = country
country_properties ?= P571,P1813,P138,P37,P85,P1451,P30,P36,P206,P610,P1589,P122,P6,P530,P1304,P463,P3001,P1082,P150,P421,P38,P2131,P2132,P1081,P47,P2046,P41,P1125
country_required_properties ?= none

star_class = Q523
star_canonical = star
star_properties ?= P18,P361,P2067,P398,P397,P2583,P1102,P215,P1215,P1457,P2227,P2076,P2120,P2547,P2046,P2234,P7584,P59,P1096,P4296,P2216
star_required_properties ?= none

university_class = Q3918
university_canonical = university
university_properties ?= P6375,P1449,P571,P17,P856,P131,P576,P154,P18,P571,P138,P112,P488,P2828,P1451,P2124,P463,P2196,P2936,P2769,P281,P355,P1830
university_required_properties ?= none

company_class = Q783794
company_canonical = company
company_properties ?= P154,P452,P571,P138,P112,P169,P1037,P1451,P17,P463,P2403,P2137,P2139,P2295,P3362,P740,P127,P749,P159,P1128,P166,P1056,P856,P1581,P414
company_required_properties ?= none

people_class = Q5
people_canonical = people
people_properties ?= P18,P21,P27,P39,P735,P734,P569,P19,P22,P25,P3373,P26,P40,P1412,P106,P1449,P1830,P69,P551,P2031,P2032,P172,P2067,P1344,P166,P1411,P2048,P140,P570,P20,P1196,P509,P4602,P119,P102,P410
people_required_properties ?= none

artist_class = Q5
artist_canonical = artist
artist_properties ?= P18,P21,P27,P735,P734,P569,P19,P22,P25,P3373,P26,P40,P1412,P106,P1449,P1830,P69,P551,P172,P2067,P1344,P166,P1411,P2048,P140,P412,P1303,P800,P136,P2218,P264
artist_required_properties ?= P800

athlete_class = Q5
athlete_canonical = athlete
athlete_properties ?= P18,P21,P27,P735,P734,P569,P19,P22,P25,P3373,P26,P40,P1412,P106,P1449,P1830,P69,P551,P172,P2067,P1344,P166,P1411,P2048,P140,P641,P413,P286,P118,P54,P552,P647,P1618,P1352,P1532
athlete_required_properties ?= P641

sports-team_class = Q12973014
sports-team_canonical = sports_team
sports-team_properties ?= P571,P17,P286,P118,P115,P127,P159,P859,P641,P822,P856,P112,P488,P2124,P355,P166,P1411,P94,P154,P1813,P138,P505
sports-team_required_properties ?= none

tv-series_class = Q5398426
tv-series_canonical = tv_series
tv-series_properties ?= P136,P170,P449,P495,P364,P58,P161,P162,P272,P750,P942,P840,P2047,P4312,P166,P1411,P674,P1113,P2437,P580,P582
tv-series_required_properties ?= none

eval_set ?= eval-synthetic

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

load_predownloaded_parameter_sets = true

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

%/wikidata.tt: $(geniedir)/tool/autoqa/wikidata/process-schema.js $($(mode)_process_schema_dependencies)
	mkdir -p $(dir $@)
	$(genie) wikidata-process-schema -o $@.tmp --entities $*/entities.json $($(mode)_process_schema_flags)\
	  --domains $($(*)_class) \
	  --domain-canonicals $($(*)_canonical) \
	  --properties $($(*)_properties) \
	  --required-properties $($(*)_required_properties)
	mv $@.tmp $@

emptydataset.tt:
	echo 'dataset @empty {}' > $@

shared-parameter-datasets.tsv:
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-entity-values --manifest $@ --append-manifest -d shared-parameter-datasets
	$(thingpedia_cli) --url $(thingpedia_url) --developer-key $(developer_key) --access-token invalid \
	  download-string-values --manifest $@ --append-manifest -d shared-parameter-datasets

%/parameter-datasets.tsv : %/wikidata.tt shared-parameter-datasets.tsv
	if [ "$(load_predownloaded_parameter_sets)" = "true" ] ; then \
	  wget --no-verbose https://almond-static.stanford.edu/test-data/wikidata-parameter-datasets/$*.tar.xz ; \
	  tar -C . -xvf $*.tar.xz ; \
	else \
	  sed -e "s|$(echo -e '\t')shared-parameter-datasets|$(echo -e '\t')../shared-parameter-datasets|g" shared-parameter-datasets.tsv > $@ ; \
	  $(genie) wikidata-make-string-datasets --manifest $@.local -d $*/parameter-datasets --thingpedia $*/wikidata.tt; \
	  cat $@.local >> $@; \
	  rm $@.local; \
	fi

%/constants.tsv: %/parameter-datasets.tsv %/wikidata.tt
	$(genie) sample-constants -o $@.tmp --parameter-datasets $*/parameter-datasets.tsv --thingpedia $*/wikidata.tt --devices org.wikidata
	cat $(geniedir)/data/en-US/constants.tsv >> $@.tmp
	mv $@.tmp $@

%/manifest.tt: %/constants.tsv %/wikidata.tt %/parameter-datasets.tsv $($(mode)_auto_annotate_dependencies)
	$(genie) auto-annotate -o $@.tmp --constants $*/constants.tsv --thingpedia $*/wikidata.tt --functions $($(*)_canonical) $($(mode)_annotate_flags) --parameter-datasets $*/parameter-datasets.tsv --dataset wikidata
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

datadir: $(experiment)/augmented.tsv
	mkdir -p $@
	if [ "$(eval_set)" = "eval-synthetic" ] ; then \
	  $(genie) split-train-eval --train $@/train.tsv --eval $@/eval.tsv \
	    --eval-probability 0.1 --split-strategy sentence \
	    --eval-on-synthetic $(experiment)/augmented.tsv ; \
	  mkdir -p $(experiment)/eval-synthetic ; \
	  cp $@/eval.tsv $(experiment)/eval-synthetic/annotated.tsv; \
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

%/eval-synthetic/annotated.tsv:
	mkdir -p $*/eval-synthetic
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
