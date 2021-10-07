// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import path from 'path';
import JSONStream from 'JSONStream';
import stream from 'stream';
import zlib from 'zlib';
import * as fs from 'fs';
const pfs = fs.promises;
import * as Tp from 'thingpedia';

import * as I18n from '../../../lib/i18n';
import * as StreamUtils from '../../../lib/utils/stream-utils';

async function loadURL(url) {
    const parsed = new URL(url);

    if (parsed.protocol === 'file:') {
        const stat = await pfs.stat(parsed.pathname);
        let stream = fs.createReadStream(parsed.pathname);
        if (parsed.pathname.endsWith('.gz'))
            stream = stream.pipe(zlib.createGunzip());

        return [stream, stat.size];
    } else if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        const res = await Tp.Helpers.Http.getStream(url);
        let stream = res;
        if (parsed.pathname.endsWith('.gz'))
            stream = stream.pipe(zlib.createGunzip());
        let size = -1;
        if (res.headers['content-length'])
            size = Number(res.headers['content-length']);
        return [stream, size];
    } else {
        throw new Error(`Invalid URL ${url}`);
    }
}

class ItemProcessor extends stream.Transform {
    constructor(offset) {
        super({
            objectMode: true,
            highWaterMark: 50000
        });

        this._tokenizer = I18n.get('en-US').getTokenizer();

        this._offset = offset;
        this._n = 0;
    }

    _transform(item, encoding, callback) {
        this._n ++;
        if (this._n && (this._n % 50000) === 0)
            console.log(this._n);
        if (this._n < this._offset) {
            callback();
            return;
        }

        if (item.type !== 'item' || !item.labels.en) {
            callback();
            return;
        }

        const label = item.labels.en.value;
        const description = item.descriptions.en ? item.descriptions.en.value : undefined;

        const tokenized = this._tokenizer.tokenize(label);
        // remove all entities that contain quoted strings, urls dates or times
        // but allow numbers (so years, ordinals and other confusable things can go in)
        if (tokenized.tokens.some((t) => /^(QUOTED_STRING|URL|DATE|TIME|EMAIL_ADDRESS|PHONE_NUMBER)/.test(t))) {
            callback();
            return;
        }

        const types = (item.claims.P31 || [])
            .filter((stmt) => stmt.rank !== 'deprecated' &&
                stmt.mainsnak &&
                stmt.mainsnak.snaktype === 'value' &&
                stmt.mainsnak.datavalue.type === 'wikibase-entityid' &&
                stmt.mainsnak.datavalue.value['entity-type'] === 'item')
            .map((stmt) => stmt.mainsnak.datavalue.value.id);

        const aliases = (item.aliases.en || [])
            .filter((alias) => alias.language === 'en')
            .map((alias) => this._tokenizer.tokenize(alias.value).rawTokens.join(' '));

        for (const t of types) {
            this.push({
                name: label,
                type: 'org.wikidata:' + t,
                value: item.id,
                canonical: tokenized.rawTokens.join(' '),
                aliases,
                description
            });
        }
        callback();
    }

    _flush(callback) {
        callback();
    }
}

class ESBulkInserter extends stream.Writable {
    constructor(config) {
        super({
            objectMode: true,
            highWaterMark: 50000
        });

        this._config = config;
        this._url = config.url + '/' + config.index;
        this._auth = 'Basic ' + (Buffer.from(config.username + ':' + config.password).toString('base64'));
    }

    _computeID(item) {
        return item.type + ':' + item.value;
    }

    _writev(items, callback) {
        items = items.map((item) => item.chunk);

        let buffer = '';
        for (const item of items) {
            buffer += JSON.stringify({ index: { _id: this._computeID(item) } }) + '\n';
            buffer += JSON.stringify(item) + '\n';
        }

        Tp.Helpers.Http.post(this._url + '/_bulk', buffer, {
            dataContentType: 'application/x-ndjson',
            auth: this._auth
        }).then((res) => {
            const parsed = JSON.parse(res);
            if (res.errors) {
                console.error(parsed);
                callback(new Error('some operation failed'));
            } else {
                callback();
            }
        }, callback);
    }

    _write(item, encoding, callback) {
        Tp.Helpers.Http.post(this._url + '/_doc/' + encodeURIComponent(this._computeID(item)), JSON.stringify(item), {
            dataContentType: 'application/json',
            auth: this._auth
        }).then(() => callback(), callback);
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('wikidata-es-import', {
        add_help: true,
        description: "Import a wikidata dump into ElasticSearch"
    });
    parser.add_argument('--url', {
        required: false,
        default: 'https://dumps.wikimedia.org/wikidatawiki/entities/latest-all.json.gz',
        help: 'URL of the Wikidata dump to process (can be a file:// URL or a http(s):// URL).'
    });
    parser.add_argument('--es-config', {
        required: true,
        help: 'Path to a JSON file containing the ElasticSearch configuration (url, username, password).'
    });
    parser.add_argument('--offset', {
        required: false,
        default: 0,
        help: 'Skip this many entities from the dump (resume uploading).'
    });
}

export async function execute(args) {
    const [stream,] = await loadURL(args.url);

    await StreamUtils.waitFinish(stream
        .setEncoding('utf8')
        .pipe(JSONStream.parse('*'))
        .pipe(new ItemProcessor(args.offset))
        .pipe(new ESBulkInserter(await import(path.resolve(args.es_config)))));
}
