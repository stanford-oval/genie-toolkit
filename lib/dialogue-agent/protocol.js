// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2016-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const MessageType = {
    // from user
    COMMAND: 'command',

    // from agent
    TEXT: 'text',
    PICTURE: 'picture',
    CHOICE: 'choice',
    LINK: 'link',
    BUTTON: 'button',
    ASK_SPECIAL: 'ask-special',
    RDL: 'rdl',
    RESULT: 'result'
};

module.exports = {
    MessageType,
};
