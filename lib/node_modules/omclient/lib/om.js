var proto = require('./ldproto'),
client = require('./client'),
crypto = require('crypto'),
ourcrypto = require('./crypto'),
assert = require('assert');

module.exports = {
    assert: assert,
    proto: proto,
    client: client,
    Buffer: Buffer,
    createNonce: ourcrypto.createNonce,
    createPrivateKey: ourcrypto.createPrivateKey,
    generatePublicKey: ourcrypto.generatePublicKey,
    computeShared: ourcrypto.computeShared,
    createSHA256: ourcrypto.createSHA256,
    createMD5: ourcrypto.createMD5,
};
Object.freeze(module.exports);