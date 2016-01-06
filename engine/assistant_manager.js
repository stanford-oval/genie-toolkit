// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const lang = require('lang');
const events = require('events');

// Very bare-bones word-level NLP
const Words = {
    IGNORED: ['a', 'the'],
    SPECIAL: ['debug', 'help', 'sorry', 'cool'],
    YES_ANSWER: ['yes', 'sure', 'ok'],
    NO_ANSWER: ['no', 'never'],
    QUESTION: ['who', 'what', 'when', 'where', 'how', 'why'],
    PREPOSITION: ['on', 'in', 'at'],
    COMPARATOR: ['>', '<', ['is', 'about'], 'is', 'contains', 'same'],
    NUMBER: [],
    TIMESTAMP: [],
    DATE: [],
    DAY: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    MONTHS: ['january', 'february', 'march', 'april', 'may', 'june', 'july',
             'august', 'september', 'october', 'november', 'december'],
    YEAR: [],

    // FINISHME: these should be taken from ThingPedia
    NOUN: ['tv', 'movie', 'show', 'lightbulb', 'scale', 'weight'],
    VERB: [['turn', 'on'], ['turn', 'off'], 'play', 'measure'],

    UNKWOWN: [],
};
const WordCategories = [Words.IGNORED, Words.YES_ANSWER, Words.NO_ANSWER,
                        Words.QUESTION, Words.SPECIAL, Words.PREPOSITION, Words.COMPARATOR,
                        Words.NUMBER, Words.TIMESTAMP, Words.DATE,
                        Words.DAY, Words.MONTHS, Words.YEAR,
                        Words.NOUN, Words.VERB, Words.UNKWOWN];

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

    getCategory: function(words, idx) {
        for (var i = 0; i < WordCategories.length; i++) {
            var attempt = this.tryCategory(words, idx, WordCategories[i]);
            if (attempt > 0)
                return [attempt, WordCategories[i]];
        }

        return null;
    },

    analyze: function(utterance) {
        // normalize and stem the utterance
        utterance = utterance.toLowerCase();
        utterance = utterance.split(/[,\.\s]+/g);

        console.log('Normalized utterance into ' + utterance);

        var words = [];
        var increase = 0;
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
            if (category === Words.UNKWOWN)
                return null;
            words.push({ word: utterance.slice(i, i + increase).join(' '),
                         category: category });
        }
        if (words.length === 0)
            return null;
        return words;
    }
});


const Dialog = new lang.Class({
    Name: 'Dialog',

    _init: function(mgr) {
        this.manager = mgr;
    },

    switchTo: function(dlg) {
        this.manager.setDialog(dlg);
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
                this.reply("NLP analysis");
                for (var i = 0 ; i < words.length; i++) {
                    this.reply(words[i].word + ": " + categoryName(words[i].category));
                }
                break;
            case 'help':
                this.reply("Sure! How can I help you?");
                this.reply("If you're unsure what to say, I understand most actions and objects. You can ask me a question and I'll try to answer it. You can tell me to do something at a later time if you give me the condition or the time.");
                break;
            case 'sorry':
                this.reply("No need to be sorry.");
                this.reply("Unless you're Canadian. Then I won't stop you.");
                break;
            case 'cool':
                this.reply("I know, right?");
                break;
            }
            return true;
        }

        return false;
    },

    handle: function(command) {
        if (this.handleGeneric(command))
            return;

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchTo(new DefaultDialog());
    },

    fail: function() {
        this.reply("Sorry, I did not understand that. Can you rephrase it?");
    },

    // faild and lose context
    failHard: function() {
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
        else if (command[0].category === Words.NOUN)
            ; // handle noun
        else if (command[0].category === Words.VERB)
            ; // handle verb
        else
            this.fail();
    }
});


module.exports = new lang.Class({
    Name: 'AssistantManager',
    $rpcMethods: ['handleCommand', 'setReceiver'],

    _init: function() {
        this._receiver = null;
        this._nlp = new NLP();
        this.setDialog(new DefaultDialog());
    },

    setDialog: function(dlg) {
        this._dialog = dlg;
        dlg.manager = this;
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
            this._dialog.handle(this._nlp.analyze(command));
        } catch(e) {
            console.log(e.stack);
            this._dialog.failHard();
        }
    },

    sendReply: function(message) {
        if (this._receiver)
            this._receiver.send(message);
    }
});
