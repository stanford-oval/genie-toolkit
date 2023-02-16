import * as Tp from 'thingpedia';
export const SCHEMAORG_PREFIX = 'https://schema.org/';

const SCHEMA_JSON = 'https://raw.githubusercontent.com/schemaorg/schemaorg/main/data/releases/14.0/schemaorg-current-https.jsonld';


// All level 1 domains in schema.org except for Action and Intangible
export const LEVEL1_DOMAINS = [
    'CreativeWork',
    'Event',
    'MedicalEntity',
    'Organization',
    'Person',
    'Place',
    'Product'
];

export class SchemaorgType {
    id : string;
    name : string;
    private _depth ?: number;
    private _subclass_of : SchemaorgType[];

    constructor(id : string, name : string, subclass_of : SchemaorgType[]) {
        this.id = id;
        this.name = name;
        this._subclass_of = subclass_of;
    }

    addParentType(type : SchemaorgType) {
        this._subclass_of.push(type);
    }

    isSubclassOf(type : string, maxDepth = Infinity) {
        if (maxDepth < 0)
            return false;
        if (this.name === type)
            return true;
        if (!this._subclass_of)
            return false;
        for (const parent of this._subclass_of) {
            if (parent.isSubclassOf(type, maxDepth - 1))
                return true;
        }
        return false;
    }

    get depth() : number {
        if (this._depth)
            return this._depth;
        if (this.name === 'Thing')
            return 0;
        const parentDepths = this._subclass_of.map((t) => t.depth);
        return Math.min(...parentDepths) + 1;
    }
}

export default class SchemaorgUtils {
    private _types : Record<string, SchemaorgType>;

    constructor() {
        this._types = {};
    }

    async _init() {
        const raw = await Tp.Helpers.Http.get(SCHEMA_JSON, { accept: 'application/json' });
        const parsed = JSON.parse(raw);
        // load types
        for (const item of parsed['@graph']) {
            const id = item['@id'];
            const name = item['rdfs:label'];
            if (item['@type'] === 'rdfs:Class')
                this._types[id] = new SchemaorgType(id, name, []);
        }
        // load subclasses
        for (const item of parsed['@graph']) {
            const id = item['@id'];
            if (!(id in this._types))
                continue;
            let parentTypes = item['rdfs:subClassOf'];
            if (!parentTypes)
                continue;
            if (!Array.isArray(parentTypes))
                parentTypes = [parentTypes];
            for (const parentType of parentTypes) {
                const schemaType = this._types[parentType['@id']];
                if (schemaType)
                    this._types[id].addParentType(schemaType);
            }
        }
    }
    
    async types(maxDepth = Infinity) {
        if (Object.keys(this._types).length === 0)
            await this._init();
        return Object.values(this._types).filter((t) => 
            t.isSubclassOf('Thing', maxDepth) && 
            LEVEL1_DOMAINS.some((d) => t.isSubclassOf(d)) || t.name === 'Thing'
        );
    }
}