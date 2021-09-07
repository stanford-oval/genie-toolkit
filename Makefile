.PHONY: all prepare

all: prepare

prepare: dist

template_sources = \
	lib/templates/*.genie \
	lib/templates/*/*.genie

sources = \
	lib/*.ts \
	lib/*/*.js \
	lib/*/*.ts \
	lib/*/*/*.js \
	lib/*/*/*.ts \
	lib/*/*/*/*.js \
	lib/*/*/*/*.ts \
	tool/*.js \
	tool/*.ts \
	tool/*/*.js \
	tool/*/*.ts \
	tool/*/*/*.js \
	tool/*/*/*.ts

languages = en

bundled_templates := \
	lib/templates/basic.genie \
	lib/templates/single-command.genie \
	lib/templates/dialogue.genie

built_bundled_templates := $(addsuffix .out.ts,$(bundled_templates))

generated_early := \
	lib/sentence-generator/compiler/grammar.js \
	lib/utils/template-string/grammar.js

generated := \
	$(generated_early) \
	$(patsubst %.po,%.mo,$(wildcard po/*.po)) \
	$(built_bundled_templates) \
	data/builtins/org.thingpedia.builtin.thingengine.builtin/dataset.tt \
	lib/engine/db/sqlite/schema.json \
	lib/engine/devices/builtins/org.thingpedia.builtin.test.tt.json \
	lib/engine/devices/builtins/org.thingpedia.builtin.thingengine.tt.json \
	lib/engine/devices/builtins/org.thingpedia.builtin.thingengine.builtin.tt.json \
	lib/engine/devices/builtins/org.thingpedia.volume-control.tt.json \
	lib/engine/devices/builtins/faq.json

$(built_bundled_templates) : $(template_sources) lib/sentence-generator/compiler/*.ts $(generated_early)
	ts-node ./lib/sentence-generator/compiler $(patsubst %.genie.out.ts,%.genie,$@)

dist: $(wildcard $(sources)) $(generated) tsconfig.json
	tsc --build tsconfig.json
	touch dist

bundle: bundle/en.zip

%.json : %.sql
	node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1]).toString("utf8")))' $< > $@.tmp
	mv $@.tmp $@

lib/engine/devices/builtins/%.tt.json : data/builtins/%/manifest.tt
	node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1]).toString("utf8")))' $< > $@.tmp
	mv $@.tmp $@

data/builtins/org.thingpedia.builtin.thingengine.builtin/dataset.tt data/builtins/org.thingpedia.builtin.thingengine.builtin/manifest.tt lib/engine/devices/builtins/faq.json &: data/builtins/org.thingpedia.builtin.thingengine.builtin/dataset.tt.in data/builtins/org.thingpedia.builtin.thingengine.builtin/manifest.tt.in data/builtins/org.thingpedia.builtin.thingengine.builtin/faq.yaml
	ts-node data/builtins/org.thingpedia.builtin.thingengine.builtin/merge-faq

%.mo : %.po
	msgfmt $< -o $@

%.js : %.pegjs
	pegjs $<
