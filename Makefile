all = \
	$(patsubst %.po,%.mo,$(wildcard po/*.po)) \
	$(patsubst data/builtins/%/manifest.tt,lib/engine/devices/builtins/%.tt.json,$(wildcard data/builtins/*/*.tt)) \
	lib/engine/db/schema.json \
	lib/sentence-generator/compiler/grammar.js

.PHONY: all bundle prepare

all: prepare

prepare: bundle dist

dist: $(all) lib/*.ts lib/*/*.js lib/*/*/*.js tool/*.js tool/*/*.js tool/*/*/*.js tsconfig.json
	tsc --build tsconfig.json

bundle: bundle/en.zip bundle/zh-tw.zip

bundle/%: languages/thingtalk/%/*.genie languages/thingtalk/*.genie languages/thingtalk/*.js
	mkdir -p $@
	cp -r languages/thingtalk/$* languages/thingtalk/*.genie languages/thingtalk/*.js $@
	echo "import '$*/thingtalk.genie';" > $@/index.genie
	echo "import '$*/contextual.genie';" > $@/contextual.genie
	touch $@

bundle/%.zip: bundle/%
	cd $< ; zip -r ../$*.zip *

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
