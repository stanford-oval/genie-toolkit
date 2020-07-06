// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>,
//          Mehrad Moradshahi <mehrad@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const Stream = require('stream');
const assert = require('assert');

const i18n = require('../lib/i18n');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-tools/parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const StreamUtils = require('../lib/utils/stream-utils');

const ENTITY_MATCH_REGEX = /^([A-Z].*)_[0-9|۰-۹]+$/;
const NUMBER_MATCH_REGEX = /^([0-9|۰-۹]+)$/;
const SMALL_NUMBER_REGEX = /^-?(۱۰|۱۱|۱۲|10|11|12|[0-9|۰-۹])$/;


function do_replace_numbers(token, requote_numbers) {
    // 1) check if token is an Arabic or English number

    return requote_numbers && NUMBER_MATCH_REGEX.test(token);
}

function findSpanContaining(index, spansBySentencePos) {
    for (let i = 0; i < spansBySentencePos.length; i++) {
        const span = spansBySentencePos[i];
        if (index >= span.begin && index < span.end)
            return span;
    }
    return undefined;
}


function findSubstring(sequence, substring, spansBySentencePos, allowOverlapping, handle_heuristics=false, param_locale='en-US') {
    let paramLangPack = i18n.get(param_locale);
    let parsedWithArticle = false;
    for (let i = 0; i < sequence.length - substring.length + 1; i++) {
        let found = substringIsFound(sequence, substring, i);
        for (let j = 0; j < substring.length; j++) {
            if (sequence[i+j] !== substring[j]) {
                found = false;
                break;
            }
        }
        if (handle_heuristics) {
            if (!found) {
                found = true;
                let pluraziedSubstring = paramLangPack.pluralize(substring.join(' ')).split(' ');
                if (pluraziedSubstring.join(' ') === substring.join(' '))
                    pluraziedSubstring = (substring.join(' ') + 's').split(' ');
                for (let j = 0; j < pluraziedSubstring.length; j++) {
                    if (sequence[i + j] !== pluraziedSubstring[j]) {
                        found = false;
                        break;
                    }
                }
            }
            if (!found) {
                found = true;
                let article_added_substring = paramLangPack.addDefiniteArticle(substring. join(' ')).split(' ');
                for (let j = 0; j < article_added_substring.length; j++) {
                    if (sequence[i + j] !== article_added_substring[j]) {
                        found = false;
                        break;
                    }
                }
                if (found)
                    parsedWithArticle = true;
            }
        }
        if (found && (allowOverlapping || !findSpanContaining(i, spansBySentencePos)))
            return [i, parsedWithArticle];
    }
    return [-1, false];
}


function findSpanType(program, begin_index, end_index, requote_numbers, string_number) {
    let spanType;
    if (begin_index > 1 && program[begin_index-2] === 'location:') {
        spanType = 'LOCATION';

    } else if (do_replace_numbers(program[begin_index], requote_numbers)
        && !(program[end_index+1].startsWith('^^'))){
        // catch purely numeric postal_codes or phone_numbers
        if (string_number)
            spanType = 'QUOTED_STRING';
        else
            spanType = 'NUMBER';
    } else if (end_index === program.length - 1 || !program[end_index+1].startsWith('^^')) {
        spanType = 'QUOTED_STRING';
    } else {
        switch (program[end_index+1]) {
        case '^^tt:hashtag':
            spanType = 'HASHTAG';
            break;
        case '^^tt:username':
            spanType = 'USERNAME';
            break;
        case '^^tt:phone_number':
            spanType = 'PHONE_NUMBER';
            break;
        default:
            spanType = 'GENERIC_ENTITY_' + program[end_index+1].substring(2);
        }
    }
    return spanType;
}


function createProgram(program, spansByProgramPos, entityRemap, requote_numbers, ignoredProgramSpans) {
    let in_string = false;
    let newProgram = [];
    let programSpanIndex = 0;

    for (let i = 0; i < program.length; i++) {
        let token = program[i];
        if (token === '"') {
            in_string = !in_string;
            if (in_string)
                continue;
            const currentSpan = spansByProgramPos[programSpanIndex];
            if (!currentSpan.sentenceSpan || !currentSpan.sentenceSpan.mapTo)
                console.log(spansByProgramPos);
            assert(currentSpan.sentenceSpan.mapTo);

            newProgram.push(currentSpan.sentenceSpan.mapTo);
            programSpanIndex++;
            continue;
        }
        if (in_string)
            continue;
        if (token === 'location:' || token.startsWith('^^')) {
            continue;
        } else if (ENTITY_MATCH_REGEX.test(token)) {
            assert(entityRemap[token]);
            newProgram.push(entityRemap[token]);
        } else if (do_replace_numbers(token, requote_numbers)){
            const currentSpan = spansByProgramPos[programSpanIndex];
            if (!currentSpan || findSpanContaining(i, ignoredProgramSpans)) {
                newProgram.push(token);
                continue;
            }
            newProgram.push(currentSpan.sentenceSpan.mapTo);
            programSpanIndex++;
        } else {
            newProgram.push(token);
        }
    }
    return newProgram;
}

function qpisSentence(sentence, spansBySentencePos) {

    let current_span_idx = 0;
    let current_span = spansBySentencePos[0];

    let newSentence = [];
    let i = 0;
    let in_string = false;
    while (i < sentence.length) {
        let word = sentence[i];
        if (current_span === null || i < current_span.begin) {
            newSentence.push(word);
            i += 1;
        } else if (i >= current_span.end) {
            newSentence.push('"');
            in_string = false;
            current_span_idx += 1;
            current_span = current_span_idx < spansBySentencePos.length ? spansBySentencePos[current_span_idx] : null;
        } else if (i === current_span.begin || in_string) {
            if (i === current_span.begin)
                newSentence.push('"');
            newSentence.push(word);
            in_string = true;
            i += 1;

        } else {
            i += 1;
        }
    }
    if (in_string)
        newSentence.push('"');
    return newSentence;

}

function createSentence(sentence, contextEntities, spansBySentencePos) {

    let current_span_idx = 0;
    let current_span = spansBySentencePos[0];

    let newSentence = [];
    let entityNumbers = {};
    let entityRemap = {};
    for (let entity of contextEntities) {
        const [, type, num] = /^(.+)_([0-9]+)$/.exec(entity);
        entityNumbers[type] = Math.max(num+1, entityNumbers[type] || 0);
        entityRemap[entity] = entity;
    }

    function getEntityNumber(entityType) {
        let nextId = (entityNumbers[entityType] || 0);
        entityNumbers[entityType] = nextId + 1;
        return String(nextId);
    }

    let i = 0;
    while (i < sentence.length) {
        let word = sentence[i];
        if (current_span === null || i < current_span.begin) {
            const entityMatch = ENTITY_MATCH_REGEX.exec(word);
            if (entityMatch !== null) {
                // input sentence contains entities
                const newEntity = entityMatch[1] + '_' + getEntityNumber(entityMatch[1]);
                entityRemap[word] = newEntity;
                newSentence.push(newEntity);
            } else {
                newSentence.push(word);
            }
            i += 1;
        } else if (i === current_span.begin) {
            const newEntity = current_span.type + '_' + getEntityNumber(current_span.type);
            current_span.mapTo = newEntity;
            newSentence.push(newEntity);
            i += 1;
        } else if (i >= current_span.end) {
            current_span_idx += 1;
            current_span = current_span_idx < spansBySentencePos.length ? spansBySentencePos[current_span_idx] : null;
        } else {
            i += 1;
        }
    }

    return [newSentence, entityRemap];

}


function getProgSpans(program, requote_numbers) {
    let in_string = false;
    let begin_index = null;
    let end_index = null;
    let span_type = null;
    let allProgSpans = [];
    for (let i = 0; i < program.length; i++) {
        let token = program[i];
        if (token === '"') {
            in_string = !in_string;
            if (in_string) {
                begin_index = i + 1;
            } else {
                end_index = i;
                span_type = findSpanType(program, begin_index, end_index, requote_numbers, true);
                let prog_span = {begin: begin_index, end: end_index, span_type:span_type};
                allProgSpans.push(prog_span);
            }
        } else if (!in_string && do_replace_numbers(token, requote_numbers)){
            begin_index = i;
            end_index = begin_index + 1;
            span_type = findSpanType(program, begin_index, end_index, requote_numbers, false);
            let prog_span = {begin: begin_index, end: end_index, span_type:span_type};
            allProgSpans.push(prog_span);
        }
    }

    // sort params based on length so that longer phrases get matched sooner
    allProgSpans.sort((a, b) => {
        const { begin:abegin, end:aend } = a;
        const { begin:bbegin, end:bend } = b;
        return (bend - bbegin) - (aend - abegin);
    });
    return allProgSpans;
}


function findSpanPositions(id, sentence, program, requote_numbers, handle_heuristics, param_locale) {
    const spansBySentencePos = [];
    const spansByProgramPos = [];

    let ignoredProgramSpans = [];

    // allProgSpans is sorted by length (longest first)
    const allProgSpans = getProgSpans(program, requote_numbers);

    for (const progSpan of allProgSpans) {
        let [begin_index, end_index, span_type] = [progSpan.begin, progSpan.end, progSpan.span_type];
        const substring = program.slice(begin_index, end_index);

        // first try without overlapping parameters, then try with overlapping parameters
        // (this is mostly useful for parameters that used twice, which happens in some dialogue dataset)
        let [idx, parsedWithArticle] = findSubstring(sentence, substring, spansBySentencePos, false /* allow overlapping */, handle_heuristics, param_locale);
        if (idx < 0) {
            // skip requoting "small" numbers that do not exist in the sentence
            if (SMALL_NUMBER_REGEX.test(substring)) {
                ignoredProgramSpans.push({begin: begin_index, end:end_index, type:span_type});
                continue;
            } else {
                let [idx, parsedWithArticle] = findSubstring(sentence, substring, spansBySentencePos, true /* allow overlapping */, handle_heuristics, param_locale);
                if (idx < 0) {
                    console.log(program.join(' '));
                    throw new Error(`Cannot find span ${substring.join(' ')} in sentence id ${id}`);
                } else {
                    // in rare cases, program span tokens might be present in multiple sentence spans
                    // so we check all of them one by one until a full span match is found
                    const overlappingSpans = findSpansContaining(idx, spansBySentencePos);
                    for (let i = 0; i < overlappingSpans.length; i++) {
                        if (!overlappingSpans[i] || idx !== overlappingSpans[i].begin || idx + end_index - begin_index + parsedWithArticle !== overlappingSpans[i].end) {
                            if (i === spansBySentencePos.length)
                                throw new Error(`Found span ${substring.join(' ')} that overlaps another span but is not identical in sentence id ${id}`);
                        } else {
                            // otherwise, the two spans are identical, so we don't create a new span
                            spansByProgramPos.push({
                                begin: begin_index,
                                end: end_index,
                                sentenceSpan: overlappingSpans[i]
                            });
                            break;
                        }
                    }
                    continue;
                }
            }
        }

        const sentenceSpanBegin = idx;
        const sentenceSpanEnd = idx + end_index - begin_index + parsedWithArticle;
        const spanType = span_type;

        const sentenceSpan = { begin: sentenceSpanBegin, end: sentenceSpanEnd, type: spanType, mapTo: undefined };
        spansBySentencePos.push(sentenceSpan);
        spansByProgramPos.push({
            begin: begin_index,
            end: end_index,
            sentenceSpan: sentenceSpan
        });
    }

    // sort by program position after matching is done
    spansByProgramPos.sort((a, b) => {
        return a.begin - b.begin;
    });
    return [spansBySentencePos, spansByProgramPos, ignoredProgramSpans];
}


function requoteSentence(id, context, sentence, program, mode, requote_numbers, handle_heuristics, param_locale) {
    sentence = sentence.split(' ');
    program = program.split(' ');

    let contextEntities = new Set;
    if (context) {
        for (let token of context.split(' ')) {
            if (/^[A-Z]/.test(token))
                contextEntities.add(token);
        }
    }

    let [spansBySentencePos, spansByProgramPos, ignoredProgramSpans] = findSpanPositions(id, sentence, program, requote_numbers, handle_heuristics, param_locale);

    if (spansBySentencePos.length === 0)
        return [sentence.join(' '), program.join(' ')];

    spansBySentencePos.sort((a, b) => {
        const {begin:abegin, end:aend} = a;
        const {begin:bbegin, end:bend} = b;
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

    let newSentence, newProgram, entityRemap;

    if (mode === 'replace'){
        [newSentence, entityRemap] = createSentence(sentence, contextEntities, spansBySentencePos);
        newProgram = createProgram(program, spansByProgramPos, entityRemap, requote_numbers, ignoredProgramSpans);
    } else if (mode === 'qpis') {
        newSentence = qpisSentence(sentence, spansBySentencePos);
        newProgram = program;
    }

    return [newSentence.join(' '), newProgram.join(' ')];
}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('requote', {
            addHelp: true,
            description: "Requote a dataset."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--mode', {
            type: String,
            help: 'Type of requoting (replace with placeholder, or just add quotation marks around params)',
            choices: ['replace', 'qpis'],
            defaultValue: 'replace'
        });
        parser.addArgument('--requote-numbers', {
            action: 'storeTrue',
            help: 'Requote numbers',
            defaultValue: false
        });
        parser.addArgument('--skip-errors', {
            action: 'storeTrue',
            help: 'Skip examples that we are unable to requote',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
        parser.addArgument('--handle-heuristics', {
            action: 'storeTrue',
            help: 'Handle cases where augmentation introduced non-matching parameters in sentence and program',
            defaultValue: false
        });
        parser.addArgument('--param-locale', {
            type: String,
            help: 'BGP 47 locale tag of the language for parameter values',
            defaultValue: 'en-US'
        });
    },

    async execute(args) {
        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true }))
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    try {
                        const [newSentence, newProgram] =
                            requoteSentence(ex.id, ex.context, ex.preprocessed, ex.target_code, args.mode,
                                args.requote_numbers, args.handle_heuristics, args.param_locale);
                        ex.preprocessed = newSentence;
                        ex.target_code = newProgram;
                        callback(null, ex);
                    } catch(e) {
                        console.error('**************');
                        console.error('Failed to requote');
                        console.error(ex.id);
                        console.error(ex.preprocessed);
                        console.error(ex.target_code);
                        console.error('**************');
                        if (args.skip_errors)
                            callback(null);
                        else
                            callback(e);

                    }
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);
    }
};
