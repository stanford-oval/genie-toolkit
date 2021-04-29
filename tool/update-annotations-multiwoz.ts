// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import { Ast, Syntax } from 'thingtalk';
import byline from 'byline';

import { DialogueSerializer, DialogueParser } from '../lib/dataset-tools/parsers';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('update-annotations', {});
    parser.add_argument('-i', '--input', {
        required: true,
        help: 'Input dialog file'
    });
}

class EntityReader extends Ast.NodeVisitor {
    places: { [name: string]: string; };

    constructor(places : {[name: string]: string}) {
        super();
        this.places = places;
    }

    visitEntityValue(node: Ast.EntityValue): boolean {
        if (node.value == null)
            return true;
        switch (node.type) {
            case "uk.ac.cam.multiwoz.Hotel:Hotel":
                node.value = 'H' + node.value;
                break;
            case "uk.ac.cam.multiwoz.Restaurant:Restaurant":
                node.value = 'R' + node.value;
                break;
            case "uk.ac.cam.multiwoz.Attraction:Attraction":
                node.value = 'A' + node.value;
                break;
            default:
                return true;
        }
        if (node.display != null)
            this.places[node.display] = node.value;
        return true;
    }
}

class PlaceAugmenter extends Ast.NodeVisitor {
    places: { [name: string]: string; };
    counter: number;

    constructor(places : {[name: string]: string}) {
        super();
        this.places = places;
        this.counter = 0;
    }
    visitInputParam(node: Ast.InputParam) : boolean {
        if (node.name == "destination" || node.name == "departure") {
            const val : string = (node.value as Ast.StringValue).value;
            node.value = new Ast.EntityValue(val in this.places ? this.places[val]: null, "uk.ac.cam.multiwoz.Place:Place", val);
            if (!(val in this.places)) {
                this.places[val] = "P" + this.counter.toString();
                this.counter++;
            }
        }
        return true;
    }

    visitDialogueHistoryResultItem(node: Ast.DialogueHistoryResultItem) : boolean {
        // hack to not change Train results
        if ('id' in node.value) return true;

        for (const key of ["destination", "departure"]) {
            if (key in node.value) {
                const val = (node.value[key] as Ast.StringValue).value;
                if (!(val in this.places)) {
                    this.places[val] = "P" + this.counter.toString();
                    this.counter++;
                }
                node.value[key] = new Ast.EntityValue(this.places[val], "uk.ac.cam.multiwoz.Place:Place", val);
            }
        }
        return true;
    }
}

export async function execute(args: any) {
    let inputs = args.input.split(',');
    const places : {[name: string]: string} = {};
    for (const visitor_creator of [() => {return new EntityReader(places)}, () => {return new PlaceAugmenter(places)}]) {
        await Promise.all(inputs.map(async (input: string) => {
            const out = new DialogueSerializer({annotations: true});
            // lol this should not be separately generated from output array, should zip
            out.pipe(fs.createWriteStream(input + '.tmp'));
            console.log(input);
            for await (const dlg of fs.createReadStream(input, { encoding: 'utf8'}).pipe(byline()).pipe(new DialogueParser())) {
                for (const turn of dlg) {
                    //console.log(turn);
                    for (const field of ['context', 'agent_target', 'user_target']) {
                        if (turn[field] == '') continue;
                        const parsed = Syntax.parse(turn[field], input.lastIndexOf('.tmp') == -1 ? Syntax.SyntaxType.Legacy : Syntax.SyntaxType.Normal);
                        parsed.visit(visitor_creator());
                        turn[field] = parsed.prettyprint();
                    }
                }
                out.write({id: dlg.id, turns: dlg});
                console.log(dlg.id);
            }
            //out.end();
        })).catch(err => {
            console.log(err);
        });
        inputs = inputs.map((input:string) => {
            return input + ".tmp";
        });
    }
}