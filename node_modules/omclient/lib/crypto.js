var nacl = require('ecma-nacl');
var crypto = require('crypto');
var FE_SIZE = 32;

function createPrivateKey() {
    return crypto.randomBytes(FE_SIZE);
}
function createNonce(s) {
    return crypto.randomBytes(s || FE_SIZE);
}
function generatePublicKey(priv) {
    return new Buffer(nacl.generate_pubkey(new Uint8Array(priv)));
}
function computeShared(priv, pub2) {
    var q = new Uint8Array(FE_SIZE);
    nacl.curve25519(q, new Uint8Array(priv), new Uint8Array(pub2));
    return new Buffer(q);
}
function createSHA256() {
    return crypto.createHash('sha256');
}
function createMD5() {
    return crypto.createHash('md5');
}

module.exports = {
    createNonce: createNonce,
    createPrivateKey: createPrivateKey,
    generatePublicKey: generatePublicKey,
    computeShared: computeShared,
    createSHA256: createSHA256,
    createMD5: createMD5,
};
Object.freeze(module.exports);
