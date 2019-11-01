bundle/%: languages/thingtalk/%/*.genie languages/thingtalk/*.genie languages/thingtalk/*.js
	mkdir -p $@
	cp -r languages/thingtalk/$* languages/thingtalk/*.genie languages/thingtalk/*.js $@
	echo "import '$*/thingtalk.genie';" > $@/index.genie
	echo "import '$*/contextual.genie';" > $@/contextual.genie
	touch $@

bundle/%.zip: bundle/%
	cd $< ; zip -r ../$*.zip *

all: bundle/en.zip bundle/zh-tw.zip
