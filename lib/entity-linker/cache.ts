import fs from 'fs';
import * as sqlite3 from 'sqlite3';

const CACHE_SCHEMA = `
create table cache (
    key text primary key,
    value text
);
`;

export default class Cache {
    private _path : string;
    private _loaded : boolean;
    private _readonly : boolean;
    private _db! : sqlite3.Database;

    constructor(path : string, readonly = false) {
        this._path = path;
        this._loaded = false;
        this._readonly = readonly;
    }

    /**
     * Load or create sqlite database for caching
     */
    private async _loadOrCreateSqliteCache() {
        if (this._readonly) {
            const db = new sqlite3.Database(this._path, sqlite3.OPEN_READONLY);
            this._db = db;
        } else {
            const db = new sqlite3.Database(this._path, sqlite3.OPEN_CREATE|sqlite3.OPEN_READWRITE);
            db.serialize(() => {
                if (!fs.existsSync(this._path)) 
                    db.exec(CACHE_SCHEMA);
            });
            this._db = db;
            this._loaded = true;
        }
    }

    /**
     * Get cache 
     * @param key 
     * @returns undefined if not found, otherwise in the format of { value : string }
     */
    async get(key : string) : Promise<any> {
        if (!this._loaded) 
            await this._loadOrCreateSqliteCache();
        return new Promise((resolve, reject) => {
            const sql = `select value from cache where key = ?`;
            this._db.get(sql, key, (err : Error|null, result : any) => {
                if (err)
                    reject(err);
                else 
                    resolve(result ? result.value : undefined);
            });
        });
    }

    /**
     * Set cache
     * @param key 
     * @param value
     * @returns undefined
     */
    async set(key : string, value : string) {
        if (this._readonly)
            return Promise.resolve();
        if (!this._loaded) 
            await this._loadOrCreateSqliteCache();
        return new Promise((resolve, reject) => {
            const sql = `insert into cache values (?, ?) on conflict do nothing`; 
            this._db.get(sql, key, value, (err : Error|null, result : any) => {
                if (err)
                    reject(err);
                else 
                    resolve(result);
            });
        });
    }
}