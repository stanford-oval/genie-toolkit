# Starter Code For Custom Skills
This starter code can be used to train a model for a custom Thingpedia skill
(_device_, in Thingpedia jargon).
It is automatically provisioned by the command:

```bash
genie init-project --developer-key $YOUR_DEVELOPER_KEY $YOUR_PROJECT_NAME
```

Note this requires to have `genie` installed as a command-line tool. You can either run `npm install -g genie-toolkit`
to get the latest release version, or follow the option 1 in the [installation instruction](https://github.com/stanford-oval/genie-toolkit/blob/master/doc/install.md).

To obtain your developer key, register an account at https://almond.stanford.edu and send a developer request 
at https://almond.stanford.edu/user/request-developer. Then you should be able to find you developer key in
your personal information panel under Settings. 

## Creating a new device

Each device should be a subfolder of this main folder. You can create the
skeleton for a device using:

```bash
genie init-device $YOUR_DEVICE_NAME
```

This will create a directory of your device name with a pre-populated `package.json`, `manifest.tt`, `index.js` files.
See detailed device package layout [here](https://github.com/stanford-oval/thingpedia-common-devices/blob/master/doc/device-layout.md)  
You can find some example devices in [thingpedia-common-devices repository](https://github.com/stanford-oval/thingpedia-common-devices/tree/master/main).

More detailed instruction of how to build skills can be found in the [Thingpedia guide](https://wiki.almond.stanford.edu/thingpedia#learning-to-write-thingpedia-devices).
Note that the Thingpedia guide is using the Thingpedia web interface to upload the devices, which is optional. 
Using this starter code, you can edit your device locally and upload it from the command line. The starter code also provides an easy way to test your device. 

## Automatic Testing
You shuld add tests for every new device, to ensure the implementation is correct.
The test framework supports devices that require no authentication or username-password style basic authentication. 

### Lint
Use:
```bash
make lint
```
To check all devices statically for errors.

### Unit Testing
Add unit tests in a file called `test/unit/$YOUR_DEVICE_NAME.js`, which should exports a list of test cases. Each test case 
should be a list containing: 
- a string for function type (`query` or `action`)
- a string for function name 
- an object for input parameters
- an object for projection and filters 
- an function to validate expected results

Some examples of test files can be found [here](https://github.com/stanford-oval/thingpedia-common-devices/tree/master/test/unit/main).

If your device needs authentication, add a file `$YOUR_DEVICE_NAME.cred.json` containing
the information needed in the directory `test/`. All the information can be accessed from the `state` parameter of your device's `constructor` in JS.  
An example can be found [here](https://github.com/stanford-oval/thingpedia-common-devices/blob/master/test/data/credentials/io.home-assistant.json)

Use:
```bash
node ./test/unit $YOUR_DEVICE_NAME
```
to run the unit tests.


### Scenario Testing

Scenario tests will load your device in an complete assistant, and test end-to-end
that the assistant responds correctly to user's commands. It is a way to catch regressions
and unexpected failures.

At first, you'll write scenario tests using `\t` commands, which emulates the user typing
ThingTalk code in their chat window directly. You can use these test to check that your skill
is returning data compatible with the function signatures declared in the manifest, and that the agent
replies correctly. Later, once a model has been trained for the skill, the user commands can
be replaced with natural language comamnds, to act as an end-to-end regression test.

To add a scenario test, add a new dialogue in the `eval/scenarios.txt` file in the device folder.
Dialogues are separated by `====` (4 equal signs). The format of a dialogue alternates user turns, prefixed with `U:`, and agent turns, prefixed
with `A:`. The user speaks first, and the agent speaks last.
The first line in a dialogue starting with `#` contains the ID of the test, and the other
`#` lines are comments.

At every turn, the system emulates inputs with the given user utterance, then checks
that the reply from the agent matches the regular expression indicated in the agent turn.

See [thingpedia-common-devices](https://github.com/stanford-oval/thingpedia-common-devices/tree/master/main) for examples for each of the devices.

Use:
```bash
node ./test/scenarios $YOUR_DEVICE_NAME
```
to run scenario tests.

## Training the NLP model

### Generating a dataset

You can generate a dataset for all devices with:
```bash
make datadir
```

A standard-sized dataset takes about 2 hours on a machine with at least 8 cores
and at least 30GB of RAM. A smaller dataset can be generated for local testing with:

```bash
make subdatasets=1 target_pruning_size=25 max_turns=2 debug_level=2 datadir
```

### Train
Training requires `genienlp` repository. To install it, use:
```bash
pip install `genienlp>=0.6.0`
```

To train a model, use:
```bash
make model=$YOUR_MODEL_NAME train-user
```
Set `model` to a unique identifier of the model. By default, the model is called "1".

Training takes about 7 hours on a single V100 GPU.
The model is saved in `everything/models/$YOUR_MODEL_NAME`.

## Running the skill

Once you have built the skill, you can run it with:
```bash
genie assistant --developer-dir $PATH_TO_THIS_DIRECTORY
```

## Upload the skill
Once ready, you can package your device with 
```bash
make build/$YOUR_DEVICE_NAME.zip
```

The zip files will be stored in `build/`.

You can then upload the device to Thingpedia with: 
```bash
genie upload-device \
  --zipfile build/com.foo.zip \
  --icon com.foo/icon.png \
  --manifest com.foo/manifest.tt \
  --dataset com.foo/dataset.tt
```

`--icon` and `--zipfile` are optional after the first upload, if they did not change. The zip file should also be omitted if the device uses the Generic REST or RSS loaders.