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

//import * as util from 'util';
import assert from 'assert';
import * as seedrandom from 'seedrandom';

import { Replaceable } from '../../lib/utils/template-string';

const TEST_CASES = [
    // 1 simple string
    [{
        $root: 'foo bar baz'
    }, {
        best: 'foo bar baz',
        good: ['foo bar baz'],
    }],

    // 2 simple string with preprocessing
    [{
        $root: 'foo, bar   baz',
    }, {
        best: 'foo , bar baz',
        good: ['foo , bar baz'],
    }],

    // 3 choice, all equal
    [{
        $root: '{ foo | bar }'
    }, {
        best: 'foo',
        good: ['foo', 'bar'],
    }],

    // 4 simple string with flags
    [{
        $root: 'restaurant [plural=one]',
    }, {
        best: 'restaurant',
        good: ['restaurant'],
    }],

    // 5 choice with flags
    [{
        $root: '{restaurant [plural=one] | restaurants [ plural=other ] }',
    }, {
        best: 'restaurant',
        good: ['restaurant', 'restaurants'],
    }],

    // 6 placeholder
    [{
        table: 'restaurant',
        $root: 'find me a ${table}',
    }, {
        best: 'find me a restaurant',
        good: ['find me a restaurant'],
    }],

    // 7 placeholder with choice
    [{
        table: '{restaurant|food place|dining hall}',
        $root: 'find me a ${table}',
    }, {
        best: 'find me a restaurant',
        good: ['find me a restaurant', 'find me a food place', 'find me a dining hall']
    }],

    // 8 constrained placeholder, no flag in replacement
    [{
        table: 'restaurant',
        $root: 'find me a ${table[plural=one]}',
    },  {
        best: 'find me a restaurant',
        good: ['find me a restaurant'],
    }],

    // 9 constrained placeholder, ok flag in replacement
    [{
        table: 'restaurant [plural=one]',
        $root: 'find me a ${table[plural=one]}',
    }, {
        best: 'find me a restaurant',
        good: ['find me a restaurant'],
    }],

    // 10 constrained placeholder, choice with flag in replacement
    [{
        table: '{restaurant [plural=one]|restaurants [plural=other]}',
        $root: 'find me a ${table[plural=one]}',
    }, {
        best: 'find me a restaurant',
        good: ['find me a restaurant'],
        bad: ['find me a restaurants'],
    }],

    // 11
    [{
        table: '{restaurant [plural=one]|food place [plural=one]|restaurants [plural=other]}',
        $root: 'find me a ${table[plural=one]}',
    }, {
        best: 'find me a restaurant',
        good: ['find me a restaurant', 'find me a food place'],
        bad: ['find me a restaurants'],
    }],

    // 12 select flag
    [{
        table: '{restaurant [plural=one]|food place [plural=one]|restaurants [plural=other]}',
        $root: 'find me ${table[plural]:select:one{a ${table}} other{many ${table}}}',
    }, {
        best: 'find me a restaurant',
        good: ['find me a restaurant', 'find me a food place', 'find me many restaurants'],
        bad: ['find me a restaurants', 'find me many restaurant']
    }],

    // 13 select flag, propagate up
    [{
        table: '{restaurant [plural=one]|food place [plural=one]|restaurants [plural=other]}',
        what: `\${table[plural]:select:
            one {a \${table} [plural=one]}
            other {
                  many \${table} [plural=other]
                | one of many \${table} [plural=one]
            }
        }`,
        $root: '{find me ${what[plural=one]}|search for ${what[plural=other]}}',
    }, {
        best: 'find me a restaurant',
        good: [
            'find me a restaurant',
            'find me one of many restaurants',
            'search for many restaurants'
        ],
        bad: [
            'find me a restaurants',
            'find me many restaurant',
            'find me many restaurants',
            'search for a restaurant',
            'search for a restaurants'
        ]
    }],

    // 14 select key
    [{
        status: {
            text: '{sunny|bright}',
            value: {
                inner: 'sunny'
            }
        },
        $root: `{it is \${status} today | \${status.inner:select:
            sunny{
                the sun is shining today
            }
            cloudy{
                clouds in the sky
            }
        }}`,
    }, {
        best: 'it is sunny today',

        good: [
            'it is sunny today',
            'the sun is shining today',
            'it is bright today',
        ],
        bad: [
            'it is cloudy today',
            'clouds in the sky'
        ]
    }],

    // 15 plural rules
    [{
        results: {
            text: 'foo, bar, baz',
            value: ['foo', 'bar', 'baz']
        },
        $root: `i found \${results:plural:
            one{one result}
            other{\${results.length} results}
        }`,
    }, {
        best: 'i found 3 results',

        good: [
            'i found 3 results',
        ],
        bad: [
            'i found 3 result',
            'i found result',
            'i found foo, bar, baz results',
            'i found foo, bar, baz result',
        ]
    }],

    // 16 one filter table
    [{
        table_0: '{restaurant [plural=one]|restaurants [plural=other]}',
        filter_1: `{
              food equal to chinese [pos=base]
            | cuisine equal to chinese [pos=base]
            | chinese food [pos=property]
            | serves chinese [pos=verb,plural=one]
            | serve chinese [pos=verb,plural=other]
            | serves chinese food [pos=verb,plural=one]
            | serve chinese food [pos=verb,plural=other]
            | serving chinese food [pos=passive_verb]
            | chinese [pos=adjective]
        }`,
        $root: `\${filter_1[pos]:select:
          property{
            \${table_0} with \${filter_1} [table_type=with,plural=table_0[plural]]
           |\${table_0} that \${table_0[plural]:select:one{has}other{have}} \${filter_1} [table_type=which,plural=table_0[plural]]
          }
          base{
            \${table_0} with \${filter_1} [table_type=with,plural=table_0[plural]]
           |\${table_0} that \${table_0[plural]:select:one{has}other{have}} \${filter_1} [table_type=which,plural=table_0[plural]]
          }
          verb{
            \${table_0[plural=one]} that \${filter_1[plural=one]} [table_type=which,plural=one]
           |\${table_0[plural=other]} that \${filter_1[plural=other]} [table_type=which,plural=other]
          }
          reverse_verb{
           \${table_0} that \${filter_1} [table_type=which,plural=table_0[plural]]
          }
          adjective{
            \${table_0} that \${table_0[plural]:select:one{is}other{are}} \${filter_1} [table_type=which,plural=table_0[plural]]
           |\${filter_1} \${table_0} [table_type=clean,plural=table_0[plural]]
          }
          passive_verb{
            \${table_0} that \${table_0[plural]:select:one{is}other{are}} \${filter_1} [table_type=which,plural=table_0[plural]]
           |\${table_0} \${filter_1} [table_type=clean,plural=table_0[plural]]
          }
          preposition{
            \${table_0} that \${table_0[plural]:select:one{is}other{are}} \${filter_1} [table_type=which,plural=table_0[plural]]
           |\${table_0} \${filter_1} [table_type=clean,plural=table_0[plural]]
          }
       }`,
    }, {
        best: 'restaurant with chinese food',

        good: [
            'restaurant with chinese food',
            'restaurants with chinese food',
            'restaurants that have chinese food',
            'restaurant that serves chinese food',
            'restaurants that serve chinese food',
            'restaurants serving chinese food',
            'chinese restaurant',
            'restaurants that are chinese',
        ],

        bad: [
            'restaurants that has chinese food',
            'restaurants that serves chinese food',
            'restaurant that serve chinese food',
            'restaurant that chinese',
            'restaurant that chinese food',
            'chinese food restaurant',
            'serves chinese food restaurant',
            'restaurant that are chinese',
            'restaurants that serving chinese food',
        ]
    }],

    // 17 two filter table
    [{
        table_0: '{restaurant [plural=one]|restaurants [plural=other]}',
        filter_1: `{
              food equal to chinese [pos=base]
            | cuisine equal to chinese [pos=base]
            | chinese food [pos=property]
            | serves chinese [pos=verb,plural=one]
            | serve chinese [pos=verb,plural=other]
            | serves chinese food [pos=verb,plural=one]
            | serve chinese food [pos=verb,plural=other]
            | serving chinese food [pos=passive_verb]
            | chinese [pos=adjective]
        }`,
        filter_2: `{
              cheap [pos=adjective]
            | serving cheap food [pos=passive_verb]
            | cheap price [pos=property]
        }`,
        table_1: `\${filter_1[pos]:select:
          property{
            \${table_0} with \${filter_1} [table_type=with,plural=table_0[plural]]
           |\${table_0} that \${table_0[plural]:select:one{has}other{have}} \${filter_1} [table_type=which,plural=table_0[plural]]
          }
          base{
            \${table_0} with \${filter_1} [table_type=with,plural=table_0[plural]]
           |\${table_0} that \${table_0[plural]:select:one{has}other{have}} \${filter_1} [table_type=which,plural=table_0[plural]]
          }
          verb{
            \${table_0[plural=one]} that \${filter_1[plural=one]} [table_type=which,plural=one]
           |\${table_0[plural=other]} that \${filter_1[plural=other]} [table_type=which,plural=other]
          }
          reverse_verb{
           \${table_0} that \${filter_1} [table_type=which,plural=table_0[plural]]
          }
          adjective{
            \${table_0} that \${table_0[plural]:select:one{is}other{are}} \${filter_1} [table_type=which,plural=table_0[plural]]
           |\${filter_1} \${table_0} [table_type=clean,plural=table_0[plural]]
          }
          passive_verb{
            \${table_0} that \${table_0[plural]:select:one{is}other{are}} \${filter_1} [table_type=which,plural=table_0[plural]]
           |\${table_0} \${filter_1} [table_type=clean,plural=table_0[plural]]
          }
          preposition{
            \${table_0} that \${table_0[plural]:select:one{is}other{are}} \${filter_1} [table_type=which,plural=table_0[plural]]
           |\${table_0} \${filter_1} [table_type=clean,plural=table_0[plural]]
          }
       }`,
       $root: `\${filter_2[pos]:select:
          base{
            \${table_1[table_type]:select:
               clean{
                  \${table_1} with \${filter_2} [table_type=with,plural=table_1[plural]]
                 |\${table_1} that \${table_1[plural]:select:one{has}other{have}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               with{
                  \${table_1} and \${filter_2} [table_type=with,plural=table_1[plural]]
                 |\${table_1} that \${table_1[plural]:select:one{has}other{have}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               which{
                  \${table_1} and \${table_1[plural]:select:one{has}other{have}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
            }
          }
          property{
            \${table_1[table_type]:select:
               clean{
                  \${table_1} with \${filter_2} [table_type=with,plural=table_1[plural]]
                 |\${table_1} that \${table_1[plural]:select:one{has}other{have}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               with{
                  \${table_1} and \${filter_2} [table_type=with,plural=table_1[plural]]
                 |\${table_1} that \${table_1[plural]:select:one{has}other{have}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               which{
                  \${table_1} and \${table_1[plural]:select:one{has}other{have}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
            }
          }
          verb{
            \${table_1[table_type]:select:
               clean{
                  \${table_1[plural=one]} that \${filter_2[plural=one]} [table_type=which,plural=one]
                 |\${table_1[plural=other]} that \${filter_2[plural=other]} [table_type=which,plural=other]
               }
               with{
                  \${table_1[plural=one]} that \${filter_2[plural=one]} [table_type=which,plural=one]
                 |\${table_1[plural=other]} that \${filter_2[plural=other]} [table_type=which,plural=other]
               }
               which{
                  \${table_1[plural=one]} and \${filter_2[plural=one]} [table_type=which,plural=one]
                 |\${table_1[plural=other]} and \${filter_2[plural=other]} [table_type=which,plural=other]
               }
            }
          }
          reverse_verb{
            \${table_1[table_type]:select:
               clean{
                  \${table_1} that \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               with{
                  \${table_1} that \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               which{
                  \${table_1} and \${filter_2} [table_type=which,plural=table_1[plural]]
               }
            }
          }
          adjective{
            \${table_1[table_type]:select:
               clean{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${filter_2} \${table_1} [table_type=clean,plural=table_1[plural]]
               }
               with{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${filter_2} \${table_1} [table_type=with,plural=table_1[plural]]
               }
               which{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${filter_2} \${table_1} [table_type=which,plural=table_1[plural]]
               }
            }
          }
          passive_verb{
            \${table_1[table_type]:select:
               clean{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${table_1} \${filter_2} [table_type=clean,plural=table_1[plural]]
               }
               with{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
               which{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
            }
          }
          preposition{
            \${table_1[table_type]:select:
               clean{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${table_1} \${filter_2} [table_type=clean,plural=table_1[plural]]
               }
               with{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${table_1} \${filter_2} [table_type=with,plural=table_1[plural]]
               }
               which{
                  \${table_1} that \${table_1[plural]:select:one{is}other{are}} \${filter_2} [table_type=which,plural=table_1[plural]]
                 |\${table_1} \${filter_2} [table_type=which,plural=table_1[plural]]
               }
            }
          }
       }`
    }, {
        best: 'chinese restaurant with cheap price',

        // non exhaustive
        good: [
            'restaurants with chinese food and cheap price',
            'restaurants that serve chinese food and have cheap price',
            'restaurant that serves chinese food and has cheap price',
            'cheap restaurants with chinese food',
            'restaurants serving chinese food that are cheap',
            'cheap restaurants serving chinese food',
            'cheap restaurant that serves chinese food',
        ],

        bad: [
            'restaurants that serves chinese food with cheap price',
            'cheap restaurants and chinese food',
            'cheap restaurants that serves chinese food',
            'restaurants that serve chinese food and has cheap price',
            'restaurants that serve chinese food and cheap price',
            'restaurants that serve chinese and cheap',
            'restaurants that cheap and serve chinese food',
            'cheap price restaurants serving chinese food',
        ]
    }]
];

function test(rng, i) {
    console.log(`# Test Case ${i+1}`);

    try {
        const [templates, expected] = TEST_CASES[i];

        let root = null;

        const placeholders = Object.keys(templates);
        const replacements = [];
        for (const key in templates) {
            const tpl = templates[key];
            let parsed, replaced;
            if (typeof tpl === 'string') {
                try {
                    parsed = Replaceable.parse(tpl).preprocess('en-US', placeholders);
                } catch(e) {
                    console.log(`Failed to parse ${key}`);
                    throw e;
                }

                replaced = parsed.replace({ replacements, constraints: {} });
                if (replaced === null)
                    break;
                replacements[placeholders.indexOf(key)] = { text: replaced, value: {} };
            } else {
                try {
                    parsed = Replaceable.parse(tpl.text).preprocess('en-US', placeholders);
                } catch(e) {
                    console.log(`Failed to parse ${key}`);
                    throw e;
                }

                replaced = parsed.replace({ replacements, constraints: {} });
                if (replaced === null)
                    break;
                replacements[placeholders.indexOf(key)] = { text: replaced, value: tpl.value };
            }
            if (key === '$root') {
                root = replaced;
                break;
            }
        }

        if (root === null) {
            assert.strictEqual(null, expected);
        } else {
            //if (i === 13)
            //    console.log(util.inspect(root, { depth: null }));

            const best = root.chooseBest();
            assert.strictEqual(best, expected.best);

            for (const expectedRandom of expected.good) {
                let ok = false;
                for (let i = 0; i < 10000; i++) {
                    const random = root.chooseSample(rng);
                    if (random === expectedRandom) {
                        ok = true;
                        break;
                    }
                    if (expected.bad && expected.bad.includes(random))
                        throw new Error(`Generated bad sentence "${random}"`);
                }
                if (!ok)
                    throw new Error(`Failed to generate "${expectedRandom}" after 10000 attempts`);
            }
        }
    } catch(e) {
        if (process.env.TEST_MODE)
            throw e;
        console.error(`Test case ${i+1} failed with exception: ${e.message}`);
        console.error(e);
    }
}


export default function main() {
    const rng = seedrandom.alea('almond is awesome');

    for (let i = 0; i < TEST_CASES.length; i++)
        test(rng, i);
}
if (!module.parent)
    main();
