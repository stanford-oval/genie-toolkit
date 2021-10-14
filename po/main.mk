po_file ?=
geniedir = .
genie ?= node --experimental_worker --max_old_space_size=8400 $(geniedir)/dist/tool/genie.js


#npm_package_name ?= genie-toolkit
#npm_package_version ?=

create-pot: $(geniedir)/po
	make all

	# remove double-slashes (caused by old BSD find) and sort lines
	find lib/ tool/ -name \*.js -or -name \*.ts | sed 's@//@/@' | sort > po/POTFILES

	mkdir -p $</tmp
	for f in $</../data/builtins/*/manifest.tt ; do \
		kind=$(basename "$(dirname $$f))" ; \
		$(genie) extract-translatable-annotations $$f -o $</tmp/$$kind.js ; \
		echo $</tmp/$$kind.js >> po/POTFILES ; \
	done

	xgettext -kN_ -c -f po/POTFILES -x po/POTFILES.skip -LJavaScript -o po/${npm_package_name}.pot --from-code UTF-8 --package-name ${npm_package_name} --package-version ${npm_package_version}

update-po:
	msgmerge -U $(po_file) ./po/genie-toolkit.pot
