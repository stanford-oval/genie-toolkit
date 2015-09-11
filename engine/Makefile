all:
	npm install
	npm dedupe

all-fedora:
	npm link ws
	npm link node-uuid
	npm link xml2js
	npm install
	npm dedupe

clean:
	rm -fr node_modules/{q,node-uuid,ws,deep-equal,ip,.bin}
	for i in apps/* channels/* devices/ * ; do \
	test -d $$i || continue; \
	test -f $$i/Makefile && make -C $$i clean ; \
	test -f $$i/Makefile || rm -fr $$i/node_modules ; \
	done
