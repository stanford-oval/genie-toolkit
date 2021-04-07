# Tutorial 1: Basic Sentence Generation

In this tutorial, you will learn the basics of Genie: how to generate a dataset
of virtual assistant commands, how to train a model on it, and how to deploy
the model.

Note: this tutorial assumes that you installed Genie using the ["git" installation
instructions](install.md). If you used the "npm" installation method, you will
need to adjust the paths. 

## Step 1: Obtain the skill definitions

The first step in this tutorial is to obtain the definitions of the virtual assistant
skills for which you want to build a dataset. We will need three files:

- thingpedia.tt: the API signatures and annotations
- dataset.tt: primitive templates describing how the APIs are invoked in natural language
- entities.json: metadata about entity types used in the APIs.

You can retrieve the first two for a given skill from [Thingpedia](https://thingpedia.stanford.edu).
For example, for the [Bing skill](https://almond.stanford.edu/thingpedia/devices/by-id/com.bing),
you can retrieve them from <https://almond.stanford.edu/thingpedia/classes/by-id/com.bing>.
See the [Thingpedia documentation](https://almond.stanford.edu/thingpedia/developers/thingpedia-nl-support.md)
for additional description of these files.

You can also retrieve the entirety of Thingpedia by issuing:
```bash
genie download-snapshot -o thingpedia.tt
genie download-templates -o dataset.tt
genie download-entities -o entities.json
```

## Step 2: Obtain Parameter Datasets

To create a training set, you must obtain the datasets for the various open-ended
parameters in your APIs, also known as "gazettes" or "ontologies". These are
lists of song names, people names, restaurant names, etc. - anything that is relevant
to your skill. They don't need to be comprehensive (the user is always free to
pick up a name you did not think of!), but the more you have, the more robust your model will be.

You should then create a parameter-datasets.tsv file mapping a string type to a
downloaded dataset file.
A sample parameter-datasets.tsv can be found in [here](https://github.com/stanford-oval/genie-toolkit/blob/master/test/data/parameter-datasets.tsv).

Because different datasets have different licenses and restrictions (such as the requirement to cite
a particular paper, or a restriction to non-commercial use), Genie does not include any dataset directly.
You can obtain the datasets Almond uses at <https://almond.stanford.edu/thingpedia/strings> and
<https://almond.stanford.edu/thingpedia/entities>. Download
is available after registration and accepting the terms and conditions.

If you have an appropriate Thingpedia developer key, you can also download the datasets
with:
```bash
genie download-entity-values -d parameter-datasets/ --manifest parameter-datasets.tsv
genie download-string-values -d parameter-datasets/ --manifest parameter-datasets.tsv --append-manifest
```

These commands will download into the `parameter-datasets` directory, and
create a manifest called `parameter-datasets.tsv`. 

## Step 3: Synthesize Sentences.

Given the skill definition, we will proceed to synthesize a dataset of commands that we
can train on. To do so, use:

```bash
genie generate --locale en-US --template languages-dist/thingtalk/en/thingtalk.genie
  --thingpedia thingpedia.tt --entities entities.json --dataset dataset.tt
  -o synthesized.tsv
```

The format of resulting file is tab-separated, with three columns: ID, sentence,
target program. The ID contains a unique number and various "flags" in uppercase
letters, indicating the type of sentence.

There are a number of hyperparameter you can set, which allow you to choose a
tradeoff between dataset size (and computational cost) and model quality. Check
`genie generate --help` for details.

NOTE: the `generate` command can require significant amounts of memory.
If you experience out of memory, it can help to invoke `node` as:
```
node --max_old_space_size=8000 `which genie` ...
```
or however much memory you want to dedicate to the process (in MB).

## Step 4: Data Augmentation

After creating the synthesized dataset, use the following command to augment the dataset
and apply parameter replacement:
```
genie augment synthesized.tsv --locale en-US --thingpedia thingpedia.tt
 --parameter-datasets parameter-datasets.tsv -o augmented.tsv
```

As written, this command will only process the synthesized dataset. If you have
additional data, for example a paraphrase dataset, you can add to the command line.

If you want to take advantage of multiple threads for speed, add `--parallelize`
followed by the number of threads to use, e.g. `--parallelize 4` to use 4 CPU cores.

There are also a number of hyperparameter you can set. Check
`genie augment --help` for details.

## Step 5: Training And Evaluation Sets

Given the created augmented.tsv file, you can split in train/eval/test with:
```
genie split-train-eval augmented.tsv --train train.tsv --eval eval.tsv [--test test.tsv] --eval-prob 0.1
  --split-strategy sentence --eval-on-synthetic
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
As you only have synthesized data, you must set `--eval-on-synthetic`, or the evaluation
sets will be empty. If you do have other data, it's recommended to omit this option instead,
because synthetic data overestimates the model performance by quite a lot.
It is recommended that you obtain a separate set of real user data, and pass
that to this command. In that case, set `--eval-prob` to the percent of real data
you wish to use.

If you can also choose specific sentences to use for evaluation. To do so,
prefix the IDs of the data you want to use for evaluation with "E", and add the
"--eval-flag". The script will then remove any duplicate of those sentences
from the training set.

If `--test` is provided, the command will generate a test set as well. Regardless of `--split-strategy`,
the test set is always split naively from the evaluation/development set, so the same sentence can appear
in both.

### Step 6: Training

To train, use:
```bash
genie train --datadir <DATADIR> --outputdir <OUTPUTDIR> --workdir <WORKDIR>
  --config-file data/bert-lstm-single-sentence.json
```

`<DATADIR>` is the path to the TSV files, `<OUTPUTDIR>` is a directory that will
contained the best trained model, and `<WORKDIR>` is a temporary directory containing
preprocessed dataset files, intermediate training steps, Tensorboard event files,
and debugging logs. `<WORKDIR>` should be on a file system with at least 5GB free;
do not use a tmpfs such as `/tmp` for it.
Use the optional config file to pass additional options to the genienlp library, or
adjust hyperparameters. The "bert-lstm-single-sentence.json" file in [data](../data)
has the recommended parameters for our use case.
You can pass `--debug` to increase output verbosity.

Training will also automatically evaluate on the validation set, and output the best
scores and error analysis.

To evaluate on the test set, use:
```
genie evaluate-server --url file://<OUTPUTDIR> --thingpedia thingpedia.tt test.tsv
```
You can pass `--debug` for additional error analysis, and `--csv` to generate machine parseable
output.

To generate a prediction file for a test set, use:
```
genie predict --url file://<OUTPUTDIR> -o predictions.tsv test.tsv
```

The prediction file can also be evaluated as:
```
genie evaluate-file --thingpedia thingpedia.tt --dataset test.tsv --predictions predictions.tsv
```
Sentence IDs in the test.tsv file and the prediction file must match, or an error occurs.

### Step 7: Deploying

The resulting trained model can be deployed as a server, by running the command:
```
genie server --nlu-model file://<OUTPUTDIR> --thingpedia thingpedia.tt -l en-US
```

The server listens on port 8400 by default. Use `--port` to change the port.

You can then set the URL of that server as the server URL for your Almond
to use the newly trained model.
