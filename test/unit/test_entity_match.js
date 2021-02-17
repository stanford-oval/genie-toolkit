

import { getBestEntityMatch } from '../../lib/dialogue-agent/entity-linking/entity-finder';

const TEST_CASES = [
    [
        "bohemian rhapsody",
        "spotify:track:6l8GvAyoUZwWDgF1e4822w",
        "com.spotify:song",
        [{
            type: 'com.spotify:song',
            value: 'spotify:track:7tFiyTwD0nx5a1eklYtX2J',
            canonical: 'bohemian rhapsody - 2011 mix',
            name: 'Bohemian Rhapsody - 2011 Mix'
        },
        {
            type: 'com.spotify:song',
            value: 'spotify:track:6l8GvAyoUZwWDgF1e4822w',
            canonical: 'bohemian rhapsody',
            name: 'Bohemian Rhapsody',
        },
        {
            type: 'com.spotify:song',
            value: 'spotify:track:3Rvjhi2fdHU7qLIv4a4MCy',
            canonical: 'bohemian rhapsody - live aid',
            name: 'Bohemian Rhapsody - Live Aid',
        }
        ]
    ],
    [
        "hotel california",
        "spotify:track:2ilnn2pGrYpFPc1H4qhp7t",
        "com.spotify:song",
        [{
            type: 'com.spotify:song',
            value: 'spotify:track:40riOy7x9W7GXjyGp4pjAv',
            canonical: 'hotel california - 2013 remaster',
            name: 'Hotel California - 2013 Remaster'
        },
        {
            type: 'com.spotify:song',
            value: 'spotify:track:2ilnn2pGrYpFPc1H4qhp7t',
            canonical: 'hotel california',
            name: 'Hotel California',
        },
        {
            type: 'com.spotify:song',
            value: 'spotify:track:5nS9WEWYnbQDBAe81SHhDP',
            canonical: 'hotel california (cover)',
            name: 'Hotel California (Cover)',
        },
        ]
    ],
    [
        "eye of the tiger",
        "spotify:track:2KH16WveTQWT6KOG9Rg6e2",
        "com.spotify:song",
        [{
            type: 'com.spotify:song',
            value: 'spotify:track:2KH16WveTQWT6KOG9Rg6e2',
            canonical: 'eye of the tiger',
            name: 'Eye of the Tiger'
        },
        {
            type: 'com.spotify:song',
            value: 'spotify:track:156zRgKOtm3Q3e2XV6UYjy',
            canonical: 'eye of the tiger - 2006 master',
            name: 'Eye of the Tiger - 2006 Master',
        },
        {
            type: 'com.spotify:song',
            value: 'spotify:track:0R85QWa6KRzB8p44XXE7ky',
            canonical: 'the eye of the tiger',
            name: 'The Eye of the Tiger',
        }
        ]
    ],
    [
        "taylor swift",
        "spotify:artist:06HL4z0CvFAxyc27GXpf02",
        "com.spotify:artist",
        [{
            type: 'com.spotify:artist',
            value: 'spotify:artist:06HL4z0CvFAxyc27GXpf02',
            canonical: 'taylor swift',
            name: 'Taylor Swift'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:5WiLThuSBwqF7SMRrzQbG6',
            canonical: 'taylor swiftman',
            name: 'Taylor Swiftman'
        }
        ]
    ],
    [
        "michael jackson",
        "spotify:artist:3fMbdgg4jU18AjLCKBhRSm",
        "com.spotify:artist",
        [{
            type: 'com.spotify:artist',
            value: 'spotify:artist:3fMbdgg4jU18AjLCKBhRSm',
            canonical: 'michael jackson',
            name: 'Michael Jackson'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:4WwJ1B8pIgerhgbFpaCLah',
            canonical: 'michael jackson jr',
            name: 'Michael Jackson Jr'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:3s9XxUSCzrvScn1ZZ4q2sK',
            canonical: 'jeffrey michael jackson',
            name: 'Jeffrey Michael Jackson'
        },
        ]
    ],
    [
        "drake",
        "spotify:artist:3TVXtAsR1Inumwj472S9r4",
        "com.spotify:artist",
        [{
            type: 'com.spotify:artist',
            value: 'spotify:artist:3TVXtAsR1Inumwj472S9r4',
            canonical: 'drake',
            name: 'Drake'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:0p4ViyfJUTW0IT4SCBLexf',
            canonical: 'drakeo the ruler',
            name: 'Drakeo the Ruler'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:5c3GLXai8YOMid29ZEuR9y',
            canonical: 'nick drake',
            name: 'Nick Drake'
        },
        ]
    ],
    [
        "maroon 5",
        "spotify:artist:04gDigrS5kc9YWfZHwBETP",
        "com.spotify:artist",
        [{
            type: 'com.spotify:artist',
            value: 'spotify:artist:04gDigrS5kc9YWfZHwBETP',
            canonical: 'maroon 5',
            name: 'Maroon 5'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:3ZnbHqf6qeVB52jlbWB7f3',
            canonical: 'karaoke - maroon 5',
            name: 'Karaoke - Maroon 5'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:7yelyOYYjMhK8wifmIlX1o',
            canonical: 'move like jagger originally performed by maroon 5 feat.c.aguillera',
            name: 'Move Like Jagger Originally Performed By Maroon 5 Feat.C.Aguillera'
        },
        ]
    ],
    [
        "physical graffiti",
        "spotify:album:1lZahjeu4AhPkg9JARZr5F",
        "com.spotify:album",
        [{
            type: 'com.spotify:album',
            value: 'spotify:album:1lZahjeu4AhPkg9JARZr5F',
            canonical: 'physical graffiti (1994 remaster)',
            name: 'Physical Graffiti (1994 Remaster)'
        },
        {
            type: 'com.spotify:album',
            value: 'spotify:album:5eJll4BBJx3Q1Dx2up8pvL',
            canonical: 'physical graffiti - ep',
            name: 'Physical Graffiti - EP'
        },
        {
            type: 'com.spotify:album',
            value: 'spotify:album:0JpERbnfgcW2UYkdgmhlkR',
            canonical: 'physical graffiti',
            name: 'Physical Graffiti'
        },
        ]
    ],
    [
        "night visions",
        "spotify:album:6htgf3qv7vGcsdxLCDxKp8",
        "com.spotify:album",
        [{
            type: 'com.spotify:album',
            value: 'spotify:album:6htgf3qv7vGcsdxLCDxKp8',
            canonical: 'night visions',
            name: 'Night Visions'
        },
        {
            type: 'com.spotify:album',
            value: 'spotify:album:1rzDtYMpZDhRgKNigB467r',
            canonical: 'night visions (deluxe)',
            name: 'Night Visions (Deluxe)'
        },
        {
            type: 'com.spotify:album',
            value: 'spotify:album:3cFiO23k0UiNm4PCKa8217',
            canonical: 'night visions (prelude)',
            name: 'Night Visions (Prelude)'
        },
        ]
    ],
    [
        "the wall",
        "spotify:album:5Dbax7G8SWrP9xyzkOvy2F",
        "com.spotify:album",
        [{
            type: 'com.spotify:album',
            value: 'spotify:album:5Dbax7G8SWrP9xyzkOvy2F',
            canonical: 'the wall',
            name: 'The Wall'
        },
        {
            type: 'com.spotify:album',
            value: 'spotify:album:283NWqNsCA9GwVHrJk59CG',
            canonical: "the writing's on the wall",
            name: "The Writing's On The Wall"
        },
        {
            type: 'com.spotify:album',
            value: 'spotify:album:2ZytN2cY4Zjrr9ukb2rqTP',
            canonical: 'off the wall',
            name: 'Off the Wall'
        },
        ]
    ],
    [
        "beatles",
        "spotify:artist:3WrFJ7ztbogyGnTHbHJFl2",
        "com.spotify:artist",
        [{
            type: 'com.spotify:artist',
            value: 'spotify:artist:3WrFJ7ztbogyGnTHbHJFl2',
            canonical: 'the beatles',
            name: 'The Beatles'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:5o723EMxNulM5ydXRh7Qkk',
            canonical: "the beatles complete on ukulele",
            name: "The Beatles Complete On Ukulele"
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:2FzAxY7Uqnr32pF7L0nK3c',
            canonical: 'beatless',
            name: 'Beatless'
        },
        {
            type: 'com.spotify:artist',
            value: 'spotify:artist:3YojAkU7hiAalEunJy55JW',
            canonical: 'beatles',
            name: 'beatles',
        }
        ]
    ],
];

async function main() {
    let failed = false;
    for (let i = 0; i < TEST_CASES.length; i++) {
        const [searchKey, expected, type, candidates] = TEST_CASES[i];
        const generated = getBestEntityMatch(searchKey, type, candidates);
        if (generated.value !== expected) {
            console.error(`Test Case ${i+1} failed`);
            console.error(`Expected: ${expected}`);
            console.error(`Generated: ${generated.value}`);
            failed = true;
        }
    }
    if (failed)
        throw new Error('testEntityMatch FAILED');

}
export default main;
if (!module.parent)
    main();
