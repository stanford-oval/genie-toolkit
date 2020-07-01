// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2017-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');

const SpeechRecognizer = require('./speech_recognizer');
const SpeechSynthesizer = require('./speech_synthesizer');
const { MessageType } = require('../dialogue-agent/protocol');

module.exports = class SpeechHandler extends events.EventEmitter {
    constructor(conversation, platform) {
        super();
        this._platform = platform;

        this._conversation = conversation;
        this._conversation.addOutput(this, false);
        this._conversation.on('inactive', () => this._autoTrigger = false);
        this._pulse = platform.getCapability('sound');
        this._wakeWordDetector = platform.getCapability('wakeword-detector');

        this._recognizer = new SpeechRecognizer({ locale: this._platform.locale });
        this._recognizer.on('error', (e) => {
            this.emit('error', e);
        });
        this._tts = new SpeechSynthesizer(platform);

        this._autoTrigger = false;
    }

    // called from conversation
    setHypothesis() {
        // ignore, this is called from the conversation when it broadcasts the hypothesis
        // to all listeners
    }

    async addMessage(message) {
        switch (message.type) {
        case MessageType.COMMAND:
            await this._tts.clearQueue();
            break;

        case MessageType.TEXT:
        case MessageType.RESULT:
            await this._tts.say(message.text);
            break;

        case MessageType.RDL:
            await this._speechSynth.say(message.rdl.displayTitle);
            break;

        case MessageType.ASK_SPECIAL:
            this._autoTrigger = message.askSpecialWhat !== null;
            break;

        // ignore all other message types
        }
    }

    /**
     * Programmatically trigger a wakeword.
     *
     * This can be used to emulate a wakeword with a push button.
     */
    wakeword() {
        this.emit('wakeword');
        this._onDetected();
    }

    _onDetected() {
        let req = this._recognizer.request(this._stream);
        req.on('hypothesis', (hypothesis) => {
            this._conversation.setHypothesis(hypothesis);
        });
        req.on('done', (status, utterance) => {
            if (status === 'Success') {
                console.log('Recognized as "' + utterance + '"');
                this._conversation.handleCommand(utterance);
            } else if (status === 'NoMatch') {
                this.emit('no-match');
            } else if (status === 'InitialSilenceTimeout') {
                this.emit('silence');
            } else {
                console.log('Recognition error: ' + status);
            }
        });
        req.on('error', (error) => {
            this._onError(error);
        });
    }

    _onError(error) {
        console.log('Error in speech recognition: ' + error.message);
        this._tts.say("Sorry, I had an error understanding your speech: " + error.message);
    }

    start() {
        this._stream = this._pulse.createRecordStream({
            format: 'S16LE',
            rate: 16000,
            channels: 1,
            properties: {
                'filter.want': 'echo-cancel',
            }
        });

        this._stream.on('state', (state) => {
            console.log('Record stream is now ' + state);
            if (state === 'ready')
                this.emit('ready');
        });

        if (this._wakeWordDetector) {
            this._wakeWordDetector.on('sound', () => {
                if (this._autoTrigger) {
                    console.log('Auto-triggered on voice detection in active conversation');
                    this._onDetected();
                }
            });
            this._wakeWordDetector.on('wakeword', (wakeword) => {
                console.log('Wakeword ' + wakeword + ' detected');
                this.emit('wakeword', wakeword);
                this._onDetected();
            });
            this._stream.pipe(this._wakeWordDetector);
        }
    }

    stop() {
        if (!this._stream)
            return;
        this._stream.end();
        this._stream = null;
        this._recognizer.close();
        if (this._wakeWordDetector)
            this._wakeWordDetector.destroy();
    }
};
