
/**
 * Testing xsp file format functions.
 */

var nacl = require('../../lib/ecma-nacl');
var xsp = nacl.fileXSP;
var compareVectors = nacl.compareVectors;
var randomBytes = require('crypto').randomBytes;
var assert = require('assert');

function getRandom(numOfBytes) {
	"use strict";
	return new Uint8Array(randomBytes(numOfBytes));
}

function testXSPFormatPackAndOpen(dataLen, segSize) {
	"use strict";

	console.log("Test encrypting and packing "+dataLen+
			" bytes of data into xsp file with segment size "+segSize);

	var data = getRandom(dataLen)
	, fileKey = getRandom(32)
	, fileKeyEncr = nacl.secret_box.formatWN.makeEncryptor(
			getRandom(32), getRandom(24))
	, fileSegments = [];

	// initialize encryptor
	var enc = xsp.makeNewFileEncryptor(segSize, fileKey, fileKeyEncr.pack)
	, nonce = getRandom(24);

	// pack segments
	var offset = 0
	, encRes;
	while (offset < data.length) {
		if (offset === 0) {
			encRes = enc.packFirstSegment(data, nonce);
		} else {
			encRes = enc.packSegment(data.subarray(offset), nonce);
		}
		nacl.advanceNonceOddly(nonce);
		offset += encRes.dataLen;
		fileSegments.push(encRes.seg);
	}
	
	// wipe key bytes from memory
	enc.destroy();

	// put segments into one array, like they will sit in one xsp file
	offset = 0;
	for (var i=0; i<fileSegments.length; i+=1) {
		offset += fileSegments[i].length;
	}
	var completeFile = new Uint8Array(offset);
	offset = 0;
	for (var i=0; i<fileSegments.length; i+=1) {
		if (i > 0) { offset += fileSegments[i-1].length; }
		completeFile.set(fileSegments[i], offset);
	}

	// initialize encryptor
	var firstSegHeader = completeFile.subarray(
			0, xsp.FIRST_SEGMENT_HEADERS_LEN)
	, dataParts = [];
	enc = new xsp.makeExistingFileEncryptor(firstSegHeader, fileKeyEncr.open);
	
	assert.strictEqual(enc.commonSegSize(), segSize,
			"Encryptor recreated incorrect common segment length");

	// read data
	var decRes;
	offset = 0;
	while (offset < completeFile.length) {
		decRes = enc.openSegment(completeFile.subarray(offset));
		offset += decRes.segLen;
		dataParts.push(decRes.data);
	}
	
	// wipe key bytes from memory
	enc.destroy();

	// reconstruct and compare complete data
	offset = 0;
	for (var i=0; i<dataParts.length; i+=1) { offset += dataParts[i].length; }
	var completeReconstrData = new Uint8Array(offset);
	offset = 0;
	for (var i=0; i<dataParts.length; i+=1) {
		completeReconstrData.set(dataParts[i], offset);
		offset += dataParts[i].length;
	}
	assert.ok(compareVectors(completeReconstrData, data),
			"Reconstructed data is not the same as original");

	console.log("PASS.\n");
}

testXSPFormatPackAndOpen(1, 16*1024);
testXSPFormatPackAndOpen(16, 16*1024);
testXSPFormatPackAndOpen(16*1024-90, 16*1024);
testXSPFormatPackAndOpen(16*1024, 16*1024);
testXSPFormatPackAndOpen(3*16*1024, 16*1024);
