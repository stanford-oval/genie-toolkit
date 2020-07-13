// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const assert = require('assert');
const Stream = require('stream');

const SUCCESS = {};
const FAILURE = {};

async function collectOutputs(app) {
    let into = [];
    for await (const output of app.mainOutput)
        into.push(output);
    return into;
}

async function testSimpleDo(engine) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originaldo = test.do_eat_data;

    let result = FAILURE;
    test.do_eat_data = (data) => {
        assert.deepStrictEqual(data, { data: 'some data ' });
        result = SUCCESS;
    };

    const app = await engine.createApp('now => @org.thingpedia.builtin.test(id="org.thingpedia.builtin.test").eat_data(data="some data ");');

    assert.strictEqual(app.name, 'Test');
    assert.strictEqual(app.description, 'consume “some data ”');

    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));
    const appInfo = await engine.getAppInfo(app.uniqueId);
    assert.strictEqual(appInfo.uniqueId, app.uniqueId);
    assert.strictEqual(appInfo.name, 'Test');

    const infos = await engine.getAppInfos();
    assert.deepStrictEqual(infos, [appInfo]);

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, []);
    assert.strictEqual(result, SUCCESS);
    test.do_eat_data = originaldo;
}

async function testDoSay(engine) {
    const app = await engine.createApp('now => @org.thingpedia.builtin.thingengine.builtin.say(message="test message");',
        { name: 'some app', description: 'some app description' });

    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.thingengine.builtin:say',
        outputValue: { message_output: 'test message' }
    }]);
}

async function testDoError(engine) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originaldo = test.do_eat_data;

    const error = new Error('test error');
    test.do_eat_data = (data) => {
        throw error;
    };

    const app = await engine.createApp('now => @org.thingpedia.builtin.test.eat_data(data="some data ");',
        { name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(outputs[0], error);

    test.do_eat_data = originaldo;
}

async function testSimpleGet(engine, icon = null) {
    const app = await engine.createApp('now => @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
        { icon: icon, name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test:get_data',
        outputValue: { data: '!!!!!!!!!!', count: 2, size: 10 }
    }, {
        outputType: 'org.thingpedia.builtin.test:get_data',
        outputValue: { data: '""""""""""', count: 2, size: 10 }
    }]);
}

async function testGetGet(engine, icon = null) {
    const app = await engine.createApp('now => @org.thingpedia.builtin.test.get_data(count=2, size=10byte) join @org.thingpedia.builtin.test.dup_data() on (data_in=data) => notify;',
        { icon: icon, name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test:get_data+org.thingpedia.builtin.test:dup_data',
        outputValue: { __response: undefined, data: '!!!!!!!!!!', count: 2, size: 10, data_in: '!!!!!!!!!!', data_out: '!!!!!!!!!!!!!!!!!!!!',}
    }, {
        outputType: 'org.thingpedia.builtin.test:get_data+org.thingpedia.builtin.test:dup_data',
        outputValue: { __response: undefined, data: '""""""""""', count: 2, size: 10, data_in: '""""""""""', data_out: '""""""""""""""""""""', }
    }]);
}

async function testGetError(engine, icon = null) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originalget = test.get_get_data;

    const error = new Error('test error');
    test.get_get_data = (data) => {
        throw error;
    };

    const app = await engine.createApp('now => @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
        { icon: icon, name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.strictEqual(outputs.length, 1);
    assert.strictEqual(outputs[0], error);

    test.get_get_data = originalget;
}

function testWhen(engine, conversation) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        const delegate = {
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-foo-' + conversation);
                assert(Object.prototype.hasOwnProperty.call(data, '__timestamp'));
                delete data.__timestamp;
                if (count === 0) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '!!!!!!!!!!' });
                    count++;
                } else if (count === 1) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '""""""""""' });
                    engine.apps.removeApp(app);
                    count++;
                    engine.assistant.removeNotificationOutput(delegate);
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
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-foo-' + conversation, name: 'some app', description: 'some app description' }).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-foo-' + conversation);
        }).catch(reject);
    });
}

function testWhenErrorInit(engine) {
    const test = engine.devices.getDevice('org.thingpedia.builtin.test');
    const originalsubscribe = test.subscribe_get_data;

    const error = new Error('Test error');

    test.subscribe_get_data = (args, state) => {
        throw error;
    };

    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for error to appear')), 10000).unref();

        const delegate = {
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

                engine.assistant.removeNotificationOutput(delegate);
                resolve();
            }
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-when-error', name: 'some app', description: 'some app description' }).then((app) => {
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
        const delegate = {
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
                assert(Object.prototype.hasOwnProperty.call(data, '__timestamp'));
                delete data.__timestamp;
                if (count === 0) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '!!!!!!!!!!' });
                    count++;
                } else if (count === 1) {
                    assert.deepStrictEqual(data, { count: 2, size: 10, data: '""""""""""' });
                    count++;
                    if (seenerror) {
                        engine.apps.removeApp(app);
                        engine.assistant.removeNotificationOutput(delegate);
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
                    engine.assistant.removeNotificationOutput(delegate);
                    resolve();
                }
            }
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-when-error-async', name: 'some app', description: 'some app description' }).then((app) => {
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
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        const delegate = {
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:get_data');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-foo-when-restart');
                assert(Object.prototype.hasOwnProperty.call(data, '__timestamp'));
                // drain and ignore the result
            },

            notifyError(appId, icon, err) {
                assert.fail('no error expected');
            }
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-foo-when-restart', name: 'some app', description: 'some app description' }).then(async (app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-foo-when-restart');

            resolve(app.waitFinished().then(async () => {
                await engine.apps.removeApp(app);
                await engine.assistant.removeNotificationOutput(delegate);
            }));
        }).catch(reject);
    });
}

function genFakeData(size, fill) {
    return String(Buffer.alloc(size, fill));
}

async function testWhenRestart(engine) {
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

    await drainTestWhen(engine);

    try {
        await new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

            const delegate = {
                notify(appId, icon, outputType, data) {
                    console.error(data);
                    assert.fail('no result expected');
                },

                notifyError(appId, icon, err) {
                    assert.fail('no error expected');
                }
            };
            engine.assistant.addNotificationOutput(delegate);

            engine.createApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
                { icon: 'org.foo', uniqueId: 'uuid-foo-when-restart', name: 'some app', description: 'some app description' }).then((app) => {
                assert.strictEqual(app.icon, 'org.foo');
                assert.strictEqual(app.uniqueId, 'uuid-foo-when-restart');

                resolve(app.waitFinished().then(async () => {
                    await engine.apps.removeApp(app);
                    await engine.assistant.removeNotificationOutput(delegate);
                }));
            }).catch(reject);
        });
    } finally {
        test.subscribe_get_data = originalsubscribe;
    }
}

function testWhenGet(engine, conversation) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        const delegate = {
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
                    assert.deepStrictEqual(data, { __response: undefined, count: 2, size: 10, data: '!!!!!!!!!!', data_in: '!!!!!!!!!!', data_out: '!!!!!!!!!!!!!!!!!!!!' });
                    count++;
                } else if (count === 1) {
                    assert.deepStrictEqual(data, { __response: undefined, count: 2, size: 10, data: '""""""""""', data_in: '""""""""""', data_out: '""""""""""""""""""""' });
                    engine.apps.removeApp(app);
                    engine.assistant.removeNotificationOutput(delegate);
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
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('monitor @org.thingpedia.builtin.test.get_data(count=2, size=10byte) join @org.thingpedia.builtin.test.dup_data() on (data_in=data) => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-when-get', name: 'some app', description: 'some app description' }).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-when-get');
        }).catch(reject);
    });
}

function testTimer(engine, conversation) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        const delegate = {
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
                        assert.deepStrictEqual(data, { __response: undefined, count: 2, size: 10, data: '""""""""""' });
                    else
                        assert.deepStrictEqual(data, { __response: undefined, count: 2, size: 10, data: '!!!!!!!!!!' });
                    count++;
                    if (count === 4) {
                        engine.apps.removeApp(app);
                        engine.assistant.removeNotificationOutput(delegate);
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
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('timer(base=makeDate(),interval=2s) join @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-timer-foo', name: 'some app', description: 'some app description' }).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-timer-foo');
        }).catch(reject);
    });
}

async function testAtTimer(engine, conversation) {
    // we cannot reliably test attimers, but we can test they don't fire
    let now = new Date;

    const delegate = {
        notify(appId, icon, outputType, data) {
            assert.fail('expected no result');
        },

        notifyError(appId, icon, err) {
            assert.fail('no error expected');
        }
    };
    engine.assistant.addNotificationOutput(delegate);

    const app = await engine.createApp(`attimer(time=makeTime(${now.getHours()+2},${now.getMinutes()})) join @org.thingpedia.builtin.test.get_data(count=2, size=10byte) => notify;`,
        { icon: 'org.foo', uniqueId: 'uuid-attimer-foo', name: 'some app', description: 'some app description' });
    assert.strictEqual(app.icon, 'org.foo');
    assert.strictEqual(app.uniqueId, 'uuid-attimer-foo');

    await new Promise((resolve, reject) => {
        setTimeout(resolve, 5000);
    });
    await engine.apps.removeApp(app);
    engine.assistant.removeNotificationOutput(delegate);
}

async function testLoadAppNotCompilable(engine) {
    const delegate = {
        notify(appId, icon, outputType, data) {
            assert.fail('expected no result');
        },

        notifyError(appId, icon, err) {
            assert.strictEqual(appId, 'uuid-not-compilable-err');
            assert.strictEqual(icon, 'org.foo');
            assert(err.message.indexOf('slot-fill') >= 0);
        }
    };
    engine.assistant.addNotificationOutput(delegate);

    const app = await engine.createApp(`now => @com.twitter.post(status=$?);`,
        { icon: 'org.foo', uniqueId: 'uuid-not-compilable-err', name: 'some app', description: 'some app description' });
    assert.strictEqual(app.icon, 'org.foo');
    assert.strictEqual(app.uniqueId, 'uuid-not-compilable-err');
    assert(!!app.error);

    assert(!engine.apps.hasApp(app));
    assert.deepStrictEqual(engine.apps.getAllApps(), []);

    engine.assistant.removeNotificationOutput(delegate);
}

async function testGetSequence(engine, icon = null) {
    const app = await engine.createApp('now => @org.thingpedia.builtin.test.next_sequence() => notify;',
        { icon , name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test:next_sequence',
        outputValue: { number: 0 }
    }]);
}

async function testGetGetSequence(engine, icon = null) {
    // if you join a table with itself, with no param passing, you will get the same
    // result twice (ie, the table is static during the query)
    const app = await engine.createApp('now => @org.thingpedia.builtin.test.next_sequence() join @org.thingpedia.builtin.test.next_sequence() => notify;',
        { icon , name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test:next_sequence+org.thingpedia.builtin.test:next_sequence',

        // this should be 1 not 2: the query is only invoked once
        outputValue: { number: 1 }
    }]);
}


function testTimerSequence(engine, conversation) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timed out while waiting for data to appear')), 10000).unref();

        let count = 0;
        const delegate = {
            notify(appId, icon, outputType, data) {
                const app = engine.apps.getApp(appId);
                assert(app.isEnabled);
                assert(app.isRunning);
                assert.strictEqual(outputType, 'org.thingpedia.builtin.test:next_sequence');
                assert.strictEqual(icon, 'org.foo');
                assert.strictEqual(appId, 'uuid-timer-sequence');
                delete data.__timestamp;
                if (count < 3) {
                    assert.deepStrictEqual(data, { __response: undefined, number: 2 + count });
                    count++;
                    if (count === 3) {
                        engine.apps.removeApp(app);
                        engine.assistant.removeNotificationOutput(delegate);
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
        };
        engine.assistant.addNotificationOutput(delegate);

        engine.createApp('timer(base=makeDate(),interval=2s) join @org.thingpedia.builtin.test.next_sequence() => notify;',
            { icon: 'org.foo', uniqueId: 'uuid-timer-sequence', name: 'some app', description: 'some app description' }).then((app) => {
            assert.strictEqual(app.icon, 'org.foo');
            assert.strictEqual(app.uniqueId, 'uuid-timer-sequence');
        }).catch(reject);
    });
}

async function testGetContext(engine, icon = null) {
    const app = await engine.createApp('now => @org.thingpedia.builtin.test.dup_data(data_in=$context.selection: String) => notify;',
        { icon , name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.test:dup_data',
        outputValue: {
            data_out: 'Selected textSelected text',
            data_in: 'Selected text'
        }
    }]);
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function testSayContext(engine, icon = null) {
    const app = await engine.createApp('now => @org.thingpedia.builtin.thingengine.builtin.say(message=$context.selection: String);',
        { icon , name: 'some app', description: 'some app description' });
    // when we get here, the app might or might not have started already
    // to be sure, we iterate its mainOutput

    // the app is still running, so the engine should know about it
    assert(engine.apps.hasApp(app.uniqueId));

    const outputs = await collectOutputs(app);
    assert.deepStrictEqual(outputs, [{
        outputType: 'org.thingpedia.builtin.thingengine.builtin:say',
        outputValue: {
            message_output: 'Selected text'
        }
    }]);
}


module.exports = async function testApps(engine) {
    assert.deepStrictEqual(engine.apps.getAllApps(), []);

    await testLoadAppNotCompilable(engine);
    await testSimpleDo(engine);
    await testDoError(engine);
    await testDoSay(engine);
    await testSimpleGet(engine);
    await testSimpleGet(engine, 'org.foo');
    await testGetGet(engine);
    await testGetError(engine, 'org.foo');
    await testWhen(engine, true);
    await testWhen(engine, false);
    await testTimer(engine);
    await testAtTimer(engine);
    await testWhenGet(engine);
    await testWhenRestart(engine);
    await testWhenErrorInit(engine);
    await testWhenErrorAsync(engine);

    await testGetContext(engine);

    // these three must be exactly in this order
    await testGetSequence(engine);
    await testGetGetSequence(engine);
    await testTimerSequence(engine);

    await testSayContext(engine);

    await delay(1000);
    assert.deepStrictEqual(engine.apps.getAllApps(), []);
};
