// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const BUILTIN_TYPEMAP = {
    Time: Type.Time,
    Number: Type.Number,
    Float: Type.Number,
    Integer: Type.Number,
    Text: Type.String,
    Boolean: Type.Boolean,
    DateTime: Type.Date,
    Date: Type.Date,
    DataType: Type.Any,
    URL: Type.Entity('tt:url'),
    ImageObject: Type.Entity('tt:picture'),
    Barcode: Type.Entity('tt:picture'),

    Mass: Type.Measure('kg'),
    Energy: Type.Measure('kcal'),
    Distance: Type.Measure('m'),
    Duration: Type.Measure('ms'),

    GeoCoordinates: Type.Location,
    MonetaryAmount: Type.Currency,

    QuantitativeValue: Type.Any
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

]);

const STRUCTURED_HIERARCHIES = [
    'StructuredValue', 'Rating', 'Offer',

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
    'offers'
]);

const PROPERTY_TYPE_OVERRIDE = {
    'telephone': Type.Entity('tt:phone_number'),
    'email': Type.Entity('tt:email_address'),
    'image': Type.Entity('tt:picture'),
    'logo': Type.Entity('tt:picture'),
    'checkinTime': Type.Time,
    'checkoutTime': Type.Time,
    'price': Type.Currency,

    'weight': Type.Measure('ms'),
    'depth': Type.Measure('m'),
    'description': Type.String,
    'addressCountry': Type.Entity('tt:country'),
    'addressRegion': Type.Entity('tt:us_state'),

    // we want to prefer VideoObject to the default Clip
    'video': Type.Entity('org.schema:VideoObject'),

    // we want to prefer Organization to the default Person
    'publisher': Type.Entity('org.schema:Organization'),

    // weird number like things, but mostly text
    'recipeYield': Type.String,

    'genre': Type.Array(Type.String),
    'creator': Type.Array(Type.Entity('org.schema.Movie:Person')),
    'contentRating': Type.String,

    'byArtist': Type.Entity('org.schema.Music:Person')
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
        passive_verb: ["in #", "around #", "at #", "on #"]
    },
    'streetAddress': {
        base: ['street']
    },
    'addressCountry': {
        passive_verb: ["in #"],
        base: ["country"]
    },
    'addressRegion': {
        passive_verb: ["in #"],
        base: ["state"]
    },
    'addressLocality': {
        base: ['city']
    }
};

const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {
    // restaurants
    'datePublished': {
        passive_verb: ["published on #", "written on #"],
        base: ["date published"]
    },
    'ratingValue': {
        passive_verb: ["rated # star"],
        base: ["rating"]
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
        base: ["cuisine", "food type"]
    },

    // hotels
    'amenityFeature': {
        base: ['amenity', 'amenity feature'],
        verb: ['offers #', 'offer #', 'has #', 'have #'],
    },
    'checkinTime': {
        base: ['checkin time', 'check in time', 'check-in time']
    },
    'checkoutTime': {
        base: ['checkout time', 'check out time', 'check-out time']
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
        "educated at #", "graduated from #"
        ]
    },
    award: {
        base: ['awards'],
        reverse_property: [
            // who is a nobel prize winner
            'winner of #', 'recipient of #',
            '# winner', '# awardee', '# recipient', '# holder',
        ],
        verb: [
        "has the award #", "has received the # award", "won the award for #", "won the # award",
        "received the # award", "received the #", "won the #", "won #", "holds the award for #", "holds the # award"
        ]
    },
    affiliation: {
        base: ['affiliations'],
        reverse_property: [
            'member of #'
        ],
        passive_verb: [
            'affiliated with #', 'affiliated to #'
        ]
    },
    worksFor: {
        base: ['employers'],
        reverse_property: [
            'employee of #', '# employee'
        ],
        verb: ['works for #', 'works at #', 'worked at #', 'worked for #'],
        passive_verb: [
            'employed at #', 'employed by #',
        ]
    },

    // recipes
    author: {
        base: ['author', 'creator'],
        passive_verb: [
            'by', 'made by', 'written by', 'created by', 'authored by', 'uploaded by', 'submitted by'
        ]
    },
    publisher: {
        base: ['publisher'],
        passive_verb: [
            'by', 'made by', 'published by'
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
        passive_verb: ['in #']
    },
    model: {
        base: ['model'],
        implicit_identity: true
    },
    brand: {
        base: ['brand'],
        adjective: ['#'],
        passive_verb: ['by #', 'manufactured by #', 'made by #', 'from #']
    },

    // books
    inLanguage: {
        base: ['language'],
        adjective: ['#'],
        passive_verb: ['in #', 'written in #'],
        reverse_property: ['# version of']
    },
    bookEdition: {
        base: ['edition'],
        reverse_property: ['# of']
    },
    bookFormat: {
        base: ['format'],
        passive_verb: ['in #', 'in # format']
    },
    numberOfPages: {
        base: ['number of pages'],
        property: ['# pages']
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
        passive_verb: ['created by', 'produced by']
    },
    dateCreated: {
        base: ['date created'],
        passive_verb: ['created on #']
    },
    duration: {
        base: ['duration', 'length'],
        adjective: ['# long']
    },
    actor: {
        base: ['actor', 'actress'],
        property: ['#'],
        passive_verb: ['played by', 'acted by']
    },
    director: {
        base: ['director'],
        passive_verb: ['directed by']
    }
};

const MANUAL_TABLE_CANONICAL_OVERRIDE = {
    'Restaurant': ['restaurant', 'diner', 'place', 'joint', 'eatery', 'canteen', 'cafeteria', 'cafe'],
    'Hotel': ['hotel', 'resort', 'lodging', 'model', 'place']
};

const PROPERTIES_NO_FILTER = [
    'name', // no filter on name, if the id has ner support, we'll generate prim for it
    'description', // we consider a question not answerable if we don't have specific property for it
    'priceRange',
    'brand',

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
    'org.schema.Restaurant:Restaurant_name': 'com.yelp:restaurant_names',
    'org.schema.Person:Person_name': 'tt:person_full_name',
    'org.schema.Person:Person_alumniOf': 'tt:university_names',
    'org.schema.Person:Person_worksFor': 'tt:company_name',
    'org.schema.Hotel:Hotel_name': 'tt:hotel_name',
    'org.schema.Music:MusicRecording_byArtist': 'tt:song_artist',
    'org.schema.Music:MusicAlbum_byArtist': 'tt:song_artist',
    'org.schema.Music:MusicRecording_inAlbum': 'tt:song_album',
    'org.schema.Music:MusicRecording_name': 'tt:song_name',
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


module.exports = {
    BUILTIN_TYPEMAP,

    BLACKLISTED_TYPES,
    BLACKLISTED_PROPERTIES,

    STRUCTURED_HIERARCHIES,
    NON_STRUCT_TYPES,
    PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_PROPERTY_CANONICAL_OVERRIDE,
    MANUAL_TABLE_CANONICAL_OVERRIDE,

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
