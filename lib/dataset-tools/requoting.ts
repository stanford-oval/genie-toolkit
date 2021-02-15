// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


function findSubstring(sequence : string[], substring : string[]) : number {
    for (let i = 0; i < sequence.length - substring.length + 1; i++) {
        let found = true;
        for (let j = 0; j < substring.length; j++) {
            if (sequence[i+j] !== substring[j]) {
                found = false;
                break;
            }
        }
        if (found)
            return i;
    }
    return -1;
}

const ENTITY_MATCH_REGEX = /^([A-Z].*)_[0-9]+$/;

function getEntityType(entityMarker : string) : string {
    switch (entityMarker) {
    case '^^tt:hashtag':
        return 'HASHTAG';
    case '^^tt:username':
        return 'USERNAME';
    case '^^tt:phone_number':
        return 'PHONE_NUMBER';
    default:
        return 'GENERIC_ENTITY_' + entityMarker.substring(2);
    }
}

function findSpanType(program : string[], begin_index : number, end_index : number) : [string, number] {
    let spanType;
    if (program[begin_index-2] === 'location:') {
        spanType = 'LOCATION';
    } else if (program[begin_index-3] === 'Location') { // new Location ( " ..., in new syntax
        spanType = 'LOCATION';
        end_index++; // eat the parenthesis
    } else if ((program[end_index+1] || '').startsWith('^^')) {
        spanType = getEntityType(program[end_index+1]);
        end_index++; // eat the entity marker
    } else if ((program[begin_index-3] || '').startsWith('^^') && program[begin_index-4] === 'null') { // null ^^com.foo ( " ..., in new syntax
        spanType = getEntityType(program[begin_index-3]);
        end_index++; // eat the parenthesis
    } else {
        spanType = 'QUOTED_STRING';
    }
    return [spanType, end_index];
}

function* requoteSentence(id : string, sentencestr : string, programstr : string) : IterableIterator<string> {
    const sentence = sentencestr.split(' ');
    const program = programstr.split(' ');

    const spans : Array<[number, number, string]> = [];
    let in_string = false;
    let begin_index : number|null = null;
    let end_index : number|null = null;
    for (let i = 0; i < program.length; i++) {
        const token = program[i];
        if (token === '"') {
            in_string = !in_string;
            if (in_string) {
                begin_index = i+1;
            } else {
                end_index = i;
                const substring = program.slice(begin_index!, end_index);
                const idx = findSubstring(sentence, substring);
                if (idx < 0)
                    throw new Error(`Cannot find span ${substring.join(' ')} in sentence id ${id}`);

                const spanBegin = idx;
                const spanEnd = idx+end_index-begin_index!;

                let spanType;
                [spanType, end_index] = findSpanType(program, begin_index!, end_index);
                spans.push([spanBegin, spanEnd, spanType]);
                i = end_index;
            }
        }
    }

    if (spans.length === 0) {
        for (let i = 0; i < sentence.length; i++) {
            const word = sentence[i];
            // if the current word is a QUOTED_STRING, HASHTAG, ENTITY or GENERIC_ENTITY_, remove the last _<id> part
            const entityMatch = ENTITY_MATCH_REGEX.exec(word);
            if (entityMatch !== null)
                yield entityMatch[1];
            else
                yield word;
        }
        return;
    }

    spans.sort((a, b) => {
        const [abegin, aend] = a;
        const [bbegin, bend] = b;
        if (abegin < bbegin)
            return -1;
        if (bbegin < abegin)
            return +1;
        if (aend < bend)
            return -1;
        if (bend < aend)
            return +1;
        return 0;
    });
    let current_span_idx = 0;
    let current_span : [number,number,string]|null = spans[0];
    for (let i = 0; i < sentence.length; i++) {
        const word = sentence[i];
        if (current_span === null || i < current_span[0]) {
            // if the current word is a QUOTED_STRING, HASHTAG, ENTITY or GENERIC_ENTITY_, remove the last _<id> part
            //
            // this means that the sentences
            // " tweet foo bar "
            // and
            // " tweet QUOTED_STRING_0 "
            //
            // will both turn into " tweet QUOTED_STRING "
            // and therefore match
            //
            // (this is only relevant if some portion of the data is left quoted
            // after augmentation)
            //
            // for simplicity, we do it only all entities
            // it has no effect on other entities because ids are assigned in increasing
            // number in the sentence
            const entityMatch = ENTITY_MATCH_REGEX.exec(word);
            if (entityMatch !== null)
                yield entityMatch[1];
            else
                yield word;
        } else if (i === current_span[0]) {
            yield current_span[2];
        } else if (i >= current_span[1]) {
            yield word;
            current_span_idx += 1;
            current_span = current_span_idx < spans.length ? spans[current_span_idx] : null;
        }
    }
}

function* requoteProgram(program : string|string[]) : IterableIterator<string> {
    if (typeof program === 'string')
        program = program.split(' ');

    let inString = false;
    let begin_index = 0;
    for (let i = 0; i < program.length; i++) {
        const token = program[i];

        if (token === '"') {
            inString = !inString;
            if (inString) {
                begin_index = i+1;
            } else {
                const [spanType, end_index] = findSpanType(program, begin_index, i);
                yield spanType;
                i = end_index;
            }
        } else if (!inString) {
            const entityMatch = ENTITY_MATCH_REGEX.exec(token);
            if (entityMatch !== null) {
                yield entityMatch[1];
                continue;
            }

            if ((token === 'new' && program[i+1] === 'Location' &&
                 program[i+3] === '"') ||
                (token === 'Location' && program[i+2] === '"'))
                continue;
            if (token === '(' &&
                (program[i-1] === 'Location' && program[i+1] === '"') ||
                (program[i-2] === 'null' && (program[i-1] || '').startsWith('^^') && program[i+1] === '"'))
                continue;
            if (token === 'null' && (program[i+1] || '').startsWith('^^'))
                continue;
            if (token === 'location:' || token.startsWith('^^'))
                continue;

            yield token;
        }
    }
}

function* getFunctions(program : string|string[], ignored : string[] = []) : IterableIterator<string> {
    if (typeof program === 'string')
        program = program.split(' ');
    let inString = false;
    let isDialoguePolicy = false;

    for (let i = 0; i < program.length; i++) {
        const token = program[i];
        if (token === '"') {
            inString = !inString;
        } else if (!inString && token.startsWith('$dialogue')) {
            isDialoguePolicy = true;
        } else if (!inString && token.startsWith('@')) {
            if (isDialoguePolicy) {
                isDialoguePolicy = false;
                continue; // discard. It's the policy, not a function
            }
            if (program[i+1] === '.') {
                const functionName = program[i+2];
                const fn = token + '.' + functionName;
                if (ignored.includes(fn))
                    continue;
                yield fn;
            }
        }
    }
}

function* getDevices(program : string|string[], ignored : string[] = []) : IterableIterator<string> {
    if (typeof program === 'string')
        program = program.split(' ');
    let inString = false;
    let isDialoguePolicy = false;

    for (let i = 0; i < program.length; i++) {
        const token = program[i];
        if (token === '"') {
            inString = !inString;
        } else if (!inString && token.startsWith('$dialogue')) {
            isDialoguePolicy = true;
        } else if (!inString && token.startsWith('@')) {
            if (isDialoguePolicy) {
                isDialoguePolicy = false;
                continue; // discard. It's the policy, not a function
            }
            if (ignored.includes(token))
                continue;
            yield token;
        }
    }
}

export {
    requoteSentence,
    requoteProgram,
    getFunctions,
    getDevices
};
