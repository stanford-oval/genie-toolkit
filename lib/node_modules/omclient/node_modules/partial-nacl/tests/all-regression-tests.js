
var boxes = [ './boxes/box',
              './boxes/core',
              './boxes/onetimeauth',
              './boxes/scalarmult',
              './boxes/secret_box',
              './boxes/stream' ]
, util = [ './util/int32' ]
, file = [ './file/xsp' ];

function run(modules, comment) {
	console.log("\n===== START "+comment+" =====\n");
	modules.forEach(function(module){
		try {
			require(module);
		} catch (e) {
			console.error(e.stack);
		}
	});
	console.log("\n===== FINISH "+comment+" =====\n");
}

run(boxes, "Tests of boxes (XSalsa, Poly, Curve and combinations)");

run(util, "Running tests of utilities");

run(file, "Running tests of file format(s)");
