// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const events = require('events');
const adt = require('adt');

const ThingTalk = require('thingtalk');

const LambdaForm = require('./lambda');
const ThingPedia = require('./thingpedia');

const ValueCategory = adt.data({
    YesNo: null,
    Number: null,
    RawString: null,
    Date: null
});

const SemanticAnalyzer = new lang.Class({
    Name: 'SemanticAnalyzer',

    _init: function(lambda) {
        this.root = lambda;

        this.isSpecial = false;
        this.isAction = false;
        this.isQuestion = false;
        this.isRule = false;
        this.isYes = false;
        this.isNo = false;
        this.isValue = false;
    },

    run: function() {
        if (this.root.isAtom && this.root.name.startsWith('tt:root.special.')) {
            if (this.root.name === 'tt:root.special.yes')
                this.isYes = true;
            else if (this.root.name === 'tt:root.special.no')
                this.isNo = true;
            else
                this.isSpecial = true;
        } else if (this.root.isApply && this.root.left.isAtom &&
                   this.root.left.name === 'tt:root.token.value') {
            this.isValue = true;
            this.value = this.root.right;
            if (this.value.isNumber)
                this.category = ValueCategory.Number;
            else if (this.value.isString)
                this.category = ValueCategory.RawString;
            else if (this.value.isDate)
                this.category = ValueCategory.Date;
        } else if (this.root.isApply) {
            var call = null;
            var params = [];
            function uncurry(form) {
                if (form.isApply) {
                    uncurry(form.left);
                    params.push(form.right);
                } else if (form.isLambda) {
                    throw new TypeError('Unexpected lambda form not in normal form');
                } else {
                    call = form;
                }
            }
            uncurry(this.root);
            if (call.isVariable)
                throw new TypeError('Unbound variable ' + call.name);
            if (!call.isAtom)
                throw new TypeError('Unexpected call to ' + call.name);
            if (call.name.startsWith('tt:device.action.')) {
                var action = ThingPedia.VerbToActionMap[call.name];
                if (action === undefined)
                    throw new TypeError('Unknown action ' + call.name);
                this.isAction = true;
                if (params.length === 0)
                    throw new TypeError('Missing parameters to action');
                if (!params[0].isAtom || !params[0].name.startsWith('tt:device.'))
                    throw new TypeError('Invalid first parameter to action (must be device)');
                var subAction = action[params[0].name];
                if (subAction === undefined)
                    throw new TypeError('Action ' + call.name + ' is not valid for device ' + params[0].name);
                this.kind = subAction[0];
                this.channel = subAction[1];
                this.params = params.slice(1);
                this.schema = subAction.slice(2);
            } else {
                throw new Error('Unhandled top-level call to ' + call.name);
            }
        } else if (this.root.isLambda) {
            throw new Error('FIXME: unhandled top-level lambda');
        } else {
            throw new TypeError('Invalid top-level ' + this.root);
        }
    }
});

const Dialog = new lang.Class({
    Name: 'Dialog',

    _init: function() {
        this.expecting = null;
        this.question = null;
        this.subdialog = null;
    },

    notify: function(app, event) {
        return false;
    },

    start: function() {
    },

    ask: function(expected, question) {
        this.question = question;
        this.expect(expected);
        return this.reply(question);
    },

    expect: function(category) {
        this.expecting = category;
        this.manager.setRaw(category === ValueCategory.RawString);
    },

    switchTo: function(dlg, command) {
        this.manager.setRaw(false);
        this.manager.setDialog(dlg);
        if (command)
            return dlg.handle(command);
        else
            return true;
    },

    switchToDefault: function() {
        return this.switchTo(new DefaultDialog());
    },

    push: function(dlg, command) {
        this.manager.setRaw(false);
        this.subdialog = dlg;
        dlg.manager = this.manager;
        if (command)
            return dlg.handle(command);
        else
            return true;
    },

    reply: function(msg) {
        this.manager.sendReply(msg);
        return true;
    },

    handleGeneric: function(analyzer) {
        if (this.subdialog !== null) {
            if (this.subdialog.handle(analyzer))
                return true;
        }

        if (analyzer.isSpecial) {
            switch(analyzer.root.name) {
            case 'tt:root.special.failed':
                return false;
            case 'tt:root.special.hello':
                var prefs = platform.getSharedPreferences();
                this.reply("Hi, " + prefs.get('sabrina-name'));
                break;
            case 'tt:root.special.debug':
                this.reply("This is a " + this.__name__);
                if (this.expecting === null)
                    this.reply("I'm not expecting anything");
                else
                    this.reply("I'm expecting a " + categoryName(this.expecting));
                break;
            case 'tt:root.special.help':
                this.reply("Sure! How can I help you?");
                this.reply("If you're unsure what to say, I understand most actions and objects. You can ask me a question and I'll try to answer it. You can tell me to do something at a later time if you give me the condition or the time.");
                if (this.expecting !== null) {
                    if (this.expecting === ValueCategory.YesNo) {
                        this.reply("At this time, just a yes or no will be fine though.");
                    } else if (this.question !== null) {
                        this.reply(this.question);
                    }
                }
                break;
            case 'tt:root.special.thankyou':
                this.reply("At your service.");
                break;
            case 'tt:root.special.sorry':
                this.reply("No need to be sorry.");
                this.reply("Unless you're Canadian. Then I won't stop you.");
                break;
            case 'tt:root.special.cool':
                this.reply("I know, right?");
                break;
            case 'tt:root.special.nevermind':
                this.reset();
                break;
            }
            return true;
        }

        if (this.expecting === ValueCategory.YesNo) {
            if (analyzer.isYes || analyzer.isNo)
                return false;

            return this.reply("Just answer yes or no.");
        } else if (this.expecting !== null &&
                   (!analyzer.isValue || analyzer.category !== this.expecting)) {
            if (analyzer.isYes)
                return this.reply("Yes what?");
            else if (analyzer.isNo)
                return this.reset();

            return this.unexpected();
        }

        return false;
    },

    handlePicture: function(url) {
        if (this.subdialog !== null)
            return this.subdialog.handlePicture(url);

        // let all pictures through by default
        return false;
    },

    handleRaw: function(raw) {
        if (this.subdialog !== null)
            return this.subdialog.handleRaw(raw);

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchToDefault();
        return true;
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return true;

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchToDefault();
        return true;
    },

    reset: function() {
        this.reply("Ok forget it");
        this.switchToDefault();
        return true;
    },

    done: function() {
        this.reply("Consider it done");
        this.switchToDefault();
        return true;
    },

    unexpected: function() {
        return this.reply("That's not what I asked");
    },

    fail: function() {
        this.reply("Sorry, I did not understand that. Can you rephrase it?");
        return true;
    },

    // faild and lose context
    failReset: function() {
        this.fail();
        this.switchToDefault();
        return true;
    },
});

const DefaultDialog = new lang.Class({
    Name: 'DefaultDialog',
    Extends: Dialog,

    notify: function(appId, event) {
        var app = this.manager.apps.getApp(appId);
        if (!app)
            return true;
        this.reply("Notification from " + app.name + ": " + event.join(', '));
        return true;
    },

    handle: function(analyzer) {
        if (this.handleGeneric(analyzer))
            return true;

        if (analyzer.isYes)
            return this.reply("I agree, but to what?");
        else if (analyzer.isNo)
            return this.reply("No way!");
        //else if (analyzer.isQuestion)
        //    return true; // FIXME: handle question
        //else if (analyzer.isRule)
        //    return this.switchTo(new RuleDialog(), analyzer);
        else if (analyzer.isAction)
            return this.switchTo(new ActionDialog(true), analyzer);
        else
            return false;
    }
});

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1).toLowerCase();
}

const ActionDialog = new lang.Class({
    Name: 'ActionDialog',
    Extends: Dialog,

    _init: function(directExec) {
        this.parent();
        this.kind = null;
        this.channelName = null;

        this.devices = null;
        this.resolving = null;

        this.currentParam = null;
        this.resolved_parameters = [];
        this.directExec = directExec;
    },

    name: function() {
        return capitalize(this.kind);
    },

    _askDevice: function() {
        var kind = this.kind;
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            this.reply("You don't have a " + kind);
            this.switchToDefault();
            return true;
        }

        if (devices.length === 1) {
            this.devices = [devices[0]];
            return false;
        }

        if (devices.length > 0) {
            this.reply("You have multiple " + kind + "s");
            var question = "Do you mean ";
            for (var i = 0; i < devices.length; i++)
                question += (i > 0 ? " or " : "") + (i+1) + ") " + devices[i].name;
            question += "?";
            this.resolving = devices;
            this.ask(ValueCategory.Number, question);
            return true;
        }
    },

    _handleResolve: function(command) {
        // command.value is a LambdaForm, command.value.value is the actual number
        var value = command.value.value;
        if (value !== Math.floor(value) ||
            value < 1 ||
            value > this.resolving.length) {
            this.reply("Please choose a number between 1 and " + this.resolving.length);
            return true;
        } else {
            this.reply("You chose " + this.resolving[value-1].name);
            this.devices = [this.resolving[value-1]];
        }

        this.resolving = [];
        this.expecting = null;
        return false;
    },

    _tryNextParameter: function(inputs) {
        while (this.parameters.length > 0) {
            var param = this.parameters.shift();

            if (param.isConstant) {
                this.resolved_parameters.push(param.value);
                continue;
            }
            if (!param.isInput)
                throw new TypeError();

            if (inputs.length > 0) {
                var input = inputs.shift();
                if (input.isYes)
                    this.resolved_parameters.push(true);
                else if (input.isNo)
                    this.resolved_parameters.push(false);
                else
                    this.resolved_parameters.push(input.value);
            } else {
                this.currentParam = param;

                var question = param.question;
                if (param.type.isString)
                    this.ask(ValueCategory.RawString, question);
                else if (param.type.isMeasure || param.type.isNumber)
                    this.ask(ValueCategory.Number, question);
                else if (param.type.isBoolean)
                    this.ask(ValueCategory.YesNo, question);
                else if (param.type.isDate)
                    this.ask(ValueCategory.Date, question);
                else
                    throw new TypeError(); // can't handle it

                return true;
            }
        }

        return false;
    },

    execute: function() {
        var devices = this.devices;
        if (devices.length < 1)
            return;
        var kind = this.kind;
        var channelName = this.channelName;
        var args = this.resolved_parameters;

        Q.all(devices.map(function(device) {
            console.log('Executing action ' + channelName + ' on ' + device.uniqueId);
            return device.getChannel(channelName, []).then(function(channel) {
                channel.sendEvent(args);
                return channel.close();
            });
        })).then(function() {
            return this.done();
        }.bind(this)).catch(function(e) {
            this.reply("Sorry, that did not work: " + e.message);
            this.switchToDefault();
        }.bind(this)).done();

        return true;
    },

    handleRaw: function(command) {
        if (this.currentParam !== null &&
            this.expecting === ValueCategory.RawString) {
            this.resolved_parameters.push(command);
            return this._continue([]);
        } else {
            return this.parent(command);
        }
    },

    handle: function(command) {
        if (this.kind === null) {
            this.kind = command.kind;
            this.channelName = command.channel;
            this.parameters = command.schema;
            if (this._askDevice(command))
                return true;
        } else if (command.isAction) {
            return this.reply("You already told me what to do");
        }

        if (this.devices === null &&
            this.currentParam === null &&
            this.expecting === ValueCategory.Number) {
            if (this._handleResolve(command))
                return true;
        }

        if (command.isAction)
            return this._continue(command.params);
        else if (command.isValue)
            return this._continue([command.value]);
        else
            return this._continue([command]);
    },

    describe: function() {
        return this.kind + " " + this.channelName + " " +
            this.resolved_parameters.join(" ");
    },

    _continue: function(params) {
        if (this._tryNextParameter(params))
            return true;

        if (!this.directExec)
            return false;

        if (this.expecting === ValueCategory.YesNo) {
            if (params.length !== 1)
                return this.fail();

            if (params[0].isYes)
                return this.execute();
            else if (params[0].isNo)
                return this.reset();
            else
                return this.fail();
        } else {
            return this.ask(ValueCategory.YesNo, "Ok, so you want me to " +
                            this.describe() +
                            ". Is that right?");
        }
    }
});

// FIXME fetch this from ThingPedia
const SABRINA_POPULATE_DATABASE = 'SabrinaPopulateDatabase() {' +
      'extern Weight : (Date, Measure(kg));' +
      'extern Height : (Date, Measure(kg));' +
      'extern Gender : (String);' +
      'extern DateOfBirth : (Date);' +
      '@(type="scale").source(t, w) => Weight(t, w);' +
      '}';

const InitializationDialog = new lang.Class({
    Name: 'InitializationDialog',
    Extends: Dialog,

    _init: function() {
        this.parent();

        this.appOk = false;
        this.hasApp = false;
        this.name = null;
        this.tentative_name = null;

        // XXX
        this.dobOk = true;
        this.genderOk = true;
    },

    _checkDatabaseApp: function() {
        if (this.appOk)
            return false;
        this.appOk = true;

        var apps = this.manager.apps;
        if (apps.getApp('app-SabrinaPopulateDatabase') !== undefined) {
            this.hasApp = true;
            return false;
        }

        var apps = this.manager.apps;
        this.hasApp = true;
        apps.loadOneApp(SABRINA_POPULATE_DATABASE, {},
                        'app-SabrinaPopulateDatabase',
                        undefined, "Sabrina Database App",
                        "Gives Sabrina knowledge from your IoT devices", true)
            .then(function() {
                this._continue();
            }.bind(this)).done();
        return true;
    },

    _checkName: function() {
        var prefs = platform.getSharedPreferences();
        var name = prefs.get('sabrina-name');
        if (name !== undefined && name !== null) {
            this.name = name;
            return false;
        }

        this.manager.messaging.getOwnId().then(function(id) {
            return this.manager.messaging.getUserById(id);
        }.bind(this)).then(function(user) {
            this.tentative_name = user.name;
            this.ask(ValueCategory.YesNo, "Can I call you " + user.name + "?");
        }.bind(this)).catch(function(e) {
            console.log('Failed to obtain omlet user name: ' + e.message);
            this.ask(ValueCategory.RawString, "What's your name?");
        }.bind(this));
        return true;
    },

    _checkDOB: function() {
        if (this.dobOk)
            return false;
        if (!this.hasApp)
            return false;

        var keyword = this.manager.keywords.getKeyword(null, 'DateOfBirth', null);
        keyword.open().then(function(kw) {
            if (keyword.value !== null) {
                this.dobOk = true;
                this._continue();
            } else {
                this.ask(ValueCategory.Date, "When were you born?");
                this.reply("(You can say no at any time and I will stop asking you questions)");
            }
        }.bind(this)).finally(function() {
            return keyword.close();
        }).done();
        return true;
    },

    _checkGender: function() {
        if (this.genderOk)
            return false;
        if (!this.hasApp)
            return false;

        var keyword = this.manager.keywords.getKeyword(null, 'Gender', null);
        keyword.open().then(function(kw) {
            if (keyword.value !== null) {
                this.genderOk = true;
                this._continue();
            } else {
                this.ask(ValueCategory.Number, "Are you male or female?");
            }
        }.bind(this)).finally(function() {
            return keyword.close();
        }).done();
        return true;
    },

    _handleNameResponse: function(word) {
        if (word.isYes) {
            this.name = this.tentative_name;
            var prefs = platform.getSharedPreferences();
            prefs.set('sabrina-name', this.name);
            this.reply("Hi " + this.name + ", nice to meet you.");
            this.expecting = null;
            return false;
        } else {
            return this.ask(ValueCategory.RawString, "Ok, what's your name then?");
        }
    },

    start: function() {
        var prefs = platform.getSharedPreferences();
        var initialized = prefs.get('sabrina-initialized');
        if (initialized)
            return this.switchToDefault();

        prefs.set('sabrina-initialized', true);
        setTimeout(function() {
            this.reply("Hello! My name is Sabrina, and I'm your virtual assistant.");

            this._continue();
        }.bind(this), 1000);
    },

    handleRaw: function(command) {
        if (this.expecting === ValueCategory.RawString) {
            if (this.name === null) {
                this.name = command;
                var prefs = platform.getSharedPreferences();
                prefs.set('sabrina-name', command);
                this.reply("Hi " + command + ", nice to meet you.");
                return this._continue();
            }
        }

        return this.parent(command);
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.expecting === ValueCategory.YesNo) {
            if (this.name === null) {
                if (this._handleNameResponse(command))
                    return true;
            }
        }

        if (this.expecting === ValueCategory.Date) {
            var keyword = this.manager.keywords.getKeyword(null, 'DateOfBirth', null);
            keyword.open().then(function() {
                keyword.changeValue([command.value.value.getTime()]);
                this._continue();
            }.bind(this)).finally(function() {
                keyword.close();
            }).done();
            return true;
        }

        if (this.expecting === ValueCategory.Gender) {
            var keyword = this.manager.keywords.getKeyword(null, 'Gender', null);
            keyword.open().then(function() {
                var gender;
                keyword.changeValue([command.value.value]);
                this._continue();
            }.bind(this)).finally(function() {
                keyword.close();
            }).done();
            return true;
        }

        return this._continue();
    },

    _continue: function() {
        if (this._checkName())
            return true;

        if (this._checkDatabaseApp())
            return true;

        if (this._checkDOB())
            return true;

        if (this._checkGender())
            return true;

        this.reply("Ok, now I'm ready to use all my magic powers to help you.");
        this.switchToDefault();
        return true;
    },
});

module.exports = new lang.Class({
    Name: 'Sabrina',
    Extends: events.EventEmitter,

    _init: function(engine) {
        events.EventEmitter.call(this);
        this._engine = engine;

        this._delegate = null;
        this._raw = false;

        this._initialized = false;

        this._notifyQueue = [];
    },

    get apps() {
        return this._engine.apps;
    },

    get devices() {
        return this._engine.devices;
    },

    get messaging() {
        return this._engine.messaging;
    },

    get keywords() {
        return this._engine.keywords;
    },

    notify: function(data) {
        if (!this._delegate) {
            this._notifyQueue.push(data);
            return;
        }
        if (!this._dialog.notify(data[0], data[1]))
            this._notifyQueue.push(data);
    },

    _flushNotify: function() {
        var queue = this._notifyQueue;
        this._notifyQueue = [];
        queue.forEach(function(data) {
            this.notify(data);
        }, this);
    },

    setDialog: function(dlg) {
        this._dialog = dlg;
        dlg.manager = this;
        dlg.start();
        this._flushNotify();
    },

    setRaw: function(raw) {
        this._raw = raw;
    },

    start: function() {
        this._initialize();
    },

    stop: function() {
    },

    setDelegate: function(delegate) {
        this._delegate = delegate;
        this._initialize();
    },

    _initialize: function() {
        if (this._initialized)
            return;
        if (!this._delegate)
            return;

        this._initialized = true;
        this.setDialog(new InitializationDialog());
    },

    handlePicture: function(url) {
        console.log('Received Assistant picture ' + url);

        return Q.try(function() {
            return this._dialog.handlePicture(url);
        }.bind(this)).then(function(handled) {
            if (!handled)
                handled = this.emit('picture', url);

            if (!handled)
                this._dialog.unexpected();
        }.bind(this)).catch(function(e) {
            console.error('Failed to process assistant picture: ' + e.message);
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    },

    handleCommand: function(command) {
        console.log('Received Assistant command ' + command);

        return Q.try(function() {
            if (this._raw)
                return this._dialog.handleRaw(command);

            return this._delegate.analyze(command).then(function(analyzed) {
                console.log('Analyzed message into ' + analyzed);

                var parser = new LambdaForm.Parser(analyzed);
                var parsed = parser.parse();
                console.log('Parsed lambda form into ' + parsed);

                var analyzer = new SemanticAnalyzer(parsed);
                try {
                    analyzer.run();
                } catch(e) {
                    this.sendReply('Sorry, semantic analyzer failed ' + e.message);
                    return false;
                }

                return this._dialog.handle(analyzer);
            }.bind(this));
        }.bind(this)).then(function(handled) {
            if (!handled)
                handled = this.emit('message', command);

            if (!handled)
                this._dialog.fail();
        }.bind(this)).catch(function(e) {
            console.error('Failed to process assistant command: ' + e.message);
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    },

    sendReply: function(message) {
        console.log('Sabrina Says: ' + message);
        if (this._delegate)
            return this._delegate.send(message);
        else
            return Q();
    },

    sendPicture: function(url) {
        console.log('Sabrina sends picture: '+ url);
        if (this._delegate)
            return this._delegate.sendPicture(url);
        else
            return Q();
    }
});
