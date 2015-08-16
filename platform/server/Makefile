
prefix ?= /usr
libdir ?= $(prefix)/lib
pkglibdir ?= $(libdir)/thingengine-server
localstatedir ?= /var/lib/thingengine-server

all: platform_config.js
	cd engine ; npm install
	cd frontend ; npm install
	npm install

platform_config.js:
	echo "exports.PKGLIBDIR = '$(prefix)'; exports.LOCALSTATEDIR = '$(localstatedir)';" > platform_config.js

SUBDIRS = engine frontend
our_sources = main.js platform.js platform_config.js

# Note the / after engine, forces symlink resolution
install: all
	install -m 0755 -d $(DESTDIR)$(pkglibdir)
	for d in $(SUBDIRS) ; do cp -pr $$d/ $(DESTDIR)$(pkglibdir) ; done
	install -m 0644 $(our_sources) $(DESTDIR)$(pkglibdir)

clean:
	make -C ../../engine clean
	make -C frontend clean

# Note the / after engine, forces symlink resolution
build-debian-src: clean
	rm -fr tmp/
	mkdir tmp/
	cp -pr debian/ tmp/
	for d in $(SUBDIRS) ; do cp -pr $$d/ tmp/ ; done
	cp -pr $(our_sources) tmp/
	cd tmp ; debuild -S
	rm -fr tmp/
