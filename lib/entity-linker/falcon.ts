import fs from 'fs';
import * as Tp from 'thingpedia';
import { Relation, Entity, Linker } from './base';
import { ENTITY_PREFIX } from './wikidata';
import WikidataUtils from './wikidata';
import Cache from './cache';

interface FalconOptions {
    ner_cache : string,
    raw_data ?: string,
}

export class Falcon extends Linker {
    private _wikidata : WikidataUtils;
    private _url : string;
    private _cache : Cache;
    private _rawData : Record<string, string>;

    constructor(wikidata : WikidataUtils, options : FalconOptions) {
        super();
        this._wikidata = wikidata;
        this._url = 'https://labs.tib.eu/falcon/falcon2/api?mode=long';
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
        const relations : Relation[] = [];
        const raw = await Tp.Helpers.Http.post(this._url, `{"text":"${utterance}"}`, {
            dataContentType: 'application/json'
        });
        const parsed = JSON.parse(raw);
        for (const entity of parsed.entities_wikidata) {
            const id = entity.URI.slice(ENTITY_PREFIX.length);
            const domainId = await this._wikidata.getDomain(id);
            entities.push({
                id,
                label: entity["surface form"],
                domain: domainId ? (domainId in this._wikidata.subdomains ? await this._wikidata.getLabel(domainId) : domainId) : null,
                type: 'entity'
            });
        }
        for (const relation of parsed.relations_wikidata) {
            relations.push({
                id: relation.URI.slice(ENTITY_PREFIX.length),
                label: relation["surface form"],
                type: 'relation'
            });
        }
        const result = { entities, relations };
        this._cache.set(utterance, JSON.stringify(result));
        return result;
    }

}