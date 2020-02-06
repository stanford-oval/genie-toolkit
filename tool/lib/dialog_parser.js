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

    _transform(dlg, encoding, callback) {
        this.push('====\n');
        this.push('# ' + dlg.id + '\n');
        if (dlg.comment)
            this.push(...(dlg.comment.split('\n').map((line) => '# ' + line)));

        for (let i = 0; i < dlg.turns.length; i++) {
            const turn = dlg.turns[i];
            if (i > 0) {
                this.push('A: ' + turn.agent + '\n');
                if (this._annotations)
                    this.push('AT: ' + turn.agent_target + '\n');
            }
            this.push('U: ' + turn.user + '\n');
            if (this._annotations)
                this.push('UT: ' + turn.user_target + '\n');
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

        this._buffer = [];

        this._i = 0;
        this._expect = 0;
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
            this._flush(callback);
            return;
        }

        let interaction;
        if (line.startsWith('S:')) {
            // system utterance, ignore
            callback();
            return;
        } else if (line.startsWith('U:')) {
            line = line.substring(2).trim();
            interaction = 0;
        } else if (line.startsWith('A:')) {
            line = line.substring(2).trim();
            interaction = 1;
        } else {
            throw new Error(`malformed line ${line}, expected to start with U: or A:`);
        }

        if (interaction !== this._expect)
            throw new Error(`malformed dialog ${this._i}, two consecutive turns on the same side`);

        this._buffer.push(line);
        this._expect = (interaction + 1) % 2;
        callback();
    }

    _flush(callback) {
        assert(this._buffer.length % 2 === 0, `malformed dialog ${this._i}, expected an equal number of user/assistant interaction`);
        const buffer = this._buffer;
        if (buffer.length === 0) {
            // ignore if the user had a ==== at the beginning or at the end of the file
            callback();
            return;
        }

        buffer.id = this._i;
        this._i++;
        this._buffer = [];
        callback(null, buffer);
    }
}

module.exports = {
    DialogueParser,
    DialogueSerializer,
};
