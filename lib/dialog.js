// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const adt = require('adt');
const util = require('util');

const ThingTalk = require('thingtalk');

const LambdaForm = require('./lambda');
const ValueCategory = require('./semantic').ValueCategory;

function arrayEquals(a, b) {
    if (a.length !== b.length)
        return false;

    return a.every(function(e, i) {
        return categoryEquals(e, b[i]);
    });
}

function categoryEquals(a, b) {
    if ((a === null) != (b === null))
        return false;
    if (Array.isArray(a) && Array.isArray(b))
        return arrayEquals(a, b);
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    return a.equals(b);
}

class Dialog {
    constructor() {
        this.expecting = null;
        this.question = null;
        this.subdialog = null;
    }

    notify(app, event) {
        return false;
    }

    start() {
    }

    ask(expected, question) {
        this.question = question;
        this.expect(expected);
        return this.reply(question);
    }

    expect(category) {
        this.expecting = category;
        this.manager.setRaw(category === ValueCategory.RawString);
    }

    switchTo(dlg, command) {
        this.manager.setRaw(false);
        this.manager.setDialog(dlg);
        if (command)
            return dlg.handle(command);
        else
            return true;
    }

    switchToDefault() {
        return this.switchTo(new DefaultDialog());
    }

    push(dlg, command) {
        this.manager.setRaw(false);
        this.subdialog = dlg;
        dlg.manager = this.manager;
        if (command)
            return dlg.handle(command);
        else
            return true;
    }

    pop() {
        this.manager.setRaw(false);
        this.expecting = null;
        this.subdialog = null;
        return false;
    }

    reply(msg) {
        this.manager.sendReply(msg);
        return true;
    }

    handleGeneric(analyzer) {
        if (this.subdialog !== null) {
            if (this.subdialog.handle(analyzer))
                return true;
        }

        if (analyzer.isSpecial) {
            switch(analyzer.special) {
            case 'tt:root.special.failed':
                return false;
            case 'tt:root.special.hello':
                var prefs = this.manager.platform.getSharedPreferences();
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
                   (!analyzer.isValue || !categoryEquals(analyzer.category, this.expecting))) {
            if (analyzer.isYes)
                return this.reply("Yes what?");
            else if (analyzer.isNo)
                return this.reset();

            return this.unexpected();
        }

        return false;
    }

    handlePicture(url) {
        if (this.subdialog !== null)
            return this.subdialog.handlePicture(url);

        // let all pictures through by default
        return false;
    }

    handleRaw(raw) {
        if (this.subdialog !== null)
            return this.subdialog.handleRaw(raw);

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchToDefault();
        return true;
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchToDefault();
        return true;
    }

    reset() {
        this.reply("Ok forget it");
        this.switchToDefault();
        return true;
    }

    done() {
        this.reply("Consider it done");
        this.switchToDefault();
        return true;
    }

    unexpected() {
        return this.reply("That's not what I asked");
    }

    fail() {
        this.reply("Sorry, I did not understand that. Can you rephrase it?");
        return true;
    }

    // faild and lose context
    failReset() {
        this.fail();
        this.switchToDefault();
        return true;
    }
}

class DefaultDialog extends Dialog {
    notify(appId, event) {
        var app = this.manager.apps.getApp(appId);
        if (!app)
            return true;
        this.reply("Notification from " + app.name + ": " + event.join(', '));
        return true;
    }

    handle(analyzer) {
        if (this.handleGeneric(analyzer))
            return true;

        if (analyzer.isYes)
            return this.reply("I agree, but to what?");
        else if (analyzer.isNo)
            return this.reply("No way!");
        else if (analyzer.isQuestion)
            return this.switchTo(new QuestionDialog(), analyzer);
        //else if (analyzer.isRule)
        //    return this.switchTo(new RuleDialog(), analyzer);
        else if (analyzer.isAction)
            return this.switchTo(new ActionDialog(true), analyzer);
        else
            return false;
    }
}

const SPARQL_PRELUDE = 'prefix foaf: <http://xmlns.com/foaf/0.1/> ' +
                       'prefix tt: <http://thingengine.stanford.edu/rdf/0.1/> ' +
                       'prefix tto: <http://thingengine.stanford.edu/ontology/0.1/#> ';

class QuestionDialog extends Dialog {
    constructor() {
        super();

        this.running = false;
    }

    handle(analyzer) {
        if (this.handleGeneric(analyzer))
            return true;
        if (this.running)
            return;

        var sparql = SPARQL_PRELUDE + analyzer.query;
        var stream = this.manager.sparql.runQuery(sparql);

        stream.on('data', (d) => {
            if (!this.running)
                return;
            this.sendReply(util.inspect(d));
        });
        stream.on('end', () => {
            if (!this.running)
                return;
            this.sendReply("Done");
            this.running = false;
            this.switchToDefault();
        });
        stream.on('error', (e) => {
            if (!this.running)
                return;
            this.sendReply("Error: " + e.message);
            this.running = false;
            this.switchToDefault();
        });

        this.running = true;
        return true;
    }
}

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1).toLowerCase();
}

class SlotFillingDialog extends Dialog {
    constructor(slots, prefilled) {
        super();

        this.slots = slots;
        this.values = new Array(slots.length);
        this.toFill = [];

        this._resolving = null;

        this.slots.forEach((slot, i) => {
            if (slot.name in prefilled) {
                if (slot.type !== prefilled[slot.name].type)
                    throw new Error('Wrong type for argument ' + slot.name);

                this.values[i] = prefilled[slot.name].value;
            } else {
                this.toFill.push(i);
            }
        });
    }

    continue() {
        if (this.toFill.length > 0) {
            var idx = this.toFill.shift();
            this._resolving = idx;

            var param = this.slots[idx];
            var question = param.question || "What is the value of argument " + param.name + "?";

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
        } else {
            return false;
        }
    }

    handleRaw(command) {
        if (this._resolving !== null &&
            categoryEquals(this.expecting, ValueCategory.RawString)) {
            this.values[this._resolving] = command;
            this._resolving = null;
            return this.continue();
        } else {
            return this.parent(command);
        }
    }

    handle(analyzer) {
        if (this._resolving !== null) {
            this.values[this._resolving] = command.value;
            this._resolving = null;
            return this.continue();
        } else {
            return this.unexpected();
        }
    }
}

class ActionDialog extends Dialog {
    constructor(directExec) {
        super();
        this.directExec = directExec;

        this.originalCommand = null;

        this.kind = null;
        this.channel = null;
        this.schema = null;
        this.device = null;
        this.resolving = null;
        this.args = null;
    }

    describe() {
        return this.channel + " on " + this.kind + " " +
            this.args.join(", ");
    }

    _askDevice() {
        var kind = this.kind;
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            this.reply("You don't have a " + kind);
            this.switchToDefault();
            return true;
        }

        if (devices.length === 1) {
            this.device = [devices[0]];
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
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 1 ||
            value > this.resolving.length) {
            this.reply("Please choose a number between 1 and " + this.resolving.length);
            return true;
        } else {
            this.reply("You chose " + this.resolving[value-1].name);
            this.device = this.resolving[value-1];
        }

        this.resolving = [];
        this.expecting = null;
        return false;
    }

    execute() {
        var kind = this.kind;
        var channel = this.channel;
        var args = this.args;

        console.log('Executing action ' + channel + ' on ' + device.uniqueId);
        Q.all(devices.map(function(device) {
            return device.invokeAction(channel, args);
        })).then(function() {
            return this.done();
        }.bind(this)).catch(function(e) {
            this.reply("Sorry, that did not work: " + e.message);
            this.switchToDefault();
        }.bind(this)).done();

        return true;
    }

    handle(command) {
        if (this.originalCommand === null)
            this.originalCommand = command;

        if (this.kind === null) {
            this.kind = command.kind;
            this.channel = command.channel;

            this.manager.schemas.getSchema(this.kind).then((schema) => {
                if (schema === null) {
                    this.sendReply("I don't recognize a thing of kind " + this.kind);
                    this.switchToDefault();
                } else {
                    if (!(this.channel in schema)) {
                        this.sendReply("Things of kind " + this.kind + " cannot " + this.channel);
                        this.switchToDefault();
                    } else {
                        this.schema = schema[this.channel];
                        this._continue();
                    }
                }
            }).catch((e) => {
                console.error("Failed to retrieve schema for " + this.kind + ": " + e.message);
                this.failReset();
            }).done();
        } else if (this.schema === null) {
            // still in process of loading the schema, ignore...
            return;
        } else {
            this._continue(command);
        }
    }

    _continue(command) {
        if (this._askDevice())
            return true;

        if (this.device === null &&
            this.expecting === ValueCategory.Number) {
            if (this._handleResolve(command))
                return true;
        }

        if (this.args === null) {
            // if we get here, either we never pushed the SlotFillingDialog,
            // or the SlotFillingDialog returned false from .handle(), which
            // implies it is done
            if (this.subdialog === null) {
                // make up slots
                var slots = this.schema.map(function(typeString, i) {
                    var type = ThingTalk.Type.fromString(typeString);
                    return { name: 'arg' + i, type: type };
                });

                this.push(new SlotFillingDialog(slots, this.originalCommand.args));
                if (this.subdialog.continue())
                    return;
            } else {
                this.args = this.subdialog.values;
                this.pop();
            }
        }

        if (!this.directExec)
            return false;

        if (categoryEquals(this.expecting, ValueCategory.YesNo)) {
            if (command.isYes)
                return this.execute();
            else if (command.isNo)
                return this.reset();
            else
                return this.fail();
        } else {
            return this.ask(ValueCategory.YesNo, "Ok, so you want me to " +
                            this.describe() +
                            ". Is that right?");
        }
    }
}

class InitializationDialog extends Dialog {
    constructor() {
        super();
        this.name = null;
        this.tentative_name = null;
    }

    _checkName() {
        var prefs = this.manager.platform.getSharedPreferences();
        var name = prefs.get('sabrina-name');
        if (name !== undefined && name !== null) {
            this.name = name;
            return false;
        }

        this.tentative_name = this.manager.user.name;
        if (this.tentative_name)
            this.ask(ValueCategory.YesNo, "Can I call you " + this.tentative_name + "?");
        else
            this.ask(ValueCategory.RawString, "What's your name?");
        return true;
    }

    _handleNameResponse(word) {
        if (word.isYes) {
            this.name = this.tentative_name;
            var prefs = this.manager.platform.getSharedPreferences();
            prefs.set('sabrina-name', this.name);
            this.reply("Hi " + this.name + ", nice to meet you.");
            prefs.set('sabrina-initialized', true);
            this.expecting = null;
            return false;
        } else {
            return this.ask(ValueCategory.RawString, "Ok, what's your name then?");
        }
    }

    start() {
        var prefs = this.manager.platform.getSharedPreferences();
        var initialized = prefs.get('sabrina-initialized');
        if (initialized)
            return this.switchToDefault();

        setTimeout(function() {
            this.reply("Hello! My name is Sabrina, and I'm your virtual assistant.");

            this._continue();
        }.bind(this), 1000);
    }

    handleRaw(command) {
        if (this.expecting === ValueCategory.RawString) {
            if (this.name === null) {
                this.name = command;
                var prefs = this.manager.platform.getSharedPreferences();
                prefs.set('sabrina-name', command);
                this.reply("Hi " + command + ", nice to meet you.");
                prefs.set('sabrina-initialized', true);
                return this._continue();
            }
        }

        return this.parent(command);
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (categoryEquals(this.expecting, ValueCategory.YesNo)) {
            if (this.name === null) {
                if (this._handleNameResponse(command))
                    return true;
            }
        }

        return this._continue();
    }

    _continue() {
        if (this._checkName())
            return true;

        this.reply("Ok, now I'm ready to use all my magic powers to help you.");
        this.switchToDefault();
        return true;
    }
}

module.exports = {
    InitializationDialog: InitializationDialog
}
