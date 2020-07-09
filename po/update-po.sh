#!/bin/sh
exec msgmerge -U $1 ./po/${npm_package_name}.pot
