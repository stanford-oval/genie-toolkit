SHELL := /bin/bash

po_file ?=
geniedir = .
genie ?= node --experimental_worker --max_old_space_size=8400 $(geniedir)/dist/tool/genie.js

builtin_skills = $(foreach d,$(wildcard $(geniedir)/data/builtins/*/manifest.tt),$(patsubst %/manifest.tt,$$(basename %),$(d)))
builtin_path = $(geniedir)/data/builtins/

custom_skills ?=
custom_path ?=

create-pot: $(geniedir)/po
	make all

	# remove double-slashes (caused by old BSD find) and sort lines
	find lib/ tool/ -name \*.js -or -name \*.ts | sed 's@//@/@' | sort > po/POTFILES

	mkdir -p $</tmp
	for fname in manifest dataset ; do \
  		for option in builtin custom ; do \
  		  	if [ "$$option" == "builtin" ] ; then \
  		  		skills="$(builtin_skills)" ; \
  		  		path=$(builtin_path) ; \
  		  	elif [ "$$option" == "custom" ] ; then \
  		  		skills="$(custom_skills)" ; \
  		  		path=$(custom_path) ; \
  		  	fi ; \
			for skill in $$skills ; do \
				kind=$$skill-$$fname ; \
				echo "processing $$kind" ; \
				$(genie) extract-translatable-annotations $$path/$$skill/"$$fname".tt -o $</tmp/$$kind.js ; \
				echo $</tmp/$$kind.js >> po/POTFILES ; \
			done ; \
		done ; \
	done

	xgettext -kN_ -c -f po/POTFILES -x po/POTFILES.skip -LJavaScript -o po/${npm_package_name}.pot --from-code UTF-8 --package-name ${npm_package_name} --package-version ${npm_package_version}

update-po:
	msgmerge -U $(po_file) ./po/genie-toolkit.pot
