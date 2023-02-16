import * as sqlite3 from 'sqlite3';

/**
 schema:
 create table type (
    id varchar(16) primary key,
    type varchar(100)
);
 */
export default class BootlegUtils {
    private _db ! : sqlite3.Database;

    constructor(path : string) {
        this._db = new sqlite3.Database(path, sqlite3.OPEN_READONLY);
    }

    async getType(id : string) : Promise<string|null> {
        const result : any = await new Promise((resolve, reject) => {
            const sql = `select type from type where id = ?`;
            this._db.get(sql, id, (err : Error|null, rows : any) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
        if (result && result.type)
            return result.type;
        return null;
    }
}