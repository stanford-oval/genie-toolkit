build-all: build-server build-android

build-engine:
	cd engine; npm install

build-server: build-engine
	cd platform/server; npm install

build-android: build-engine
	cd platform/android/app/src/main/assets/jxcore; npm install
	cd platform/android; ./gradlew build

install-android-debug: build-android
	adb install -r platform/android/app/build/outputs/apk/app-debug.apk

logcat:
	adb logcat *:S JX:V thingengine.Service:V jxcore-log:V
