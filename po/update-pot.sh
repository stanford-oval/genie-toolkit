#!/bin/sh

podir=`dirname $0`
mkdir -p $podir/tmp
for f in $podir/../data/builtins/*.tt ; do
	kind=`basename $f .tt`
	node $podir/extract-translatable-annotations.js $f > $podir/tmp/$kind.js
done
find lib -name \*.js > po/POTFILES
xgettext -kN_ -c -f po/POTFILES -x po/POTFILES.skip -o po/${npm_package_name}.pot --from-code UTF-8 --package-name ${npm_package_name} --package-version ${npm_package_version}
