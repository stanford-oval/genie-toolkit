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

// FINISHME: move this to actual thingpedia
const Parameter = adt.data({
    Constant: { value: adt.any },
    Input: { question: adt.only(String), type: adt.only(ThingTalk.Type) }
});

const ThingPedia = {
    NounToKindMap: {
        'tv': 'tv',
        'lightbulb': 'lightbulb',
        'scale': 'scale'
    },
    NounToTriggerMap: {
        'weight': ['extern Weight : (Date, Measure(kg));', 'Weight(_, %s)',
                   ThingTalk.Type.Measure('kg')],
        'picture': [],
        'movie': [],
        'show': [],
    },
    DeviceVerbToActionMap: {
        'scale': {},
        'tv': {
            'turn on': ['setpower', Parameter.Constant(true)],
            'turn off': ['setpower', Parameter.Constant(false)]
        },
        'lightbulb': {
            'turn on': ['setpower', Parameter.Constant(true)],
            'turn off': ['setpower', Parameter.Constant(false)]
        },
    },
    AbsoluteVerbToActionMap: {
        'tweet': ['twitter', 'sink', Parameter.Input("What do you want me to tweet?",
                                                     ThingTalk.Type.String)]
    },

    VerbToActionMap: {
        'tt:device.action.post': {
            'tt:missing': ['twitter', 'facebook'],
            'tt:device.twitter': ['twitter', 'sink', Parameter.Input("What do you want me to tweet?",
                                                                     ThingTalk.Type.String)],
            'tt:device.facebook': ['facebook', 'post', Parameter.Input("What do you want me to post on Facebook?",
                                                                       ThingTalk.Type.String)]
        }
    },
};

const LambdaForm = adt.data(function() {
    return {
        Atom: { name: adt.only(String) },
        Apply: { left: adt.only(this),
                 right: adt.only(this) },
        Lambda: { varname: adt.only(String),
                  body: adt.only(this) },
        String: { value: adt.only(String) },
        Number: { value: adt.only(Number) },
        Date: { value: adt.only(Date) },
        Variable: { name: adt.only(String) },
    };
});

const LambdaFormParser = new lang.Class({
    Name: 'LambdaFormParser',

    _init: function(full) {
        this._full = full;
        this._idx = 0;
    },

    _eatString: function() {
        this._idx ++; // eat the open quote first
        var buffer = '';
        while (this._idx < this._full.length) {
            if (this._full[this._idx] === '"') {
                this._idx ++; // eat the close quote
                return buffer;
            }

            if (this._full[this._idx] === '\\') {
                if (this._idx === this._full.length-1)
                    throw new Error('Invalid escape');
                if (this._full[this._idx] === '"')
                    buffer += '"';
                else if (this._full[this._idx] === 'n')
                    buffer += '\n';
                else
                    throw new Error('Invalid escape');
                this._idx += 2;
            } else {
                buffer += this._full[this._idx];
                this._idx++;
            }
        }

        throw new Error('Invalid non terminated string');
    },

    _eatName: function() {
        var reg = /[a-z:\.]+/ig;
        reg.lastIndex = this._idx;
        var match = reg.exec(this._full);
        if (match === null)
            throw new Error('Expected identifier');
        this._idx = reg.lastIndex;
        return match[0];
    },

    nextToken: function() {
        while (this._idx < this._full.length) {
            if (/\s/.test(this._full[this._idx]))
                this._idx++;
            break;
        }
        if (this._idx >= this._full.length)
            throw new Error('Unexpected end of input');

        if (this._full[this._idx] === '(') {
            this._idx++;
            return '(';
        }

        if (this._full[this._idx] === ')') {
            this._idx++;
            return ')';
        }

        if (this._full[this._idx] === '"') {
            return this._eatString();
        }

        return this._eatName();
    },

    expect: function(what) {
        var token = this.nextToken();
        if (what !== token)
            throw new Error('Expected ' + what);
    },

    parseList: function() {
        var name = this.nextToken();
        if (name === '(') {
            var left = this.parseList();
            if (left.isString || left.isDate || left.isNumber)
                throw new Error('Cannot apply value ' + left);
            var right = this.parseAtom();
            return LambdaForm.Apply(left, right);
        } else if (name === 'string') {
            var value = this.nextToken();
            if (value === '(' || value === ')')
                throw new Error('Expected string');
            this.expect(')');
            return LambdaForm.String(value);
        } else if (name === 'date') {
            var year = this.nextToken();
            var month = this.nextToken();
            var day = this.nextToken();
            if (year === '(' || year === ')' ||
                month === '(' || month === ')' ||
                day === '(' || day === ')')
                throw new Error('Expected date');
            this.expect(')');
            return LambdaForm.Date(new Date(year, month, day));
        } else if (name === 'lambda') {
            var varname = this.nextToken();
            if (varname === '(' || varname === ')')
                throw new Error('Expected varname');
            var body = this.parseAtom();
            this.expect(')');
            return LambdaForm.Lambda(varname, body);
        } else if (name === 'var') {
            var varname = this.nextToken();
            this.expect(')');
            return LambdaForm.Variable(varname);
        } else {
            var left = LambdaForm.Atom(name);
            var right = this.parseAtom();
            this.expect(')');
            return LambdaForm.Apply(left, right);
        }
    },

    parseAtom: function() {
        var token = this.nextToken();
        if (token === '(')
            return this.parseList();
        else if (token === ')')
            throw new Error('Unexpected token close-paren');
        else
            return LambdaForm.Atom(token);
    },

    parse: function() {
        return this.parseAtom()
    }
});

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

    /*
const ConditionDialog = new lang.Class({
    Name: 'ConditionDialog',
    Extends: Dialog,

    _init: function() {
        this.parent();
        this.done = false;

        this.lhs = [];
        this.comp = null;
        this.rhs = null;
    },

    describe: function() {
        return "If " + this.lhs.map(function(w) { return w.word; }).join(" and ")
            + " " + this.comp.word + " " +
            this.rhs.word;
    },

    name: function() {
        return this.lhs.map(function(w) {
            return capitalize(w.word);
        }).join('');
    },

    generateCode: function() {
        var idx = 0;
        var declarations = [];
        var conditions = [];
        this.lhs.forEach(function(lhs) {
            var lhs_condition = ThingPedia.NounToTriggerMap[lhs.word];
            var lhs_declaration = lhs_condition[0];
            var lhs_channelName = lhs_condition[1];
            var lhs_valueType = lhs_condition[2];

            declarations.push(lhs_declaration);

            var lhs_varName = 'v' + (idx++);
            conditions.push(lhs_channelName.format(lhs_varName));

            if (lhs_valueType.isString) {
                conditions.push(lhs_varName + '="' + this.rhs.word + '"');
            } else {
                if (this.rhs.word.category === Words.VALUE_NOUN) {
                    var rhs_condition = ThingPedia.NounToTriggerMap[this.rhs.word];
                    var rhs_declaration = rhs_condition[0];
                    var rhs_channelName = rhs_condition[1];
                    var rhs_valueType = rhs_condition[2];

                    declarations.push(rhs_declaration);

                    var rhs_varName = 'v' + (idx++);
                    conditions.push(rhs_channelName.format(rhs_varName));

                    if (this.comp.word === 'is about') {
                        conditions.push(lhs_varName + '/' + rhs_varName + ' <= 1.05 && '
                                        + lhs_varName + '/' + rhs_varName + ' >= 0.95');
                    } else if (this.comp.word === 'contains') {
                        conditions.push('$contains(' + lhs_varName + ',' + rhs_varName + ')');
                    } else if (this.comp.word === 'is' ||
                               this.comp.word === 'same') {
                        conditions.push(lhs_varName + '=' + rhs_varName);
                    } else {
                        conditions.push(lhs_varName + this.comp.word + rhs_varName);
                    }
                } else {
                    if (this.comp.word === 'is about') {
                        conditions.push(lhs_varName + '/' + this.rhs.word + ' <= 1.05 && '
                                        + lhs_varName + '/' + this.rhs.word + ' >= 0.95');
                    } else if (this.comp.word === 'contains') {
                        conditions.push('$contains(' + lhs_varName + ',' + this.rhs.word + ')');
                    } else if (this.comp.word === 'is' ||
                               this.comp.word === 'same') {
                        conditions.push(lhs_varName + '=' + this.rhs.word);
                    } else {
                        conditions.push(lhs_varName + this.comp.word + this.rhs.word);
                    }
                }
            }
        }, this);

        return [declarations, conditions.join(', ')];
    },

    _handleAny: function(command) {
        if (command[0].category === Words.CONDITIONAL)
            command.shift();
        if (command.length === 0)
            return this.reply("If what?");

        while (command.length > 0 && this.rhs === null) {
            var next = command.shift();

            if (next.category === Words.VALUE_NOUN) {
                if (this.comp === null)
                    this.lhs.push(next);
                else
                    this.rhs.push(next);
            } else if (next.category === Words.COMPARATOR) {
                if (this.comp !== null || this.lhs.length === 0)
                    return this.fail();

                this.comp = next;
            } else {
                if (this.comp !== null)
                    this.rhs = next;
                else
                    return this.fail();
            }
        }

        if (this.comp === null) {
            return this.reply("What about " +
                              this.lhs.map(function(w) { return w.word; }).join(" and ")
                              + "?");
        }
        if (this.rhs === null)
            return this.reply(this.comp.word + " what?");

        return false;
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return true;

        if (this._handleAny(command))
            return true;

        return false;
    },
});

const RuleDialog = new lang.Class({
    Name: 'RuleDialog',
    Extends: Dialog,

    _init: function() {
        this.parent();
        this.condition = null;
        this.action = null;
    },

    execute: function() {
        var actions = this.action.generateCode();
        var lhs = this.condition.generateCode();
        var declarations = lhs[0];
        var condition = lhs[1];
        var code = 'SabrinaGenerated' + this.condition.name() + this.action.name() + '() {\n';
        code += declarations.join('\n');
        code += '\n';
        actions.forEach(function(action) {
            code += condition + " => " + action + ";\n";
        });
        code += '}';

        this.manager.apps.loadOneApp(code, { description: this.describe() },
                                     undefined, undefined, true)
            .then(function(e) {
                this.done();
            }.bind(this)).catch(function(e) {
                this.reply("Sorry, that did not work: " + e.message);
                this.switchToDefault();
            }.bind(this)).done();
    },

    describe: function() {
        return this.condition.describe() + ", " + this.action.describe();
    },

    handleRaw: function(raw) {
        if (this.subdialog !== null) {
            if (this.subdialog.handleRaw(raw))
                return;

            return this._continue([]);
        } else {
            return this.parent(raw);
        }
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.condition === null) {
            if (this.push(this.condition = new ConditionDialog(), command))
                return true;
        }

        if (this.action === null) {
            if (command.length === 0) {
                this.reply("What do you want to do " + this.condition.describe() + "?");
                this.subdialog = null;
                return;
            }

            if (command[0].category === Words.DEVICE_NOUN ||
                command[0].category === Words.DEVICE_VERB) {
                if (this.push(this.action = new DeviceActionDialog(false), command))
                    return true;
            } else if (command[0].category === Words.ABSOLUTE_VERB) {
                if (this.push(this.action = new AbsoluteActionDialog(false), command))
                    return true;
            } else {
                // FINISHME
                return this.fail();
            }
        }

        return this._continue(command);
    },

    _continue: function(command) {
        this.subdialog = null;

        if (this.expecting === Words.YES_ANSWER) {
            if (command.length !== 1)
                return this.fail();

            if (command[0].category === Words.YES_ANSWER)
                return this.execute();
            else if (command[0].category === Words.NO_ANSWER)
                return this.reset();
            else
                return this.fail();
        } else {
            return this.ask(Words.YES_ANSWER, "Ok, so " +
                            this.describe() +
                            ". Is that right?");
        }

        // FINISHME
        return this.parent(command);
    }
});
*/

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

                                    /*
    generateCode: function() {
        var devices = this.devices;

        var action = ThingPedia.AbsoluteVerbToActionMap[this.verb.word];
        var kind = action[0];

        var selector;
        if (devices.length > 1) {
            // selected 'all'
            selector = '@(type="' + kind + '")';
        } else {
            selector = '@(id="' + devices[0].uniqueId + '")';
        }

        var channelName = action[1];
        var args = this.resolved_parameters.map(function(p) {
            if (typeof p === 'string')
                return '"' + p + '"';
            else
                return p;
        });

        return [selector + '.' + channelName + '(' + args.join(',') + ')'];
    },*/

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

// FIXME
/*
const ActionDialog = new lang.Class({
    Name: 'ActionDialog',
    Extends: Dialog,

    _init: function(directExec) {
        this.parent();
        this.nouns = [];
        this.verbs = [];
        this.resolved_nouns = [];
        this.resolving = [];
        this.devices = {};
        this.directExec = directExec;
    },

    name: function() {
        return this.resolved_nouns.map(function(w) {
            return capitalize(w.word);
        }).join('');
    },

    _checkVerb: function(word) {
        for (var i = 0; i < this.resolved_nouns.length; i++) {
            if (!this._checkVerbNoun(word, this.resolved_nouns[i]))
                return false;
        }

        return true;
    },

    _handleAny: function(command) {
        for (var i = 0; i < command.length; i++) {
            if (this.expecting !== null) {
                if (this.expecting !== command[i].category)
                    return this.unexpected();
            } else {
                if (command[i].category === Words.YES_ANSWER ||
                    command[i].category === Words.NO_ANSWER ||
                    command[i].category === Words.SPECIAL)
                    return this.fail();
            }

            if (command[i].category === Words.DEVICE_VERB) {
                if (!this._checkVerb(command[i]))
                    return true;
            }
        }

        for (var i = 0; i < command.length; i++) {
            if (command[i].category === Words.DEVICE_NOUN) {
                this.nouns.push(command[i]);
            } else if (command[i].category === Words.DEVICE_VERB) {
                this.verbs.push(command[i]);
            }
        }

        return false;
    },

    _tryResolveNoun: function(command) {
        if (this.nouns.length === 0)
            return false;

        var toResolve = this.nouns.shift();

        for (var i = 0; i < this.verbs.length; i++) {
            if (!this._checkVerbNoun(this.verbs[i], toResolve))
                return true;
        }

        var kind = ThingPedia.NounToKindMap[toResolve.word];
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            this.reply("You don't have any " + toResolve.word);
            this.switchToDefault();
            return true;
        }

        if (devices.length === 1) {
            this.devices[toResolve.word] = [devices[i]];
            this.resolved_nouns.push(toResolve);
            return false;
        }

        if (devices.length > 1) {
            this.reply("You have multiple " + toResolve.word + "s");
            var question = "Do you mean ";
            for (var i = 0; i < devices.length; i++)
                question += (i > 0 ? " or " : "") + (i+1) + ") " + devices[i].name;
            question += "?";
            this.resolving = devices;
            this.resolved_nouns.push(toResolve);
            this.ask(Words.NUMBER, question);
            return true;
        }
    },

    execute: function() {
        Q.all(this.resolved_nouns.map(function(noun) {
            var devices = this.devices[noun.word];
            if (devices.length < 1)
                return;
            var kind = ThingPedia.NounToKindMap[noun.word];

            return Q.all(this.verbs.map(function(verb) {
                var action = ThingPedia.DeviceVerbToActionMap[kind][verb.word];

                var channelName = action[0];
                var args = action.slice(1).map(function(param) {
                    if (param.isConstant)
                        return param.value;
                    else
                        throw new TypeError(); // not implemented yet
                });

                return Q.all(devices.map(function(device) {
                    console.log('Executing action ' + channelName + ' on ' + device.uniqueId);
                    return device.getChannel(channelName, []).then(function(channel) {
                        channel.sendEvent(args);
                        return channel.close();
                    });
                }));
            }));
        }, this)).then(function() {
            return this.done();
        }.bind(this)).catch(function(e) {
            this.reply("Sorry, that did not work: " + e.message);
            this.switchToDefault();
        }.bind(this)).done();

        return true;
    },

    generateCode: function() {
        var actions = [];
        this.resolved_nouns.forEach(function(noun) {
            var devices = this.devices[noun.word];

            var kind = ThingPedia.NounToKindMap[noun.word];

            var selector;
            if (devices.length > 1) {
                // selected 'all'
                selector = '@(type="' + kind + '")';
            } else {
                selector = '@(id="' + devices[0].uniqueId + '")';
            }

            this.verbs.forEach(function(verb) {
                var action = ThingPedia.DeviceVerbToActionMap[kind][verb.word];

                var channelName = action[0];
                var args = action.slice(1).map(function(param) {
                    if (param.isConstant)
                        return param.value;
                    else
                        throw new TypeError(); // not implemented yet
                });

                actions.push(selector + '.' + channelName + '(' + args.join(',') + ')');
            }, this);
        }, this);

        return actions;
    },

    _handleResolve: function(command) {
        if (command[0].word === 'none')
            return this.reset();

        var noun = this.resolved_nouns[this.resolved_nouns.length-1].word;
        if (command[0].word === 'all') {
            this.reply("You chose all " + noun + "s");
            this.devices[noun] = this.resolving;
        } else {
            var value = command[0].value;
            if (value !== Math.floor(value) ||
                value < 1 ||
                value > this.resolving.length) {
                return this.reply("Please choose a number between 1 and " + this.resolving.length);
            } else {
                this.reply("You chose " + this.resolving[value-1].name);

                this.devices[noun] = [this.resolving[value-1]];
            }
        }

        this.resolving = [];
        this.expecting = null;
        return false;
    },

    describe: function() {
        return this.verbs.map(function(w) { return w.word; }).join(" and ") +
            " the " +
            this.resolved_nouns.map(function(w) { return w.word; }).join(" and ");
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.expecting !== Words.YES_ANSWER &&
            this.expecting !== Words.NUMBER) {
            if (this._handleAny(command))
                return true;

            if (this._tryResolveNoun())
                return true;
        }

        if (this.expecting === Words.NUMBER) {
            if (this._handleResolve(command))
                return true;
        }

        if (this.resolved_nouns.length === 0 && this.verbs.length === 0)
            return this.fail();

        if (this.resolved_nouns.length === 0) {
            return this.ask(Words.DEVICE_NOUN, "What do you want to " +
                            this.verbs.map(function(w) { return w.word; }).join(" and ") + "?");
        }

        if (this.verbs.length === 0) {
            return this.ask(Words.DEVICE_VERB, "What do you want to do with the " +
                            this.resolved_nouns.map(function(w) { return w.word; }).join(" and ") + "?");
        }

        if (!this.directExec)
            return false;

        if (this.expecting === Words.YES_ANSWER) {
            if (command.length !== 1)
                return this.fail();

            if (command[0].category === Words.YES_ANSWER)
                return this.execute();
            else if (command[0].category === Words.NO_ANSWER)
                return this.reset();
            else
                return this.fail();
        } else {
            return this.ask(Words.YES_ANSWER, "Ok, so you want me to " +
                            this.describe() +
                            ". Is that right?");
        }
    }
});
*/

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
        this.dobOk = false;
        this.genderOk = false;
    },

    _checkDatabaseApp: function() {
        if (this.appOk)
            return false;

        var apps = this.manager.apps;
        if (apps.getApp('app-SabrinaPopulateDatabase') !== undefined) {
            this.appOk = true;
            this.hasApp = true;
            return false;
        }

        this.reply("It looks like you're not storing your personal information in the database yet.");
        return this.ask(ValueCategory.YesNo, "Would you like me to do so?");
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
            this.ask(ValueCategory.YesNo, "Can I call you %s?".format(user.name));
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

    _handleAppResponse: function(analyzer) {
        this.expecting = null;
        this.appOk = true;

        if (analyzer.isYes) {
            var apps = this.manager.apps;
            this.hasApp = true;
            apps.loadOneApp(SABRINA_POPULATE_DATABASE,
                            { description: "Fills the Sabrina Database with data from your IoT devices" },
                            'app-SabrinaPopulateDatabase',
                            undefined, true)
                .then(function() {
                    this._continue();
                }.bind(this)).done();
            return true;
        } else {
            this.hasApp = false;
            return false;
        }
    },

    _handleNameResponse: function(word) {
        if (word.isYes) {
            this.name = this.tentative_name;
            var prefs = platform.getSharedPreferences();
            prefs.set('sabrina-name', this.name);
            this.reply("Hi %s, nice to meet you.".format(this.name));
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
        this.reply("Hello! My name is Sabrina, and I'm your virtual assistant.");

        this._continue();
    },

    handleRaw: function(command) {
        if (this.expecting === ValueCategory.RawString) {
            if (this.name === null) {
                this.name = command;
                var prefs = platform.getSharedPreferences();
                prefs.set('sabrina-name', command);
                this.reply("Hi %s, nice to meet you.".format(command));
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
                if (this._handleNameResponse(command[0]))
                    return true;
            } else if (!this.appOk) {
                if (this._handleAppResponse(command[0]))
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
    },
});

const AssistantManager = new lang.Class({
    Name: 'AssistantManager',
    Extends: events.EventEmitter,
    $rpcMethods: ['handleCommand', 'setDelegate'],

    _init: function(engine) {
        events.EventEmitter.call(this);
        this._engine = engine;

        this._receiver = null;
        this._raw = false;

        this._initialized = false;

        this._notify = null;
        this._notifyListener = this._onNotify.bind(this);
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

    get ui() {
        return this._engine.ui;
    },

    _onNotify: function(data) {
        if (!this._receiver) {
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
            this._onNotify(data);
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

        return this.ui.getAllNotify().then(function(notify) {
            this._notify = notify;
            notify.on('data', this._notifyListener);
        }.bind(this));
    },

    stop: function() {
        if (this._notify) {
            this._notify.removeListener('data', this._notifyListener);
            return this._notify.close();
        } else {
            return Q();
        }
    },

    setDelegate: function(delegate) {
        this._delegate = delegate;
        return this._initialize();
    },

    _initialize: function() {
        if (this._initialized)
            return Q();
        if (!this._delegate)
            return Q();

        this._initialized = true;
        this.setDialog(new InitializationDialog());
    },

    handleCommand: function(command) {
        console.log('Received Assistant command ' + command);

        Q.try(function() {
            var handled;
            if (this._raw)
                return this._dialog.handleRaw(command);

            return this._delegate.analyze(command).then(function(analyzed) {
                console.log('Analyzed message into ' + analyzed);

                var parser = new LambdaFormParser(analyzed);
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
        }.bind(this)).done();
    },

    sendReply: function(message) {
        console.log('sendReply: ' + message);
        if (this._delegate)
            this._delegate.send(message);
    }
});

const DummyAssistantManager = new lang.Class({
    Name: 'DummyAssistantManager',

    _init: function() {
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },

    handleCommand: function(command) {
        throw new Error('handleCommand should not be called on this platform');
    },
});

function create(engine) {
    if (platform.hasCapability('assistant'))
        return new AssistantManager(engine);
    else
        return new DummyAssistantManager();
}

module.exports.create = create;
