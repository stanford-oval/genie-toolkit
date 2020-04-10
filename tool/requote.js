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

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const StreamUtils = require('../lib/stream-utils');

const ENTITY_MATCH_REGEX = /^([A-Z].*)_[0-9]+$/;
const NUMBER_MATCH_REGEX = /^([0-9|\u0660-\u0669]+)$/;

function do_replace_numbers(token, requote_numbers) {
    // check if token is:
    // 1) an Arabic or English number
    // 2) ignore digit 0 and 1 since it is sometimes used in program to represent
    // singularities (e.g. a, an, one, ...) but is not present in the snetence

    return requote_numbers && NUMBER_MATCH_REGEX.test(token) && !(token === '0') && !(token === '1');
}


function check_range(index, spansBySentencePos){
    for (let i = 0; i < spansBySentencePos.length; i++){
        const span = spansBySentencePos[i];
        if (index >= span.begin && index < span.end)
            return false;
    }
    return true;

}


function findSubstring(sequence, substring, spansBySentencePos) {
    for (let i = 0; i < sequence.length - substring.length + 1; i++) {
        let found = true;

        for (let j = 0; j < substring.length; j++) {
            if (sequence[i+j] !== substring[j]) {
                found = false;
                break;
            }
        }
        if (found && check_range(i, spansBySentencePos))
            return i;
    }
    return -1;
}


function findSpanType(program, begin_index, end_index, requote_numbers) {
    let spanType;
    if (begin_index > 1 && program[begin_index-2] === 'location:') {
        spanType = 'LOCATION';

    } else if (do_replace_numbers(program[begin_index], requote_numbers) && !(program[end_index+1].startsWith('^^'))){
        // catch purely numeric postal code
        if (program[begin_index - 3].endsWith('String'))
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
        end_index++;
    }
    return [spanType, end_index];
}


function createProgram(program, spansByProgramPos, entityRemap, requote_numbers) {
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
            try{
                assert(currentSpan.mapTo);
            }
            catch (e) {
                console.log('error!');
                console.log(program.join(' '));
            }

            newProgram.push(currentSpan.mapTo);
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
            newProgram.push(currentSpan.mapTo);
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

function createSentence(sentence, spansBySentencePos) {

    let current_span_idx = 0;
    let current_span = spansBySentencePos[0];

    let newSentence = [];
    let entityNumbers = {};
    function getEntityNumber(entityType) {
        let nextId = (entityNumbers[entityType] || 0);
        entityNumbers[entityType] = nextId + 1;
        return String(nextId);
    }
    let entityRemap = {};

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

function sortWithIndeces(toSort, sort_func) {
    let toSort_new = [];
    for (let i = 0; i < toSort.length; i++) 
        toSort_new[i] = [toSort[i], i];
    
    toSort_new.sort(sort_func);
    let sortIndices = [];
    for (let j = 0; j < toSort_new.length; j++) {
        sortIndices.push(toSort_new[j][1]);
        toSort[j] = toSort_new[j][0];
    }
    return sortIndices;
}

function getProgSpans(program, is_quoted, requote_numbers) {
    let in_string = false;
    let begin_index = null;
    let end_index = null;
    let all_prog_spans = [];
    if (is_quoted) {
        for (let i = 0; i < program.length; i++) {
            let token = program[i];
            if (ENTITY_MATCH_REGEX.test(token) || do_replace_numbers(token, requote_numbers)){
                begin_index = i;
                end_index = begin_index + 1;
                let prog_span = {begin: begin_index, end: end_index};
                all_prog_spans.push(prog_span);
            }
        }

    } else {
        for (let i = 0; i < program.length; i++) {
            let token = program[i];
             if (token === '"') {
                in_string = !in_string;
                if (in_string) {
                    begin_index = i + 1;
                } else {
                    end_index = i;
                    let prog_span = {begin: begin_index, end: end_index};
                    all_prog_spans.push(prog_span);
                }
            } else if (!in_string && do_replace_numbers(token, requote_numbers)){
                begin_index = i;
                end_index = begin_index + 1;
                let prog_span = {begin: begin_index, end: end_index};
                all_prog_spans.push(prog_span);
            }
        }
    }



    // sort params based on length so that longer phrases get matched sooner
    let sort_func = function (a, b)  {
        const {begin:abegin, end:aend} = a[0];
        const {begin:bbegin, end:bend} = b[0];
        return (bend - bbegin) - (aend - abegin);
    };

    // sort array in-place and return sorted indices
    let sortIndices = sortWithIndeces(all_prog_spans, sort_func);

    return [all_prog_spans, sortIndices];
}


function findSpanPositions(id, sentence, program, is_quoted, requote_numbers) {
    const spansBySentencePos = [];
    const spansByProgramPos = [];

    const [all_prog_spans_sorted, sortIndices]  = getProgSpans(program, is_quoted, requote_numbers);

    for (let i = 0; i < all_prog_spans_sorted.length; i++) {
        const prog_span = all_prog_spans_sorted[i];
        let [begin_index, end_index] = [prog_span.begin, prog_span.end];
        const substring = program.slice(begin_index, end_index);
        const idx = findSubstring(sentence, substring, spansBySentencePos);
        if (idx < 0){
            console.log(program.join(' '));
            console.error('***Error: Program contains some parameters that are not present in the sentence***');
            throw new Error(`Cannot find span ${substring.join(' ')} in sentence id ${id}`);

        }

        const spanBegin = idx;
        const spanEnd = idx + end_index - begin_index;

        let spanType = findSpanType(program, begin_index, end_index, requote_numbers)[0];

        const span = {begin: spanBegin, end: spanEnd, type: spanType, mapTo: undefined};
        spansBySentencePos.push(span);
        spansByProgramPos.push(span);

    }

    return [spansBySentencePos, spansByProgramPos, sortIndices];
}


function requoteSentence(args, id, sentence, program) {
    sentence = sentence.split(' ');
    program = program.split(' ');

    let mode = args.mode;
    let is_quoted = args.is_quoted;
    let requote_numbers = args.requote_numbers;

    let [spansBySentencePos, spansByProgramPosSorted, sortIndices] = findSpanPositions(id, sentence, program, is_quoted, requote_numbers);

    if (spansBySentencePos.length === 0)
        return [sentence.join(' '), program.join(' ')];

    // revert back the order after matching is done
    let spansByProgramPos = [];
    for (let i = 0; i < sortIndices.length; i++)
        spansByProgramPos[sortIndices[i]] = spansByProgramPosSorted[i];

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
        [newSentence, entityRemap] = createSentence(sentence, spansBySentencePos);
        newProgram = createProgram(program, spansByProgramPos, entityRemap, requote_numbers);
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
        parser.addArgument('--is_quoted', {
            action: 'storeTrue',
            help: 'The input dataset is already quoted. Pass this to qpis a quoted dataset',
            defaultValue: false
        });
        parser.addArgument('--requote-numbers', {
            action: 'storeTrue',
            help: 'Requote numbers',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in TSV format); use - for standard input'
        });
    },

    async execute(args) {
        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual }))
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    try {
                        const [newSentence, newProgram] = requoteSentence(args, ex.id, ex.preprocessed, ex.target_code);
                        ex.preprocessed = newSentence;
                        ex.target_code = newProgram;
                        callback(null, ex);
                    } catch(e) {
                        console.error(`Failed to requote`);
                        console.error(ex.preprocessed);
                        console.error(ex.target_code);
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
