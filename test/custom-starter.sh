#!/bin/bash

# Test the starter code for custom skills.

. $(dirname $0)/common.sh
do_setup
trap on_error ERR INT TERM

# initialize the starter code, which will copy over everything

node ${srcdir}/dist/tool/genie.js init-project test-project
cd test-project

# assert the files exist
test -f package.json
test -f package-lock.json

# poor man's npm link
rm -fr node_modules/genie-toolkit
ln -s $srcdir node_modules/genie-toolkit

# let's add a device
node ${srcdir}/dist/tool/genie.js init-device com.example

test -f com.example/package.json
test -f com.example/package-lock.json
test -f com.example/manifest.tt

cat > com.example/index.js <<EOF
const Tp = require('thingpedia');
module.exports = class extends Tp.BaseDevice {
    get_test() {
        return [{ value: 1 }, { value: 2 }];
    }
};
EOF
cat > com.example/manifest.tt <<EOF
class @com.example
#_[name="Example device"]
#_[description="Example description"]
{
    import loader from @org.thingpedia.v2();
    import config from @org.thingpedia.config.none();

    list query test(out value : Number)
    #_[canonical=["test"]]
    #_[result=["the answer is \${value}"]];
}
EOF

make
test -f build/com.example.zip

# let's try unit tests
cat > test/unit/com.example.js <<EOF
const assert = require('assert');
module.exports = [
    ['query', 'test', {}, {}, (results) => {
        assert.deepStrictEqual(results, [{ value: 1 }, { value: 2 }]);
    }]
];
EOF

node ./test/unit com.example
node ./test/unit everything

# let's try scenario tests
mkdir -p com.example/eval
cat > com.example/eval/scenarios.txt <<EOF
U: \t @com.example.test();
A: The answer is 1\.
A: >> expecting = null
EOF

node ./test/scenarios everything
node ./test/scenarios com.example

# add some evaluation data
mkdir -p com.example/eval/dev
cat > com.example/eval/dev/annotated.txt <<EOF
U: get test answer
UT: \$dialogue @org.thingpedia.dialogue.transaction.execute;
UT: @com.example.test();
EOF

# set some configuration
# this uses a testing developer key
cat > config.mk <<EOF
developer_key = 88c03add145ad3a3aa4074ffa828be5a391625f9d4e1d0b034b445f18c595656
thingpedia_url = https://dev.almond.stanford.edu/thingpedia
EOF

# make a dataset (a small one)
make subdatasets=1 max_turns=3 target_pruning_size=10 datadir

# train a model (for a few iterations)
make model=small train_iterations=4 train_save_every=2 \
  train_log_every=2 custom_train_nlu_flags="--train_batch_tokens 100 --val_batch_size 100" \
  train_pretrained_model=sshleifer/bart-tiny-random train-user

# evaluate
make eval_set=dev model=small evaluate
