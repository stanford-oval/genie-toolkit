
zipfiles = twitter-account.zip bodytrace-scale.zip

all: $(zipfiles)

%.zip: %
	cd $< ; \
	npm install ; \
	zip -r $(abspath $@) *

upload: $(zipfiles)
	scp $^ pepperjack.stanford.edu:/home/ThingPedia/code_storage/devices/

clean:
	rm -f *.zip
