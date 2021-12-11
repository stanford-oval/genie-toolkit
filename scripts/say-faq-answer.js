const yaml = require("js-yaml");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");

const BASE_URL = "https://nlp-staging.almond.stanford.edu/en-US/voice/tts?text=";

const name = process.argv[2];
const filename = "data/builtins/org.thingpedia.builtin.thingengine.builtin/faq.yaml";
const data = yaml.load(fs.readFileSync(filename, { encoding: "utf-8" }));
// const key = `about_almond_${name}`;
const key = name;
const answer = data[key]["a"][0];

const url = BASE_URL + encodeURIComponent(answer);

const proc = spawn("ffplay", ["-nodisp", "-"]);

https.get(url, (res) => {
  res.pipe(proc.stdin);
});
