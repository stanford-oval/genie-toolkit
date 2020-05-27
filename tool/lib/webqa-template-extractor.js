// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";
const fs = require('fs');
const util = require('util');
const POS = require("en-pos");
const child_process = require('child_process');

function posTag(tokens) {
    return new POS.Tag(tokens)
        .initial() // initial dictionary and pattern based tagging
        .smooth() // further context based smoothing
        .tags;
}

class AnnotationExtractor {
    constructor(klass, queries, model, options) {
        this.class = klass;
        this.model = model;
        this.queries = queries;
        this.options = options;

        this.newCanonicals = {};
    }

    async run(synonyms, queries) {
        for (let qname of this.queries) {
            let query_canonical = queries[qname]['canonical'];
            for (let arg in synonyms[qname]) {
                if (arg === 'id' || Object.keys(synonyms[qname][arg]).length === 0)
                    continue;

                let input = this.generateInput(synonyms[qname][arg]);
                let output = await this._paraphrase(input.join('\n'), arg);
                let values = queries[qname]['args'][arg]['values'];
                for (let i = 0; i < input.length; i++)
                    this.extractCanonical(arg, input[i], output[i], values, query_canonical);
            }

            for (let arg in synonyms[qname]) {
                if (!(arg in this.newCanonicals))
                    continue;

                let canonicals = this.class.queries[qname].getArgument(arg).metadata.canonical;
                for (let typeNewCanonical in this.newCanonicals[arg]) {
                    for (let newCanonical of this.newCanonicals[arg][typeNewCanonical]) {
                        if (!(newCanonical.startsWith('# ') || newCanonical.endsWith(' #') || newCanonical.includes(' # ')))
                            continue;

                        if (this.hasConflict(arg, newCanonical))
                            continue;

                        if (!canonicals[typeNewCanonical]) {
                            canonicals[typeNewCanonical] = [newCanonical];
                            continue;
                        }
                        if (canonicals[typeNewCanonical].includes(newCanonical))
                            continue;
                        if (newCanonical.endsWith(' #') && canonicals[typeNewCanonical].includes(newCanonical.slice(0, -2)))
                            continue;
                        canonicals[typeNewCanonical].push(newCanonical);
                    }
                }
            }
        }
    }

    hasConflict(currentArg, currentCanonical) {
        for (let arg in this.newCanonicals) {
            if (arg === currentArg)
                continue;
            for (let pos in this.newCanonicals[arg]) {
                for (let canonical of this.newCanonicals[arg][pos]) {
                    if (canonical.replace('#', '').trim() === currentCanonical.replace('#', '').trim())
                        return true;
                }
            }
        }
        return false;
    }

    async _paraphrase(input, arg) {
        // if debug file exists, use them directly
        if (fs.existsSync(`./gpt2-paraphraser-out-${arg}.json`))
            return JSON.parse(fs.readFileSync(`./gpt2-paraphraser-out-${arg}.json`, 'utf-8'));

        // genienlp run-paraphrase --input_column 0 --skip_heuristics --model_name_or_path xxx --temperature 1 1 1 --num_beams 4 --pipe_mode
        const args = [
            `run-paraphrase`,
            `--input_column`, `0`,
            `--skip_heuristics`,
            `--model_name_or_path`, this.model,
            `--temperature`, `1`, `1`, `1`,
            `--num_beams`, `4`,
            `--pipe_mode`
        ];
        const child = child_process.spawn(`genienlp`, args, { stdio: ['pipe', 'pipe', 'inherit'] });

        const output = util.promisify(fs.writeFile);
        if (this.options.debug)
            await output(`./gpt2-paraphraser-in-${arg}.tsv`, input);

        const stdout = await new Promise((resolve, reject) => {
            child.stdin.write(input);
            child.stdin.end();
            child.on('error', reject);
            child.stdout.on('error', reject);
            child.stdout.setEncoding('utf8');
            let buffer = '';
            child.stdout.on('data', (data) => {
                buffer += data;
            });
            child.stdout.on('end', () => resolve(buffer));
        });

        if (this.options.debug)
            await output(`./gpt2-paraphraser-out-${arg}.json`, JSON.stringify(JSON.parse(stdout), null, 2));

        return JSON.parse(stdout);
    }

    generateInput(candidates) {
        const input = [];
        for (let category in candidates) {
            let canonical = Object.keys(candidates[category])[0];
            for (let sentence of candidates[category][canonical])
                input.push(`${sentence}`);
        }
        return input;
    }

    extractCanonical(arg, origin, paraphrases, values, query_canonical) {
        if (!(arg in this.newCanonicals))
            this.newCanonicals[arg] = {};

        const canonical = this.newCanonicals[arg];
        let value = values.find((v) => origin.includes(v));
        if (!value) {
            // base canonical, do nothing
            return;
        }
        value = value.toLowerCase();

        for (let paraphrase of paraphrases) {
            paraphrase = paraphrase.toLowerCase();

            if (!paraphrase.includes(value))
                continue;

            if (paraphrase.endsWith('.') || paraphrase.endsWith('?') || paraphrase.endsWith('!'))
                paraphrase = paraphrase.slice(0, -1);

            let tags = posTag(paraphrase.split(' '));

            let prefixes = [];
            if (origin.startsWith('who ')) {
                prefixes.push('who ');
                prefixes.push('who\'s ');
            } else {
                let standard_prefix = origin.slice(0, origin.indexOf(query_canonical) + query_canonical.length + 1);
                prefixes.push(standard_prefix);
                let to_replace = origin.includes(`a ${query_canonical}`) ? `a ${query_canonical}` : query_canonical;
                prefixes.push(standard_prefix.replace(to_replace, `${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `some ${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `all ${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `any ${query_canonical}s`));
                prefixes.push(standard_prefix.replace(to_replace, `any ${query_canonical}`));
                prefixes.push(standard_prefix.replace(to_replace, `an ${query_canonical}`));
                prefixes.push(standard_prefix.replace(to_replace, `the ${query_canonical}`));
            }

            for (let prefix of new Set(prefixes)) {
                if (!paraphrase.startsWith(prefix))
                    continue;

                let clause = paraphrase.slice(prefix.length);
                let length = prefix.trim().split(' ').length;

                if (prefix === 'who\'s' || clause.startsWith('is ') || clause.startsWith('are ')) {
                    if (clause.startsWith('is ') || clause.startsWith('are ')) {
                        clause = clause.slice(clause.indexOf(' ') + 1);
                        length += 1;
                    }
                    if (clause.startsWith('a ') || clause.startsWith('an ') || clause.startsWith('the ') ||
                        ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[length + 1])) {
                        canonical['reverse_property'] = canonical['reverse_property'] || [];
                        canonical['reverse_property'].push(clause.replace(value, '#'));
                    } else if (['IN', 'VBN', 'VBG'].includes(tags[length + 1])) {
                        canonical['passive_verb'] = canonical['passive_verb'] || [];
                        canonical['passive_verb'].push(clause.replace(value, '#'));
                    }
                } if (clause.startsWith('with ') || clause.startsWith('has ') || clause.startsWith('have ')) {
                    canonical['property'] = canonical['property'] || [];
                    canonical['property'].push(clause.slice(clause.indexOf(' ') + 1).replace(value, '#'));
                } else if ((clause.startsWith('that ') || clause.startsWith('who ')) && ['VBP', 'VBZ', 'VBD'].includes(tags[length + 1])) {
                    canonical['verb'] = canonical['verb'] || [];
                    canonical['verb'].push(clause.slice(clause.indexOf(' ' + 1)).replace(value, '#'));
                } else if (['VBP', 'VBZ', 'VBD'].includes(tags[length])) {
                    canonical['verb'] = canonical['verb'] || [];
                    canonical['verb'].push(clause.replace(value, '#'));
                }
                break;
            }
        }
    }
}


module.exports = AnnotationExtractor;
