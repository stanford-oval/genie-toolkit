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
// Author: Silei Xu <silei@cs.stanford.edu>


import assert from 'assert';
import * as path from 'path';
import * as child_process from 'child_process';


const input = {
  "Restaurant": {
    "type": "query",
    "canonical": "restaurant",
    "args": {
      "servesCuisine": {
        "canonicals": {
          "default": "verb",
          "verb": [
            "serves # cuisine"
          ]
        },
        "values": [
          "chinese",
          "italian",
          "seafood"
        ]
      },
      "parking": {
        "canonicals": {
          "default": [
            "property"
          ],
          "property_true": [
            "parking"
          ]
        }
      }
    }
  }
};

const expected_output = {
  "synonyms": {
    "Restaurant": {
      "servesCuisine": {
        "verb": {
          "serves # cuisine": [
            "which restaurant serves chinese cuisine ?",
            "show me a restaurant that serves chinese cuisine .",
            "which restaurant serves italian cuisine ?",
            "show me a restaurant that serves italian cuisine .",
            "which restaurant serves seafood cuisine ?",
            "show me a restaurant that serves seafood cuisine ."
          ],
          "offers # cuisine": [
            "which restaurant offers chinese cuisine ?",
            "show me a restaurant that offers chinese cuisine .",
            "which restaurant offers italian cuisine ?",
            "show me a restaurant that offers italian cuisine .",
            "which restaurant offers seafood cuisine ?",
            "show me a restaurant that offers seafood cuisine ."
          ],
          "has # cuisine": [
            "which restaurant has chinese cuisine ?",
            "show me a restaurant that has chinese cuisine .",
            "which restaurant has italian cuisine ?",
            "show me a restaurant that has italian cuisine .",
            "which restaurant has seafood cuisine ?",
            "show me a restaurant that has seafood cuisine ."
          ],
          "serve # cuisine": [
            "which restaurant serve chinese cuisine ?",
            "show me a restaurant that serve chinese cuisine .",
            "which restaurant serve italian cuisine ?",
            "show me a restaurant that serve italian cuisine .",
            "which restaurant serve seafood cuisine ?",
            "show me a restaurant that serve seafood cuisine ."
          ],
          "serves # cooking": [
            "which restaurant serves chinese cooking ?",
            "show me a restaurant that serves chinese cooking .",
            "which restaurant serves italian cooking ?",
            "show me a restaurant that serves italian cooking .",
            "which restaurant serves seafood cooking ?",
            "show me a restaurant that serves seafood cooking ."
          ],
          "serves # food": [
            "which restaurant serves chinese food ?",
            "show me a restaurant that serves chinese food .",
            "which restaurant serves italian food ?",
            "show me a restaurant that serves italian food .",
            "show me a restaurant that serves seafood food ."
          ],
          "serves # foods": [
            "which restaurant serves chinese foods ?",
            "show me a restaurant that serves chinese foods .",
            "show me a restaurant that serves italian foods .",
            "show me a restaurant that serves seafood foods ."
          ]
        }
      },
      "parking": {
        "property_true": {
          "parking": [
            "show me a restaurant with parking .",
            "which restaurant has parking ?"
          ],
          "parked": [
            "show me a restaurant with parked .",
            "which restaurant has parked ?"
          ],
          "park": [
            "show me a restaurant with park .",
            "which restaurant has park ?"
          ],
          "garage": [
            "show me a restaurant with garage .",
            "which restaurant has garage ?"
          ],
          "space": [
            "show me a restaurant with space .",
            "which restaurant has space ?"
          ]
        }
      }
    }
  },
  "adjectives": [
    "Restaurant.servesCuisine"
  ],
  "domains": {
    "Restaurant": {
       bite: 2,
       burger: 1,
       cafe: 4,
       chef: 3,
       chinatown: 1,
       cuisine: 2,
       diner: 8,
       dining: 3,
       grocery: 2,
       hamburger: 1,
       pizza: 3,
       place: 8,
       seafood: 2
    }
  }
};


async function main() {
    const args = [
        path.resolve(path.dirname(module.filename), '../../tool/autoqa/lib/bert-canonical-annotator.py'),
        'all',
        '--no-mask',
        '--k-synonyms', '5'
    ];
    const child = child_process.spawn(`python`, args, {stdio: ['pipe', 'pipe', 'inherit']});
    const stdout = await new Promise((resolve, reject) => {
        child.stdin.write(JSON.stringify(input));
        child.stdin.end();
        child.on('error', reject);
        child.stdout.on('error', reject);
        child.stdout.setEncoding('utf8');
        let buffer = '';
        child.stdout.on('data', (data) => {
            buffer += data;
        });
        child.stdout.on('end', () => resolve(buffer));
    });

    assert.deepStrictEqual(JSON.parse(stdout), expected_output);
}
export default main;
if (!module.parent)
    main();
