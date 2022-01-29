
import * as argparse from 'argparse';
import * as fs from 'fs';
import * as Tp from 'thingpedia';
import * as I18n from '../lib/i18n';
import seedrandom from 'seedrandom';
import { Ast } from 'thingtalk';
import { Type, SchemaRetriever } from 'thingtalk';
import { choose } from '../lib/utils/random';
import { sampleString } from '../lib/utils/misc-utils';
import { ParaphraseExample } from './autoqa/lib/canonical-example-constructor';
import { generateExamples } from './autoqa/lib/canonical-example-constructor';
import { parseConstantFile } from './lib/constant-file';
import { getElementType } from './autoqa/wikidata/utils';
import { clean } from '../lib/utils/misc-utils';
import { makeLookupKeys } from '../lib/dataset-tools/mturk/sample-utils';
import { PARTS_OF_SPEECH, Canonicals, CanonicalAnnotation } from './autoqa/lib/base-canonical-generator';
import genBaseCanonical from './autoqa/lib/base-canonical-generator';
import * as utils from '../lib/utils/misc-utils';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('synthetic-data-sampler', {
        add_help: true,
        description: "Automatically generate samples from the canonicals"
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('-l', '--locale', {
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('--constants', {
        required: false,
        help: 'TSV file containing constant values to use.'
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--parameter-datasets', {
        required: true,
        help: 'TSV file containing the paths to datasets for strings and entity types.'
    });
    parser.add_argument('--sample-size', {
        default: 10,
        help: 'Number of samples per entity or string value'
    });
    parser.add_argument('--devices', {
        required: false,
        help: `The list of devices to sample, separated by comma`
    });
    parser.add_argument('--paraphraser-model', {
        required: false,
        help: `A path to the directory where the bart paraphraser model is saved`
    });
}

export function getEntityType(type : Type) : string|null {
    if (type instanceof Type.Entity)
        return type.type;
    if (type instanceof Type.Array)
        return getEntityType(type.elem as Type);
    return null;
}

export function isString(type : Type) : boolean {
    if (type.isString)
        return true;
    if (type instanceof Type.Array)
        return isString(type.elem as Type);
    return false;
}

export interface Entity {
    value : string;
    display : string;
}

interface Constant {
    value ?: any,
    display : string
}

function sampleEntities(sample_size : number, data : EntityRecord[]) : Entity[] {
    const rng = seedrandom.alea("777");
    const sampled = choose(data.filter((entity) => entity.name.length < 25), sample_size, rng);
    return sampled.filter((entity) => /^[a-zA-Z0-9 .]*$/.test(entity.name)).map((entity) => {
        return {
            value: entity.value,
            display: entity.name
        };
    });
}

function doSampleStrings(sample_size : number, data : ParameterRecord[], locale : string) : string[] {
    const rng = seedrandom.alea("777");
    const langPack = I18n.get(locale);
    const sampleOne = function(string : ParameterRecord) : string|null {
        let attempts = 1000;
        while (attempts > 0) {
            const sampled = sampleString(string.value.split(' '), langPack, rng);
            if (sampled)
                return sampled;
            attempts -= 1;
        }
        return null;
    };
    const sampled = choose(data.map(sampleOne).filter(Boolean) as string[], sample_size, rng);
    return sampled.filter((string) => /^[a-zA-Z0-9 .]*$/.test(string));
}

function typeToString(type : Type) : string {
    const elemType = getElementType(type);
    if (elemType instanceof Type.Entity)
        return elemType.type;
    return type.toString();
}

function countArgTypes(schema : Ast.FunctionDef) : Record<string, number> {
    const count : Record<string, number> = {};
    for (const arg of schema.iterateArguments()) {
        const typestr = typeToString(arg.type);
        if (!typestr)
            continue;
        count[typestr] = (count[typestr] || 0) + 1;
    }
    return count;
}

export interface EntityRecord {
    type : string;
    value : string;
    canonical : string;
    name : string;
}

export interface ParameterRecord {
    preprocessed : string;
    value : string;
    weight : number;
}

export interface ParameterProvider {
    get(type : 'entity'|'string', key : string) : Promise<ParameterRecord[]>;
    getEntity(key : string) : Promise<EntityRecord[]>;
}

async function retrieveEntitySamples(constProvider : ParameterProvider, name : string) {
    const data = await constProvider.getEntity(name);
    if (data.length === 0)
        return [];
    const sampled = sampleEntities(1, data);
    return sampled;
}

async function retrieveStringSamples(constProvider : ParameterProvider, name : string, locale : string) {
    const data = await constProvider.get('string', name);
    if (data.length === 0)
        return [];
    const sampled = doSampleStrings(1, data, locale);
    return sampled;
}

async function sampleConstants(functions : Record<string, Ast.FunctionDef>, 
                               constProvider : Tp.FileParameterProvider,
                               device : any,
                               locale : any) {
    const constants : Record<string, Constant[]> = {};
    for (const f in functions) {
        const functionDef = functions[f];
        for (const argument of functionDef.iterateArguments()) {
            const arg = argument.name;
            const string_values = argument.getImplementationAnnotation<string>('string_values');
            const entityType = getEntityType(argument.type);
            // const queryCanonical = Array.isArray(argument.nl_annotations.canonical) ? argument.nl_annotations.canonical[0] : argument.nl_annotations.canonical;
            // console.log(`arg: ${arg}`);
            // console.log(`string_values: ${string_values}`);
            // console.log(`entityType: ${entityType}`);
            // console.log("canonical:");
            // console.log(queryCanonical);
            if (string_values) {
                let samples : string[] = await retrieveStringSamples(constProvider, `org.schema:${f}_${arg}`, locale);
                if (samples.length === 0)
                    samples = await retrieveStringSamples(constProvider, string_values, locale);
                if (entityType) {
                    if (['tt:hashtag', 'tt:username'].includes(entityType)) {
                        samples.forEach((sample) => {
                            const key = `param:@${device}.${f}:${arg}:Entity(${entityType})`;
                            const obj = { key: sample, value: `null`, display: sample };
                            if (!constants[key])
                                constants[key] = [];
                            constants[key].push(obj);
                        });
                    } else {
                        samples.forEach((sample) => {
                            const key = `param:@${device}.${f}:${arg}:Entity(${entityType})`;
                            const obj = { key: sample, value: `null`, display: sample };
                            if (!constants[key])
                                constants[key] = [];
                            constants[key].push(obj);
                        });
                    }
                    if (arg === 'id') {
                        samples.forEach((sample) => {
                            const key = `param:@${device}.${f}:${arg}:String`;
                            const obj = { key: sample, value: sample, display: sample };
                            if (!constants[key])
                                constants[key] = [];
                            constants[key].push(obj);
                        });
                    }
                } else if (isString(argument.type)) {
                    samples.forEach((sample) => {
                        const key = `param:@${device}.${f}:${arg}:String`;
                        const obj = { key: sample, value: sample, display: sample };
                        if (!constants[key])
                            constants[key] = [];
                        constants[key].push(obj);
                    });
                }
            } else if (entityType) {
                const samples = await retrieveEntitySamples(constProvider, entityType);
                samples.forEach((sample) => {
                    const key = `param:@${device}.${f}:${arg}:Entity(${entityType})`;
                    const obj = { key: sample.value, value: sample.value, display: sample.display };
                    if (!constants[key])
                        constants[key] = [];
                    constants[key].push(obj);
                });
                if (arg === 'id') {
                    samples.forEach((sample) => {
                        const key = `param:@${device}.${f}:${arg}:String`;
                        const obj = { key: sample.display, value: sample.display, display: sample.display };
                        if (!constants[key])
                            constants[key] = [];
                        constants[key].push(obj);
                    });
                }
            }
            // console.log("constants:");
            // console.log(constants);
        }
    }
    return constants;
}

export function retrieveSamples(classDef : Ast.ClassDef, constants : Record<string, Constant[]>, qname : string, arg : Ast.ArgumentDef) : string[] {
    //TODO: also use enum canonicals?
    if (arg.type instanceof Type.Enum) 
        return arg.type.entries!.slice(0, 10).map(clean);
    const keys = makeLookupKeys('@' + classDef.kind + '.' + qname, arg.name, arg.type);
    let sampleConstants : Constant[] = [];
    for (const key of keys) {
        if (constants[key]) {
            sampleConstants = constants[key];
            break;
        }
    }
    return sampleConstants.map((v) => {
        if (arg.type.isString || (arg.type instanceof Type.Array && (arg.type.elem as Type).isString))
            return v.value;
        return v.display;
    });
}

function generateBaseCanonicalAnnotation(func : Ast.FunctionDef, 
                                         arg : Ast.ArgumentDef, 
                                         typeCounts : Record<string, number>,
                                         queries : string[],
                                         remove_existing_canonicals : boolean) : CanonicalAnnotation {
    const canonicalAnnotation : CanonicalAnnotation = {};
    if (remove_existing_canonicals) {
        genBaseCanonical(canonicalAnnotation, arg.name, arg.type);
    } else {
        const existingCanonical : Record<string, any> = arg.getNaturalLanguageAnnotation('canonical') || {};
        if (typeof existingCanonical === 'string') 
            canonicalAnnotation.base = [existingCanonical];
        else if (Array.isArray(existingCanonical))
            canonicalAnnotation.base = existingCanonical;
        else if (typeof existingCanonical === 'object') 
            Object.assign(canonicalAnnotation, existingCanonical);
    } 

    // remove function name in arg name, normally it's repetitive
    for (const [key, value] of Object.entries(canonicalAnnotation)) {
        if (PARTS_OF_SPEECH.includes(key)) {
            canonicalAnnotation[key as keyof Canonicals] = value.map((c : string) => {
                if (c.startsWith(func.name.toLowerCase() + ' '))
                    return c.slice(func.name.toLowerCase().length + 1);
                return c;
            });
        }
    }

    // copy base canonical if property canonical is missing
    if (canonicalAnnotation.base && !canonicalAnnotation.property)
        canonicalAnnotation.property = [...canonicalAnnotation.base];

    const typestr = typeToString(func.getArgType(arg.name)!);
    if (typestr && typeCounts[typestr] === 1) {
        // if an entity is unique, allow dropping the property name entirely
        // FIXME: consider type hierarchy, or probably drop it entirely
        if (canonicalAnnotation.property && !queries.includes(typestr.substring(typestr.indexOf(':') + 1))) {
            if (!canonicalAnnotation.property.includes('#'))
                canonicalAnnotation.property.push('#');
        }

        // if property is missing, use the type information
        if (!('property' in canonicalAnnotation)) {
            const base = utils.clean(typestr.substring(typestr.indexOf(':') + 1));
            canonicalAnnotation['property'] = [base];
            canonicalAnnotation['base'] = [base];
        }

        // if it's the only people entity, adding adjective form
        // E.g., author for review - bob's review
        //       byArtist for MusicRecording - bob's song
        if (typestr.endsWith(':Person'))
            canonicalAnnotation.adjective = ["# 's", '#'];

        // if it's the only date, adding argmin/argmax/base_projection
        if (typestr === 'Date') {
            canonicalAnnotation.adjective_argmax = ["most recent", "latest", "last", "newest"];
            canonicalAnnotation.adjective_argmin = ["earliest", "first", "oldest"];
            canonicalAnnotation.base_projection = ['date'];
        }
    }
    return canonicalAnnotation;
}

function toTSV(device : string, data : ParaphraseExample[], useHeading : boolean) {
    let headings : string = '';
    if (useHeading)
        headings = ["id", "utterance", "thingtalk", "query", "queryCanonical", "argument", "value"].join('\t') + '\n';
    const rows = data.reduce((acc : string[], colValue, idx) => {
        const id = `${device}-${idx.toLocaleString('en-US', {minimumIntegerDigits: 3, useGrouping:false})}`;
        const thingtalk = "";
        const tmp = [
            id,
            colValue["utterance"],
            thingtalk,
            colValue["query"],
            colValue["queryCanonical"],
            colValue["argument"],
            colValue["value"]
        ]
        return acc.concat([tmp.join('\t')]);
    }, []).join('\n');
    return `${headings}${rows}`;
}

export async function execute(args : any) {
    process.stdout.write("Generating samples... ");
    const tpClient = new Tp.FileClient(args);
    const schemaRetriever = new SchemaRetriever(tpClient, null, !args.debug);
    const device = args.devices.split(',')[0];
    const locale = args.locale;
    const deviceClass = await schemaRetriever.getFullSchema(device);
    const functions = Object.assign({}, deviceClass.queries, deviceClass.actions);
    let sampledConstants : Record<string, Constant[]> = {}; 
    if (args.constants) {
        sampledConstants = await parseConstantFile(args.locale, args.constants);
    } else {
        const constProvider = new Tp.FileParameterProvider(args.parameter_datasets, args.locale);
        await constProvider.load();
        sampledConstants = await sampleConstants(functions, constProvider, device, locale);
    }
    const examples : ParaphraseExample[] = [];
    const queries = Object.keys(deviceClass.queries).concat(Object.keys(deviceClass.actions));
    for (const fname of queries) {
        const func = deviceClass.queries[fname] || deviceClass.actions[fname];
        const typeCounts = countArgTypes(func);
        for (const arg of func.iterateArguments()) {
            const sampleValues = retrieveSamples(deviceClass, sampledConstants, fname, arg);
            // console.log(sampleValues);
            const canonicalAnnotation = generateBaseCanonicalAnnotation(func, arg, typeCounts, queries, false);
            examples.push(...generateExamples(func, arg, canonicalAnnotation, sampleValues));
        }
    }
    const output = toTSV(device.split('.').pop(), examples, false);
    console.log(output);
    args.output.write(output);
    process.stdout.write("Done!\n");
}