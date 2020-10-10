.PHONY: all bundle prepare

all: prepare

prepare: dist bundle

sources = \
	lib/*.ts \
	lib/*/*.js \
	lib/*/*.ts \
	lib/*/*/*.js \
	lib/*/*/*.ts \
	tool/*.js \
	tool/*.ts \
	tool/*/*.js \
	tool/*/*.ts \
	tool/*/*/*.js \
	tool/*/*/*.ts

languages = en

bundled_templates := \
	$(foreach lang,$(languages),$(patsubst %.genie,%.genie.ts,$(wildcard languages/thingtalk/*.genie languages/thingtalk/$(lang)/*.genie languages/thingtalk/$(lang)/*/*.genie)))

generated := \
	$(patsubst %.po,%.mo,$(wildcard po/*.po)) \
	$(patsubst data/builtins/%/manifest.tt,lib/engine/devices/builtins/%.tt.json,$(wildcard data/builtins/*/*.tt)) \
	lib/engine/db/schema.json \
	lib/sentence-generator/compiler/grammar.js

%.genie.ts : %.genie lib/sentence-generator/compiler/*.ts lib/sentence-generator/compiler/grammar.js
	node ./dist/tool/genie.js compile-template $<

dist: $(wildcard $(sources)) $(generated) tsconfig.json
	tsc --build tsconfig.json
	# HACK!!! by default typescript generates imports of the form
	# "import * as events from "node/events"
	# for some obsure reason, these work okay when a library
	# is a regular package in node_modules, but don't work at
	# all with "npm link", "yarn link", or symlinks in general
	# removing the "node/" prefix works though, because then
	# the module is resolved as a standard module in nodejs
	find dist/ -name \*.d.ts | xargs sed -i 's|from "node/|from "|g'
	touch dist

languages-dist: $(bundled_templates) $(wildcard languages/*/*.js languages/*/*.ts languages/*/*/*.js languages/*/*/*.ts) dist
	tsc --build languages/tsconfig.json
	touch languages-dist

bundle: bundle/en.zip bundle/zh-tw.zip bundle/zh-cn.zip

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

%.mo : %.po
	msgfmt $< -o $@

%.js : %.pegjs
	pegjs $<
