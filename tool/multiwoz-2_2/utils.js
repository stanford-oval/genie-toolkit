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
// Author: Ryan Othniel Kearns <kearns@cs.stanford.edu>
"use strict";

const SERVICE_MAP = {
    'hotel': 'Hotel',
    'train': 'Train',
    'attraction': 'Attraction',
    'restaurant': 'Restaurant',
    // 'hospital': 'Hospital',
    'taxi': 'Taxi'
    // 'bus': 'Bus',
    // 'police': 'Police'
};

const ACTION_MAP = {
    'book_hotel': 'make_booking',
    'book_train': 'make_booking',
    'book_restaurant': 'make_reservation',
    'find_taxi': 'make_booking' // FIXME inconsistency in MultiWOZ 2.2
};

const SLOT_MAP = {
    'hotel-pricerange': 'price_range',
    'hotel-type': 'type',
    'hotel-parking': 'parking',
    'hotel-bookday': 'book_day',
    'hotel-bookpeople': 'book_people',
    'hotel-bookstay': 'book_stay',
    'hotel-stars': 'stars',
    'hotel-internet': 'internet',
    'hotel-name': 'id',
    'hotel-area': 'area',
    'hotel-address': 'address',
    'hotel-phone': 'phone',
    'hotel-postcode': 'postcode',
    'hotel-ref': 'reference_number',

    'train-arriveby': 'arrive_by',
    'train-departure': 'departure',
    'train-day': 'day',
    'train-bookpeople': 'book_people',
    'train-leaveat': 'leave_at',
    'train-destination': 'destination',
    'train-trainid': 'id',
    'train-ref': 'reference_number',
    'train-price': 'price',
    'train-duration': 'duration',

    'attraction-area': 'area',
    'attraction-name': 'id',
    'attraction-type': 'type',
    'attraction-entrancefee': 'entrance_fee',
    'attraction-openhours': 'openhours',
    'attraction-address': 'address',
    'attraction-phone': 'phone',
    'attraction-postcode': 'postcode',

    'restaurant-pricerange': 'price_range',
    'restaurant-area': 'area',
    'restaurant-food': 'food',
    'restaurant-name': 'id',
    'restaurant-bookday': 'book_day',
    'restaurant-bookpeople': 'book_people',
    'restaurant-booktime': 'book_time',
    'restaurant-address': 'address',
    'restaurant-phone': 'phone',
    'restaurant-postcode': 'postcode',
    'restaurant-ref': 'reference_number',

    // 'hospital-department': '',
    // 'hospital-address': '',
    // 'hospital-phone': '',
    // 'hospital-postcode': '',

    'taxi-leaveat': 'leave_at',
    'taxi-destination': 'destination',
    'taxi-departure': 'departure',
    'taxi-arriveby': 'arrive_by',
    'taxi-type': 'car',
    'taxi-phone': 'phone'

    // 'bus-departure': '',
    // 'bus-destination': '',
    // 'bus-leaveat': '',
    // 'bus-day': '',

    // 'police-address': '',
    // 'police-phone': '',
    // 'police-postcode': '',
    // 'police-name': ''
};

module.exports = {
    cleanEnumValue(v) {
        // replace dash with space
        v = v.replace(/-/g, ' ');
        // camelcase the value
        // v = v.replace(/(?:^|\s+|-)[A-Za-z]/g, (letter) => letter.trim().toUpperCase());
        // add underscore prefix if value starts with number
        if (/^\d.*/.test(v))
            v = '_' + v;
        return v;
    },

    SERVICE_MAP: SERVICE_MAP,
    ACTION_MAP: ACTION_MAP,
    SLOT_MAP: SLOT_MAP

};
