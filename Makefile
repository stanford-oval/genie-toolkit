bundle/%: languages/%/*.genie languages/*.genie languages/*.js
	mkdir -p $@
	cp -r languages/$* languages/*.genie languages/*.js $@
	echo "import '$*/thingtalk.genie';" > $@/index.genie
	echo "import '$*/contextual.genie';" > $@/contextual.genie
	touch $@

bundle/%.zip: bundle/%
	cd $< ; zip -r ../$*.zip *

all: bundle/en.zip bundle/zh-tw.zip
