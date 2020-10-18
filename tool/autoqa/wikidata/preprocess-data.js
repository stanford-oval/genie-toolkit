"use strict";

const fs = require('fs');
const util = require('util');
const path = require('path');
const os = require('os');

const I18N = require('../../../lib/i18n');
const StreamUtils = require('../../../lib/utils/stream-utils');
const { snakecase } = require('../lib/utils');

const {
    getPropertyLabel
} = require('./utils');

function argnameFromLabel(label) {
    return snakecase(label)
        .replace(/'/g, '') // remove apostrophe
        .replace(/,/g, '') // remove comma
        .replace(/_\/_/g, '_or_') // replace slash by or
        .replace('/[(|)]/g', '') // replace parentheses
        .replace(/-/g, '_') // replace -
        .replace(/\s/g, '_') // replace whitespace
        .replace('/', '_') // replace backslash
        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove accent
}

class ParamDatasetGenerator {
    constructor(options) {
        this._locale = options.locale;
        this._domains = options.domains;
        this._input_dir = options.input_dir;
        this._base_dir = options.base_dir;
        this._output_dir = path.join(options.base_dir, options.output_dir);
        this._maxValueLength = options.maxValueLength;
        this._tokenizer = I18N.get(options.locale).getTokenizer();
        this._properties = {};
        for (const domain of this._domains) {
            this._properties[domain] = new Set();
        }
    }

    async _readSync(func, dir) {
        return util.promisify(func)(dir, { encoding: 'utf8' });
    }

    async _processData(domain, table, manifest, outputDir, isEntity) {
        const inputDir = path.join(this._input_dir, domain, table);
        const inputsPath = await this. _readSync(fs.readdir, inputDir);
        
        for (const inputPath of inputsPath) {
            const property = inputPath.split('.')[0];
            const fileId = argnameFromLabel(await getPropertyLabel(property));
            const outputPath = path.join(outputDir, `org.wikidata:${fileId}.${isEntity?'json':'tsv'}`);

            const inputs = (await this. _readSync(fs.readFile, path.join(inputDir, inputPath))).split(os.EOL);
            const data = [];
            for (const input of inputs) {
                // Last item in array is empty
                if (input === '') 
                    continue;
                const item = JSON.parse(input);

                if (isEntity) {
                    // Some entity does not have label. Skip.
                    if (!('label' in item))
                        continue;
                    
                    const entity = {
                        value: item.label,
                        name: item.value
                    };
                    const tokens = this._tokenizer.tokenize(item.label).tokens;

                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    entity.canonical = tokens.join(' ');
                    if (this._maxValueLength >= 0 && entity.canonical.length > this._maxValueLength)
                        continue;

                    data.push(entity);
                    this._properties[domain].add(property);
                } else {
                    const value = item.value;
                    // skip if value is number
                    if (!isNaN(value))
                        continue;

                    const tokens = this._tokenizer.tokenize(item.value).tokens;
                    const weight = 1; // ?
                    
                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    const tokenizedString = tokens.join(' ');
                    if (this._maxValueLength >= 0 && tokenizedString.length > this._maxValueLength)
                        continue;

                    data.push(`${value}\t${tokenizedString}\t${weight}`);
                    this._properties[domain].add(property);
                }
            }

            // Dump propety data
            if (data.length !== 0) {
                if (isEntity) {
                    manifest.write(`entity\t${this._locale}\torg.wikidata:${fileId}\t${path.relative(path.join(this._output_dir, domain), outputPath)}\n`);
                    await util.promisify(fs.writeFile)(outputPath, JSON.stringify({ result: 'ok', data }, undefined, 2), { encoding: 'utf8' });
                } else {
                    manifest.write(`string\t${this._locale}\torg.wikidata:${fileId}\t${path.relative(path.join(this._output_dir, domain), outputPath)}\n`);
                    await util.promisify(fs.writeFile)(outputPath, data.join(os.EOL), { encoding: 'utf8' });
                }
            }
        }
    }

    async run() {
        const appendManifest = false;
        for (const domain of this._domains) {
            const outputDir = path.join(this._output_dir, domain, 'parameter-datasets');
            await util.promisify(fs.mkdir)(outputDir, { recursive: true });
            const manifest = fs.createWriteStream(
                path.join(this._output_dir, domain, 'parameter-datasets.tsv'),
                { flags: appendManifest ? 'a' : 'w' });
            await Promise.all([
                this._processData(domain, 'labeled_entity', manifest, outputDir, true),
                this._processData(domain, 'value', manifest, outputDir, false),
                this._processData(domain, 'external', manifest, outputDir, false)
            ]);
            manifest.end();
            await StreamUtils.waitFinish(manifest);
            await util.promisify(fs.writeFile)(path.join(this._output_dir, domain, 'properties.txt'), 
                Array.from(this._properties[domain]).join(','), { encoding: 'utf8' });
        }
    }
}

async function main() {
    const paramDatasetGenerator = new ParamDatasetGenerator({
        locale: 'en-US',
        domains: ['Q515', 'Q6256'],
        input_dir: path.join('/mnt/data/shared/wikidata', 'value'),
        base_dir: path.join(os.homedir(), 'CS294S/genie-workdirs/wikidata294'),
        output_dir: 'data'
    });
    await paramDatasetGenerator.run();
}

if (require.main === module) {
    main()
}