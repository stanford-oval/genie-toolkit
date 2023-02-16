import fs from 'fs';
import * as Tp from 'thingpedia';
import { Entity, Linker } from './base';
import WikidataUtils from './wikidata';
import Cache from './cache';

interface AzureEntityLinkerOptions {
    ner_cache : string,
    raw_data ?: string
}

export class AzureEntityLinker extends Linker {
    private _wikidata : WikidataUtils;
    private _url : string;
    private _cache : Cache;
    private _rawData : Record<string, string>;

    constructor(wikidata : WikidataUtils, options : AzureEntityLinkerOptions) {
        super();
        this._wikidata = wikidata;
        this._url = 'https://entity-linker.cognitiveservices.azure.com//text/analytics/v3.0/entities/linking';
        this._cache = new Cache(options.ner_cache);
        this._rawData = {};
        if (options.raw_data) {
            for (const ex of JSON.parse(fs.readFileSync(options.raw_data, 'utf-8')).questions)
                this._rawData[ex.id] = ex.question[0].string;
        }
    }
    
    async run(id : string, utterance : string) {
        if (id in this._rawData)
            utterance = this._rawData[id];
        const cache = await this._cache.get(utterance);
        if (cache)
            return JSON.parse(cache);
        const entities : Entity[] = [];
        if (!process.env.AZURE_ENTITY_LINKER_KEY) 
            throw new Error('Missing environment variable AZURE_ENTITY_LINKER_KEY');
        const example = {
            id: '0',
            language: 'en',
            text: utterance
        };
        const raw = await Tp.Helpers.Http.post(this._url, `{ "documents":[${JSON.stringify(example)}] }`, {
            dataContentType: 'application/json',
            extraHeaders: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_ENTITY_LINKER_KEY }
        });
        const parsed = JSON.parse(raw);
        for (const entity of parsed.documents[0].entities) {
            const id = await this._wikidata.getQIDbyWikipediaUrl(entity.url);
            if (!id)
                throw new Error('Cannot find Wikidata entity for: ' + entity.url);
            const domainId = await this._wikidata.getDomain(id);
            entities.push({
                id,
                label: entity.name,
                domain: domainId ? (domainId in this._wikidata.subdomains ? await this._wikidata.getLabel(domainId) : domainId) : null,
                type: 'entity'
            });
        }
        const result = { entities, relations: [] };
        this._cache.set(utterance, JSON.stringify(result));
        return result;
    }

}