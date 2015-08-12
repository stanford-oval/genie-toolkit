build-all: build-server build-android

build-engine:
	cd engine; npm install

build-server: build-engine
	cd platform/server; npm install

build-android-js: build-engine
	cd platform/android/app/src/main/assets/jxcore; npm install

build-android: build-android-js
	cd platform/android; ./gradlew build

install-android-debug: build-android
	adb install -r platform/android/app/build/outputs/apk/app-debug.apk

logcat:
	adb logcat *:S JX:V thingengine.Service:V jxcore-log:V

test-data:
	-mkdir home-server/
	echo '[{"kind":"test"}]' > home-server/apps.db
	-mkdir home-android/
	echo '[{"kind":"test"}]' > home-android/apps.db

run-server: build-server
	-mkdir home-server/
	cd home-server/ ; node ../platform/server/main.js

run-android-mock: build-android-js
	-mkdir home-android/
	cd home-android/ ; node ../platform/android/app/src/main/assets/jxcore_mock.js
