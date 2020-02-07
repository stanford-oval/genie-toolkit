// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const Stream = require('stream');

class DialogueSerializer extends Stream.Transform {
    constructor(options = { annotations: true }) {
        super({ writableObjectMode: true });

        this._buffer = [];
        this._annotations = options.annotations;
    }

    _pushMany(values) {
        for (const v of values)
            this.push(v);
    }

    _prefixLines(text, prefix) {
        return text.split('\n').map((line) => prefix + line + '\n');
    }

    _transform(dlg, encoding, callback) {
        this.push('====\n');
        this.push('# ' + dlg.id + '\n');
        if (dlg.comment)
            this._pushMany(this._prefixLines(dlg.comment, '# '));

        for (let i = 0; i < dlg.turns.length; i++) {
            const turn = dlg.turns[i];
            if (i > 0) {
                this.push('A: ' + turn.agent + '\n');
                if (this._annotations)
                    this._pushMany(this._prefixLines(turn.agent_target, 'AT: '));
            }
            this.push('U: ' + turn.user + '\n');
            if (this._annotations)
                this._pushMany(this._prefixLines(turn.user_target, 'UT: '));
        }

        callback();
    }

    _flush(callback) {
        callback();
    }
}

class DialogueParser extends Stream.Transform {
    constructor() {
        super({ objectMode: true });

        this._currentDialogue = [];
        this._currentTurn = {
            agent: '',
            agent_target: '',
            user: '',
            user_target: '',
        };
        this._currentKey = null;
        this._buffer = '';

        this._i = 0;
    }

    _transform(line, encoding, callback) {
        line = line.trim();

        // comment or empty line
        if (!line || line.startsWith('#')) {
            callback();
            return;
        }

        // end of current dialog
        if (line.startsWith('====')) {
            if (this._buffer)
                this._flushTurn();
            this._flush(callback);
            return;
        }

        let key, text;
        if (line.startsWith('A:')) {
            key = 'agent';
            text = line.substring(2).trim();
        } else if (line.startsWith('U:')) {
            key = 'user';
            text = line.substring(2).trim();
        } else if (line.startsWith('AT:')) {
            key = 'agent_target';
            text = line.substring(2).trim();
        } else if (line.startsWith('UT:')) {
            key = 'user_target';
            text = line.substring(3).trim();
        } else {
            throw new Error(`malformed line ${line}, expected to start with U:, A:, AT: or UT:`);
        }
        if (this._currentKey !== null && this._currentKey !== key) {
            this._currentTurn[this._currentKey] = this._buffer;
            this._buffer = '';
            if (this._currentKey === 'user_target')
                this._flushTurn();
        }

        this._currentKey = key;
        this._buffer += text;
        callback();
    }

    _flushTurn() {
        if (!this._currentTurn.user ||
            !this._currentTurn.user_target)
            throw new Error(`malformed dialogue ${this._i}, missing user utterance at turn ${this._currentDialogue.length}`);
        if (this._buffer.length > 0) {
            if (!this._currentTurn.agent ||
                !this._currentTurn.agent_target)
                throw new Error(`malformed dialogue ${this._i}, missing agent utterance at turn ${this._currentDialogue.length}`);
        }
        this._currentDialogue.push(this._currentTurn);
        this._currentTurn = {
            agent: '',
            agent_target: '',
            user: '',
            user_target: '',
        };
    }

    _flush(callback) {
        const dialogue = this._currentDialogue;
        if (dialogue.length === 0) {
            // ignore if the user had a ==== at the beginning or at the end of the file
            callback();
            return;
        }

        dialogue.id = this._i;
        this._i++;
        this._currentDialogue = [];
        this._currentKey = null;
        callback(null, dialogue);
    }
}

module.exports = {
    DialogueParser,
    DialogueSerializer,
};
