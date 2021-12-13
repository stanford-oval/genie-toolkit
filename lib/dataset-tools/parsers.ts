// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import assert from 'assert';
import Stream from 'stream';

import * as FlagUtils from './flags';

export type SentenceFlags = FlagUtils.SentenceFlags;
export interface SentenceExample {
    id : string;
    flags : FlagUtils.SentenceFlags;

    raw ?: string;
    context ?: string;
    preprocessed : string;
    target_code : string|string[];

    // these two are separate properties with different purposes
    // "predictions" is used by "genie evaluate-file", and
    // "prediction" is used by "genie predict"
    predictions ?: string[][];
    prediction ?: string;

    // these two are used by almond-cloud, and we preserve in some cases
    type ?: string;
    utterance ?: string;
}

class DatasetStringifier extends Stream.Transform {
    constructor() {
        super({
            writableObjectMode: true,
        });
    }

    _transform(ex : SentenceExample, encoding : BufferEncoding, callback : (err ?: Error|null, buffer ?: string) => void) {
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

    _flush(callback : (err : Error|null) => void) {
        process.nextTick(callback);
    }
}

interface DatasetParserOptions {
    offset ?: number;
    contextual ?: boolean;
    preserveId ?: boolean;
    overrideFlags ?: string;
    parseMultiplePrograms ?: boolean;
}

class DatasetParser extends Stream.Transform {
    private _n : number;
    private _offset : number;
    private _contextual : boolean;
    private _preserveId : boolean;
    private _overrideFlags : string|undefined;
    private _parseMultiplePrograms : boolean;

    constructor(options : DatasetParserOptions = {}) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });
        this._n = 0;
        this._offset = options.offset||0;
        this._contextual = !!options.contextual;
        this._preserveId = !!options.preserveId;
        this._overrideFlags = options.overrideFlags;
        this._parseMultiplePrograms = !!options.parseMultiplePrograms;
    }

    _transform(line : string, encoding : BufferEncoding, callback : (err ?: Error|null, res ?: SentenceExample) => void) {
        this._n ++;
        if (this._n < this._offset) {
            callback();
            return;
        }
        const parts = line.trim().split('\t');
        let ex : SentenceExample;
        if (this._contextual) {
            if (this._parseMultiplePrograms) {
                ex = {
                    id: parts[0],
                    flags: {},
                    context: parts[1].normalize('NFKD'),
                    preprocessed: parts[2].normalize('NFKD'),
                    target_code: parts.slice(3).map((item) => item.normalize('NFKD'))
                };
            } else {
                if (parts.length < 4)
                    throw new Error(`malformed line ${line}`);
                ex = {
                    id: parts[0],
                    flags: {},
                    context: parts[1].normalize('NFKD'),
                    preprocessed: parts[2].normalize('NFKD'),
                    target_code: parts[3].normalize('NFKD')
                };
            }
        } else {
            if (this._parseMultiplePrograms) {
                ex = {
                    id: parts[0],
                    flags: {},
                    preprocessed: parts[1].normalize('NFKD'),
                    target_code: parts.slice(2).map((item) => item.normalize('NFKD'))
                };
            } else {
                const [id, preprocessed, target_code] = parts;
                ex = {
                    id: id,
                    flags: {},
                    preprocessed: preprocessed.normalize('NFKD'),
                    target_code: target_code.normalize('NFKD')
                };
            }
        }

        if (this._overrideFlags) {
            for (const flag of Array.from(this._overrideFlags))
                ex.flags[FlagUtils.flagsMap[flag]] = true;
        } else if (!this._preserveId) {
            FlagUtils.parseId(ex);
        }

        callback(null, ex);
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export interface DialogueTurn {
    context : string|null;
    agent : string|null;
    agent_target : string|null;
    agent_timestamp ?: Date;
    intermediate_context : string|null;
    user : string;
    user_target : string;
    user_timestamp ?: Date;
    vote ?: string;
    comment ?: string;
}

export interface DialogueExample {
    id : string;
    comment ?: string;
    turns : DialogueTurn[];
}

class DialogueSerializer extends Stream.Transform {
    private _annotations : boolean;

    constructor(options = { annotations: true }) {
        super({ writableObjectMode: true });

        this._annotations = options.annotations;
    }

    private _pushMany(values : string[]) {
        for (const v of values)
            this.push(v);
    }

    private _prefixLines(text : string|null, prefix : string) : string[] {
        if (!text)
            return [];
        return text.trim().split('\n').map((line) => prefix + line + '\n');
    }

    _transform(dlg : DialogueExample, encoding : BufferEncoding, callback : (err ?: Error|null) => void) {
        this.push('====\n');
        this.push('# ' + dlg.id + '\n');
        if (dlg.comment)
            this._pushMany(this._prefixLines(dlg.comment, '# '));

        for (let i = 0; i < dlg.turns.length; i++) {
            const turn = dlg.turns[i];
            if (i > 0) {
                if (this._annotations)
                    this._pushMany(this._prefixLines(turn.context, 'C: '));
                if (turn.agent_timestamp)
                    this.push('#! timestamp: ' + turn.agent_timestamp.toISOString() + '\n');
                this._pushMany(this._prefixLines(turn.agent, 'A: '));
                if (this._annotations)
                    this._pushMany(this._prefixLines(turn.agent_target, 'AT: '));
                if (this._annotations && turn.intermediate_context)
                    this._pushMany(this._prefixLines(turn.intermediate_context, 'C: '));
            }
            if (turn.vote)
                this.push('#! vote: ' + turn.vote + '\n');
            if (turn.comment) {
                const lines = turn.comment.trim().split('\n');
                this.push('#! comment: ' + lines[0] + '\n');
                this._pushMany(this._prefixLines(lines.slice(1).join('\n'), '#!          '));
            }
            if (turn.user_timestamp)
                this.push('#! timestamp: ' + turn.user_timestamp.toISOString() + '\n');
            this._pushMany(this._prefixLines(turn.user, 'U: '));
            if (this._annotations)
                this._pushMany(this._prefixLines(turn.user_target, 'UT: '));
        }

        callback();
    }

    _flush(callback : (err ?: Error|null) => void) {
        callback();
    }
}

const KEY_SEQUENCE_WITH_ANNOTATION : Array<keyof DialogueTurn> = ['context', 'agent', 'agent_target', 'user', 'user_target'];
const KEY_SEQUENCE_WITHOUT_ANNOTATION : Array<keyof DialogueTurn> = ['agent', 'user'];
const KEY_SEQUENCE_INVERTED : Array<keyof DialogueTurn> = ['user', 'agent'];

// FIXME this is a bad type and we should use DialogueExample instead
export type ParsedDialogue = DialogueTurn[] & { id : string };

class DialogueParser extends Stream.Transform {
    private _buffer : string[];
    private _i : number;
    private _id : string|undefined;
    private _keySequence : Array<keyof DialogueTurn>;
    private _ignoreErrors : boolean;

    constructor({
        withAnnotations = true,
        invertTurns = false,
        ignoreErrors = false
    } = {}) {
        super({ objectMode: true });

        this._buffer = [];
        this._i = 0;
        this._id = undefined;
        if (withAnnotations)
            this._keySequence = KEY_SEQUENCE_WITH_ANNOTATION;
        else if (invertTurns)
            this._keySequence = KEY_SEQUENCE_INVERTED;
        else
            this._keySequence = KEY_SEQUENCE_WITHOUT_ANNOTATION;
        this._ignoreErrors = ignoreErrors;
    }

    _transform(line : string, encoding : BufferEncoding, callback : (err ?: Error|null, data ?: DialogueTurn[]) => void) {
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

    _flush(callback : (err ?: Error|null, data ?: DialogueTurn[]) => void) {
        const lines = this._buffer;
        if (lines.length === 0) {
            // ignore `====` at the beginning or at the end
            // or consecutive appearances of `====`
            // this simplifies concatenating datasets

            // but reset the ID, otherwise the next dialogue will have the wrong
            // ID
            this._id = undefined;
            callback();
            return;
        }
        this._buffer = [];

        const dlg : ParsedDialogue = [] as unknown as ParsedDialogue;
        // with or without annotations, the object always includes the
        // annotation keys, as this simplifies typing
        let currentTurn : DialogueTurn = {
            context: '',
            agent: '',
            agent_target: '',
            intermediate_context: '',
            user: '',
            user_target: '',
            comment: ''
        };

        // first turn starts with the user
        let expect = this._keySequence.indexOf('user');
        function flushTurn() {
            dlg.push(currentTurn);
            currentTurn = {
                context: '',
                agent: '',
                agent_target: '',
                intermediate_context: '',
                user: '',
                user_target: '',
                comment: ''
            };
        }

        let currentKey : keyof DialogueTurn|null = null;
        let text = '';
        for (const line of lines) {
            let key : keyof DialogueTurn|'timestamp', newText;
            if (line.startsWith('A: ')) {
                key = 'agent';
                newText = line.substring(3).trim().normalize('NFKD');
            } else if (line.startsWith('U: ')) {
                key = 'user';
                newText = line.substring(3).trim().normalize('NFKD');
            } else if (line.startsWith('AT: ')) {
                key = 'agent_target';
                newText = line.substring(4).normalize('NFKD');
            } else if (line.startsWith('UT: ')) {
                key = 'user_target';
                newText = line.substring(4).normalize('NFKD');
            } else if (line.startsWith('C: ')) {
                key = 'context';
                newText = line.substring(3).normalize('NFKD');
            } else if (line.startsWith('#! vote: ')) {
                key = 'vote';
                newText = line.substring('#! vote: '.length).normalize('NFKD');
            } else if (line.startsWith('#! timestamp: ')) {
                key = 'timestamp';
                newText = line.substring('#! timestamp: '.length).normalize('NFKD');
            } else if (line.startsWith('#! comment: ')) {
                key = 'comment';
                newText = line.substring('#! comment: '.length).normalize('NFKD');
            } else if (line.startsWith('#! ')) {
                key = 'comment';
                newText = line.substring('#! '.length).normalize('NFKD');
            } else {
                if (this._ignoreErrors)
                    continue;
                throw new Error(`malformed line ${line}, expected to start with C:, U:, A:, AT: or UT:`);
            }

            if (key === 'vote') {
                currentTurn.vote = newText + '\n';
                continue;
            }
            if (key === 'comment') {
                currentTurn.comment += newText + '\n';
                continue;
            }
            if (key === 'timestamp') {
                if (currentKey === 'user')
                    currentTurn.user_timestamp = new Date(newText.trim());
                else
                    currentTurn.agent_timestamp = new Date(newText.trim());
                continue;
            }

            if (currentKey === 'intermediate_context' && key === 'context')
                key = 'intermediate_context';

            if (currentKey !== null && currentKey !== key) {
                assert(text);
                currentTurn[currentKey] = text.trim().normalize('NFKD');
                text = '';

                if (currentKey === this._keySequence[this._keySequence.length-1])
                    flushTurn();
            }

            if (currentKey !== key) {
                if (key === 'context' && this._keySequence[expect] === 'user')
                    key = 'intermediate_context';

                if (this._ignoreErrors) {
                    if (key === 'agent' && this._keySequence[expect] === 'context') {
                        currentTurn.context = currentTurn.user_target;
                        expect = (expect + 1) % this._keySequence.length;
                    }

                    if (key === 'user_target' && this._keySequence[expect] === 'user') {
                        currentTurn.user = '';
                        expect = (expect + 1) % this._keySequence.length;
                    }
                }

                if (key !== 'intermediate_context') {
                    if (key !== this._keySequence[expect]) {
                        if (this._ignoreErrors) // truncate the dialogue on errors, we'll drop the last turn
                            break;
                        throw new Error(`malformed dialogue ${this._i}, expected ${this._keySequence[expect]}, saw ${key}`);
                    }
                    expect = (expect + 1) % this._keySequence.length;
                }
                currentKey = key;
            }
            text += newText + '\n';
        }

        if (currentKey !== this._keySequence[this._keySequence.length-1]) {
            if (!this._ignoreErrors)
                throw new Error(`malformed dialogue ${this._i}, unterminated last turn`);

            // ignore the current turn entirely if it is unterminated and we're told to
            // ignore errors
        } else {
            currentTurn[currentKey] = text.trim();
            flushTurn();
        }

        dlg.id = this._id || String(this._i);
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
