geniedir ?= ../..
wikidata_dir ?= raw/wikidata
csqa_dir ?= raw/csqa

-include ./config.mk

memsize := 12000
NODE ?= node
genie ?= $(NODE) --experimental_worker --max_old_space_size=$(memsize) $(geniedir)/dist/tool/genie.js

# experiment: city, country, tv, disease, human, art, song, game, organization, music_band
experiment ?= 

# options for manfiest generation
annotation ?= auto
type_system ?= entity-hierarchical
paraphraser_options ?= --paraphraser-model ./models/paraphraser-bart-large-speedup-megabatch-5m --batch-size 16 --debug

baseline_preprocess_flags =
manual_preprocess_flags = 
wikidata_preprocess_flags =
auto_preprocess_flags =

baseline_process_schema_flags =
manual_process_schema_flags = --manual
wikidata_process_schema_flags = --wikidata-labels
auto_process_schema_flags =

baseline_annotate_flags =
manual_preprocess_flags = 
wikidata_annotate_flags =
auto_annotate_flags = --algorithms bart-paraphrase --type-based-projection $(paraphraser_options)

preprocess_flags ?= --type-system $(type_system) $($(annotation)_preprocess_flags)
process_schema_flags ?= --type-system $(type_system) $($(annotation)_process_schema_flags)
annotate_flags ?= $($(annotation)_annotate_flags)

# options for synthesis
datadir = datadir

csqa_filter = "ques_type_id=1,2"
valid_size ?= 500

valid_set ?= valid
eval_set ?= eval
dataset_file ?= emptydataset.tt
synthetic_flags ?= \
	projection_with_filter \
	projection \
	aggregation \
	schema_org \
	filter_join \
	no_stream
annotate_with_entity_id =
soft_match_id = 
generate_flags = $(foreach v,$(synthetic_flags),--set-flag $(v)) $(if $(soft_match_id),,--set-flag no-soft_match_id)
custom_generate_flags ?=
pruning_size ?= 25
mindepth ?= 6
maxdepth ?= 8
fewshot =
fewshot_size = 100

train_batch_tokens = 2000
val_batch_size = 4000

# options for training
model ?= 1
train_iterations ?= 10000
train_save_every ?= 1000
train_log_every ?= 100
train_nlu_flags ?= \
	--model TransformerSeq2Seq \
	--pretrained_model facebook/bart-large \
	--lr_multiply 0.01 \
	--warmup 20 \
	--gradient_accumulation_steps 20 \
	--eval_set_name valid \
	--train_batch_tokens $(train_batch_tokens) \
	--val_batch_size $(val_batch_size) \
	--preprocess_special_tokens \
	--override_question= 
custom_train_nlu_flags ?=

.PHONY: datadir train clean clean-synthesis
.SECONDARY:

models/paraphraser-bart-large-speedup-megabatch-5m:
	mkdir -p models
	wget --no-verbose https://almond-static.stanford.edu/research/schema2qa2.0/paraphraser-bart-large-speedup-megabatch-5m.tar.xz
	tar -C models -xvf paraphraser-bart-large-speedup-megabatch-5m.tar.xz

emptydataset.tt:
	echo 'dataset @empty {}' > $@

raw/bootleg:
	mkdir -p raw/bootleg
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/bootleg/qid2typeids.json -P $@
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/bootleg/type_vocab.json -P $@
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/bootleg/type_vocab_to_wikidataqid.json -P $@

bootleg-types.json: raw/bootleg
	mkdir -p $(dir $@)
	$(genie) wikidata-preprocess-bootleg \
	  --types raw/bootleg/qid2typeids.json \
	  --type-vocab raw/bootleg/type_vocab.json \
	  --type-vocab-to-qid raw/bootleg/type_vocab_to_wikidataqid.json \
	  --bootleg-types $@.tmp \
	  --bootleg-type-canonicals bootleg-type-canonicals.json.tmp
	mv $@.tmp $@
	mv bootleg-type-canonicals.json.tmp bootleg-type-canonicals.json

raw/wikidata:
	mkdir -p $@
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb/filtered_property_wikidata4.json -P $@
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb/wikidata_short_1.json -P $@
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb/wikidata_short_2.json -P $@
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/kb/items_wikidata_n.json -P $@

raw/csqa/train:
	mkdir -p raw/csqa
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/train.tar.xz
	tar -C raw/csqa -xf train.tar.xz

raw/csqa/valid:
	mkdir -p raw/csqa
	wget --no-verbose https://almond-static.stanford.edu/research/csqa/valid.tar.xz
	tar -C raw/csqa -xf valid.tar.xz

domains.tsv: raw/csqa/valid $(wikidata_dir)
	$(genie) wikidata-csqa-type-map \
	  -i raw/csqa/valid \
	  --wikidata $(wikidata_dir)/wikidata_short_*.json \
	  --wikidata-labels $(wikidata_dir)/items_wikidata_n.json \
	  $(if $(findstring all,$(experiment)),,--domains $(experiment)) \
	  $(type_map_options) \
	  -o $@

$(experiment)/parameter-datasets.tsv: $(wikidata_dir) domains.tsv bootleg-types.json
	mkdir -p $(experiment)/parameter-datasets
	$(genie) wikidata-preprocess-knowledge-base \
	  --domains domains.tsv \
	  --wikidata $(wikidata_dir)/wikidata_short_1.json $(wikidata_dir)/wikidata_short_2.json \
	  --wikidata-entity-list $(wikidata_dir)/items_wikidata_n.json \
	  --wikidata-property-list $(wikidata_dir)/filtered_property_wikidata4.json \
	  --bootleg-types bootleg-types.json \
	  --bootleg-type-canonicals bootleg-type-canonicals.json \
	  --subtypes $(experiment)/subtypes.json \
	  --filtered-properties $(experiment)/properties.json \
	  --symmetric-properties $(experiment)/symmetric-properties.txt \
	  --manifest $(experiment)/parameter-datasets.tsv.tmp \
	  --output-dir $(experiment)/parameter-datasets \
	  $(preprocess_flags)
	mv $(experiment)/parameter-datasets.tsv.tmp $(experiment)/parameter-datasets.tsv

$(experiment)/wikidata.tt: $(experiment)/parameter-datasets.tsv domains.tsv  
	mkdir -p $(dir $@)
	$(genie) wikidata-process-schema  \
	  -o $@.tmp --entities $(experiment)/entities.json \
	  --domains domains.tsv \
	  --property-labels $(wikidata_dir)/filtered_property_wikidata4.json \
	  --subtypes $(experiment)/subtypes.json \
	  --properties $(experiment)/properties.json \
	  $(process_schema_flags)
	mv $@.tmp $@

$(experiment)/constants.tsv: $(experiment)/parameter-datasets.tsv $(experiment)/wikidata.tt
	$(genie) sample-constants -o $@.tmp --parameter-datasets $(experiment)/parameter-datasets.tsv --thingpedia $(experiment)/wikidata.tt --devices org.wikidata
	cat $(geniedir)/data/en-US/constants.tsv >> $@.tmp
	mv $@.tmp $@

$(experiment)/manifest.tt: $(experiment)/constants.tsv $(experiment)/wikidata.tt $(experiment)/parameter-datasets.tsv $(if $(findstring auto,$(annotation)),models/paraphraser-bart-large-speedup-megabatch-5m,)
	$(genie) auto-annotate -o $@.tmp \
	  --dataset wikidata \
	  --constants $(experiment)/constants.tsv \
	  --thingpedia $(experiment)/wikidata.tt \
	  --entities ${experiment}/entities.json \
	  $(annotate_flags) 
	mv $@.tmp $@

$(experiment)/synthetic-d%.tsv: $(experiment)/manifest.tt $(dataset_file)
	$(genie) generate -o $@.tmp \
	  --thingpedia $(experiment)/manifest.tt \
	  --entities $(experiment)/entities.json \
	  --dataset $(dataset_file) \
	  --target-pruning-size $(pruning_size) \
	  $(generate_flags) \
	  --maxdepth $$(echo $* | cut -f1 -d'-') \
	  --random-seed $@ \
	  --debug 3
	mv $@.tmp $@

$(experiment)/synthetic.tsv : $(foreach v,1 2 3,$(experiment)/synthetic-d$(mindepth)-$(v).tsv) $(experiment)/synthetic-d$(maxdepth).tsv
	cat $^ > $@
	
# csqa training set converted as few shot
$(experiment)/csqa-train.tsv: $(experiment)/wikidata.tt $(csqa_dir)/train $(wikidata_dir) domains.tsv 
	$(genie) wikidata-convert-csqa \
	  --domains domains.tsv \
	  --thingpedia $(experiment)/wikidata.tt \
	  --input $(csqa_dir)/train \
	  --output $@\
	  --wikidata-property-list $(wikidata_dir)/filtered_property_wikidata4.json \
	  --items $(experiment)/items.json \
	  --values $(experiment)/values.json \
	  --types $(experiment)/types.json \
	  --filtered-examples $(experiment)/train.json \
	  $(if $(annotate_with_entity_id),--include-entity-value,) \
	  $(if $(soft_match_id),--soft-match-id,) \

$(experiment)/csqa-train-typechecked.tsv: $(experiment)/wikidata.tt $(experiment)/csqa-train.tsv
	$(genie) typecheck \
	  -o $@ \
	  --dropped $(experiment)/csqa-train-dropped.tsv \
	  --thingpedia $(experiment)/wikidata.tt \
	  $(if $(annotate_with_entity_id),--include-entity-value,) \
	  $(experiment)/csqa-train.tsv

$(experiment)/fewshot.tsv: $(experiment)/csqa-train-typechecked.tsv
	head -$(fewshot_size) $(experiment)/csqa-train-typechecked.tsv > $(experiment)/fewshot.tsv

$(experiment)/augmented.tsv : $(experiment)/manifest.tt $(experiment)/synthetic.tsv $(experiment)/parameter-datasets.tsv $(if $(fewshot),$(experiment)/fewshot.tsv,)
	$(genie) augment -o $@.tmp -l en-US \
	  --thingpedia $(experiment)/manifest.tt \
	  --entities $(experiment)/entities.json \
	  --parameter-datasets $(experiment)/parameter-datasets.tsv \
	  --synthetic-expand-factor 1 --quoted-paraphrasing-expand-factor 60 --no-quote-paraphrasing-expand-factor 20 --quoted-fraction 0.0 \
	  --debug --no-requotable \
	  $(if $(annotate_with_entity_id),--include-entity-value,) \
	  $(experiment)/synthetic.tsv $(if $(fewshot),$(experiment)/fewshot.tsv,)
	mv $@.tmp $@

$(experiment)/csqa-valid.tsv: $(experiment)/wikidata.tt $(csqa_dir)/valid $(wikidata_dir) domains.tsv 
	$(genie) wikidata-convert-csqa \
	  --domains domains.tsv \
	  --thingpedia $(experiment)/wikidata.tt \
	  --input $(csqa_dir)/valid \
	  --output $@\
	  --wikidata-property-list $(wikidata_dir)/filtered_property_wikidata4.json \
	  --items $(experiment)/items.json \
	  --values $(experiment)/values.json \
	  --types $(experiment)/types.json \
	  --filtered-examples $(experiment)/valid.json \
	  $(if $(csqa_filter),--filter $(csqa_filter),) \
	  $(if $(annotate_with_entity_id),--include-entity-value,) \
	  $(if $(soft_match_id),--soft-match-id,) \

$(experiment)/csqa-valid-typechecked.tsv: $(experiment)/wikidata.tt $(experiment)/csqa-valid.tsv
	$(genie) typecheck \
	  -o $@ \
	  --dropped $(experiment)/csqa-valid-dropped.tsv \
	  --thingpedia $(experiment)/wikidata.tt \
	  $(if $(annotate_with_entity_id),--include-entity-value,) \
	  $(experiment)/csqa-valid.tsv

$(experiment)/eval/annotated.tsv: $(experiment)/csqa-valid-typechecked.tsv
	mkdir -p $(experiment)/eval 
	cp $(experiment)/csqa-valid-typechecked.tsv $@

$(experiment)/valid/annotated.tsv: $(experiment)/csqa-valid-typechecked.tsv
	mkdir -p $(experiment)/valid
	head -n $(valid_size) $(experiment)/csqa-valid-typechecked.tsv > $@

datadir: domains.tsv $(experiment)/augmented.tsv $(experiment)/$(valid_set)/annotated.tsv $(experiment)/$(eval_set)/annotated.tsv
	mkdir -p $@
	cp $(experiment)/augmented.tsv $@/train.tsv
	cp $(experiment)/$(valid_set)/annotated.tsv $@/$(valid_set).tsv 
	cp $(experiment)/$(eval_set)/annotated.tsv $@/$(eval_set).tsv
	touch $@

train: $(datadir)
	mkdir -p $(experiment)/models/$(model)
	-rm datadir/almond
	ln -sf . datadir/almond
	genienlp train \
	  --no_commit \
	  --data $(datadir) \
	  --save $(experiment)/models/$(model) \
	  --cache $(datadir)/.cache \
	  --tensorboard_dir $(experiment)/models/$(model) \
	  --train_tasks almond \
	  --train_iterations $(train_iterations) \
	  --save_every $(train_save_every) \
	  --log_every $(train_log_every) \
	  --val_every $(train_save_every) \
	  --exist_ok \
	  --skip_cache \
	  --preserve_case \
	  $(train_nlu_flags) \
	  $(custom_train_nlu_flags)

evaluate: $(experiment)/models/${model}/best.pth $(experiment)/$(eval_set)/annotated.tsv $(experiment)/manifest.tt
	$(genie) evaluate-server $(experiment)/$(eval_set)/annotated.tsv \
	  --url "file://$(abspath $(experiment)/models/$(model))" \
	  --thingpedia $(experiment)/manifest.tt \
	  --debug \
	  --csv-prefix $(eval_set) \
	  --csv \
	  --min-complexity 1 \
	  --max-complexity 3 \
	  --ignore-entity-type \
	  $(if $(annotate_with_entity_id),--include-entity-value,) \
	  -o $(experiment)/$(eval_set)/$(model).results.tmp | tee $(experiment)/$(eval_set)/$(model).debug
	mv $(experiment)/$(eval_set)/$(model).results.tmp $(experiment)/$(eval_set)/$(model).results

clean: 
	rm -rf datadir
	rm -rf $(experiment)
	rm -rf domains.tsv bert-canonical-annotator-*.json paraphraser-in.json paraphraser-out.json

clean-synthesis:
	rm -rf datadir
	rm -rf $(experiment)/synthetic*.tsv $(experiment)/augmented.tsv