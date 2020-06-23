# Almond

[![Build Status](https://travis-ci.org/stanford-oval/almond-dialog-agent.svg?branch=master)](https://travis-ci.org/stanford-oval/almond-dialog-agent) [![Coverage Status](https://coveralls.io/repos/github/stanford-oval/almond-dialog-agent/badge.svg?branch=master)](https://coveralls.io/github/stanford-oval/almond-dialog-agent?branch=master) [![Dependency Status](https://david-dm.org/stanford-oval/almond-dialog-agent/status.svg)](https://david-dm.org/stanford-oval/almond-dialog-agent) [![Greenkeeper badge](https://badges.greenkeeper.io/stanford-oval/almond-dialog-agent.svg)](https://greenkeeper.io/)

## End User Programmable Virtual Assistants

This repository contains the dialog agent for Almond, the end user programmable
assistant.

It contains a library to handle the input from the user, invoke the
semantic parser, query the user for any unspecified information, and
complete the command to be executed.

The Almond dialog agent is meant to be used in one of the Almond platform layers:
- [cloud](https://github.com/stanford-oval/almond-cloud): a web version of Almond, multiuser
- [server](https://github.com/stanford-oval/almond-server): single user web Almond, for a home server
- [android](https://github.com/stanford-oval/almond-android): a standalone Android app
- [gnome](https://github.com/stanford-oval/almond-gnome): a standalone GNOME/GTK+ app
- [command line](https://github.com/stanford-oval/almond-cmdline): for testing and development

Almond is a research project led by prof. Monica Lam, from Stanford University.
You can find more information at <https://almond.stanford.edu>.

## License

This package is covered by the GNU General Public License, version 3
or any later version. Further details are in the LICENSE file.
