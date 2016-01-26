# Installing and running ThingEngine

These installation instructions are for running your own ThingEngine.
Most users will not want to follow these instruction, especially at their
first encounter with ThingEngine. Instead, we recommend starting with
an account at [ThingEngine Cloud](https://thingengine.stanford.edu), the
free online version.

## Installing pre-built binaries

Pre-built binaries are available for some of our supported platforms:

- Android (phone tier): http://web.stanford.edu/~gcampagn/misc/thingengine.apk
- Fedora 23 x86_64 (server tier): http://web.stanford.edu/~gcampagn/misc/thingengine-server-1.0.0-1.fc23.x86_64.rpm

For the Android build, once installed it is automatically enabled right away.
For the server build, once installed you must enable it with
    systemctl enable thingengine-server.service

## Building from source

### Phone platform

You must have the Android SDK and NDK installed and properly configured
in your $PATH.

From the top-level, run `make build-android`. The resulting APK will
be in /platform/android/app/build/outputs/apk.

Android Studio project files are provided in /platform/android/, so **after
the first build** you can load Android Studio and click run or debug.

### Server platform

To build the server to run it, from the top-level, run `make build-server`.
Once built, the server can be run as `node path/to/platform/server/main.js`
from any empty directory.

As a convenience the command `make run-server` will do both and run the
server in the `home-server` directory.

To build the server as an installable package, you should first create a tarball,
by running `make dist` from /platform/server/, then build the package
by passing prefix= and localstatedir= to make. Examples for debian and
fedora are provided in /platform/server/.

The server runs on port 3000 by default. You can change it with the _PORT_
environment variable, but this is not recommended.

If you run the server as root, it will try to drop capabilities to the user
thingengine and group thingengine immediately after started. It is up to you
to make sure this user and group exists.

### Cloud platform

The cloud platform must be installed in /opt/thingengine. It is safe
to read-only bind mount your installation directory there, or just
clone the git repository directly in there. A symlink will not suffice
though, because the sandbox will not be able to resolve it.

To build the dependencies, from the top-level, run `make
build-cloud`. You must have `sudo` configured to build the sandbox and
make it setuid.

#### SQL setup

You must also have a working MySQL database. Data definition SQL
commands that must be run before the cloud platform is started are in
/platform/cloud/model/schema.sql.

By default, the server will connect to database thingengine on the
localhost server with the user thingengine and password
thingengine. You can change that by passing a _DATABASE\_URL_
environment variable (in the form commonly provided by cloud hosting
services such as Heroku).

The SQL file containing the schema will also create the "root" user,
with password "rootroot". This is initially the only system
administrator (with the ability to kill and restart other users), and
you should change its password immediately. Note that administrator
accounts will also have engines, things and apps running in their
name, just like regular accounts. There is no support yet for creating
service accounts that only operate on the website.

#### Deployment

The cloud platform will work from any current directory, and will not
modify any file outside of it. You should run from an empty directory
like `home-cloud` in the top-level.

Working Debian initscripts and systemd unit files are provided in
platform/cloud.  The Debian initscript will run in
/var/lib/thingengine-cloud, the systemd unit in /srv/thingengine. Both
assume there exists a user called thingengine to run the service as -
the service does not drop capabilities and should not be run as root.

You should set up a secret key (used for sessions) in the
_SECRET\_KEY_ environment variable before deploying for production.

The server by default runs on port 8080. You can change it with the
_PORT_ environment variable, but it is recommended instead to set up a
forwarding proxy listening on ports 80 and 443, because the server
will not do HTTPS natively. Example configuration for ngnix is in
/platform/cloud/ngnix.conf.

#### Setting up the virtual assistant

If you want to offer virtual assistant services (like Sabrina is
offered on the reference installation) to your users, you should first
create a suitable Omlet account, that will appear as the account
the user is interacting with.

Then, while logged in as an administrator account, you would visit
/assistant/setup. The page will redirect to Omlet to complete
authentication: choose to authenticate yourself as the virtual
assistant account. When successful, you will redirected back to
an almost empty page that says Ok, and your users will be able
to enable the assistant from their accounts.
