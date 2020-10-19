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
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accent
        .replace(/[\W]+/g, '_');
}

class ParamDatasetGenerator {
    constructor(options) {
        this._locale = options.locale;
        this._domains = options.domains;
        this._canonicals = options.canonicals;
        this._input_dir = options.input_dir;
        this._output_dir = options.output_dir;
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

    async _processData(domain, table, manifest, outputDir, isEntity, canonical) {
        const inputDir = path.join(this._input_dir, domain, table);
        const inputsPath = await this. _readSync(fs.readdir, inputDir);
        
        for (const inputPath of inputsPath) {
            const property = inputPath.split('.')[0];
            const fileId = argnameFromLabel(await getPropertyLabel(property));
            
            // To-Do
            const globalRegex = RegExp('[\W]+', 'g');
            if (fileId.includes('/') || fileId.includes('æ') || globalRegex.test(fileId)) {
                console.log(fileId);
                continue;
            }
            
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
                    if (!('label' in item) || item.label.includes('æ'))
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
                } else {
                    const value = item.value;
                    // skip if value is number or include æ 
                    if (!isNaN(value)) {
                        //this._properties[domain].add(property);
                        continue;
                    } 
                    
                    if (value.includes('æ'))
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
                }
            }

            // Dump propety data
            if (data.length !== 0) {
                this._properties[domain].add(property);
                if (isEntity) {
                    manifest.write(`entity\t${this._locale}\torg.wikidata:${fileId}\t${path.relative(path.join(this._output_dir, canonical), outputPath)}\n`);
                    await util.promisify(fs.writeFile)(outputPath, JSON.stringify({ result: 'ok', data }, undefined, 2), { encoding: 'utf8' });
                } else {
                    manifest.write(`string\t${this._locale}\torg.wikidata:${fileId}\t${path.relative(path.join(this._output_dir, canonical), outputPath)}\n`);
                    await util.promisify(fs.writeFile)(outputPath, data.join(os.EOL), { encoding: 'utf8' });
                }
            }
        }
    }

    async run() {
        const appendManifest = false;
        for (const idx in this._domains) {
            const outputDir = path.join(this._output_dir, this._canonicals[idx], 'parameter-datasets');
            await util.promisify(fs.mkdir)(outputDir, { recursive: true });
            const manifest = fs.createWriteStream(
                path.join(this._output_dir, this._canonicals[idx], 'parameter-datasets.tsv'),
                { flags: appendManifest ? 'a' : 'w' });
            await Promise.all([
                this._processData(this._domains[idx], 'labeled_entity', manifest, outputDir, true, this._canonicals[idx]),
                this._processData(this._domains[idx], 'value', manifest, outputDir, false, this._canonicals[idx]),
                this._processData(this._domains[idx], 'external', manifest, outputDir, false, this._canonicals[idx])
            ]);
            manifest.end();
            await StreamUtils.waitFinish(manifest);
            await util.promisify(fs.writeFile)(path.join(this._output_dir, this._canonicals[idx], 'properties.txt'), 
                Array.from(this._properties[this._domains[idx]]).join(','), { encoding: 'utf8' });
        }
    }
}

async function main() {
    const paramDatasetGenerator = new ParamDatasetGenerator({
        locale: 'en-US',
        domains: ['Q515', 'Q6256'],
        canonicals: ['city', 'country'],
        input_dir: path.join('/mnt/data/shared/wikidata', 'value'),
        output_dir: path.join(os.homedir(), 'CS294S/genie-workdirs/wikidata294')
    });
    await paramDatasetGenerator.run();
}

if (require.main === module) {
    main()
}