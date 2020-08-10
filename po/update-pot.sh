#!/bin/sh

set -e
set -x

podir=`dirname $0`
mkdir -p $podir/tmp

find lib -name \*.js > po/POTFILES
for f in $podir/../data/builtins/*/manifest.tt ; do
	kind=`basename $f .tt`
	node $podir/extract-translatable-annotations.js $f > $podir/tmp/$kind.js
	echo $podir/tmp/$kind.js >> po/POTFILES
done
node $podir/extract-translatable-templates.js $podir/../languages/thingtalk/en/dialogue.genie > $podir/tmp/templates.js
echo $podir/tmp/templates.js >> po/POTFILES
xgettext -kN_ -c -f po/POTFILES -x po/POTFILES.skip -o po/genie-toolkit.pot --from-code UTF-8 --package-name genie-toolkit --package-version ${npm_package_version}
