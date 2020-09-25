// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

import assert from 'assert';
import Stream from 'stream';

import * as FlagUtils from './flags';

class DatasetStringifier extends Stream.Transform {
    constructor() {
        super({
            writableObjectMode: true,
        });
    }

    _transform(ex, encoding, callback) {
        let buffer = FlagUtils.makeId(ex) + '\t';
        if (ex.context)
            buffer += ex.context + '\t';
        buffer += ex.preprocessed + '\t';
        if (Array.isArray(ex.target_code))
            buffer += ex.target_code.join('\t');
        else
            buffer += ex.target_code;
        if (ex.prediction)
            buffer += '\t' + ex.prediction;
        buffer += '\n';
        callback(null, buffer);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class DatasetParser extends Stream.Transform {
    constructor(options = {}) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._contextual = options.contextual;
        this._preserveId = options.preserveId;
        this._overrideFlags = options.overrideFlags;
        this._parseMultiplePrograms = options.parseMultiplePrograms;
    }

    _transform(line, encoding, callback) {
        const parts = line.trim().split('\t');

        let ex;
        if (this._contextual) {
            if (this._parseMultiplePrograms) {
                ex = {
                    id: parts[0],
                    context: parts[1],
                    preprocessed: parts[2],
                    target_code: parts.slice(3)
                };
            } else {
                if (parts.length < 4)
                    throw new Error(`malformed line ${line}`);
                ex = {
                    id: parts[0],
                    context: parts[1],
                    preprocessed: parts[2],
                    target_code: parts[3]
                };
            }
        } else {
            if (this._parseMultiplePrograms) {
                ex = {
                    id: parts[0],
                    preprocessed: parts[1],
                    target_code: parts.slice(2)
                };
            } else {
                const [id, preprocessed, target_code] = parts;
                ex = {
                    id, preprocessed, target_code
                };
            }
        }

        ex.flags = {};
        if (this._overrideFlags) {
            for (let flag of Array.from(this._overrideFlags))
                ex.flags[FlagUtils.flagsMap[flag]] = true;
        } else if (!this._preserveId) {
            FlagUtils.parseId(ex);
        }

        callback(null, ex);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

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
        return text.trim().split('\n').map((line) => prefix + line + '\n');
    }

    _transform(dlg, encoding, callback) {
        this.push('====\n');
        this.push('# ' + dlg.id + '\n');
        if (dlg.comment)
            this._pushMany(this._prefixLines(dlg.comment, '# '));

        for (let i = 0; i < dlg.turns.length; i++) {
            const turn = dlg.turns[i];
            if (i > 0) {
                if (this._annotations)
                    this._pushMany(this._prefixLines(turn.context, 'C: '));
                this.push('A: ' + turn.agent + '\n');
                if (this._annotations)
                    this._pushMany(this._prefixLines(turn.agent_target, 'AT: '));
                if (this._annotations && turn.intermediate_context)
                    this._pushMany(this._prefixLines(turn.intermediate_context, 'C: '));
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

const KEY_SEQUENCE_WITH_ANNOTATION = ['context', 'agent', 'agent_target', 'user', 'user_target'];
const KEY_SEQUENCE_WITHOUT_ANNOTATION = ['agent', 'user'];
const KEY_SEQUENCE_INVERTED = ['user', 'agent'];

class DialogueParser extends Stream.Transform {
    constructor({ withAnnotations = true, invertTurns = false } = {}) {
        super({ objectMode: true });

        this._buffer = [];
        this._i = 0;
        this._id = undefined;
        this._withAnnotations = withAnnotations;
        if (withAnnotations)
            this._keySequence = KEY_SEQUENCE_WITH_ANNOTATION;
        else if (invertTurns)
            this._keySequence = KEY_SEQUENCE_INVERTED;
        else
            this._keySequence = KEY_SEQUENCE_WITHOUT_ANNOTATION;
    }

    _transform(line, encoding, callback) {
        line = line.trim();

        // comment or empty line
        // the first # line is treated as the ID of the dialogue
        if (this._id === undefined && line.startsWith('#')) {
            this._id = line.substring(1).trim();

            // if the ID starts with some character that could be confused as flag (like "S" for synthetic)
            // add a "_" in front
            if (/^(R)?(P)?(C)?(S)?(E)?$/.test(this._id))
                this._id = '_' + this._id;
        }
        if (!line || line.startsWith('#')) {
            callback();
            return;
        }

        // end of current dialog
        if (line.startsWith('====')) {
            this._flush(callback);
            return;
        }

        // buffer the current line
        this._buffer.push(line);
        callback();
    }

    _flush(callback) {
        const lines = this._buffer;
        if (lines.length === 0) {
            // ignore `====` at the beginning or at the end
            // or consecutive appearances of `====`
            // this simplifies concatenating datasets
            callback();
            return;
        }
        this._buffer = [];

        const dlg = [];
        let currentTurn;

        const withAnnotations = this._withAnnotations;
        if (withAnnotations) {
            currentTurn = {
                context: '',
                agent: '',
                agent_target: '',
                user: '',
                user_target: '',
            };
        } else {
            currentTurn = {
                agent: '',
                user: '',
            };
        }

        // first turn starts with the user
        let expect = this._keySequence.indexOf('user');
        function flushTurn() {
            dlg.push(currentTurn);
            if (withAnnotations) {
                currentTurn = {
                    context: '',
                    agent: '',
                    agent_target: '',
                    user: '',
                    user_target: '',
                };
            } else {
                currentTurn = {
                    agent: '',
                    user: '',
                };
            }
        }

        let currentKey = null;
        let text = '';
        for (let line of lines) {
            let key, newText;
            if (line.startsWith('A: ')) {
                key = 'agent';
                newText = line.substring(3).trim();
            } else if (line.startsWith('U: ')) {
                key = 'user';
                newText = line.substring(3).trim();
            } else if (line.startsWith('AT: ')) {
                key = 'agent_target';
                newText = line.substring(4);
            } else if (line.startsWith('UT: ')) {
                key = 'user_target';
                newText = line.substring(4);
            } else if (line.startsWith('C: ')) {
                key = 'context';
                newText = line.substring(3);
            } else {
                throw new Error(`malformed line ${line}, expected to start with C:, U:, A:, AT: or UT:`);
            }

            if (currentKey === 'intermediate_context' && key === 'context')
                key = 'intermediate_context';
            if (currentKey !== null && currentKey !== key) {
                assert(text);
                currentTurn[currentKey] = text.trim();
                text = '';

                if (currentKey === this._keySequence[this._keySequence.length-1])
                    flushTurn();
            }

            if (currentKey !== key) {
                if (key === 'context' && this._keySequence[expect] === 'user')
                    key = 'intermediate_context';

                if (key !== 'intermediate_context') {
                    if (key !== this._keySequence[expect])
                        throw new Error(`malformed dialogue ${this._i}, expected ${this._keySequence[expect]}, saw ${key}`);
                    expect = (expect + 1) % this._keySequence.length;
                }
                currentKey = key;
            }
            text += newText + '\n';
        }

        if (currentKey !== this._keySequence[this._keySequence.length-1])
            throw new Error(`malformed dialogue ${this._i}, unterminated last turn`);

        currentTurn[currentKey] = text.trim();
        flushTurn();

        dlg.id = this._id || this._i;
        this._id = undefined;
        this._i++;
        callback(null, dlg);
    }
}

export {
    DatasetParser,
    DatasetStringifier,
    DialogueParser,
    DialogueSerializer,
};
