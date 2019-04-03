# Genie

[![Build Status](https://travis-ci.com/Stanford-Mobisocial-IoT-Lab/genie-toolkit.svg?branch=master)](https://travis-ci.com/Stanford-Mobisocial-IoT-Lab/genie-toolkit) [![Coverage Status](https://coveralls.io/repos/github/Stanford-Mobisocial-IoT-Lab/genie-toolkit/badge.svg?branch=master)](https://coveralls.io/github/Stanford-Mobisocial-IoT-Lab/genie-toolkit?branch=master) [![Dependency Status](https://david-dm.org/Stanford-Mobisocial-IoT-Lab/genie-toolkit/status.svg)](https://david-dm.org/Stanford-Mobisocial-IoT-Lab/genie-toolkit) [![Greenkeeper badge](https://badges.greenkeeper.io/Stanford-Mobisocial-IoT-Lab/genie-toolkit.svg)](https://greenkeeper.io/) [![Language grade: JavaScript](https://img.shields.io/lgtm/grade/javascript/g/Stanford-Mobisocial-IoT-Lab/genie-toolkit.svg?logo=lgtm&logoWidth=18)](https://lgtm.com/projects/g/Stanford-Mobisocial-IoT-Lab/genie-toolkit/context:javascript)

This repository hosts Genie, a tool which allows you to quickly create new semantic
parsers that translate from natural language to a formal language of your choice.

Genie was described in the paper:

_Genie: A Generator of Natural Language Semantic Parsers for Virtual Assistant Commands_  
Giovanni Campagna (\*), Silei Xu (\*), Mehrad Moradshahi, Richard Socher, and Monica S. Lam  
Conditionally accepted to _Proceedings of the 40th ACM SIGPLAN Conference on Programming Language Design and Implementation_ (PLDI 2019), Phoenix, AZ, June 2019.

If you use Genie in any academic work, please cite the above paper.

This repository contains the Genie library and a command line tool; other portions
of the Genie system, such as the basic language library, paraphrasing web server and
semantic parsing code live in other repositories.

## Installation

See [Install](INSTALL.md).

## License

This package is covered by the GNU General Public License, version 3
or any later version. See [LICENSE](LICENSE) for details.

## Reproducing the results of the paper

To reproduce the machine learning results of the paper, see [Reproducing](doc/reproducing.md).

## Using Genie

### Genie concepts

Genie is a based on the _Genie template language_, which succintly defines a space of synthetic
sentences. Genie can use the template language to generate 

### A turnkey solution for Genie+Almond

A all-in-one solution to use Genie to extend ThingTalk with new templates is provided by
[almond-cloud](https://github.com/Stanford-Mobisocial-IoT-Lab/almond-cloud).

Please refer to `almond-cloud` documentation for installation instructions.

After installation, administrators (and optionally users) can create new Genie template
modules and new natural language models, trigger automated training and deploy the trained models
to any Almond system.

### Manual Genie Usage

If almond-cloud is not desired, or one wants to avoid the complexity of setting up a database
and web server, it is possible to invoke Genie manually, and have it manipulate datasets stored
as TSV/CSV files.

NOTE: Genie assumes all files are UTF-8, and ignores the current POSIX locale (LC_CTYPE and LANG
enviornment varialbes). Legacy encodings such as ISO-8859-1 or Big5 are not supported and could
cause problems.

### Step 0. (Optional) Setup

At various points Genie will call a tokenizer to preprocess the sentences and apply argument
identification. By default, it will use the REST API provided by <https://almond-nl.stanford.edu/>.
This can be very slow, especially with large datasets, as it involves one HTTP/1.1 request per sentence.

Alternatively, you should set up a local instance of [almond-tokenizer](https://github.com/Stanford-Mobisocial-IoT-Lab/almond-tokenizer),
listening on localhost port 8888. If you do so, set the environment variable `GENIE_USE_TOKENIZER=local`.
This avoids the network communication and also uses a more efficient protocol.

Note that correct preprocessing of Location values with a local tokenizer requires MapQuest API key.
Please refer to the almond-tokenizer documentation for details.

#### Step 1. Generate synthetic set.

To generate a synthetic set, use:

```
genie generate --locale en --template template.genie --thingpedia thingpedia.json --dataset dataset.tt -o synthetic.tsv
```

The `--template` flag can be used to point to a template file definining the construct templates,
in Genie language. E.g. `languages/en/thingtalk.genie` is the one for English sentence synthesis.
Multiple `--template` flags can be used to load multiple template files.

The `--thingpedia` flag should point to a [Thingpedia snapshot file](https://almond.stanford.edu/thingpedia/developers/thingpedia-api/#api-Schemas-GetSnapshot),
which defines the types and signatures of the primitives to use. You can download a snapshot file
for the reference Thingpedia with:
```
genie download-snapshot [--snapshot <snapshot_id>] -o thingpedia.json
```
If you omit the `--snapshot` parameter, the latest content of Thingpedia will be used.

The `--dataset` flag to should point to the primitive templates in ThingTalk dataset syntax.
See the [Thingpedia documentation](https://almond.stanford.edu/thingpedia/developers/thingpedia-nl-support.md)
for a description of dataset files.

The latest dataset file for the reference Thingpedia can be downloaded with:
```
genie download-dataset -o dataset.tt
```

The resulting `synthetic.tsv` file can be used to train directly. To do so, skip to Step 4, Dataset preprocessing. If you wish instead to paraphrase, you'll probably want to restrict the synthetic set
to paraphrase-friendly construct templates, by passing `--flag-set turking` on the command line.

NOTE: the `generate` command can require significant amounts of memory. If you experience out of memory,
it can help to invoke `node` as:
```
node --max_old_space_size=8000 `which genie` ...
```
or however much memory you want to dedicate to the process (in MB).

#### Step 2. Choose the sentences to paraphrases.

To choose which sentences to paraphrase, use:
```
genie sample synthetic.tsv --constants constants.tsv --sampling-strategy bySignature --sampling-control easy-hard-functions.tsv -o mturk-input.tsv
```

Use `constants.tsv` to choose which values to use for each constant, based on type and parameter name.
This parameter cannot be omitted.
A default that is appropriate for English and the reference Thingpedia can be found at [data/en-US/constants.tsv](data/en-US/constants.tsv).

Use `--sampling-control` to choose which functions are hard and which functions are easy; this affect
the proportion of paraphrase inputs that will use each functions. See [data/easy-hard-functions.tsv](data/easy-hard-functions.tsv) for details of the file format. If omitted, all functions are considered equally hard. 

You can also modify [lib/paraphrase-sampler.js](lib/paraphrase-sampler.js) to further adapt how
sampling occurs, based on program complexity, sentence complexity or other heuristics.

#### Step 3. Paraphrasing

The command-line version of Genie **does not** include a paraphrasing website, as that is usually too dependency
heavy and too specific to a particular setup. Instead, the `mturk-input.tsv` is in a format
suitable for use with the paraphrasing website provided by [almond-cloud](https://github.com/Stanford-Mobisocial-IoT-Lab/almond-cloud),
which provides one-click integration with Amazon MTurk.

If you wish to avoid almond-cloud, you can prepare the paraphrasing HITs with:
```
genie mturk-make-paraphrase-hits -o paraphrasing-hits.csv < mturk-input.tsv 
```
The resulting `paraphrasing-hits.csv` will be suitable to use on Amazon MTurk using the template provided
in [data/mturk/paraphrasing-template.html](data/mturk/paraphrasing-template.html). Note that the on-the-fly validation provided by this template is more limited
than the one performed by almond-cloud, due to limitations of the MTurk platform; hence, subsequent
validation might end up rejecting more HITs.

After using the embedded template, you can prepare the validation HITs with:
```
genie mturk-make-validation-hits -o validation-hits.csv < paraphrasing-results.csv
```

The template for validation HITs lives at [data/mturk/validation-template.html](data/mturk/validation-template.html)

Finally, after completing the validation HITs, you can obtain the paraphrasing dataset with:
```
genie mturk-validate
  --paraphrasing-input paraphrasing-results.csv --validation-input validation-hits.csv
  --validation-count 4 --validation-threshold 4
  -o paraphrasing.tsv --paraphrasing-rejects paraphrasing-rejects.csv --validation-rejects validation-rejects.csv
```
`--validation-count` controls the number of workers that vote on each sentence, and `--validation-threshold`
is the number of workers that must approve of a sentence before it is included
in the datasets. The `--paraphrasing-rejects` and `--validation-rejects` arguments generate reject files
that can be used in Amazon MTurk to reject the completed tasks.

If you wish to skip manual validation, use a `--validation-threshold` of 0. In that case, `--validation-input`
is not necessary. The script will still perform automatic validation.

#### Step 4. Dataset preprocessing

After creating the synthetic and paraphrase datasets, use the following command to augment the dataset
and apply parameter replacement:
```
genie augment paraphrasing.tsv synthetic.tsv --thingpedia thingpedia.json --ppdb compiled-ppdb.bin --parameter-datasets parameter-datasets.tsv
 -o everything.tsv
 [--ppdb-synthetic-fraction FRACTION] [--ppdb-paraphrase-fraction FRACTION]
 [--quoted-fraction FRACTION]
```

Before this step, you must obtain the parameter datasets, and create a parameter-datasets.tsv file
mapping a string type to a downloaded dataset file.

Because different datasets have different licenses and restrictions (such as the requirement to cite
a particular paper, or a restriction to non-commercial use), Genie does not include any dataset directly.
You can obtain the datasets Almond uses at <https://almond.stanford.edu/thingpedia/strings> and
<https://almond.stanford.edu/thingpedia/entities>. Download
is available after registration and accepting the terms and conditions.

Given the created everything.tsv file, you can split in train/eval/test with:
```
genie split-train-eval -i everything.tsv --train train.tsv --eval eval.tsv [--test test.tsv] --eval-prob 0.1
  --split-strategy sentence
```

This command will split according to split strategy:
- `id`: naive split; the same exact sentence can occur in the training and testing set; use this split only
  with data that you're confident is highly representative of real-world usage, otherwise you'll overestimate
  your accuracy (the difference can be up to 20%)
- `raw-sentence` and `sentence`: split on sentences; sentences in the training set will not occur in the test
  set; `sentence` considers two sentences to be equal if they differ only for parameters, while `raw-sentence`
  does not; this is the split to use to train a production model, as it maximizes the amount of available
  training data without overestimating accuracy
- `program`: split on programs; the same program will not appear in both the training set and test set;
  programs that differ only for the parameter values are considered identical;
- `combination`: split on function combinations; the same sequence of functions will not appear in the training
  and test set; use this strategy to reproduce the experiment in the Genie paper with a new dataset

Use `--eval-prob` to control the fraction of the data that will be part of the evaluation set.

If `--test` is provided, the command will generate a test set as well. Regardless of `--split-strategy`,
the test set is always split naively from the evaluation/development set, so the same sentence can appear
in both.

#### Step 5. Training

To train, use:
```
genie train --datadir <DATADIR> --outputdir <OUTPUTDIR> --workdir <WORKDIR>
```

`<DATADIR>` is the path to the TSV files, `<OUTPUTDIR>` is a directory that will
contained the best trained model, and `<WORKDIR>` is a temporary directory containing
preprocessed dataset files, intermediate training steps, Tensorboard event files,
and debugging logs. `<WORKDIR>` should be on a file system with at least 10GB free;
do not use a tmpfs such as `/tmp` for it.

Training will also automatically evaluate on the validation set, and output the best
scores and error analysis.

To evaluate on the test set, use:
```
genie evaluate --datadir <DATADIR> --outputdir <OUTPUTDIR> --workdir <WORKDIR>
```

#### Step 6. Deploying

The resulting trained model can be deployed using `genie-server`, provided by the
[genie-parser](https://github.com/Stanford-Mobisocial-IoT-Lab/genie-parser) package.
Please refer to its documentation for instructions.

### Modifying ThingTalk

If you want to also extend ThingTalk (with new syntax or new features) you will need to
fork and modify the library, which lives at <https://github.com/Stanford-Mobisocial-IoT/thingtalk>.
After modifying the library, you can use `yarn link` or a combination of package.json `dependencies`
and `resolutions` to point the almond-cloud installation to your library. You must make sure
that only one copy of the ThingTalk library is loaded (use `find node_modules/ -name thingtalk` to check).

If you modify the ThingTalk syntax, you must also point genie-parser to a modified parser for the ThingTalk grammar
(to perform automatic syntax checks). See the ThingTalk documentation for how to generate this.
