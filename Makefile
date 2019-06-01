%.json : %.sql
	node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1]).toString("utf8")))' $< > $@.tmp
	mv $@.tmp $@

lib/devices/builtins/%.tt.json : data/%.tt
	node -e 'console.log(JSON.stringify(require("fs").readFileSync(process.argv[1]).toString("utf8")))' $< > $@.tmp
	mv $@.tmp $@

%.mo : %.po
	msgfmt $< -o $@

all = \
	$(patsubst %.po,%.mo,$(wildcard po/*.po)) \
	$(patsubst data/%.tt,lib/devices/builtins/%.tt.json,$(wildcard data/*.tt)) \
	lib/db/schema.json

all: $(all)
