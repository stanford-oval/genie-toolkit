
zipfiles = \
	bluetooth-generic.zip \
	twitter-account.zip \
	bodytrace-scale.zip \
	heatpad.zip \
	sportradar.zip

all: $(zipfiles)

%.zip: %
	cd $< ; \
	npm install ; \
	zip -r $(abspath $@) *

upload: $(zipfiles)
	#scp $^ pepperjack.stanford.edu:/home/ThingPedia/code_storage/devices/
	for f in $^ ; do aws s3 cp $$f s3://thingpedia/devices/ ; done

clean:
	rm -f *.zip
