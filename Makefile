.PHONY: all bundle prepare

all: prepare

prepare: dist bundle

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
	languages/thingtalk/en/basic.genie \
	languages/thingtalk/en/thingtalk.genie \
	languages/thingtalk/en/dialogue.genie \
	languages/thingtalk/en/sempre.genie

built_bundled_templates := $(addsuffix .ts,$(bundled_templates))

generated := \
	$(patsubst %.po,%.mo,$(wildcard po/*.po)) \
	data/builtins/thingengine.builtin/dataset.tt \
	lib/engine/db/schema.json \
	lib/sentence-generator/compiler/grammar.js \
	lib/engine/devices/builtins/test.tt.json \
	lib/engine/devices/builtins/thingengine.tt.json \
	lib/engine/devices/builtins/thingengine.builtin.tt.json \
	lib/engine/devices/builtins/faq.json

$(built_bundled_templates) : languages/*/*.genie languages/*/*/*.genie languages/*/*/*/*.genie lib/sentence-generator/compiler/*.ts lib/sentence-generator/compiler/grammar.js
	node ./dist/tool/genie.js compile-template $(patsubst %.genie.ts,%.genie,$@)

dist: $(wildcard $(sources)) $(generated) tsconfig.json
	tsc --build tsconfig.json
	# HACK!!! by default typescript generates imports of the form
	# "import * as events from "node/events"
	# for some obsure reason, these work okay when a library
	# is a regular package in node_modules, but don't work at
	# all with "npm link", "yarn link", or symlinks in general
	# removing the "node/" prefix works though, because then
	# the module is resolved as a standard module in nodejs
	find dist/ -name \*.d.ts | xargs sed -i -e 's|from "node/|from "|g'
	# copy the BERT script to the build folder
	mkdir -p dist/tool/autoqa/lib
	cp tool/autoqa/lib/bert-canonical-annotator.py dist/tool/autoqa/lib
	touch dist

languages-dist: $(built_bundled_templates) $(wildcard languages/*/*.js languages/*/*.ts languages/*/*/*.js languages/*/*/*.ts) dist
	tsc --build languages/tsconfig.json
	touch languages-dist

bundle: bundle/en.zip

bundle/%.zip: languages-dist
	mkdir -p bundle/$*
	cp -r languages-dist/thingtalk/$* languages-dist/thingtalk/*.js languages-dist/thingtalk/*.js.map bundle/$*
	cd bundle/$* ; zip -r ../$*.zip *

%.json : %.sql
	node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1]).toString("utf8")))' $< > $@.tmp
	mv $@.tmp $@

lib/engine/devices/builtins/%.tt.json : data/builtins/%/manifest.tt
	node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1]).toString("utf8")))' $< > $@.tmp
	mv $@.tmp $@

data/builtins/thingengine.builtin/dataset.tt data/builtins/thingengine.builtin/manifest.tt lib/engine/devices/builtins/faq.json &: data/builtins/thingengine.builtin/dataset.tt.in data/builtins/thingengine.builtin/manifest.tt.in data/builtins/thingengine.builtin/faq.yaml
	ts-node data/builtins/thingengine.builtin/merge-faq

%.mo : %.po
	msgfmt $< -o $@

%.js : %.pegjs
	pegjs $<
