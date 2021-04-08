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

import * as ThingTalk from 'thingtalk';
const Type = ThingTalk.Type;

//TODO: some of the following could differ from domain to domain; we should allow domain override.

const BUILTIN_TYPEMAP = {
    Time: Type.Time,
    Number: Type.Number,
    Float: Type.Number,
    Integer: Type.Number,
    Text: Type.String,
    Boolean: Type.Boolean,
    DateTime: Type.Date,
    Date: Type.Date,
    DataType: Type.String, // for lack of a better type
    URL: new Type.Entity('tt:url'),
    ImageObject: new Type.Entity('tt:picture'),
    Barcode: new Type.Entity('tt:picture'),

    Mass: new Type.Measure('kg'),
    Energy: new Type.Measure('kcal'),
    Distance: new Type.Measure('m'),
    Duration: new Type.Measure('ms'),

    GeoCoordinates: Type.Location,
    MonetaryAmount: Type.Currency,

    QuantitativeValue: Type.String // for lack of a better type
};


const BLACKLISTED_TYPES = new Set([
    'QualitativeValue', 'PropertyValue', 'BedType', 'MedicalBusiness',

    // buggy, causes Audience to turn into an enum
    'Researcher',
]);

const BLACKLISTED_PROPERTIES = new Set([
    'sameAs', 'affiliation', 'mainEntityOfPage',
    'embedUrl',

    // FIXME we want to black-list aggregateRating.itemReviewed but not Review.itemReviewed...
    'itemReviewed',

     // This is used as the range of rating
    'bestRating', 'worstRating',

    // renamed to description during normalization
    'reviewBody',

    // this causes a loop in PriceSpecification, which turns PriceSpecification into an Entity and that sucks
    'eligibleTransactionVolume',
    // same thing, causes a loop in Offer which is bad
    'addOn',

    // not particularly useful, and kind of confusing
    'areaServed',

    // handled specially by normalization
    'priceCurrency',

    // movie properties
    'dateCreated',
    'thumbnailUrl',
    'trailer',

    // hotel properties: we ended up not using brand
    'brand'

]);

const BLACKLISTED_PROPERTIES_BY_DOMAIN = {
    movies: ['author']
};

const STRUCTURED_HIERARCHIES = [
    'StructuredValue', 'Rating', // Offer (Offer introduce a loop in the latest version of schema.org)

    // FIXME Review is too messy to represent as a structured value, either you lose info or you get cycles
    // 'Review'
];

const NON_STRUCT_TYPES = new Set([
]);

const PROPERTY_FORCE_ARRAY = new Set([
    'worksFor',

    'recipeCuisine',
    'recipeCategory',
]);

const PROPERTY_FORCE_NOT_ARRAY = new Set([
    'offers',
    'starRating'
]);

const PROPERTY_TYPE_OVERRIDE = {
    'telephone': new Type.Entity('tt:phone_number'),
    'email': new Type.Entity('tt:email_address'),
    'faxNumber': new Type.Entity('tt:phone_number'),
    'image': new Type.Entity('tt:picture'),
    'logo': new Type.Entity('tt:picture'),
    'checkinTime': Type.Time,
    'checkoutTime': Type.Time,
    'price': Type.Currency,

    'weight': new Type.Measure('ms'),
    'depth': new Type.Measure('m'),
    'description': Type.String,
    'addressCountry': new Type.Entity('tt:country'),
    'addressRegion': new Type.Entity('tt:us_state'),

    // we want to prefer VideoObject to the default Clip
    'video': new Type.Entity('org.schema:VideoObject'),

    // we want to prefer Organization to the default Person
    'publisher': new Type.Entity('org.schema:Organization'),

    // weird number like things, but mostly text
    'recipeYield': Type.String,

    'genre': new Type.Array(Type.String),
    'creator': new Type.Array(new Type.Entity('org.schema.Movie:Person')),
    'contentRating': Type.String,
    'byArtist': new Type.Entity('org.schema.Music:Person'),

    'openingHours': Type.RecurrentTimeSpecification,
    'priceRange': new Type.Enum(['cheap', 'moderate', 'expensive', 'luxury']),
    'workLocation': Type.Location,

    'inLanguage': new Type.Entity('tt:iso_lang_code'),
    'knowsLanguage': new Type.Array(new Type.Entity('tt:iso_lang_code'))
};

// Base canonical override
// This is limited to one canonical per property (as if we replaced the property name)
const PROPERTY_NAME_OVERRIDE_BY_DOMAIN = {
    'restaurants': {
        'starRating.ratingValue': 'michelinStar'
    },
    'hotels': {
        'starRating.ratingValue': 'star'
    },
    'people': {
        'address.addressLocality': 'homeLocation'
    }
};

const PROPERTY_CANONICAL_OVERRIDE = {
    // thing
    url: {
        base: ['url', 'link']
    },
    name: {
        base: ['name'],
        passive_verb: ['called']
    },
    description: {
        base: ['description', 'summary'],
    },
    image: {
        base: ['picture', 'image', 'photo']
    },

    // location
    'geo': {
        base: ['location', 'address'],
        preposition: ["in #", "from #", "around #", "at #", "on #"]
    },
    'postalCode': {
        base: ['postal code', 'postcode', 'zip code'],
        preposition: ['in #', 'from #', 'in the # zip code'],
    },
    /*
    'streetAddress': {
        base: ['street']
    },
    'addressLocality': {
        base: ['city'],
        preposition: ["in #", "from #"],
    },*/
    'addressCountry': {
        preposition: ["in #", "from #"],
        base: ["country"]
    },
    'addressRegion': {
        preposition: ["in #", "from #"],
        base: ["state"]
    }
};

const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {
    // restaurants
    'datePublished': {
        passive_verb: ["published on #", "written on #"],
        base: ["date published"],
        adjective_argmax: ['most recent', 'latest', 'last', 'newest'],
        adjective_argmin: ['earliest', 'first', 'oldest'],
        base_projection: ['date', 'year'],
        passive_verb_projection: ['published | on', 'written | on']
    },
    'ratingValue': {
        passive_verb: ["rated # star"],
        base: ["rating", "overall rating", "average rating", "customer rating", "review rating"],
        adjective: ['# star'],
        adjective_argmax: ['top-rated', 'best'],
        projection_pronoun: ['how'],
        passive_verb_projection: ['rated']
    },
    'reviewRating': {
        base: ["rating"]
    },
    'telephone': {
        base: ["telephone", "phone number"]
    },
    'servesCuisine': {
        adjective: ["#"],
        verb: ["serves # cuisine", "serves # food", "offer # cuisine", "offer # food", "serves", "offers"],
        property: ["# cuisine", "# food"],
        base: ["cuisine", "food type"],
        base_projection: ["food", "cuisine"],
        verb_projection: ["serve", "offer", "have"],
    },
    'priceRange': {
        base: ['price range'],
        adjective: ["#"],
    },
    'openingHours': {
        verb: ["opens at", "opens on"],
        verb_projection: ['open', 'close']
    },
    'acceptsReservation': {
        verb_true: ["accepts reservation"]
    },
    'smokingAllowed': {
        property_true: ['smoking allowed'],
        property_false: ['no smoking'],
        verb_true: ['allows smoking']
    },
    author: {
        base: ['author'],
        preposition: ['by'],
        passive_verb: [
            'written by', 'authored by', 'uploaded by', 'submitted by'
        ],
        verb: ['# wrote', '# authored'],
        base_projection: ['author', 'creator'],
        reverse_verb_projection: ['wrote', 'authored'],
        passive_verb_projection: ['written | by', 'authored | by']
    },

    // hotels
    'amenityFeature': {
        base: ['amenity', 'amenity feature'],
        verb: ['offers #', 'offer #', 'has #', 'have #'],
        base_projection: ['amenity'],
        verb_projection: ['']
    },
    'checkinTime': {
        base: ['checkin time', 'check in time', 'check-in time']
    },
    'checkoutTime': {
        base: ['checkout time', 'check out time', 'check-out time']
    },
    'petsAllowed': {
        property_true: ['pets allowed'],
        property_false: ['no pets allowed'],
        verb_true: ['allows pets', 'accepts pets', 'accepts dog'],
        adjective_true: ['pets friendly', 'dog friendly']
    },

    // linkedin
    alumniOf: {
        base: ['college degrees', 'universities', "alma maters"],
        reverse_property: [
        // who is an alumnus of Stanford
        "alumni of #", "alumnus of #", "alumna of #",
        // who is a Stanford alumnus
        "# alumnus", "# alumni", "# grad", "# graduate"
        ],
        verb: [
        // who went to Stanford
        "went to #", "graduated from #", "attended #", "studied at #"
        ],
        passive_verb: [
        // who was educated at Stanford ...
        "educated at #"
        ],
        base_projection: ['college'],
        verb_projection: ['graduate | from', 'go to', 'attend', 'study at'],
        passive_verb_projection: ['educated | at',]

    },
    award: {
        base: ['awards', 'prize'],
        reverse_property: [
            // who is a nobel prize winner
            'winner of #', 'recipient of #',
            '# winner', '# awardee', '# recipient', '# holder',
        ],
        verb: [
        "has the award #", "has received the # award", "won the award for #", "won the # award",
        "received the # award", "received the #", "won the #", "won #", "holds the award for #", "holds the # award"
        ],
        base_projection: ['award', 'prize'],
        verb_projection: ['win', 'hold'],
        passive_verb: ['received'],
    },
    worksFor: {
        base: ['employers'],
        reverse_property: [
            'employee of #', '# employee'
        ],
        verb: ['works for #', 'works at #', 'worked at #', 'worked for #'],
        passive_verb: [
            'employed at #', 'employed by #',
        ],
        base_projection: ['company', 'employer'],
        verb_projection: ['work for', 'work | at']
    },
    jobTitle: {
        base: ['job title', 'position', 'title'],
        reverse_property: ['#']
    },
    knowsLanguage: {
        base: ['languages mastered'],
        verb: ['knows', 'masters', 'understands'],
        base_projection: ['language'],
        verb_projection: ['know', 'understand', 'master'],
        adjective: ['# speaking']
    },
    addressLocality: {
        base: ['city', 'town', 'area'],
        preposition: ["in #", "from #"],
    },

    // recipes
    publisher: {
        base: ['publisher'],
        preposition: ['by'],
        passive_verb: [
            'made by', 'published by'
        ],
    },

    prepTime: {
        verb: ['takes # to prepare', 'needs # to prepare'],
        base: ['prep time', 'preparation time', 'time to prep', 'time to prepare']
    },
    cookTime: {
        verb: ['takes # to cook', 'needs # to cook'],
        base: ['cook time', 'cooking time', 'time to cook']
    },
    totalTime: {
        verb: ['takes #', 'requires #', 'needs #', 'uses #', 'consumes #'],
        base: ['total time', 'time in total', 'time to make']
    },
    recipeYield: {
        verb: ['yields #', 'feeds #', 'produces #', 'results in #', 'is good for #'],
        passive_verb: ['yielding #'],
        base: ['yield amount', 'yield size']
    },
    recipeCategory: {
        adjective: ["#"],
        base: ['categories']
    },
    recipeIngredient: {
        adjective: ["#"],
        verb: ['contains', 'uses', 'has'],
        passive_verb: ['containing', 'using'],
        base: ['ingredients']
    },
    recipeInstructions: {
        base: ['instructions']
    },
    recipeCuisines: {
        adjective: ["#"],
        verb: ['belongs to the # cuisine'],
        base: ['cuisines', 'cuisine']
    },
    reviewBody: {
        base: ['body', 'text', 'content']
    },
    saturatedFatContent: {
        base: ['saturated fat content', 'saturated fat amount', 'saturated fat', 'trans fat']
    },

    // product
    mpn: {
        base: ['manufacturer part number']
    },
    color: {
        base: ['color'],
        adjective: ['#'],
        preposition: ['in #']
    },
    model: {
        base: ['model'],
        implicit_identity: true
    },
    brand: {
        base: ['brand'],
        adjective: ['#'],
        preposition: ['by', 'from'],
        passive_verb: ['manufactured by #', 'made by #']
    },

    // books
    inLanguage: {
        base: ['language'],
        adjective: ['#'],
        preposition: ['in'],
        passive_verb: ['written in #'],
        reverse_property: ['# version of'],
        base_projection: ['language'],
        preposition_projection: ['in'],
        passive_verb_projection: ['written | in']
    },
    bookEdition: {
        base: ['edition'],
        reverse_property: ['# of']
    },
    bookFormat: {
        base: ['format'],
        preposition: ['in #', 'in # format']
    },
    numberOfPages: {
        base: ['number of pages'],
        property: ['# pages'],
        adjective_argmax: ['longest'],
        adjective_argmin: ['shortest']
    },
    abridged: {
        adjective_true: ['abridged']
    },

    // movies
    contentRating: {
        base: ['content rating'],
        adjective: ['# rated', '#-rated'],
        passive_verb: ['rated #']
    },
    genre: {
        base: ['genre'],
        adjective: ['#']
    },
    creator: {
        base: ['creator', 'producer'],
        passive_verb: ['created by', 'produced by', 'made by'],
        verb: ['# created', '# creates', '# produced', '# made'],
        base_projection: ['creator', 'producer'],
        reverse_verb_projection: ['created', 'produced', 'made'],
        passive_verb_projection: ['created | by', 'produced | by', 'made | by']
    },
    duration: {
        base: ['duration', 'length'],
        adjective: ['# long'],
        adjective_argmax: ['longest'],
        adjective_argmin: ['shortest']
    },
    actor: {
        base: ['actor', 'actress'],
        property: ['#', '# in the cast'],
        passive_verb: ['played by', 'acted by'],
        verb: ['stars', '# acted', '# acted in', '# was in'],
        base_projection: ['actor', 'actress'],
        verb_projection: ['have'],
        reverse_verb_projection: ['acted in'],
        preposition_projection: ['in']
    },
    director: {
        base: ['director'],
        passive_verb: ['directed by'],
        verb: ['# directs', '# directed'],
        reverse_verb_projection: ['directed']
    },

    // music
    inAlbum: {
        base: ['album'],
        preposition: ['in', 'in album', 'on', 'on album', 'from', 'from album'],
        passive_verb: ['included in #'],
        verb: ['appears in #', 'appears on #', '# have', '# has', '# contains', '# includes'],
        base_projection: ['album'],
        verb_projection: ['appear | in', 'appear | on'],
        reverse_verb_projection: ['have', 'has', 'contain', 'contains', 'includes'],
        passive_verb_projection: ['included | in', 'included | on'],
        preposition_projection: ['in', 'on']
    },
    byArtist: {
        base: ['artist', 'singer', 'band'],
        adjective: ['# \'s', '#'],
        preposition: ['by', 'by artist'],
        passive_verb: ['created by', 'sang by', 'performed by', 'released by'],
        verb: ['# sings', '# sang', '# release', '# publish'],
        base_projection: ['artist', 'singer', 'band'],
        passive_verb_projection: ['created | by', 'sang | by', 'performed | by'],
        reverse_verb_projection: ['sing', 'sang']
    },
    numTracks: {
        base: ['number of tracks', 'number of songs']
    }
};

const MANUAL_COUNTED_OBJECT_OVERRIDE = {
    numTracks: ['tracks', 'songs']
};

const MANUAL_PROPERTY_CANONICAL_OVERRIDE_BY_DOMAIN = {
    'restaurants': {
        'starRating.ratingValue': {
            base: ["michelin star rating", "michelin rating", "michelin star"],
            adjective: ["michelin # star", "michelin # star"],
            passive_verb: ["rated # star by michelin guide"]
        }
    },
    'hotels': {
        'aggregateRating.ratingValue': {
            passive_verb: ["rated # star"],
            base: ["rating", "overall rating", "average rating", "customer rating", "review rating"],
            adjective_argmax: ['top-rated', 'best'],
            projection_pronoun: ['how'],
            passive_verb_projection: ['rated']
        },
        'starRating.ratingValue': {
            base: ["star rating"],
            property: ["# stars"],
            adjective: ["# star"]
        }
    }
};

const TABLE_CANONICAL_OVERRIDE = {
    'MusicRecording': 'song',
    'MusicAlbum': 'album'
};

const MANUAL_TABLE_CANONICAL_OVERRIDE = {
    'Restaurant': ['restaurant', 'diner', 'place', 'joint', 'eatery', 'canteen', 'cafeteria', 'cafe'],
    'Hotel': ['hotel', 'resort', 'lodging', 'motel', 'place'],
    'MusicRecording': ['song', 'music recording', 'music'],
    'MusicAlbum': ['album']
};

const PROPERTIES_NO_FILTER = [
    'name', // no filter on name, if the id has ner support, we'll generate prim for it
    'description', // we consider a question not answerable if we don't have specific property for it

    'telephone',
    'email',
    'faxNumber',
    'hasMap',

    // ID properties or opaque strings
    'gtin13',
    'productID',
    'mpn'
];

const PROPERTIES_DROP_WITH_GEO = [
    'streetAddress', // street address and address locality should be handled by geo
    'addressLocality'
];

// HACK: certain structured types want to get the name & description property from Thing
const STRUCT_INCLUDE_THING_PROPERTIES = new Set([
    'LocationFeatureSpecification'
]);


const STRING_FILE_OVERRIDES = {
    'org.schema.Restaurant:Restaurant_name': 'org.openstreetmap:restaurant',
    'org.schema.Person:Person_name': 'tt:person_full_name',
    'org.schema.Person:Person_address_addressLocality': 'tt:location',
    'org.schema.Person:Person_alumniOf': 'tt:university_names',
    'org.schema.Person:Person_worksFor': 'tt:company_name',
    'org.schema.Person:Person_jobTitle': 'tt:job_title',
    'org.schema.Hotel:Hotel_name': 'org.openstreetmap:hotel',
    'org.schema.Music:MusicRecording_byArtist': 'tt:song_artist',
    'org.schema.Music:MusicAlbum_byArtist': 'tt:song_artist',
    'org.schema.Music:MusicRecording_inAlbum': 'tt:song_album',
    'org.schema.Music:MusicRecording_name': 'tt:song_name',
    'org.schema.Music:CreativeWork_genre': 'com.spotify:genre',
    'org.schema.Book:Book_name': 'tt:book_name'
};

// maps old name to new name
const PROPERTY_RENAMES = {
    'checkInTime': 'checkinTime',
    'checkOutTime': 'checkoutTime',
    'AggregateRating': 'aggregateRating',
    'awards': 'award',

    // clean up property ambiguity by consolidating to one property
    'reviewBody': 'description',
};

// enum normalization
const ENUM_VALUE_NORMALIZE = {
    'itemCondition': {
        'New': 'NewCondition',
        'BrandNew': 'NewCondition',
        'NewWithBox': 'NewCondition',
        'NewWithTags': 'NewCondition',
        'NewWithoutTags': 'UsedCondition',
        'OpenBox': 'UsedCondition',
        'Used': 'UsedCondition',
        'ManufacturerRefurbished': 'RefurbishedCondition',
        'SellerRefurbished': 'RefurbishedCondition',
        '--notSpecified': undefined
    }
};

const WHITELISTED_PROPERTIES_BY_DOMAIN = {
    'restaurants': ['acceptsReservations', 'starRating', 'starRating.ratingValue', 'openingHours', 'email', 'smokingAllowed', 'priceRange'],
    'hotels': ['petsAllowed', 'starRating', 'starRating.ratingValue', 'priceRange', 'email', 'faxNumber'],
    'people': ['jobTitle', 'email', 'telephone', 'faxNumber', 'knowsLanguage', 'workLocation'],
    'linkedin': ['jobTitle', 'email', 'telephone', 'faxNumber', 'knowsLanguage', 'workLocation'],
    'books': ['abridged', 'datePublished'],
    'music': ['genre', 'datePublished', 'inLanguage', 'duration', 'numTracks']
};


export {
    BUILTIN_TYPEMAP,

    BLACKLISTED_TYPES,
    BLACKLISTED_PROPERTIES,
    BLACKLISTED_PROPERTIES_BY_DOMAIN,
    WHITELISTED_PROPERTIES_BY_DOMAIN,

    STRUCTURED_HIERARCHIES,
    NON_STRUCT_TYPES,
    PROPERTY_CANONICAL_OVERRIDE,
    PROPERTY_NAME_OVERRIDE_BY_DOMAIN,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE_BY_DOMAIN,
    TABLE_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,
    MANUAL_COUNTED_OBJECT_OVERRIDE,

    PROPERTY_FORCE_NOT_ARRAY,
    PROPERTY_FORCE_ARRAY,
    PROPERTY_TYPE_OVERRIDE,

    PROPERTIES_NO_FILTER,
    PROPERTIES_DROP_WITH_GEO,
    STRUCT_INCLUDE_THING_PROPERTIES,

    STRING_FILE_OVERRIDES,

    PROPERTY_RENAMES,
    ENUM_VALUE_NORMALIZE
};
