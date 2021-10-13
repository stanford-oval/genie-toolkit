#!/bin/sh

set -e
set -x

make
podir=`dirname $0`

# remove double-slashes (caused by old BSD find) and sort lines
find lib/ tool/ -name \*.js -or -name \*.ts | sed 's@//@/@' | sort > po/POTFILES

mkdir -p $podir/tmp
for f in $podir/../data/builtins/*/manifest.tt ; do
	kind=$(basename "$(dirname $f))"
	node --experimental_worker --max_old_space_size=8500 `dirname "$0"`/../dist/tool/genie.js extract-translatable-annotations --append $f -o $podir/tmp/$kind.js
	echo $podir/tmp/$kind.js >> po/POTFILES
done

xgettext -kN_ -c -f po/POTFILES -x po/POTFILES.skip -LJavaScript -o po/${npm_package_name}.pot --from-code UTF-8 --package-name ${npm_package_name} --package-version ${npm_package_version}
