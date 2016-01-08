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

const AppCompiler = require('./app_compiler');

// Very bare-bones word-level NLP
const Words = {
    // special sentinel for ask() to avoid any NLP normalization or processing
    RAW_STRING: [],

    IGNORED: ['a', 'the', 'and', 'my', 'your', 'mine', 'yours', 'of'],
    SPECIAL: ['debug', 'nlp', 'help', 'sorry', 'cool', ['never', 'mind']],
    YES_ANSWER: ['yes', 'sure', 'ok'],
    NO_ANSWER: ['no', 'never'],

    // "measure weight" should be kind of the same as "what [is] [my] weight"
    // hence "measure" in QUESTION not DEVICE_VERB or ABSOLUTE_VERB
    QUESTION: ['?', 'who', 'what', 'when', 'where', 'how', 'why', 'measure'],

    PREPOSITION: ['on', 'in', 'at'],
    COMPARATOR: ['>', '<', ['is', 'about'], 'is', 'contains', 'same'],
    NUMBER: ['all', 'none'],
    TIMESTAMP: [],
    DATE: [],
    DAY: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    MONTHS: ['january', 'february', 'march', 'april', 'may', 'june', 'july',
             'august', 'september', 'october', 'november', 'december'],
    YEAR: [],

    // FINISHME: these should be taken from ThingPedia
    // (or some crazy unsupervised learning on a massive amount of text!)

    // a noun that identifies a device (ie, a thing)
    DEVICE_NOUN: ['tv', 'scale', 'lightbulb'],

    // a noun that identifies something that can be measured or extracted from
    // a trigger (ie, something that you ask or search for)
    VALUE_NOUN: ['weight', 'picture', 'movie', 'show'],

    // something else
    OTHER_NOUN: [],

    // a verb, maps to an action on a device_noun
    DEVICE_VERB: [['turn', 'on'], ['turn', 'off'], 'play', 'measure'],

    // a verb that also implies where to execute the action
    ABSOLUTE_VERB: ['tweet'],

    UNKWOWN: [],
};
const WordCategories = [Words.IGNORED, Words.SPECIAL, Words.YES_ANSWER, Words.NO_ANSWER,
                        Words.QUESTION, Words.PREPOSITION, Words.COMPARATOR,
                        Words.NUMBER, Words.TIMESTAMP, Words.DATE,
                        Words.DAY, Words.MONTHS, Words.YEAR,
                        Words.DEVICE_NOUN, Words.VALUE_NOUN, Words.OTHER_NOUN,
                        Words.DEVICE_VERB, Words.ABSOLUTE_VERB,
                        Words.UNKWOWN];

// FINISHME: move this to actual thingpedia
const Parameter = adt.data({
    Constant: { value: adt.any },
    Input: { question: adt.only(String), type: adt.only(AppCompiler.Type) }
});

const ThingPedia = {
    NounToKindMap: {
        'tv': 'tv',
        'lightbulb': 'lightbulb',
        'scale': 'scale'
    },
    NounToTriggerMap: {
        'weight': ['scale', 'source'],
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
        'tweet': ['twitter', 'sink', Parameter.Input("What", AppCompiler.Type.String)]
    },
};

function categoryName(category) {
    for (var key in Words) {
        if (Words[key] === category)
            return key;
    }
    return 'INVALID_CATEGORY';
}

const NLP = new lang.Class({
    Name: 'NLP',

    _init: function() {
    },

    isIgnored: function(word) {
        return Words.IGNORED.indexOf(word) >= 0;
    },

    tryCategory: function(words, idx, category) {
        for (var i = 0; i < category.length; i++) {
            var candidate = category[i];
            if (Array.isArray(candidate)) {
                var j = idx;
                var good = true;
                for (var k = 0; k < candidate.length; k++) {
                    if (j >= words.length) {
                        good = false;
                        break;
                    }
                    if (this.isIgnored(words[j])) {
                        j++;
                        continue;
                    }
                    if (words[j] !== candidate[k]) {
                        good = false;
                        break;
                    }
                    j++;
                }
                if (good)
                    return j - idx;
            } else {
                if (candidate === words[idx])
                    return 1;
            }
        }
    },

    parseNumeric: function(word) {
        if (/^\d{4}$/.test(word)) {
            var year = parseInt(word, 10);
            if (year >= 1900 && year <= 2100)
                return [1, Words.YEAR, year];
        }

        var date = word.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
        if (date !== null) {
            var year = parseInt(date[1], 10);
            var month = parseInt(date[2], 10);
            var day = parseInt(date[3], 10);
            if (year >= 1900 && year <= 2100 &&
                month >= 1 && month <= 12 &&
                day >= 1 && day <= 31) {
                var dateObj = new Date(year, month-1, day, 0, 0, 0);
                return [1, Words.DATE, dateObj];
            }
        }
        date = word.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
        if (date !== null) {
            var year = parseInt(date[3], 10);
            var month = parseInt(date[1], 10);
            var day = parseInt(date[2], 10);

            if (year >= 1900 && year <= 2100) {
                if (month >= 1 && month <= 12 &&
                    day >= 1 && day <= 31) {
                    var dateObj = new Date(year, month-1, day, 0, 0, 0);
                    return [1, Words.DATE, dateObj];
                }

                // try swapping month and day (European style)
                var tmp = month;
                month = day;
                day = tmp;
                if (month >= 1 && month <= 12 &&
                    day >= 1 && day <= 31) {
                    var dateObj = new Date(year, month-1, day, 0, 0, 0);
                    return [1, Words.DATE, dateObj];
                }
            }
        }

        if (/^\d+(?:[,.]\d+)?[a-z]*$/.test(word))
            return [1, Words.NUMBER, parseFloat(word.replace(',', '.'))];

        return null;
    },

    getCategory: function(words, idx) {
        if (/^\d/.test(words[idx]))
            return this.parseNumeric(words[idx]);

        for (var i = 0; i < WordCategories.length; i++) {
            var attempt = this.tryCategory(words, idx, WordCategories[i]);
            if (attempt > 0)
                return [attempt, WordCategories[i], null];
        }

        return [1, Words.UNKWOWN, null];
    },

    analyze: function(utterance) {
        var words = [];
        var increase = 0;
        var question = false;
        // normalize and stem the utterance
        utterance = utterance.toLowerCase().trim();

        // move a question mark from the last word to a separate word at
        // the beginning (that triggers the QuestionDialog path)
        if (utterance[utterance.length-1] === '?') {
            question = true;
            utterance = utterance.substr(0, utterance.length-1);
        }
        utterance = utterance.split(/(?:[,\.](?!\d)|[\s\!])+/g);
        utterance = utterance.map(function(word) {
            return word.trim();
        });
        utterance = utterance.filter(function(word) {
            return word.length > 0;
        });

        console.log('Normalized utterance into ' + utterance);

        for (var i = 0; i < utterance.length; i += increase) {
            var res = this.getCategory(utterance, i);
            if (res === null)
                return null;
            increase = res[0];
            if (increase === 0)
                return null;
            var category = res[1];
            if (category === Words.IGNORED)
                continue;
            var value = res[2];
            words.push({ word: utterance.slice(i, i + increase).join(' '),
                         category: category,
                         value: value });
        }
        if (words.length === 0)
            return null;

        if (question) {
            if (words[0].category === Words.SPECIAL) {
                words.splice(1, 0, { word: '?',
                                     category: Words.QUESTION,
                                     value: null });
            } else {
                words.unshift({ word: '?',
                                category: Words.QUESTION,
                                value: null });
            }
        }

        return words;
    }
});


const Dialog = new lang.Class({
    Name: 'Dialog',

    _init: function() {
        this.expecting = null;
        this.question = null;
    },

    ask: function(expected, question) {
        this.question = question;
        this.expecting = expected;
        this.reply(question);

        this.manager.setRaw(expected === Words.RAW_STRING);
    },

    expect: function(category) {
        this.expecting = category;
    },

    switchTo: function(dlg, command) {
        this.manager.setRaw(false);
        this.manager.setDialog(dlg);
        if (command)
            dlg.handle(command);
    },

    reply: function(msg) {
        this.manager.sendReply(msg);
    },

    handleGeneric: function(words) {
        if (words === null) {
            this.fail();
            return true;
        }

        if (words[0].category === Words.SPECIAL) {
            switch(words[0].word) {
            case 'debug':
                this.reply("This is a " + this.__name__);
                if (this.expecting === null)
                    this.reply("I'm not expecting anything");
                else
                    this.reply("I'm expecting a " + categoryName(this.expecting));
                break;
            case 'nlp':
                this.reply("NLP analysis");
                for (var i = 0 ; i < words.length; i++) {
                    var reply = words[i].word + ": " + categoryName(words[i].category);
                    if (words[i].value !== null)
                        reply += ": " + words[i].value;
                    this.reply(reply);
                }
                break;
            case 'help':
                this.reply("Sure! How can I help you?");
                this.reply("If you're unsure what to say, I understand most actions and objects. You can ask me a question and I'll try to answer it. You can tell me to do something at a later time if you give me the condition or the time.");
                if (this.expecting !== null) {
                    if (this.expecting === Words.YES_ANSWER ||
                        this.expecting === Words.NO_ANSWER) {
                        this.reply("At this time, just a yes or no will be fine though.");
                    } else if (this.question !== null) {
                        this.reply(this.question);
                    }
                }
                break;
            case 'sorry':
                this.reply("No need to be sorry.");
                this.reply("Unless you're Canadian. Then I won't stop you.");
                break;
            case 'cool':
                this.reply("I know, right?");
                break;
            case 'never mind':
                this.reset();
                break;
            }
            return true;
        }

        if (this.expecting !== null &&
            this.expecting !== words[0].category) {
            if (this.expecting === Words.YES_ANSWER ||
                this.expecting === Words.NO_ANSWER) {
                if (words.length === 1 &&
                    (words[0].category === Words.NO_ANSWER ||
                     words[0].category === Words.YES_ANSWER))
                    return false;

                this.reply("Just answer yes or no.");
                return true;
            } else {
                if (words.length === 1) {
                    if (words[0].category === Words.YES_ANSWER) {
                        this.reply("Yes what?");
                        return true;
                    } else if (words[0].category === Words.NO_ANSWER) {
                        this.reset();
                        return true;
                    }
                }

                this.unexpected();
                return true;
            }
        }

        return false;
    },

    handleRaw: function(raw) {
        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchTo(new DefaultDialog());
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return;

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchTo(new DefaultDialog());
    },

    reset: function() {
        this.reply("Ok forget it");
        this.switchTo(new DefaultDialog());
    },

    done: function() {
        this.reply("Consider it done");
        this.switchTo(new DefaultDialog());
    },

    unexpected: function() {
        this.reply("That's not what I asked");
    },

    fail: function() {
        this.reply("Sorry, I did not understand that. Can you rephrase it?");
        console.log((new Error()).stack);
    },

    // faild and lose context
    failReset: function() {
        this.fail();
        this.switchTo(new DefaultDialog());
    },
});

const DefaultDialog = new lang.Class({
    Name: 'DefaultDialog',
    Extends: Dialog,

    handle: function(command) {
        if (this.handleGeneric(command))
            return;

        if (command[0].category === Words.YES_ANSWER)
            this.reply("I agree, but to what?");
        else if (command[0].category === Words.NO_ANSWER)
            this.reply("No f-ing way");
        else if (command[0].category === Words.QUESTION)
            ; // handle question
        else if (command[0].category === Words.DEVICE_NOUN)
            this.switchTo(new DeviceActionDialog(), command);
        else if (command[0].category === Words.DEVICE_VERB)
            this.switchTo(new DeviceActionDialog(), command);
        else if (command[0].category === Words.ABSOLUTE_VERB)
            this.switchTo(new AbsoluteActionDialog(), command);
        else if (command[0].category === Words.VALUE_NOUN)
            ; // handle question
        else if (command[0].category === Words.OTHER_NOUN)
            ; // ??? do something
        else
            this.fail();
    }
});

const AbsoluteActionDialog = new lang.Class({
    Name: 'AbsoluteActionDialog',
    Extends: Dialog,

    _init: function() {
        this.verb = null;
        this.channelName = null;

        this.devices = null;
        this.resolving = null;

        this.parameters = [];
        this.currentParam = null;
        this.resolved_parameters = [];
    },

    _handleVerb: function(command) {
        this.verb = command.shift();

        var action = ThingPedia.AbsoluteVerbToActionMap[this.verb.word];
        this.parameters = action.slice(2);

        if (command.length == 0)
            return this._askDevice();
        else
            return false;
    },

    _askDevice: function() {
        var action = ThingPedia.AbsoluteVerbToActionMap[this.verb.word];
        var kind = action[0];
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            this.reply("You need a " + kind + " to " + this.verb.word);
            this.switchTo(new DefaultDialog());
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
            this.ask(Words.NUMBER, question);
            return true;
        }
    },

    _handleResolve: function(command) {
        if (command[0].word === 'none') {
            this.reset();
            return true;
        }

        var action = ThingPedia.AbsoluteVerbToActionMap[this.verb.word];
        var noun = action[0];
        if (command[0].word === 'all') {
            this.reply("You chose all " + noun + "s");
            this.devices = this.resolving;
        } else {
            var value = command[0].value;
            if (value !== Math.floor(value) ||
                value < 1 ||
                value > this.resolving.length) {
                this.reply("Please choose a number between 1 and " + this.resolving.length);
                return true;
            } else {
                this.reply("You chose " + this.resolving[value-1].name);
                this.devices = [this.resolving[value-1]];
            }
        }

        this.resolving = [];
        this.expecting = null;
        return false;
    },

    _tryNextParameter: function(command) {
        while (this.parameters.length > 0) {
            var param = this.parameters.shift();

            if (param.isConstant) {
                this.resolved_parameters.push(param.value);
                continue;
            }
            if (!param.isInput)
                throw new TypeError();

            if (command.length > 0) {
                var value;
                if (param.type.isString) {
                    value = command.map(function(word) { return word.word; }).join(' ');
                    command = [];
                } else {
                    value = command.shift().word;
                }
                this.resolved_parameters.push(value);
            } else {
                this.currentParam = param;

                var question = param.question + " do you want me to " + this.verb.word + "?";
                if (param.type.isString)
                    this.ask(Words.RAW_STRING, question);
                else if (param.type.isMeasure || param.type.isNumber)
                    this.ask(Words.NUMBER, question);
                else if (param.type.isBoolean)
                    this.ask(Words.YES_ANSWER, question);
                else if (param.type.isDate)
                    this.ask(Words.DATE, question);
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
        var action = ThingPedia.AbsoluteVerbToActionMap[this.verb.word];
        var kind = action[0];
        var channelName = action[1];
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
            this.switchTo(new DefaultDialog());
        }.bind(this)).done();
    },

    handleRaw: function(command) {
        if (this.currentParam !== null &&
            this.expecting === Words.RAW_STRING) {
            this.resolved_parameters.push(command);
            this._continue([]);
        } else {
            this.parent(command);
        }
    },

    handle: function(command) {
        if (this.verb === null) {
            if (this._handleVerb(command))
                return;
        }

        if (this.devices === null &&
            this.currentParam === null &&
            this.expecting === Words.NUMBER) {
            if (this._handleResolve(command))
                return;
            command = [];
        }

        this._continue(command);
    },

    _continue: function(command) {
        if (this._tryNextParameter(command))
            return;

        if (this.devices === null && this.resolving === null) {
            if (this._askDevice(command))
                return;
        }


        if (this.expecting === Words.YES_ANSWER) {
            if (command.length !== 1) {
                this.fail();
                return;
            }

            if (command[0].category === Words.YES_ANSWER)
                this.execute();
            else if (command[0].category === Words.NO_ANSWER)
                this.reset();
            else
                this.fail();
        } else {
            this.ask(Words.YES_ANSWER, "Ok, so you want me to " +
                     this.verb.word + " " +
                     this.resolved_parameters.join(" ") +
                     ". Is that right?");
        }
    }
});

const DeviceActionDialog = new lang.Class({
    Name: 'DeviceActionDialog',
    Extends: Dialog,

    _init: function() {
        this.parent();
        this.nouns = [];
        this.verbs = [];
        this.resolved_nouns = [];
        this.resolving = [];
        this.devices = {};
    },

    _checkVerbNoun: function(verb, noun) {
        var kind = ThingPedia.NounToKindMap[noun.word];
        var actionMap = ThingPedia.DeviceVerbToActionMap[kind];

        if (!(verb.word in actionMap)) {
            this.reply("I don't how to " + verb.word + " a " + noun.word);
            this.switchTo(new DefaultDialog());
            return false;
        } else {
            return true;
        }
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
                if (this.expecting !== command[i].category) {
                    this.unexpected();
                    return false;
                }
            } else {
                if (command[i].category === Words.YES_ANSWER ||
                    command[i].category === Words.NO_ANSWER ||
                    command[i].category === Words.SPECIAL) {
                    this.fail();
                    return false;
                }
            }

            if (command[i].category === Words.DEVICE_VERB) {
                if (!this._checkVerb(command[i])) {
                    return false;
                }
            }
        }

        for (var i = 0; i < command.length; i++) {
            if (command[i].category === Words.DEVICE_NOUN) {
                this.nouns.push(command[i]);
            } else if (command[i].category === Words.DEVICE_VERB) {
                this.verbs.push(command[i]);
            }
        }

        return true;
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
            this.switchTo(new DefaultDialog());
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
            this.switchTo(new DefaultDialog());
        }.bind(this)).done();
    },

    _handleResolve: function(command) {
        if (command[0].word === 'none') {
            this.reset();
            return true;
        }

        var noun = this.resolved_nouns[this.resolved_nouns.length-1].word;
        if (command[0].word === 'all') {
            this.reply("You chose all " + noun + "s");
            this.devices[noun] = this.resolving;
        } else {
            var value = command[0].value;
            if (value !== Math.floor(value) ||
                value < 1 ||
                value > this.resolving.length) {
                this.reply("Please choose a number between 1 and " + this.resolving.length);
                return true;
            } else {
                this.reply("You chose " + this.resolving[value-1].name);

                this.devices[noun] = [this.resolving[value-1]];
            }
        }

        this.resolving = [];
        this.expecting = null;
        return false;
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return;

        if (this.expecting !== Words.YES_ANSWER &&
            this.expecting !== Words.NUMBER) {
            if (!this._handleAny(command))
                return;

            if (this._tryResolveNoun())
                return;
        }

        if (this.expecting === Words.NUMBER) {
            if (this._handleResolve(command))
                return;
        }

        if (this.devices.length === 0 && this.verbs.length === 0) {
            this.fail();
            return;
        }

        if (this.devices.length === 0) {
            this.ask(Words.DEVICE_NOUN, "What do you want to " +
                     this.verbs.map(function(w) { return w.word; }).join(" and ") + "?");
            return;
        }

        if (this.verbs.length === 0) {
            this.ask(Words.DEVICE_VERB, "What do you want to do with the " +
                     this.resolved_nouns.map(function(w) { return w.word; }).join(" and ") + "?");
            return;
        }

        if (this.expecting === Words.YES_ANSWER) {
            if (command.length !== 1) {
                this.fail();
                return;
            }

            if (command[0].category === Words.YES_ANSWER)
                this.execute();
            else if (command[0].category === Words.NO_ANSWER)
                this.reset();
            else
                this.fail();
        } else {
            this.ask(Words.YES_ANSWER, "Ok, so you want me to " +
                     this.verbs.map(function(w) { return w.word; }).join(" and ") +
                     " the " +
                     this.resolved_nouns.map(function(w) { return w.word; }).join(" and ") +
                     ". Is that right?");
        }
    }
});

module.exports = new lang.Class({
    Name: 'AssistantManager',
    $rpcMethods: ['handleCommand', 'setReceiver'],

    _init: function(devices) {
        this.devices = devices;

        this._receiver = null;
        this._nlp = new NLP();
        this._raw = false;
        this.setDialog(new DefaultDialog());
    },

    setDialog: function(dlg) {
        this._dialog = dlg;
        dlg.manager = this;
    },

    setRaw: function(raw) {
        this._raw = raw;
    },

    start: function() {
        return Q();
    },

    stop: function() {
        return Q();
    },

    setReceiver: function(receiver) {
        this._receiver = receiver;
    },

    handleCommand: function(command) {
        console.log('Received Assistant command ' + command);

        try {
            if (this._raw)
                this._dialog.handleRaw(command);
            else
                this._dialog.handle(this._nlp.analyze(command));
        } catch(e) {
            console.log(e.stack);
            this._dialog.failReset();
        }
    },

    sendReply: function(message) {
        if (this._receiver)
            this._receiver.send(message);
    }
});
