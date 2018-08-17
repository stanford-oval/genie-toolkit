// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
Q.longStackSupport = true;
process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');
const Stream = require('stream');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const Engine = require('../lib/engine');
const DeviceView = require('../lib/devices/device_view');
const IpAddress = require('../lib/util/ip_address');

// make all errors fatal
/*const originalconsoleerror = console.error;
console.error = function(errmsg, ...stuff) {
    originalconsoleerror(errmsg, ...stuff);
    process.exit(1);
};*/

class MockAssistant {
    constructor() {
    }

    _setConversation(conv) {
        this._conv = conv;
    }

    getConversation(conv) {
        assert.strictEqual(conv, 'mock');
        return this._conv;
    }

    notifyAll(...data) {
        this._conv.notify(...data);
    }
    notifyErrorAll(...data) {
        this._conv.notifyError(...data);
    }
}

const SUCCESS = {};
const FAILURE = {};

function testDevices(engine) {
    const devices = engine.devices;

    // test that the built devices are what we expect

    assert(devices.hasDevice('thingengine-own-desktop'));
    assert(devices.hasDevice('thingengine-own-global'));
    assert(devices.hasDevice('org.thingpedia.builtin.test'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.phone'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.home'));
    assert(!devices.hasDevice('org.thingpedia.builtin.thingengine.gnome'));

    // test looking up devices

    const builtin = devices.getAllDevicesOfKind('org.thingpedia.builtin.thingengine.builtin');
    assert.strictEqual(builtin.length, 1);
    assert.strictEqual(builtin[0], devices.getDevice('thingengine-own-global'));

    const test = devices.getAllDevicesOfKind('org.thingpedia.builtin.test');
    assert.strictEqual(test.length, 1);
    assert.strictEqual(test[0], devices.getDevice('org.thingpedia.builtin.test'));

    assert.deepStrictEqual(devices.getAllDevicesOfKind('messaging'), []);
    assert.deepStrictEqual(devices.getAllDevicesOfKind('com.xkcd'), []);

    // test device views, adding and removing devices

    let added = FAILURE;
    let removed = SUCCESS;
    const view = new DeviceView(devices, Ast.Selector.Device('com.xkcd', null, null));
    view.on('object-added', (d) => {
        assert.strictEqual(d, devices.getDevice('com.xkcd'));
        added = SUCCESS;
    });
    view.on('object-removed', () => {
        removed = FAILURE;
    });
    view.start();
    assert.deepStrictEqual(view.values(), []);

    let view2;

    return devices.loadOneDevice({ kind: 'com.xkcd' }, true).then((device) => {
        const xkcd = devices.getAllDevicesOfKind('com.xkcd');
        assert.strictEqual(xkcd.length, 1);
        assert.strictEqual(xkcd[0], device);
        assert(devices.hasDevice('com.xkcd'));
        assert.strictEqual(devices.getDevice('com.xkcd'), device);

        const viewvalues = view.values();
        assert.strictEqual(viewvalues.length, 1);
        assert.strictEqual(viewvalues[0], device);

        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);

        view.stop();
        view2 = new DeviceView(devices, Ast.Selector.Device('com.xkcd', null, null));
        // start the view before we connect to the signal, so we are sure not to receive it
        view2.start();
        view2.on('object-added', (d) => {
            assert.strictEqual(d, devices.getDevice('com.xkcd'));
            added = FAILURE;
        });
        view2.on('object-removed', () => {
            removed = SUCCESS;
        });

        const view3 = new DeviceView(devices, Ast.Selector.Device('com.xkcd', 'com.xkcd', null));
        view3.start();
        assert.strictEqual(view3.values().length, 1);
        view3.stop();

        const view4 = new DeviceView(devices, Ast.Selector.Device('com.xkcd', 'com.xkcd2', null));
        view4.start();
        assert.strictEqual(view4.values().length, 0);
        view4.stop();

        return devices.removeDevice(device);
    }).then(() => {
        assert(!devices.hasDevice('com.xkcd'));
        assert.strictEqual(added, SUCCESS);
        assert.strictEqual(removed, SUCCESS);

        assert.deepStrictEqual(view2.values(), []);
    }).then(() => {
        return devices.updateDevicesOfKind('com.xkcd');
    }).then(() => {
        // should do (almost) nothing because there is no twitter configured
        return devices.updateDevicesOfKind('com.twitter');
    }).then(() => {
        const test = devices.getDevice('org.thingpedia.builtin.test');

        return test.get_get_data({ count: 2, size: 10 });
    }).then((result) => {
        assert.deepStrictEqual(result, [{
            data: '!!!!!!!!!!',
        }, {
            data: '""""""""""'
        }]);

        const fakeState = {
            _state: {},
            get(key) {
                return this._state[key];
            },
            set(key, v) {
                this._state[key] = v;
                return v;
            }
        };

        return new Promise((resolve, reject) => {
            const test = devices.getDevice('org.thingpedia.builtin.test');

            const stream = test.subscribe_get_data({ size: 10 }, fakeState);
            const buffer = [];

            stream.on('data', (d) => {
                assert(d.hasOwnProperty('__timestamp'));
                delete d.__timestamp;
                buffer.push(d);
            });
            stream.on('end', () => reject(new Error('Unexpected end')));
            stream.on('error', reject);

            let atTimeout = null;
            setTimeout(() => {
                assert(buffer.length >= 4 && buffer.length <= 6);
                stream.destroy();
                atTimeout = buffer.length;
            }, 5000);
            setTimeout(() => {
                assert.strictEqual(buffer.length, atTimeout);
                assert.deepStrictEqual(buffer.slice(0, 4), [
                    { data: '!!!!!!!!!!' },
                    { data: '""""""""""' },
                    { data: '##########' },
                    { data: '$$$$$$$$$$' }
                ]);

                resolve();
            }, 10000);
        });
    });
}

function testHTTPClient(engine) {
    return ThingTalk.Grammar.parseAndTypecheck('now => @com.xkcd.get_comic() => notify;', engine.schemas, false).then(() => {
        // do it again, to check that it is cached
        return ThingTalk.Grammar.parseAndTypecheck('now => @com.xkcd.get_comic() => notify;', engine.schemas, false);
    }).then(() => {
        // now with metas
        return ThingTalk.Grammar.parseAndTypecheck('now => @com.xkcd.get_comic() => notify;', engine.schemas, true);
    });
}

function testSimpleDo(engine) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originaldo = test.do_eat_data;

    let result = FAILURE;
    test.do_eat_data = (data) => {
        assert.deepStrictEqual(data, { data: 'some data ' });
        result = SUCCESS;
    };

    return engine.apps.loadOneApp('now => @org.thingpedia.builtin.test.eat_data(data="some data ");',
        {}, undefined, undefined, 'some app', 'some app description', true).then((app) => {
        // when we get here, the app might or might not have started already
        // to be sure, we iterate its mainOutput

        // the app is still running, so the engine should know about it
        assert(engine.apps.hasApp(app.uniqueId));

        return app.mainOutput.next();
    }).then((what) => {
        // there should be no result output, so we should be done immediately
        assert(what.item.isDone);
        what.resolve();
        assert.strictEqual(result, SUCCESS);
        test.do_eat_data = originaldo;
    });
}

function testDoSay(engine) {
    return engine.apps.loadOneApp('now => @org.thingpedia.builtin.thingengine.builtin.say(message="test message");',
        {}, undefined, undefined, 'some app', 'some app description', true).then((app) => {
        // when we get here, the app might or might not have started already
        // to be sure, we iterate its mainOutput

        // the app is still running, so the engine should know about it
        assert(engine.apps.hasApp(app.uniqueId));

        return Promise.all([app, app.mainOutput.next()]);
    }).then(([app, what]) => {
        assert(what.item.isNotification);
        assert.strictEqual(what.item.outputType, null);
        assert.strictEqual(what.item.outputValue, "test message");
        what.resolve();
        return app.mainOutput.next();
    }).then((what) => {
        // there should be no result output, so we should be done immediately
        assert(what.item.isDone);
        what.resolve();
    });
}

function testDoError(engine) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originaldo = test.do_eat_data;

    const error = new Error('test error');
    test.do_eat_data = (data) => {
        throw error;
    };

    return engine.apps.loadOneApp('now => @org.thingpedia.builtin.test.eat_data(data="some data ");',
        {}, undefined, undefined, 'some app', 'some app description', true).then((app) => {
        // when we get here, the app might or might not have started already
        // to be sure, we iterate its mainOutput

        // the app is still running, so the engine should know about it
        assert(engine.apps.hasApp(app.uniqueId));

        return app.mainOutput.next().then((what) => {
            assert(what.item.isError);
            what.resolve();
            assert.strictEqual(what.item.icon, null);
            assert.strictEqual(what.item.error, error);
            return app.mainOutput.next();
        }).then((what) => {
            // there should be no result output, so we should be done immediately
            assert(what.item.isDone);
            what.resolve();
            test.do_eat_data = originaldo;
        });
    });
}

function testSimpleGet(engine, icon = null) {
    return engine.apps.loadOneApp('now => @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
        { $icon: icon }, undefined, undefined, 'some app', 'some app description', true).then((app) => {
        // when we get here, the app might or might not have started already
        // to be sure, we iterate its mainOutput

        // the app is still running, so the engine should know about it
        assert(engine.apps.hasApp(app.uniqueId));
        return app.mainOutput.next().then((what) => {
            assert(what.item.isNotification);
            what.resolve();
            assert.strictEqual(what.item.icon, icon);
            assert.strictEqual(what.item.outputType, 'org.thingpedia.builtin.test:get_data');
            assert.deepStrictEqual(what.item.outputValue, { data: '!!!!!!!!!!', count: 2, size: 10 });
            return app.mainOutput.next();
        }).then((what) => {
            assert(what.item.isNotification);
            what.resolve();
            assert.strictEqual(what.item.icon, icon);
            assert.strictEqual(what.item.outputType, 'org.thingpedia.builtin.test:get_data');
            assert.deepStrictEqual(what.item.outputValue, { data: '""""""""""', count: 2, size: 10 });
            return app.mainOutput.next();
        }).then((what) => {
            assert(what.item.isDone);
            what.resolve();
        });
    });
}

function testGetGet(engine, icon = null) {
    return engine.apps.loadOneApp('now => @org.thingpedia.builtin.test.get_data(count=2, size=10byte) join @org.thingpedia.builtin.test.dup_data() on (data_in=data) => notify;',
        { $icon: icon }, undefined, undefined, 'some app', 'some app description', true).then((app) => {
        // when we get here, the app might or might not have started already
        // to be sure, we iterate its mainOutput

        // the app is still running, so the engine should know about it
        assert(engine.apps.hasApp(app.uniqueId));
        return app.mainOutput.next().then((what) => {
            assert(what.item.isNotification);
            what.resolve();
            assert.strictEqual(what.item.icon, icon);
            assert.strictEqual(what.item.outputType, 'org.thingpedia.builtin.test:get_data+org.thingpedia.builtin.test:dup_data');
            assert.deepStrictEqual(what.item.outputValue, { data: '!!!!!!!!!!', count: 2, size: 10, data_in: '!!!!!!!!!!', data_out: '!!!!!!!!!!!!!!!!!!!!',});
            return app.mainOutput.next();
        }).then((what) => {
            assert(what.item.isNotification);
            what.resolve();
            assert.strictEqual(what.item.icon, icon);
            assert.strictEqual(what.item.outputType, 'org.thingpedia.builtin.test:get_data+org.thingpedia.builtin.test:dup_data');
            assert.deepStrictEqual(what.item.outputValue, { data: '""""""""""', count: 2, size: 10, data_in: '""""""""""', data_out: '""""""""""""""""""""', });
            return app.mainOutput.next();
        }).then((what) => {
            assert(what.item.isDone);
            what.resolve();
        });
    });
}

function testGetError(engine, icon = null) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originalget = test.get_get_data;

    const error = new Error('test error');
    test.get_get_data = (data) => {
        throw error;
    };

    return engine.apps.loadOneApp('now => @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
        { $icon: icon }, undefined, undefined, 'some app', 'some app description', true).then((app) => {
        // when we get here, the app might or might not have started already
        // to be sure, we iterate its mainOutput

        // the app is still running, so the engine should know about it
        assert(engine.apps.hasApp(app.uniqueId));
        return app.mainOutput.next().then((what) => {
            assert(what.item.isError);
            what.resolve();
            assert.strictEqual(what.item.icon, 'org.foo');
            assert.strictEqual(what.item.error, error);
            return app.mainOutput.next();
        }).then((what) => {
            assert(what.item.isDone);
            what.resolve();
            test.get_get_data = originalget;
        });
    });
}

function testWhen(engine, conversation) {
    const assistant = engine.platform.getCapability('assistant');

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        assistant._setConversation({
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-foo-' + conversation);
                assert(data.hasOwnProperty('__timestamp'));
                delete data.__timestamp;
                if (count === 0) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '!!!!!!!!!!' });
                    count++;
                } else if (count === 1) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '""""""""""' });
                    engine.apps.removeApp(app);
                    count++;
                    resolve();
                } else {
                    try {
                        assert.fail("too many results from the monitor");
                    } catch(e) {
                        reject(e);
                    }
                }
            },

            notifyError(appId, icon, err) {
                assert.fail('no error expected');
            }
        });

        return engine.apps.loadOneApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { $icon: 'org.foo', $conversation: conversation ? 'mock' : undefined },
            'uuid-foo-' + conversation, undefined, 'some app', 'some app description', true).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-foo-' + conversation);
        }).catch(reject);
    });
}

function testWhenErrorInit(engine) {
    const assistant = engine.platform.getCapability('assistant');

    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originalsubscribe = test.subscribe_get_data;

    const error = new Error('Test error');

    test.subscribe_get_data = (args, state) => {
        throw error;
    };

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for error to appear')), 10000).unref();

        assistant._setConversation({
            notify(appId, icon, outputType, data) {
                assert.fail('expected no results');
            },

            notifyError(appId, icon, err) {
                assert.strictEqual(appId, 'uuid-when-error');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(err, error);

                assert(engine.apps.hasApp(appId));

                const app = engine.apps.getApp(appId);

                assert(app.isEnabled);
                assert(app.isRunning);
                engine.apps.removeApp(app);

                resolve();
            }
        });

        engine.apps.loadOneApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { $icon: 'org.foo', $conversation: 'mock' },
            'uuid-when-error', undefined, 'some app', 'some app description', true).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-when-error');
        }).catch(reject);
    }).then((v) => {
        test.subscribe_get_data = originalsubscribe;
        return v;
    }, (e) => {
        test.subscribe_get_data = originalsubscribe;
        throw e;
    });
}

function testWhenErrorAsync(engine) {
    const assistant = engine.platform.getCapability('assistant');
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originalsubscribe = test.subscribe_get_data;

    const error = new Error('Asynchronous test error');

    test.subscribe_get_data = (args, state) => {
        const stream = new Stream.Readable({ read() {}, objectMode: true });
        stream.destroy = () => {};

        setTimeout(() => {
            const now = Date.now();
            for (let i = 0; i < 2; i++)
                stream.push({ __timestamp: now, data: genFakeData(args.size, '!'.charCodeAt(0) + i) });

            stream.emit('error', error);
        }, 100);
        return stream;
    };

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        let seenerror = false;
        assistant._setConversation({
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                if (!app) {
                    console.log([appId, icon, outputType, data]);
                    throw new Error('??? ' + appId);
                }
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-when-error-async');
                assert(data.hasOwnProperty('__timestamp'));
                delete data.__timestamp;
                if (count === 0) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '!!!!!!!!!!' });
                    count++;
                } else if (count === 1) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '""""""""""' });
                    count++;
                    if (seenerror) {
                        engine.apps.removeApp(app);
                        resolve();
                    }
                } else {
                    try {
                        assert.fail("too many results from the monitor");
                    } catch(e) {
                        reject(e);
                    }
                }
            },

            notifyError(appId, icon, err) {
                const app = engine.apps.getApp(appId);

                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-when-error-async');
                assert.strictEqual(err, error);

                seenerror = true;
                if (count === 2) {
                    engine.apps.removeApp(app);
                    resolve();
                }
            }
        });

        engine.apps.loadOneApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { $icon: 'org.foo' },
            'uuid-when-error-async', undefined, 'some app', 'some app description', true).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-when-error-async');
        }).catch(reject);
    }).then((v) => {
        test.subscribe_get_data = originalsubscribe;
        return v;
    }, (e) => {
        test.subscribe_get_data = originalsubscribe;
        throw e;
    });
}

function drainTestWhen(engine) {
    const assistant = engine.platform.getCapability('assistant');

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        assistant._setConversation({
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-foo-when-restart');
                assert(data.hasOwnProperty('__timestamp'));
                // drain and ignore the result
            },

            notifyError(appId, icon, err) {
                assert.fail('no error expected');
            }
        });

        engine.apps.loadOneApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { $icon: 'org.foo' },
            'uuid-foo-when-restart', undefined, 'some app', 'some app description', true).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-foo-when-restart');

            resolve(app.waitFinished().then(() => {
                return engine.apps.removeApp(app);
            }));
        }).catch(reject);
    });
}

function genFakeData(size, fill) {
    return String(Buffer.alloc(size, fill));
}

function testWhenRestart(engine) {
    const assistant = engine.platform.getCapability('assistant');
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originalsubscribe = test.subscribe_get_data;

    test.subscribe_get_data = (args, state) => {
        const stream = new Stream.Readable({ read() {}, objectMode: true });
        stream.destroy = () => {};

        setTimeout(() => {
            const now = Date.now();
            for (let i = 0; i < 10; i++)
                stream.push({ __timestamp: now, data: genFakeData(args.size, '!'.charCodeAt(0) + i) });
            stream.push(null);
        }, 100);
        return stream;
    };

    return drainTestWhen(engine).then(() => {
        return new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

            assistant._setConversation({
                notify(appId, icon, outputType, data) {
                    console.error(data);
                    assert.fail('no result expected');
                },

                notifyError(appId, icon, err) {
                    assert.fail('no error expected');
                }
            });

            return engine.apps.loadOneApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
                { $icon: 'org.foo' },
                'uuid-foo-when-restart', undefined, 'some app', 'some app description', true).then((app) => {
                assert.strictEqual(app.icon, 'org.foo');
                assert.strictEqual(app.uniqueId, 'uuid-foo-when-restart');

                resolve(app.waitFinished().then(() => {
                    return engine.apps.removeApp(app);
                }));
            }).catch(reject);
        });
    }).then((v) => {
        test.subscribe_get_data = originalsubscribe;
        return v;
    }, (e) => {
        test.subscribe_get_data = originalsubscribe;
        throw e;
    });
}

function testWhenGet(engine, conversation) {
    const assistant = engine.platform.getCapability('assistant');

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        assistant._setConversation({
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data+org.thingpedia.builtin.test:dup_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-when-get');
                //assert(data.hasOwnProperty('__timestamp'));
                //delete data.__timestamp;
                if (count === 0) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '!!!!!!!!!!', data_in: '!!!!!!!!!!', data_out: '!!!!!!!!!!!!!!!!!!!!' });
                    count++;
                } else if (count === 1) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '""""""""""', data_in: '""""""""""', data_out: '""""""""""""""""""""' });
                    engine.apps.removeApp(app);
                    count++;
                    resolve();
                } else {
                    try {
                        assert.fail("too many results from the monitor");
                    } catch(e) {
                        reject(e);
                    }
                }
            },

            notifyError(appId, icon, err) {
                assert.fail('no error expected');
            }
        });

        return engine.apps.loadOneApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) join @org.thingpedia.builtin.test.dup_data() on (data_in=data) => notify;',
            { $icon: 'org.foo', $conversation: conversation ? 'mock' : undefined },
            'uuid-when-get', undefined, 'some app', 'some app description', true).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-when-get');
        }).catch(reject);
    });
}

function testTimer(engine, conversation) {
    const assistant = engine.platform.getCapability('assistant');

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        assistant._setConversation({
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-timer-foo');
                delete data.__timestamp;
                if (count < 4) {
                    if (count % 2)
                        assert.deepStrictEqual(data, { count: 2, size: 10, data: '""""""""""' });
                    else
                        assert.deepStrictEqual(data, { count: 2, size: 10, data: '!!!!!!!!!!' });
                    count++;
                    if (count === 4) {
                        engine.apps.removeApp(app);
                        resolve();
                    }
                } else {
                    try {
                        assert.fail("too many results from the monitor");
                    } catch(e) {
                        reject(e);
                    }
                }
            },

            notifyError(appId, icon, err) {
                assert.fail('no error expected');
            }
        });

        return engine.apps.loadOneApp('timer(base=makeDate(),interval=2s) join @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { $icon: 'org.foo', $conversation: conversation ? 'mock' : undefined },
            'uuid-timer-foo', undefined, 'some app', 'some app description', true).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-timer-foo');
        }).catch(reject);
    });
}

function testAtTimer(engine, conversation) {
    const assistant = engine.platform.getCapability('assistant');

    // we cannot reliably test attimers, but we can test they don't fire
    let now = new Date;

    assistant._setConversation({
        notify(appId, icon, outputType, data) {
            assert.fail('expected no result');
        },

        notifyError(appId, icon, err) {
            assert.fail('no error expected');
        }
    });

    return engine.apps.loadOneApp(`attimer(time=makeTime(${now.getHours()+2},${now.getMinutes()})) join @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;`,
        { $icon: 'org.foo', $conversation: conversation ? 'mock' : undefined },
        'uuid-attimer-foo', undefined, 'some app', 'some app description', true).then((app) => {
        assert.strictEqual(app.icon, 'org.foo');
        assert.strictEqual(app.uniqueId, 'uuid-attimer-foo');

        return new Promise((resolve, reject) => {
            setTimeout(resolve, 5000);
        }).then(() => {
            return engine.apps.removeApp(app);
        });
    });
}

function testLoadAppSyntaxError(engine) {
    const assistant = engine.platform.getCapability('assistant');

    assistant._setConversation({
        notify(appId, icon, outputType, data) {
            assert.fail('expected no result');
        },

        notifyError(appId, icon, err) {
            assert.strictEqual(appId, 'uuid-syntax-err');
            assert.strictEqual(icon, 'org.foo');
            assert.strictEqual(err.name, 'SyntaxError');
        }
    });

    return engine.apps.loadOneApp(`foo foo foo`,
        { $icon: 'org.foo', $conversation: undefined },
        'uuid-syntax-err', undefined, 'some app', 'some app description', true).then((app) => {
        assert.strictEqual(app.icon, 'org.foo');
        assert.strictEqual(app.uniqueId, 'uuid-syntax-err');
        assert(!!app.error);

        assert(!engine.apps.hasApp(app));
        assert.deepStrictEqual(engine.apps.getAllApps(), []);
    });
}

function testLoadAppTypeError(engine) {
    const assistant = engine.platform.getCapability('assistant');

    assistant._setConversation({
        notify(appId, icon, outputType, data) {
            assert.fail('expected no result');
        },

        notifyError(appId, icon, err) {
            assert.strictEqual(appId, 'uuid-type-err');
            assert.strictEqual(icon, 'org.foo');
            assert.strictEqual(err.name, 'TypeError');
        }
    });

    return engine.apps.loadOneApp(`now => @com.twitter.search(), temperature >= 42 => notify;`,
        { $icon: 'org.foo', $conversation: undefined },
        'uuid-type-err', undefined, 'some app', 'some app description', true).then((app) => {
        assert.strictEqual(app.icon, 'org.foo');
        assert.strictEqual(app.uniqueId, 'uuid-type-err');
        assert(!!app.error);

        assert(!engine.apps.hasApp(app));
        assert.deepStrictEqual(engine.apps.getAllApps(), []);
    });
}

function testApps(engine) {
    assert.deepStrictEqual(engine.apps.getAllApps(), []);

    return Promise.resolve().then(() => {
        return testLoadAppSyntaxError(engine);
    }).then(() => {
        return testLoadAppTypeError(engine);
    }).then(() => {
        return testSimpleDo(engine);
    }).then(() => {
        return testDoError(engine);
    }).then(() => {
        return testDoSay(engine);
    }).then(() => {
        return testSimpleGet(engine);
    }).then(() => {
        return testSimpleGet(engine, 'org.foo');
    }).then(() => {
        return testGetGet(engine);
    }).then(() => {
        return testGetError(engine, 'org.foo');
    }).then(() => {
        return testWhen(engine, true);
    }).then(() => {
        return testWhen(engine, false);
    }).then(() => {
        return testTimer(engine);
    }).then(() => {
        return testAtTimer(engine);
    }).then(() => {
        return testWhenGet(engine);
    }).then(() => {
        return testWhenRestart(engine);
    }).then(() => {
        return testWhenErrorInit(engine);
    }).then(() => {
        return testWhenErrorAsync(engine);
    }).then(() => {
        const assistant = engine.platform.getCapability('assistant');
        assistant._setConversation(null);

        assert.deepStrictEqual(engine.apps.getAllApps(), []);
    });
}

function testUtil(engine) {
    return Promise.resolve(IpAddress.getServerAddresses()).then((addresses) => {
        addresses.forEach((address) => {
            assert(/^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+)$/.test(address));
        });
        return IpAddress.getServerName();
    });
}

function main() {
    var platform = require('./test_platform').newInstance();
    platform.setAssistant(new MockAssistant());

    var engine;
    Promise.resolve().then(() => {
        engine = new Engine(platform);
        return engine.open();
    }).then(() => {
        Promise.resolve(testDevices(engine)).then(() => {
            return testHTTPClient(engine);
        }).then(() => {
            return testApps(engine);
        }).then(() => {
            return testUtil(engine);
        }).then(() => {
            return engine.stop();
        }).catch((e) => {
            console.error('FAIL: ', e);
            process.exit(1);
        });
        return engine.run();
    }).then(() => {
        return engine.close();
    });
}

main();