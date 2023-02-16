import * as Tp from 'thingpedia';
import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';
import { wikibaseSdk } from 'wikibase-sdk'; 
import wikibase from 'wikibase-sdk';
import BootlegUtils from './bootleg';
import SchemaorgUtils, { SCHEMAORG_PREFIX, SchemaorgType, LEVEL1_DOMAINS } from './schemaorg';

const URL = 'https://query.wikidata.org/sparql';
export const ENTITY_PREFIX = 'http://www.wikidata.org/entity/';
export const PROPERTY_PREFIX = 'http://www.wikidata.org/prop/direct/';
export const PROPERTY_PREDICATE_PREFIX = 'http://www.wikidata.org/prop/';
export const PROPERTY_STATEMENT_PREFIX = 'http://www.wikidata.org/prop/statement/';
export const PROPERTY_QUALIFIER_PREFIX = 'http://www.wikidata.org/prop/qualifier/';
export const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
export const DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime';
export const TP_DEVICE_NAME = 'wd';

// the key domains will be replaced by the value domains when querying
// (use the natural language of key domains)
export const DOMAIN_OVERRIDE : Record<string, string> = {
    "Q571": "Q47461344" // book -> written work
};

const PROPERTY_BLACKLIST = [
    'P31',
    // obsolete properties
    'P642',
    // audio-related 
    'P7243', // pronunciation
    'P898', // ipa transcription
    // external id or info
    'P1472', // commons creator page
    'P2888', // exact match
    'P973', // described at
    'P1482', // stack exchange tag
    'P1613', // irc channel
    'P1065', // archive url
    'P7705', // superfamicom.org url,
    'P1713', // biography at the bundestag of germany url,
    'P1325', // external data available at
    'P1421', // grin url
    'P1348', // algae base url
    'P1991', // lpsn url
    'P6363', // word lift url,
    'P953', // full work available at url
    // kb/wikimedia metadata: 
    'P1709', // equivalent class
    'P5008' , // on focus list of wikimedia projects
    'P1889', // different from
    'P1343', // described by source
    'P910', // topic's main categories
    'P1424', // topic's main templates
    'P1151', // topic's main wikimedia portals 
    'P3831', // object has role,
    'P1480', // sourcing circumstances,
    'P217', // inventory number,
    'P485', // archives at
    'P1552', // has quality
    'P2959', // permanent duplicate item,
    'P2354', // has list
    'P5125', // wikimedia outline
    'P528', // catalog code 
    'P972', // catalog
    'P805', // statement is subject of
    'P3680', // statement supported by
    'P1957',  // wikisource index page url
    'P8768', // online catalog
    'P854', // reference url
    'P373', // commons category,
    'P935', // commons gallery
    'P1612', // commons_institution_page
    // misc
    'P5282', // ground level 360 degree view
];

// these domains are too big, querying its entities without more filters
// will timeout 
const BIG_DOMAINS = [ 
    'Q5',        // human
    'Q13442814', // scholarly article
    'Q16521'     // taxon
];

// these domains are too big, sorting entities by sitelinks will time out 
// set their sitelinks minimum manually to get entities
const SITELINKS_MINIMUM : Record<string, number> = {
    'Q5': 100, // human
    'Q16521': 100, // taxon
    'Q3305213': 20, // painting
    'Q13442814': 1, // scholar article
};

const SQLITE_SCHEMA = `
create table http_requests (
    url text primary key,
    result text
);

create table labels (
    id varchar(16) primary key,
    label text
);
`;

interface Constraint {
    key : string,
    value : string
}

type WikibaseType = 'WikibaseItem' | 'CommonsMedia' | 'String' | 'Quantity' | 'Time' | 'Monolingualtext' | 'Url' | 'Unsupported';

function normalizeURL(url : string) {
    return url.trim().replace(/\s+/g, ' ');
}
 
export default class WikidataUtils {
    private _wdk : wikibaseSdk;
    private _schemaorg : SchemaorgUtils;
    private _cachePath : string;
    private _cache ! : sqlite3.Database;
    private _bootleg : BootlegUtils;
    private _cacheLoaded : boolean;
    private _domains : Record<string, SchemaorgType>; // domains and their schema.org equivalent type 
    private _subdomains : Record<string, string[]>; // domains and their subdomains
    private _domainSize : Record<string, number>; // number of entities for each domain
    private _properties : Record<string, WikibaseType>; // all properties to include with their wikibase type
    private _readonlyCache : boolean;

    constructor(cachePath : string, bootlegPath : string, saveCache = true) {
        this._cachePath = cachePath;
        this._wdk = wikibase({ instance: 'https://www.wikidata.org' });
        this._schemaorg = new SchemaorgUtils();
        this._bootleg = new BootlegUtils(bootlegPath);
        this._cacheLoaded = false;
        this._domains = {};
        this._subdomains = {};
        this._domainSize = {};
        this._properties = {};
        this._readonlyCache = !saveCache;
    }

    get subdomains() {
        return this._subdomains;
    }

    /**
     * Load or create sqlite database for caching
     */
    private async _loadOrCreateSqliteCache() {
        if (this._readonlyCache) {
            const db = new sqlite3.Database(this._cachePath, sqlite3.OPEN_READONLY);
            this._cache = db;
        } else {
            const db = new sqlite3.Database(this._cachePath, sqlite3.OPEN_CREATE|sqlite3.OPEN_READWRITE);
            db.serialize(() => {
                if (!fs.existsSync(this._cachePath)) 
                    db.exec(SQLITE_SCHEMA);
            });
            this._cache = db;
            this._cacheLoaded = true;
        }
    }

    /**
     * Get cache 
     * @param table the name of the table
     * @param field the filed of projection
     * @param constraint the constraint to apply to the retrieval
     * @returns undefined if not found, otherwise in the format of { result : string }
     */
    private async _getCache(table : string, field : string, constraint : Constraint) : Promise<any> {
        if (!this._cacheLoaded) 
            await this._loadOrCreateSqliteCache();
        return new Promise((resolve, reject) => {
            const sql = `select ${field} from ${table} where ${constraint.key} = ?`;
            this._cache.get(sql, constraint.value, (err : Error|null, rows : any) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
    }

    /**
     * Set cache
     * @param table the name of the table
     * @param values all the values to add to the table
     * @returns undefined
     */
    private async _setCache(table : string, ...values : string[]) {
        if (this._readonlyCache)
            return Promise.resolve();
        if (!this._cacheLoaded) 
            await this._loadOrCreateSqliteCache();
        return new Promise((resolve, reject) => {
            const placeholders = values.map(() => '?').join(',');
            const sql = `insert into ${table} values (${placeholders}) on conflict do nothing`; 
            this._cache.get(sql, ...values, (err : Error|null, rows : any) => {
                if (err)
                    reject(err);
                else 
                    resolve(rows);
            });
        });
    }

    /**
     * Obtain results of a SPARQL query against Wikidata SPARQL endpoint
     * @param sparql a SPARQL query
     * @returns A list of the results
     */
    private async _query(sparql : string) {
        const result = await this._request(`${URL}?query=${encodeURIComponent(normalizeURL(sparql))}`);
        if (result === null)
            return null;
        return result.results.bindings;
    }

    /**
     * Obtain results of URL in JSON form (Wikibase API call)
     * @param url 
     * @param caching enable caching for the request or not
     * @returns An object of the result
     */
    private async _request(url : string, caching = true, attempts = 1) : Promise<any> {
        if (caching) {
            const cached = await this._getCache('http_requests', 'result', { key: 'url', value : url });
            if (cached) 
                return JSON.parse(cached.result);
        }
        try {
            const result = await Tp.Helpers.Http.get(url, { accept: 'application/json' });
            if (caching)
                await this._setCache('http_requests', url, result);
            const parsed = JSON.parse(result);
            return parsed;
        } catch(e) {
            if (attempts < 2)
                return this._request(url, caching, attempts + 1);
            console.log(`Failed to retrieve result for: ${url}`);
            console.log(e);
            return null;
        }
    }

    async query(sparql : string) : Promise<string[]> {
        const raw = await this._request(`${URL}?query=${encodeURIComponent(normalizeURL(sparql))}`);
        return WikidataUtils.processRawResult(raw);
    }

    static processRawResult(raw : any) : string[] {
        if (raw === null)
            return [];
        if ('boolean' in raw)
            return [raw.boolean.toString()];
        const result = raw.results.bindings.map((r : Record<string, any>) => Object.values(r)[0].value);
        return result.map((r : string) => r.startsWith(ENTITY_PREFIX) ? r.slice(ENTITY_PREFIX.length) : r);
    }

    /**
     * Obtain the values of property for a given entity
     * @param entityId QID of an entity
     * @param propertyId PID of an entity
     * @returns values of the property
     */
    async getPropertyValue(entityId : string, propertyId : string) : Promise<string[]> {
        const sparql = `SELECT ?v WHERE { wd:${entityId} wdt:${propertyId} ?v. }`;
        const res = await this._query(sparql);
        return res.map((r : any) => r.v.value.slice(ENTITY_PREFIX.length));
    }

    /**
     * Get the domain of a given entity: 
     * if there are multiple domains, pick the one that has the most instances;
     * @param entityId QID of an entity
     * @param excludes a list of domains (QIDs) that we want to exclude, this is used to 
     *                 to provide alternative domain when properties are not available
     * @returns the QID of the domain of the entity
     */
    async getDomain(entityId : string, excludes : string[] = []) : Promise<string|null> {
        await this.loadAllDomains();
        const domains = await this.getPropertyValue(entityId, 'P31');
        if (domains.length === 0)
            return null;
        if (domains.includes('Q5') && !excludes.includes('Q5'))
            return 'Q5';
            
        const bootlegType = await this._bootleg.getType(entityId);
        if (bootlegType) {
            if (bootlegType in this._domains && !excludes.includes(bootlegType))
                return bootlegType;
            return this.getTopLevelDomain([bootlegType], excludes);
        }
        
        return this.getTopLevelDomain(domains, excludes);
    }

    /**
     * Get the Wikidata label for an entity or a property   
     * @param id QID or PID
     * @returns natural language label in English
     */
    async getLabel(id : string) : Promise<string|null> {
        if (!/[P|Q][0-9]+/.test(id))
            return null;
        const cache = await this._getCache('labels', 'label', { key : 'id', value : id });
        if (cache)
            return cache.label;
        const result = await this._request(this._wdk.getEntities({ 
            ids: [id],
            languages: ['en'],
            props: ['labels']
        }));
        try {
            const label = (Object.values(result.entities)[0] as any).labels.en.value;
            await this._setCache('labels', id, label);
            return label;
        } catch(e) {
            console.log(`Failed to retrieve label for ${id}`);
            return null;
        }
    }

    /**
     * Get the Wikidata alt label for an entity or a property
     * @param id QID or PID
     * @returns an array of alternative labels in English
     */
    async getAltLabels(id : string) : Promise<string[]> {
        const result = await this._request(this._wdk.getEntities({
            ids: [id],
            languages: ['en'],
            props: ['aliases']
        }));
        try {
            return (Object.values(result.entities)[0] as any).aliases.en.map((alias : any) => alias.value);
        } catch(e) {
            console.log(`Found no alt label for ${id}`);
            return [];
        }
    }

    /**
     * Get the wikidata label for a list of entities/properties. 
     * The API allows up to 50 entities/properties at a time. 
     * @param qids a list of QIDs or PIDs
     * @returns A map from id to label
     */
    async getLabelsByBatch(...ids : string[]) : Promise<Record<string, string|null>> {
        const result : Record<string, string|null> = {};
        const uncached = [];
        for (const id of ids) {
            if (!/^[P|Q][0-9]+$/.test(id))
                continue;
            const cached = await this._getCache('labels', 'label', { key : 'id', value : id });
            if (cached) 
                result[id] = cached.label;
            else    
                uncached.push(id);
        }
        const uniqueUncached = [...new Set(uncached)];
        for (let i = 0; i < uniqueUncached.length; i += 50) {
            const batch = uniqueUncached.slice(i, i + 50);
            const raw = await this._request(this._wdk.getEntities({
                ids : batch,
                languages: ['en'],
                props: ['labels']
            }));
            for (const [qid, entity] of Object.entries(raw.entities) as any) {
                if (qid !== entity.id) // some entities are simply a redirect of another entity, drop those 
                    continue;
                result[qid] = entity.labels?.en?.value;
                await this._setCache('labels', qid, entity.labels?.en?.value ?? null);
            }
        }
        return result;
    }

    /**
     * Get example entities for the given domain
     * 
     * Examples are sorted based on sitelinks.
     * Order by sitelinks in human (Q5), painting (Q3305213), and taxon (Q16521) domain 
     * will lead to timeout, thus handle these three domains specially
     * 
     * @param domain QID of the domain
     * @param limit the maximum number of entities to return
     * @returns an array of QIDs belongs to the given domain
     */
    async getEntitiesByDomain(domain : string, limit = 100) : Promise<string[]> {
        let sparql;
        if (domain in SITELINKS_MINIMUM) {
            sparql = `SELECT ?v ?sitelinks WHERE {
                ?v wdt:P31 wd:${domain} ;
                   wikibase:sitelinks ?sitelinks . 
                FILTER (?sitelinks > ${SITELINKS_MINIMUM[domain]}) .
            } LIMIT ${limit}`;
        } else {
            sparql = `SELECT ?v WHERE {
                ?v wdt:P31 wd:${domain} ;
                   wikibase:sitelinks ?sitelinks .  
            } ORDER BY DESC(?sitelinks) LIMIT ${limit}`;
        }
        const res = await this._query(sparql);
        return res.map((r : any) => r.v.value.slice(ENTITY_PREFIX.length));
    }

    /**
     * Get properties for a given domain
     * 
     * First get 100 example entities in the domain, and then extract all properties 
     * they use
     * 
     * @param domain QID of the domain
     * @param includeNonEntityProperties include properties whose values are not Wikidata entities 
     * @returns an array of PIDs belongs to the given domain
     */
    async getDomainProperties(domain : string, includeNonEntityProperties = false) : Promise<string[]> {
        const propertyCounter : Record<string, number> = {};
        const exampleEntities = await this.getEntitiesByDomain(domain);
        const entityOnlyFilter = `FILTER(STRSTARTS(STR(?v), "${ENTITY_PREFIX}")) .`;
        for (const entity of exampleEntities) {
            const sparql = `SELECT DISTINCT ?p WHERE {
                wd:${entity} ?p ?v .
                FILTER(STRSTARTS(STR(?p), str(wdt:))) . 
                BIND (IRI(replace(str(?p), str(wdt:), str(wd:)))  AS ?p2)
                ?p2 wikibase:propertyType ?type ..
                FILTER (?type != wikibase:ExternalId) .
                ${includeNonEntityProperties ? '' : entityOnlyFilter }
            } `;
            const res = await this._query(sparql);
            res.forEach((r : any) => {
                if (!PROPERTY_BLACKLIST.includes(r.p.value.slice(PROPERTY_PREFIX.length))) {
                    const property = r.p.value.slice(PROPERTY_PREFIX.length);
                    if (!(property in propertyCounter))
                        propertyCounter[property] = 0;
                    propertyCounter[property] += 1;
                }
            });
        }
        // a property is included only if at least two entities have it
        return Object.keys(propertyCounter).filter((p) => propertyCounter[p] >= 2);
    }

    /**
     * Given a domain and a property, find if the property qualifiers
     * @param domain QID
     * @param property PID
     * @returns a list of qualifiers PID 
     */
    async getQualifiersByProperty(property : string, limit = 100) : Promise<string[]> {
        const qualifierCount : Record<string, number> = {};
        const sparql = `SELECT DISTINCT ?entity ?qualifier WHERE {
            ?entity p:${property} ?statement .
            OPTIONAL { 
                ?statement ?qualifier ?x. 
                FILTER(STRSTARTS(STR(?qualifier), "${PROPERTY_QUALIFIER_PREFIX}P")). 
                BIND (IRI(replace(str(?qualifier), str(pq:), str(wd:)))  AS ?p)
                ?p wikibase:propertyType ?type .
                FILTER (?type != wikibase:ExternalId) .
            }
        } LIMIT ${limit}`;
        const res = await this._query(sparql);
        res.forEach((r : any) => {
            const q = r.qualifier?.value.slice(PROPERTY_QUALIFIER_PREFIX.length);
            if (q) {
                if (PROPERTY_BLACKLIST.includes(q.slice(PROPERTY_QUALIFIER_PREFIX.length)))
                    return;
                if (!(q in qualifierCount))
                    qualifierCount[q] = 0;
                qualifierCount[q] += 1;
            }
        });
        // a qualifier is included only if there are 10+ instances among the examples
        return Object.keys(qualifierCount).filter((q) => qualifierCount[q] >= 10);
    } 

    /**
     * Get properties and their values for a given domain
     * 
     * First get 100 example entities in the domain, and then extract all properties 
     * they use and their values
     * 
     * @param domain QID of the domain
     * @param includeNonEntityProperties include properties whose values are not Wikidata entities 
     * @returns an object where key is property PID, values are either an array of string/entity objects, or a type 
     */
    async getDomainPropertiesAndValues(domain : string, includeNonEntityProperties = false) : Promise<Record<string, any>> {
        const properties : Record<string, string[]> = {};
        const propertyCounter : Record<string, number> = {};
        const exampleEntities = await this.getEntitiesByDomain(domain);
        const entityOnlyFilter = `FILTER(STRSTARTS(STR(?v), "${ENTITY_PREFIX}")) .`;
        for (const entity of exampleEntities) {
            const sparql = `SELECT DISTINCT ?p ?v WHERE {
                wd:${entity} ?p ?v .
                FILTER(STRSTARTS(STR(?p), str(wdt:))) . 
                BIND (IRI(replace(str(?p), str(wdt:), str(wd:)))  AS ?p2)
                ?p2 wikibase:propertyType ?type .
                FILTER (?type != wikibase:ExternalId) .
                ${includeNonEntityProperties ? '' : entityOnlyFilter }
            } `;
            const res = await this._query(sparql);
            res.forEach((r : any) => {
                if (PROPERTY_BLACKLIST.includes(r.p.value.slice(PROPERTY_PREFIX.length)))
                    return;
                const property = r.p.value.slice(PROPERTY_PREFIX.length);
                const value = r.v.value.startsWith(ENTITY_PREFIX) ? r.v.value.slice(ENTITY_PREFIX.length) : r.v.value; 
                if (!(property in properties))
                    properties[property] = [];
                if (!(property in propertyCounter))
                    propertyCounter[property] = 0;
                properties[property].push(value);
                propertyCounter[property] += 1;
            });
        }
        // a property is included only if at least 10 entities have it
        Object.entries(propertyCounter).forEach(([property, count]) => {
            if (count < 10)
                delete properties[property];
        });
        return properties;
    }

    /**
     * Get sample values for a qualifier 
     * @param qualifier PID of a qualifier
     * @returns the sampled values for the qualifier
     */
    async getQualifierValues(qualifier : string, limit = 100) : Promise<string[]> {
        const sparql = `SELECT DISTINCT ?v WHERE {
            ?any pq:${qualifier} ?v.
        } limit ${limit}`;
        const res = await this._query(sparql);
        return res.map((r : any) => 
            r.v.value.startsWith(ENTITY_PREFIX) ? r.v.value.slice(ENTITY_PREFIX.length) : r.v.value
        );
    }


    /**
     * Get properties that are marked as "Wikidata property with datatype 'time'"
     * 
     * @returns a list of property ids 
     */
    async getTimeProperties() {
        const sparql = `SELECT DISTINCT ?p WHERE {
            ?p wdt:P31 wd:Q18636219 ;
        }`;
        const res = await this._query(sparql);
        return res.map((r : any) => r.p.value.slice(ENTITY_PREFIX.length));
    }

    /**
     * Get the allowed units (Q21514353) of a property
     * This allows to detect Measure types
     *
     * @param propertyId
     * @returns A list of allowed units
     */
    async getAllowedUnits(propertyId : string) : Promise<string[]> {
        const query = `SELECT ?value ?valueLabel WHERE {
            wd:${propertyId} p:P2302 ?statement .
            ?statement ps:P2302 wd:Q21514353 .
            ?statement pq:P2305 ?value .
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }`;
        const result = await this._query(query);
        return result.map((r : any) => r.valueLabel.value);
    }

    /**
     * Get range constraint
     *
     * @param propertyId
     * @returns range or null
     */
    async getRangeConstraint(propertyId : string) : Promise<Record<string, number>|null> {
        const query = `SELECT ?max ?min WHERE {
            wd:${propertyId} p:P2302 ?statement .
            ?statement ps:P2302 wd:Q21510860 .
            ?statement pq:P2312 ?max .
            ?statement pq:P2313 ?min .
        }`;
        const result = await this._query(query);
        if (result.length > 0) {
            const range : Record<string, number> = {};
            if (result[0].max)
                range.max = result[0].max.value;
            if (result[0].min)
                range.min = result[0].min.value;
            if (Object.keys(range).length > 0)
                return range;
        }
        return null;
    }

    /**
     * Return 
     * @param propertyId 
     * @returns wikibaseType 
     */
    async getPropertyType(propertyId : string) : Promise<string> {
        if (Object.keys(this._properties).length === 0) {   
            const query = `SELECT ?p ?type WHERE {
                ?p wikibase:propertyType ?type . 
                FILTER (?type != wikibase:ExternalId)
            }`;
            const result = await this._query(query);
            result.forEach((r : any) => {
                const property : string = r.p.value;
                const type : string = r.type.value;
                let wikibaseType = type.slice('http://wikiba.se/ontology#'.length);
                // if (!['WikibaseItem', 'String', 'Quantity', 'Time', 'Monolingualtext', 'Url', 'GlobeCoordinate'].includes(wikibaseType))
                if (!['WikibaseItem', 'String', 'Quantity', 'Time', 'Monolingualtext', 'Url'].includes(wikibaseType))
                    wikibaseType = 'Unsupported';
                this._properties[property.slice(ENTITY_PREFIX.length)] = wikibaseType as WikibaseType;
            });
        }
        return this._properties[propertyId];
    }

    /**
     * the number of entities in this domain
     * @param domain QID of a domain
     */
    async getDomainSize(domain : string) : Promise<number> {
        if (!this._domainSize[domain]) {
            if (BIG_DOMAINS.includes(domain)) {
                this._domainSize[domain] = Infinity;
            } else {
                const query = `SELECT (COUNT(DISTINCT(?uri)) as ?count) WHERE {
                    ?uri wdt:P31 wd:${domain}. 
                }`;
                const result = await this._query(query);
                if (result === null) {
                    console.log(`Timeout to get domain size for ${domain}, assuming it's a big domain`);
                    this._domainSize[domain] = Infinity;
                } else {
                    this._domainSize[domain] = result[0].count.value;
                }
            }
        }
        return this._domainSize[domain];
    }

    /**
     * Get all the domains to include in the schema
     * @returns the domains
     */
    async loadAllDomains(minimum_size = 100) {
        if (Object.keys(this._domains).length === 0) {
            const schemaTypes = await this._schemaorg.types();
            const query = `SELECT DISTINCT ?domain ?equivalent WHERE {
                ?domain wdt:P1709 ?equivalent.
                FILTER(STRSTARTS(STR(?equivalent), 'https://schema.org/'))
            }`;
            const result = await this._query(query);
            for (const r of result) {
                const domain = r.domain.value.slice(ENTITY_PREFIX.length);
                const equivalent = r.equivalent.value.slice(SCHEMAORG_PREFIX.length);
                const equivalentType = schemaTypes.find((t) => t.name === equivalent);
                if (!equivalentType)
                    continue;
                // only add the domain if (1) it's "entity" or (2) it has at least 100 examples
                // domain size is counted by direct class (P31 only, no P31/P279*), so entity has less than 100 examples
                if (domain === 'Q35120' || (await this.getDomainSize(domain)) >= minimum_size) {
                    this._domains[domain] = equivalentType;
                    this._subdomains[domain] = [];
                }
            }
            // manually add the following domains
            // Q16521: taxon
            // Q95074: fictional character
            for (const domain of ['Q16521', 'Q95074']) {
                const equivalentType = schemaTypes.find((t) => t.name === 'Thing')!;
                this._domains[domain] = equivalentType;
                this._subdomains[domain] = [];
            }

            await this._loadSubdomains();
        }
    }

    async _loadSubdomains() {
        // get all domains that have external equivalence
        const query = `SELECT DISTINCT ?uri WHERE { ?uri wdt:P1709 ?equivalent }`;
        const result = await this._query(query);
        // find their parent 
        const subdomains = result.map((r : any) => 
            r.uri.value.slice(ENTITY_PREFIX.length)
        ).filter((r : string) => 
            !(r in this._domains)
        );
        for (const domain of subdomains) {
            const topLevelDomains = await this.getTopLevelDomains(domain);
            for (const topLevelDomain of topLevelDomains)
                this._subdomains[topLevelDomain].push(domain);
        }
    }

    /**
     * Return the top-level parent domains given a subdomain 
     * this only returns domains that are included in the manifest
     * @param qids a list of QIDs 
     */
    async getTopLevelDomains(...qids : string[]) : Promise<string[]> {
        await this.loadAllDomains();
        const domains = [];
        for (const qid of qids) {
            if (qid in this._domains) {
                domains.push(qid);
                continue;
            }
            const query = `SELECT ?uri WHERE { wd:${qid} wdt:P279+ ?uri }`;
            const result = await this._query(query);
            const parentDomains : string[] = result.map((r : any) => 
                r.uri.value.slice(ENTITY_PREFIX.length)
            ).filter((d : string) => 
                d in this._domains 
            );
            domains.push(...parentDomains);
        }
        return [...new Set(domains)];
    }

    /**
     * Return the immediate parent domains given a subdomain
     * this returns all domains in wikidata, including those not in the manifest
     * @param qids a list of QIDs
     * @returns a list of parent class QIDs 
     */
    async getParentDomains(...qids : string[]) : Promise<string[]> {
        await this.loadAllDomains();
        const domains = [];
        for (const qid of qids) {
            if (qid in this._domains) {
                domains.push(qid);
                continue;
            }
            const query = `SELECT ?uri WHERE { wd:${qid} wdt:P279 ?uri }`;
            const result = await this._query(query);
            const parentDomains : string[] = result.map((r : any) => 
                r.uri.value.slice(ENTITY_PREFIX.length)
            );
            domains.push(...parentDomains);
        }
        return [...new Set(domains)];
    }

    /**
     * Return one top-level domain given a subdomain
     * The returned one is considered the default domain to choose a function 
     * unless there are some properties not available for the domain
     * 
     * It iteratively check the immediate parent domains and find a domain that
     * is included in the top-level domains. If there are multiple, some heuristics
     * is used to order the candidates
     * 
     * @param qids a list of QIDs 
     * @param excludes a list of domains (QIDs) we want to exclude from the result
     * @returns the default to-level domain 
     */
    async getTopLevelDomain(qids : string[], excludes : string[] = []) : Promise<string> {
        await this.loadAllDomains();
        // if no domains available, return the 'entity' domain - everything is an entity
        if (qids.length === 0)
            return 'Q35120';
        let candidates = qids.filter((d) => d in this._domains && !excludes.includes(d));
        if (candidates.length > 0) {
            // (1) sort by domain size first, choose the more common one
            //     if there is a tie, go with alphabetical order
            candidates.sort((a, b) => {
                if (this._domainSize[a] === this._domainSize[b])
                    return b.localeCompare(a);
                return this._domainSize[a] - this._domainSize[b];
            });
            
            // (2) within the 1st level schema domain, sort by depth, choose the more specific one
            //     if there is a tie, choose the one that has a larger domain size
            for (const domain of LEVEL1_DOMAINS) {
                if (this._domains[candidates[0]].isSubclassOf(domain)) {
                    candidates = candidates.filter((d) => this._domains[d].isSubclassOf(domain));
                    if (candidates.length === 1 && this._domains[candidates[0]].name === domain)
                        return candidates[0];
                    candidates = candidates.filter((d) => this._domains[d].name !== domain);
                    const maxDepth = Math.max(...candidates.map((d) => this._domains[d].depth));
                    candidates = candidates.filter((d) => this._domains[d].depth === maxDepth);
                    candidates.sort((a, b) => {
                        if (this._domainSize[a] === this._domainSize[b])
                            return b.localeCompare(a);
                        return this._domainSize[b] - this._domainSize[a];
                    });
                }
            }
            return candidates[0];
        }
        const parentDomains = await this.getParentDomains(...qids);
        return this.getTopLevelDomain(parentDomains);
    }

    /**
     * Return the children domains given a domain
     * this returns all domains in wikidata, including those not in the manifest
     * @param qids a list of QIDs
     * @returns a list of subdomain QIDs 
     */
    async getSubdomains(...qids : string[]) : Promise<string[]> {
        const domains = [];
        for (const qid of qids) {
            const query = `SELECT ?uri WHERE { ?uri wdt:P279* wd:${qid} }`;
            const result = await this._query(query);
            const parentDomains : string[] = result.map((r : any) => 
                r.uri.value.slice(ENTITY_PREFIX.length)
            );
            domains.push(...parentDomains);
        }
        return [...new Set(domains)];
    }

    /**
     * Given a name of an entity, find its QID 
     * @param name the name of the entity
     * @returns 
     */
    async getEntityByName(name : string) : Promise<string|null> {
        const result = await this._request(this._wdk.searchEntities(name));
        try {
            return result.search[0].id;
        } catch(e) {
            console.log(`Failed to find domain for ${name}`);
            return null;
        }
    }

    /**
     * guess if the thingtalk type of a value is string
     * @param value a string of value
     * @returns if the value is a string value
     */
    isStringValue(value : string) : boolean {
        // preprocessed entity type 
        if (/^Q[0-9]+$/.test(value))
            return false;
        // raw entity, url, pictures
        if (value.startsWith('http://') || value.startsWith('https://'))
            return false;
        // date
        if (!isNaN(Date.parse(value)))
            return false;
        // number, measurement
        if (!isNaN(+value))
            return false;
        return true;
    }

    /**
     * guess if the thingtalk type of a value is number
     * @param value a string of value
     * @returns if the value is a number value
     */
    isNumber(value : string) : boolean {
        return !isNaN(+value);
    }

    /**
     * guess if the thingtalk type of a value is entity
     * @param value a string of value
     * @returns if the value is a entity value
     */
    isEntity(value : string) : boolean {
        return /^Q[0-9]+$/.test(value);
    }

    /**
     * @param wikipediaUrl Wikipedia url for an entity
     * @returns QID of the entity in wikidata
     */
    async getQIDbyWikipediaUrl(wikipediaUrl : string) : Promise<string|null> {
        const title = wikipediaUrl.slice('https://en.wikipedia.org/wiki/'.length);
        const url = 'https://en.wikipedia.org/w/api.php';
        const params = `action=query&prop=pageprops&titles=${encodeURIComponent(title)}&format=json`;
        const result = await this._request(`${url}?${params}`);
        const pageprops = (Object.values(result.query.pages)[0] as any).pageprops;
        return pageprops ? pageprops.wikibase_item : null;
    }

    async isDomainEntity(entity : string) : Promise<boolean> {
        const sparql = `SELECT DISTINCT ?v WHERE { 
            wd:${entity} wdt:P279 ?v.
        }`;
        const result = await this._query(sparql);
        return result.length > 0;
    }

    /**
     * 
     * @param entity qid of an entity
     * @returns all properties that connect to the entity
     */
    async getConnectedProperty(entity : string, incoming = true) : Promise<string[]> {
        const bidirectionalPropertySparql = `SELECT DISTINCT ?p WHERE {
            { wd:${entity} ?p ?v.} UNION { ?v ?p wd:${entity}. }
            FILTER(STRSTARTS(STR(?p), str(wdt:))) . 
            BIND (IRI(replace(str(?p), str(wdt:), str(wd:)))  AS ?p2)
            ?p2 wikibase:propertyType ?type .
            FILTER (?type != wikibase:ExternalId) .
        }`;
        const unidirectionalPropertySparql = `SELECT DISTINCT ?p WHERE {
            wd:${entity} ?p ?v.
            FILTER(STRSTARTS(STR(?p), str(wdt:))) . 
            BIND (IRI(replace(str(?p), str(wdt:), str(wd:)))  AS ?p2)
            ?p2 wikibase:propertyType ?type .
            FILTER (?type != wikibase:ExternalId) .
        }`;
        if (!incoming || await this.isDomainEntity(entity)) {
            const result = await this._query(unidirectionalPropertySparql);
            return result.map((r : any) => r.p.value.slice(PROPERTY_PREFIX.length)).filter((p : string) => !PROPERTY_BLACKLIST.includes(p));
        }
        try {
            const result = await this._query(bidirectionalPropertySparql);
            return result.map((r : any) => r.p.value.slice(PROPERTY_PREFIX.length)).filter((p : string) => !PROPERTY_BLACKLIST.includes(p));
        } catch(e) {
            const result = await this._query(unidirectionalPropertySparql);
            return result.map((r : any) => r.p.value.slice(PROPERTY_PREFIX.length)).filter((p : string) => !PROPERTY_BLACKLIST.includes(p));
        }
    }

    async getConnectedPropertyQualifiers(entity : string, properties : string[]) : Promise<string[]> {
        const qualifiers = [];
        for (const property of properties) {
            const sparql = `SELECT DISTINCT ?qualifier WHERE {
                wd:${entity} p:${property} ?statement .
                OPTIONAL { 
                    ?statement ?qualifier ?x. 
                    FILTER(STRSTARTS(STR(?qualifier), "${exports.PROPERTY_QUALIFIER_PREFIX}P")). 
                    BIND (IRI(replace(str(?qualifier), str(pq:), str(wd:)))  AS ?p)
                    ?p wikibase:propertyType ?type .
                    FILTER (?type != wikibase:ExternalId) .
                }
            }`;
            const result = await this._query(sparql);
            qualifiers.push(...result.filter((r : any) => !!r.qualifier)
                .map((r : any) => r.qualifier.value.slice(PROPERTY_QUALIFIER_PREFIX.length))
                .filter((p : string) => !PROPERTY_BLACKLIST.includes(p))
                .map((p : string) => `${property}.${p}`));
        }
        return qualifiers;
    }
}