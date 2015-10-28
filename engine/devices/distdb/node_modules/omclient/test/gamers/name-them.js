var Chance = require('chance');
var chance = new Chance();
var fs = require('fs');
var files = fs.readdirSync(".");
for(var i in files) {
	var f = files[i];
	if(f.indexOf('.') != -1 || f.indexOf(' ') != -1)
		continue;
	var dest = chance.name() +".jpg";
	console.log("rename " + f + " to " + dest);
    fs.renameSync(f, dest);
}