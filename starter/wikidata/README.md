# Starter Code for Wikidata

This directory contains the basic starter code to train a single-turn Q\&A semantic parsing model for a [Wikidata](https://wikidata.org) domain.

By following the instructions in this starter code, you will create a [Thingpedia](https://wiki.almond.stanford.edu/thingpedia) skills that can answer questions over Wikidata. You will also create a natural language model to go along with that skill.

## Configuration
### Install `genienlp`
Install `genienlp` following the instructions [here](https://github.com/stanford-oval/genienlp). 
Alternatively, clone the repo and run `pip3 install -e .` to install the latest version.

### Set developer key
Create a file called `config.mk`  and add the following line:
```bash
developer_key = 
```
Append your Thingpedia developer key after the `=` sign. A Thingpedia developer account is required to obtain the developer key. 
[Register an Almond account](https://almond.stanford.edu/user/register) at <https://almond.stanford.edu> and [sign up as a developer](https://almond.stanford.edu/user/request-developer), then you can retrieve the developer key from your [user profile](https://almond.stanford.edu/user/profile) page

### Set experiment
Add the following line to the `config.mk` file:
```bash
experiment =
```
`experiment` specifies a domain in Wikidata ontology. Append the domain you want to experiment on after the `=` sign.

The starter code contains for 10 domains: `city`, `country`, `star`, `university`, `company`,
`people`, `artist`, `athlete`, `sports-team`, and `tv-series`.

Alternatively to setting in `config.mk`, you can also specify the experiment
on the command-line with `make experiment=...` instead of a bare `make`.

## Step 1. Generate Skill Manifest and Parameter Value Sets
A Thingpedia skill starts with a _manifest_ containing the signature of _queries_ (database schemas) and _actions_ (API calls that perform side-effects) in that skills. In this case, we're creating a Q&A skill, so we're only interested in queries. You can learn more about manifests for Thingpedia skills, and their syntax, in the [Thingpedia guide](https://wiki.almond.stanford.edu/thingpedia/guide/classes).

Each query includes the _properties_ that can be asked for each query, their [ThingTalk type](https://wiki.almond.stanford.edu/thingtalk/reference), as well as natural language _annotations_ for each property. These annotations will be will be used to generate both the training data and the replies from the agent.
A detailed introduction of how to annotate properties is provided in the [natural language chapter of the Thingpedia Guide](https://wiki.almond.stanford.edu/thingpedia/guide/natural-language).
 
The most important annotation is the _canonical form_, denoted with `#_[canonical]`, which indicates how the property is referred to in natural language, in the different part of speech. The full list of all the various parts of speech is provided in the [annotation reference](https://wiki.almond.stanford.edu/genie/annotations#canonical-forms).

For Wikidata, Genie can automatically generate a `manifest.tt` file given a domain. Use 
```bash
make $(exp)/manifest.tt
```
where `$(exp)` should be replaced with the domain you have chosen.  
Genie loads the Wikidata dump provided by [CSQA](https://amritasaha1812.github.io/CSQA/), and based on which, it generates the `manifest.tt` as well as parameter values which located under `$(exp)/parameter-datasets/`.

By default, Genie uses only the name of the property as the annotation. 
One can enable _auto annotator_ by the following command
```bash
make $(exp)/manifest.tt annotation=auto
```
Remove `$(exp)/manifest.tt` if it's already existed. Once enabled, Genie will download a pretrained paraphraser model and use that to generate annotations automatically. 
For more details, please refer to our [AutoQA paper](https://almond-static.stanford.edu/papers/autoqa-emnlp2020.pdf).

## Step 2. Generate Training Data and Validation Data
Genie can automatically synthesize training data based on the `manifest.tt` and the parameter values. 
Run the following command to generate a sample dataset: 
```
make target_pruning_size=10 datadir
```
With `target_pruning_size` set to 10, Genie can generate a small dataset quickly without demanding a lot of memory. 
This allows a quick check on if the synthesis dataset looks reasonable. 
For debugging, you can increase the verbosity with:
```bash
make target_pruning_size=10 custom_generate_flags="--debug $N" datadir
```
where `$N` is a number between 1 and 5 (1 or 2 are usually good choices).
**Hint**: Use `cat datadir/train.tsv | shuf | head -n10` on the command-line to get a small random sample of the dataset to look at.

Once ready, remove the `target_pruning_size` override to generate the full dataset as follows:
```bash
rm -rf datadir $(exp)/synthetic.tsv $(exp)/augmented.tsv
make datadir
```
Generating a full dataset requires a few hours and about 16GB of RAM.
The process shows a progress bar, but the time estimate is unreliable.

The dataset consists of two files, `train.tsv` for training and `eval.tsv` for dev set.
Each file is tab-separated with three column: the ID of the sentence 
(consisting of [flags](https://wiki.almond.stanford.edu/nlp/dataset) and a sequential number), 
the sentence, and the corresponding ThingTalk code.
The dev set is converted from [CSQA](https://amritasaha1812.github.io/CSQA/) by filtering only questions the given domain. 


## Step 3. Train
Now you have generated a training dataset. You can do a test run for training with:
```bash
make train_iterations=30 train_save_every=10 train_log_every=5 train
```
This will train a model with a tiny number of iterations to verify the generated dataset is valid. 

You can set the unique identifier of the model by setting `model=${model_id}`. By default, the model is called "1".  The model is saved in `$(exp)/models/$(model)`.

To run the full training, run the following command:
```bash
make model=${model_id} train
```
This takes about 5 hours on a single V100 GPU.

If you want, you can also change the hyperparameters used for training with:
```bash
make model=${model_id} eval_set=eval-synthetic custom_train_nlu_flags="..." train
```
Set `custom_train_nlu_flags` to the `genienlp` command-line arguments you want to set. Use `genienlp train --help` to find the full list of available options. For example, to use 3 LSTM layers in the decoder instead of 2, use `custom_train_nlu_flags="--rnn_layers 3"`.


## Step 4. Evaluate
After training, you can evaluate again with:
```
make model=${model_id} evaluate
```

The result will be stored under `$(exp)/eval/${model}.results`. The first line shows the overall accuracy, and the rest of lines show the accuracy break down by the complexity, based on the number of properties used in the question (1, 2, and 3+). For each row, the first number is the total number of examples, and the second number is the accuracy. The other columns are are metrics of partial correctness that indicate if the model can identify parts of the ThingTalk code; they are not meaningful for Wikidata queries so you can ignore them.

Under the same directory, you will find a file named `$(exp)/eval-synthetic/${model}.debug`. The file contains all the examples that the model failed to predict. Each row is tab-separated with the following columns: example ID, type of failure, utterance, expected ThingTalk, and predicted ThingTalk.
