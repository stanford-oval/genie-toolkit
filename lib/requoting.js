// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

function findSubstring(sequence, substring) {
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

function* requoteSentence(id, sentence, program) {
    sentence = sentence.split(' ');
    program = program.split(' ');

    const spans = [];
    let in_string = false;
    let begin_index = null;
    let end_index = null;
    for (let i = 0; i < program.length; i++) {
        let token = program[i];
        if (token === '"') {
            in_string = !in_string;
            if (in_string) {
                begin_index = i+1;
            } else {
                end_index = i;
                const substring = program.slice(begin_index, end_index);
                const idx = findSubstring(sentence, substring);
                if (idx < 0)
                    throw new Error(`Cannot find span ${substring.join(' ')} in sentence id ${id}`);

                let spanType;
                if (i === program.length - 1 || !program[i+1].startsWith('^^')) {
                    spanType = 'QUOTED_STRING';
                } else {
                    switch (program[i+1]) {
                    case '^^tt:hashtag':
                        spanType = 'HASHTAG';
                        break;
                    case '^^tt:username':
                        spanType = 'USERNAME';
                        break;
                    default:
                        spanType = 'GENERIC_ENTITY_' + program[i+1].substring(2);
                    }
                    i++;
                }
                spans.push([idx, idx+end_index-begin_index, spanType]);
            }
        }
    }

    if (spans.length === 0) {
        for (let i = 0; i < sentence.length; i++) {
            let word = sentence[i];
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
    let current_span = spans[0];
    for (let i = 0; i < sentence.length; i++) {
        let word = sentence[i];
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

function* requoteProgram(program) {
    if (typeof program === 'string')
        program = program.split(' ');

    let inString = false;
    for (let i = 0; i < program.length; i++) {
        const token = program[i];

        if (token === '"') {
            inString = !inString;
            if (!inString) {
                let spanType;
                if (i === program.length - 1 || !program[i+1].startsWith('^^')) {
                    spanType = 'QUOTED_STRING';
                } else {
                    switch (program[i+1]) {
                    case '^^tt:hashtag':
                        spanType = 'HASHTAG';
                        break;
                    case '^^tt:username':
                        spanType = 'USERNAME';
                        break;
                    default:
                        spanType = 'GENERIC_ENTITY_' + program[i+1].substring(2);
                    }
                    i++;
                }
                yield spanType;
            }
        } else if (!inString) {
            const entityMatch = ENTITY_MATCH_REGEX.exec(token);
            if (entityMatch !== null)
                yield entityMatch[1];
            else
                yield token;
        }
    }
}

function* getFunctions(program) {
    if (typeof program === 'string')
        program = program.split(' ');
    let inString = false;
    for (let token of program) {
        if (token === '"')
            inString = !inString;
        else if (!inString && token.startsWith('@'))
            yield token;
    }
}

function* getDevices(program) {
    for (let fn of getFunctions(program)) {
        let dot = fn.lastIndexOf('.');
        yield fn.substring(0, dot);
    }
}

module.exports = {
    requoteSentence,
    requoteProgram,
    getFunctions,
    getDevices
};
