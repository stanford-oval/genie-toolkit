build-all: build-server build-android build-cloud

build-engine:
	make -C engine all

build-engine-android:
	make -C engine all-android

build-shared:
	make -C platform/shared all

build-server: build-engine build-shared
	make -C platform/server all

build-cloud: build-engine build-shared
	make -C platform/cloud all

build-android-js: build-engine-android build-shared
	cd platform/android/app/src/main/assets/jxcore; npm install --no-optional --only=prod
	cd platform/android/app/src/main/assets/jxcore/frontend; npm install --no-optional --only=prod

build-android: build-android-js
	cd platform/android; ./gradlew build

install-android-debug: build-android
	adb install -r platform/android/app/build/outputs/apk/app-debug.apk

logcat:
	adb logcat *:S JX:V thingengine.Service:V thingengine.UI:V jxcore-log:V

run-server: build-server
	test -d home-server || mkdir home-server/
	cd home-server/ ; node ../platform/server/main.js

run-android-mock: build-android-js
	test -d home-android || mkdir home-android/
	cd home-android/ ; jx ../platform/android/app/src/main/assets/jxcore_mock.js

clean:
	make -C engine clean
	make -C platform/server clean
	make -C platform/android clean
	rm -fr home-android
	rm -fr home-server
