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
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import { Ast, Type } from 'thingtalk';

enum ValueCategory {
    YesNo,
    MultipleChoice,
    Number,
    Measure,
    RawString,
    Password,
    Date,
    Time,
    Picture,
    Location,
    PhoneNumber,
    EmailAddress,
    Contact,
    Generic,
}
export default ValueCategory;

namespace ValueCategory {
    export function fromType(type : Type) : ValueCategory {
        if (type instanceof Type.Entity && type.type === 'tt:picture')
            return ValueCategory.Picture;
        else if (type instanceof Type.Entity && type.type === 'tt:phone_number')
            return ValueCategory.PhoneNumber;
        else if (type instanceof Type.Entity && type.type === 'tt:email_address')
            return ValueCategory.EmailAddress;
        else if (type instanceof Type.Entity && type.type === 'tt:contact')
            return ValueCategory.Contact;
        else if (type instanceof Type.Entity)
            return ValueCategory.RawString;
        else if (type.isBoolean)
            return ValueCategory.YesNo;
        else if (type.isString)
            return ValueCategory.RawString;
        else if (type.isNumber)
            return ValueCategory.Number;
        else if (type.isMeasure)
            return ValueCategory.Measure;
        else if (type.isEnum)
            return ValueCategory.RawString;
        else if (type.isTime)
            return ValueCategory.Time;
        else if (type.isDate)
            return ValueCategory.Date;
        else if (type.isLocation)
            return ValueCategory.Location;
        else
            return ValueCategory.Generic;
    }

    export function fromValue(value : Ast.Value) : ValueCategory {
        if (value.isVarRef)
            return ValueCategory.Generic;

        const type = value.getType();
        return fromType(type);
    }

    export function fromString(expected : string|null) : ValueCategory|null {
        if (expected === null)
            return null;

        switch (expected) {
        case 'yesno':
            return ValueCategory.YesNo;
        case 'location':
            return ValueCategory.Location;
        case 'picture':
            return ValueCategory.Picture;
        case 'phone_number':
            return ValueCategory.PhoneNumber;
        case 'email_address':
            return ValueCategory.EmailAddress;
        case 'contact':
            return ValueCategory.Contact;
        case 'number':
            return ValueCategory.Number;
        case 'date':
            return ValueCategory.Date;
        case 'time':
            return ValueCategory.Time;
        case 'raw_string':
            return ValueCategory.RawString;
        case 'password':
            return ValueCategory.Password;
        case 'choice':
            return ValueCategory.MultipleChoice;
        default:
            return ValueCategory.Generic;
        }
    }

    export function toString(expected : ValueCategory|null) : string|null {
        let what;
        if (expected === ValueCategory.YesNo)
            what = 'yesno';
        else if (expected === ValueCategory.Location)
            what = 'location';
        else if (expected === ValueCategory.Picture)
            what = 'picture';
        else if (expected === ValueCategory.PhoneNumber)
            what = 'phone_number';
        else if (expected === ValueCategory.EmailAddress)
            what = 'email_address';
        else if (expected === ValueCategory.Contact)
            what = 'contact';
        else if (expected === ValueCategory.Number)
            what = 'number';
        else if (expected === ValueCategory.Date)
            what = 'date';
        else if (expected === ValueCategory.Time)
            what = 'time';
        else if (expected === ValueCategory.RawString)
            what = 'raw_string';
        else if (expected === ValueCategory.Password)
            what = 'password';
        else if (expected === ValueCategory.MultipleChoice)
            what = 'choice';
        else if (expected !== null)
            what = 'generic';
        else
            what = null;
        return what;
    }
}
