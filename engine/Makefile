all:
	npm install --no-optional --only=prod sqlite3
	make all-android

all-android:
	npm install --no-optional --only=prod
	for i in device-classes/* node_modules/omclient node_modules/thingpedia ; do \
	test -d $$i || continue; \
	test -f $$i/Makefile && make -C $$i all ; \
	test -f $$i/Makefile || (cd $$i ; npm install --no-optional --only=prod ); \
	npm dedupe; \
	done

all-fedora:
	npm link ws
	npm link node-uuid
	npm link xml2js
	npm link sqlite3
	make all-android

clean:
	rm -fr node_modules/{q,node-uuid,ws,deep-equal,ip,.bin,adt,oauth,tmp}
	for i in device-classes/* ; do \
	test -d $$i || continue; \
	test -f $$i/Makefile && make -C $$i clean ; \
	test -f $$i/Makefile || rm -fr $$i/node_modules ; \
	done
