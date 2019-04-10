# ThingEngine

[![Build Status](https://travis-ci.org/stanford-oval/thingengine-core.svg?branch=master)](https://travis-ci.org/stanford-oval/ThingTalk) [![Coverage Status](https://coveralls.io/repos/github/stanford-oval/thingengine-core/badge.svg?branch=master)](https://coveralls.io/github/stanford-oval/ThingTalk?branch=master) [![Dependency Status](https://david-dm.org/stanford-oval/thingengine-core/status.svg)](https://david-dm.org/stanford-oval/thingengine-core) [![Greenkeeper badge](https://badges.greenkeeper.io/stanford-oval/thingengine-core.svg)](https://greenkeeper.io/)

## A Modular, Powerful Virtual Assistant Engine

ThingEngine is the runtime of Almond, the open virtual assistant. It holds
your credentials and data, and runs the command you define using the ThingTalk
language.

This package contains the core of ThingEngine, which is concerned with
actually loading and executing the ThingTalk code. It cannot be used alone, it
must be imported by one of the integration layers
([cloud](https://github.com/Stanford-IoT-Lab/thingengine-platform-cloud),
[server](https://github.com/Stanford-IoT-Lab/thingengine-platform-server)
or
[android](https://github.com/Stanford-IoT-Lab/thingengine-platform-android))

ThingEngine is part of Almond, a research project led by
prof. Monica Lam, from Stanford University. You can find more
information at <https://almond.stanford.edu>, and you can
find user documentation [here](/doc/main.md).
