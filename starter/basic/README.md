# Starter Code for Thingpedia

This directory contains the basic starter code to train a single-sentence
NLU model for Thingpedia.

## Installation

See the [Genie installation instructions](/doc/install.md).

## Configuration

Edit `Makefile` and set `geniedir` with the path to your "genie-toolkit"
checkout. Set `developer_key` to your Thingpedia developer key.

You can also create a file called 'config.mk' with your settings if you don't
want to edit the Makefile directly.

## Usage

All commands accept an "experiment=" option, setting which experiment
to run. An experiment is a specific set of Thingpedia skills and associated
datasets and models.

The starter code contains two experiments:
- `thingpedia`: train on the latest snapshot of the public Thingpedia
- `custom`: empty experiment; you must supply your own thingpedia.tt, dataset.tt
  and entities.json.

You can add more experiments by editing the `Makefile` and adding them to `all_experiments`,
as well as creating new per-experiment variables.

### Generate a dataset

Use:
```
make experiment=... datadir
```
To generate a dataset.

The starter code is tuned to generate a full dataset, which will take a while.
Use the following options to control the dataset size:
```
make experiment=... max_depth=7 target_pruning_size=2500 datadir
```
Set a smaller depth or pruning size for faster generation.

### Train

Use:
```
make experiment=... model=... train
```
Set `model` to a unique identifier of the model. By default, the model is called "1".

Training takes about 7 hours on a single V100 GPU.
The model is saved in `$(experiment)/models/$(model)`.

### Evaluate

The starter code does not include any evaluation data. If you obtain some,
you can add it to `$(experiment)/eval/annotated.tsv` for the dev set,
and `$(experiment)/test/annotated.tsv` for the test set. Then, add the models
you wish to the evaluate to the `_eval_models` or `_test_models` variable
associated with the experiment.
Finally, you can evaluate a specific with
```
make experiment=... eval_set=... evaluate
```
`eval_set` should be "eval" or "test".

Data added to the dev set will be also used during training for cross-validation.
