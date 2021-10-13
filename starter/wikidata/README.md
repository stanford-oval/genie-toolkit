# Starter Code for Wikidata Q&A

This directory contains the basic starter code to synthesis data and train a single-turn Q\&A semantic parsing model for a [Wikidata](https://wikidata.org) domain.

## Installation

See the [Genie installation instructions](/doc/install.md).

## Configuration

Edit `Makefile` and set `experiment` to be the domain you want to experiment on. 
The following ten domains are supported: `city`, `country`, `tv`, `disease`, `human`, `art`, `song`, `game`, `organization`, `music_band`.
Alternatively, you can run all of the following commands with an `experiment=` option. 

## Generate a schema
Use:
```bash
make $(experiment)/manifest.tt
```
where `$(experiment)` is the domain you chose. 

The starter code loads data from [Bootleg](https://github.com/HazyResearch/bootleg) and [CSQA](https://amritasaha1812.github.io/CSQA/), based on which, it generates the manifest containing the signature of the QA skill. By default, it uses a BART paraphraser model to automatically generate [natural language annotations](https://wiki.almond.stanford.edu/genie/annotations#canonical-forms) for each property available in the domain. 

Options available:
- `annotation`: set the method of generating natural language annotation; supports:
  - `baseline`: only use a canonical annotation derived from the property name. 
  - `auto` (default): extract annotation using a BART paraphraser 
  - `manual`: use manual annotations in `/tool/autoqa/wikidata/manual-annotations.ts`
  - `wikidata`: use wikidata alternative labels for each property as annotation
- `type-system`: set the how the ThingTalk type is set for each property; supports:
  - `entity-hierarchical` (default): each property has a unique entity type based on its name with a prefix `p_`, and it's a super type of the types of all its values
  - `entity-plain`: each property has a unique entity type
  - `string`: everything has a string type except for `id`
## Generate a dataset
Use:
```bash
make datadir 
```
This will synthesize a dataset based on the manifest. 

Options available:
- `max_depth`, `pruning_size`: the former decides the depth of synthesis, and the latter decides the sample size for each non-terminal. Together they decide the complexity and size of the synthetic dataset. By default they are set to be `8` and `25` respectively.
- `fewshot`, `fewshot_size`: set `fewshot` to `true` to include few shot examples converted from CSQA dataset in the training. By default, `fewshot_size` is set to `100`. 
  

## Train
Use:
```bash
make model=... train
```
Set `model` to a unique identifier of the model. By default, the model is called "1".
Training takes about 1 hour on a single V100 GPU. The model is saved in `$(experiment)/models/$(model)`.


## Evaluate 
The starter code converts a subset of CSQA dev set as the eval set. To evaluate on this eval set, use 
```bash
make model=... evaluate 
```

After the evaluation finishes, you will have two files:
- `$(experiment)/eval/${model}.results`: short file in CSV form containing accuracy
- `$(experiment)/eval/${model}.debug`: the error analysis file which compares the output of the model with the gold annotation, and reports all the errors

