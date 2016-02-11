all:
	npm install --no-optional --only=prod sqlite3
	make all-android

all-android:
	npm install --no-optional --only=prod

all-fedora:
	npm link ws
	npm link node-uuid
	npm link sqlite3
	make all-android

clean:
	rm -fr node_modules/{q,deep-equal,ip,node-uuid,ws}
