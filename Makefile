build-all: build-server build-android

build-engine:
	make -C engine all

build-server: build-engine
	make -C platform/server all

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
	echo '[{"kind":"test"}]' > home-server/apps.db
	echo '[]' > home-server/device.db
	echo '{}' > home-android/prefs.db
	test -d home-android || mkdir home-android/
	echo '[{"kind":"test"}]' > home-android/apps.db
	echo '[]' > home-android/device.db
	echo '{}' > home-android/prefs.db

run-server: build-server
	-mkdir home-server/
	cd home-server/ ; node ../platform/server/main.js --test

run-android-mock: build-android-js
	-mkdir home-android/
	cd home-android/ ; node ../platform/android/app/src/main/assets/jxcore_mock.js

clean:
	make -C engine clean
	make -C platform/server clean
	make -C platform/android clean
