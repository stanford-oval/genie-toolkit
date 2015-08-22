build-all: build-server build-android

build-engine:
	make -C engine all

build-server: build-engine
	make -C platform/server all

build-cloud: build-engine
	make -C platform/cloud all

build-android-js: build-engine
	cd platform/android/app/src/main/assets/jxcore; npm install

build-android: build-android-js
	cd platform/android; ./gradlew build

install-android-debug: build-android
	adb install -r platform/android/app/build/outputs/apk/app-debug.apk

logcat:
	adb logcat *:S JX:V thingengine.Service:V jxcore-log:V

test-data:
	test -d home-server || mkdir home-server/
	cp test/server-apps.db home-server/apps.db
	sqlite3 home-server/sqlite.db < engine/db/schema.sql
	echo '[]' > home-server/devices.db
	echo '{}' > home-server/prefs.db
	test -d home-android || mkdir home-android/
	cp test/android-apps.db home-android/apps.db
	sqlite3 home-android/sqlite.db < engine/db/schema.sql
	echo '[]' > home-android/devices.db
	echo '{}' > home-android/prefs.db

run-server: build-server
	test -d home-server || mkdir home-server/
	cd home-server/ ; node ../platform/server/main.js --test

run-android-mock: build-android-js
	test -d home-android || mkdir home-android/
	cd home-android/ ; node ../platform/android/app/src/main/assets/jxcore_mock.js

clean:
	make -C engine clean
	make -C platform/server clean
	make -C platform/android clean
	rm -fr home-android
	rm -fr home-server
