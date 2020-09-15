# Starter Code for Wikidata Single Domain

This directory contains the basic starter code to train a single-sentence
Q\&A semantic parsing model for a [Wikidata](https://wikidata.org) domain.

## Installation
The starter code requires`nodejs` (>=10.0) and `yarn` as a package manager. 
See [nodejs](https://nodejs.org/en/download/) and [yarn](https://classic.yarnpkg.com/en/docs/install/) for installation details. 
You can check your installation by running `node --version` and `yarn --version`.

In addition, you will need [thingpedia-cli](https://github.com/stanford-oval/thingpedia-cli),
which provides an easy way to download data from and upload data to Thingpedia. 
Run the following command to install it: 
```bash
yarn global add thingpedia-cli
```

After installation, you should get a command called `thingpedia`.
If encounter `command not found`, make sure the Yarn global bin directory
(usually `~/.yarn/bin`) is in your PATH. You can find the path with the command
`yarn global bin`.

```bash
export PATH=~/.yarn/bin:$PATH
```

If you plan to run training yourself, you will also need the [genienlp](),
Run the following command to install it:
```bash
git clone https://github.com/stanford-oval/genienlp
cd  genienlp
pip install --user -e .
pip install tensorboard
```

## Configuration

Edit `Makefile` and set `developer_key` to your Thingpedia developer key.
A Thingpedia developer account is required to obtain the developer key. 
[Register an Almond account](https://almond.stanford.edu/user/register) 
and [sign up as a developer](https://almond.stanford.edu/user/request-developer), 
then you can retrieve the developer key 
from your [user profile](https://almond.stanford.edu/user/profile) page

You can also create a file called 'config.mk' with your settings if you don't
want to edit the Makefile directly.

## Usage

All commands accept an "experiment=" option, setting which experiment
to run. An experiment is a specific set of domains in Schema.org ontology,
with associated datasets and models.
The starter code contains data for 3 domains: `city`, `university`, and `company`.
You can add more experiments by editing the `Makefile` and adding them to `all_experiments`,
as well as creating new per-experiment variables.

### Generate Manifest and Value Datasets
The manifest.tt file contains the manifest of the Q\&A skill to build, 
including the query of the domain with all the properties available for the query. 
Genie can automatically generate manifest.tt for each experiment. 
Use 
```bash
make experiment=$(exp) $(exp)/manifest.tt
```

The manifest.tt also include natural language annotations for queries and their properties, describing
how they can be referred in natural language. A detailed introduction of the annotation syntax can be 
found in [Almond Wiki](https://wiki.almond.stanford.edu/genie/annotations).

By default, Genie uses the Wikidata labels and [aliases](https://www.wikidata.org/wiki/Help:Aliases/en) 
as the annotations. They are categorized into different parts of speech using using a heuristic algorithm. 

Genie can also automatically generate natural language annotations using pretrained language models. 
To enable that, run 
```bash
make models/paraphraser-bart 
make experiment=$(exp) mode=auto $(exp)/manifest.tt
```

One can also fine-tune natural language annotations, by updating `MANUAL_PROPERTY_CANONICAL_OVERRIDE` in 
`tool/autoqa/wikidata/manual-annotations.js`. To enable the manual annotations, run 
```bash
make experiment=$(exp) mode=manual $(exp)/manifest.tt
```
For properties not specified, it will keep the Wikidata labels and aliases as annotations. 


### Generate a dataset

Use:
```bash
make experiment=$(exp) datadir
```
To generate a dataset.

The starter code is tuned to generate a full dataset, which will consume a lot of memory and take a long time.
Use the following options to control the dataset size:
```bash
make experiment=... max_depth=8 target_pruning_size=500 datadir
```
Set a smaller depth or pruning size for faster generation. 
For example, you can set `target_pruning_size=10` to get a sense of what the sentences look like.

### Train

Use:
```bash
make experiment=$(exp) model=$(model) train
```
Set `model` to a unique identifier of the model. By default, the model is called "1". 
The model is saved in `$(exp)/models/$(model)`.

Training takes about 5 hours on a single V100 GPU. 
But you can test run the training by setting a very small training iteration as follows
```bash
make experiment=$(exp) model=$(model) train_iterations=30 train_save_every=10 train_log_every=5 train 
```

### Evaluate

By default, the starter code will split the synthesized data into training set and a synthetic dev set. 
One can evaluate on the synthetic dev set by running the following command: 
```bash
make experiment=$(exp) model=$(model) evaluate
```

If you obtain your own evaluation data, you can add it to `$(experiment)/eval/annotated.tsv` for the dev set,
and `$(experiment)/test/annotated.tsv` for the test set. 
Data added to the dev set will be also used during training for cross-validation.
You can change the evaluation set
by setting `eval_set` to "eval" or "test" as:
```bash
make experiment=$(exp) model=$(model) eval_set=$(eval-set) evaluate
```


