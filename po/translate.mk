SHELL := /bin/bash

GENIENLP_EMBEDDINGS ?= ../genienlp/.embeddings

geniedir ?= .
genienlp ?= GENIENLP_EMBEDDINGS=$(GENIENLP_EMBEDDINGS) ; genienlp

skip_po_creation = true
skip_translation = false

non_interactive =

model_name_or_path=Helsinki-NLP/opus-mt-$(src_lang)-$(tgt_lang)
# model_name_or_path=facebook/mbart-large-50-one-to-many-mmt
# model_name_or_path=facebook/mbart-large-50-many-to-many-mmt
# model_name_or_path=facebook/m2m100_418M

src_lang=en
tgt_lang=

val_batch_size = 2000
temperature = 0.2

default_translation_hparams = --val_batch_size $(val_batch_size) --temperature $(temperature) --repetition_penalty 1.0

$(geniedir)/po/$(tgt_lang): $(geniedir)/po

	# prepare po
	if ! $(skip_po_creation) ; then \
		cd $< ; rm -rf $(tgt_lang).po ; msginit -i genie-toolkit.pot -l $(tgt_lang) $(if $(non_interactive),--no-translator,) ; \
	fi
	mkdir -p $@
	cp $</$(tgt_lang).po $@/input.po

	python3 $(geniedir)/scripts/po_edit.py --transformation prepare_for_translation --input_file $@/input.po --output_file $@/input.tsv

	# translate po
	rm -rf tmp/almond/
	mkdir -p tmp/almond/
	ln -f $@/*.tsv tmp/almond/
	if ! $(skip_translation) ; then \
		if [ ! -f $(GENIENLP_EMBEDDINGS)/$(model_name_or_path)/best.pth ] ; then \
			$(genienlp) train --override_question= --train_iterations 0 --train_tasks almond_translate \
			 --train_languages $(src_lang) --train_tgt_languages $(tgt_lang) --eval_languages $(src_lang) --eval_tgt_languages $(tgt_lang) \
			  --model TransformerSeq2Seq --pretrained_model $(model_name_or_path) --save $(GENIENLP_EMBEDDINGS)/$(model_name_or_path)/ \
			   --embeddings $(GENIENLP_EMBEDDINGS) --exist_ok --skip_cache --no_commit --preserve_case ; \
		fi ; \
		$(genienlp) predict --eval_dir $@/ --path $(GENIENLP_EMBEDDINGS)/$(model_name_or_path)/ --pred_set_name input \
			 --translate_no_answer  --tasks almond_translate --data tmp/  --evaluate valid \
			  --pred_languages $(src_lang) --pred_tgt_languages $(tgt_lang) --overwrite --silent $(default_translation_hparams) ; \
	fi

	# create final po
	python3 $(geniedir)/scripts/po_edit.py --transformation create_final --input_file $@/input.po --translated_file $@/valid/almond_translate.tsv --output_file $@/output.po

	# cp to main po directory
	cp $@/output.po $</$(tgt_lang).po

translate-po: $(geniedir)/po/$(tgt_lang)
	# done!
	echo $@
