# Starter Code For Custom Skills

This starter code can be used to train a model for a custom Thingpedia skill
(_device_, in Thingpedia jargon).
It is automatically provisioned by the command:

```
genie init-project
```

NOTE: a longer guide to use this starter code is provided at
<https://github.com/stanford-oval/thingpedia-common-devices/blob/master/doc/adding-new-device.md>.

## Creating a new device

Each device should be a subfolder of this main folder. You can create the
skeleton for a device using:

```
genie init-device $name
```

Follow the [Thingpedia guide](https://wiki.almond.stanford.edu/thingpedia/guide)
to build the new device.

## Automatic Testing

Use:
```
make lint
```
To check all devices statically for errors.

Use:
```
node ./test/unit $device
```
to run unit tests for a given device. Unit tests are defined in a file
called $device.js in test/unit.

Use:
```
node ./test/scenarios $device
```
to run scenario tests for a given device. Scenario tests are defined in a file
called eval/scenarios.txt in the device.

## Training the NLP model

### Generating a dataset

You can generate a dataset for all devices with:
```
make datadir
```

A standard-sized dataset takes about 2 hours on a machine with at least 8 cores
and at least 60GB of RAM. A smaller dataset can be generated for local testing with:

```
make subdatasets=1 target_pruning_size=25 max_turns=2 debug_level=2 datadir
```

### Train

To train a model, use:
```
make model=... train
```
Set `model` to a unique identifier of the model. By default, the model is called "1".

Training takes about 7 hours on a single V100 GPU.
The model is saved in `everything/models/$(model)`.

## Running the skill

Once you have built the skill, you can run it with:
```
genie assistant --developer-dir $path_to_this_directory
