# Starter Code for Wikidata Single Domain

This directory contains the basic starter code to train a single-turn Q\&A semantic parsing model for a [Wikidata](https://wikidata.org) domain.

By following the instructions in this starter code, you will create a [Thingpedia](https://wiki.almond.stanford.edu/thingpedia) skills that can answer questions over Wikidata. You will also create a natural language model to go along with that skill.

## Configuration

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

For Wikidata, Genie can automatically generate a `manifest.tt` file given a domain and available properties. Use 
```bash
make $(exp)/manifest.tt
```
where `$(exp)` should be replaced with the domain you have chosen. 

By default, Genie uses the Wikidata labels and [aliases](https://www.wikidata.org/wiki/Help:Aliases/en) to construct the canonical forms. The labels are categorized into different parts of speech using using a heuristic algorithm.

**Task**: Look at the manifest now (in your favorite text editor). Each property is annotated with various ways to refer to it in natural language. Is that comprehensive? Can you think of other synonyms or other syntactic forms for each property? The more forms that are added to the manifest, the more robust will be the model to the different ways to phrase the same question.

## Step 2. Download a Pretrained Model

A pretrained model of each wikidata skill, trained on synthesized data created from the base annotations, is available for download from <https://almond-static.stanford.edu/test-data/wikidata/$(exp)/pretrained.tar.gz> (e.g. <https://almond-static.stanford.edu/test-data/wikidata/city/pretrained.tar.gz> for the "city" domain).

You can download the model with the following command:
```
wget https://almond-static.stanford.edu/test-data/wikidata/$(exp)/pretrained.tar.gz
tar xvf pretrained.tar.gz
```

The model will be stored in `$(exp)/models/pretrained`.

## Step 3. Evaluate on Synthetic Data
The starter code will split the synthesized data into training set and a synthetic dev set.  You can evaluate on the synthetic dev set by running the following command: 
```bash
make model=${model_id} eval_set=eval-synthetic evaluate
```
The model id corresponds to a folder in `$(exp)/models/`. The model ID is `pretrained` for the pretrained model downloaded from our server.

The result will be stored under `$(exp)/eval-synthetic/${model}.results`. The first line shows the overall accuracy, and the rest of lines show the accuracy  break down by the complexity, based on the number of properties used in the question (1, 2, and 3+). For each row, the first number is the total number of examples, and the second number is the accuracy. The other columns are are metrics of partial correctness that indicate if the model can identify parts of the ThingTalk code; they are not meaningful for Wikidata queries so you can ignore them.

**Task**: What accuracy do you get at this step? Do you think this model will achieve this accuracy when you try it in real life?

Under the same directory, you will find a file named `$(exp)/eval-synthetic/${model}.debug`. The file contains all the examples that the model failed to predict. Each row is tab-separated with the following columns: example ID, type of failure, utterance, expected ThingTalk, and predicted ThingTalk.

## Step 4. Evaluate on Real Data
Evaluating on synthetic data is not very meaningful, because synthetic data is too easy, so the accuracy is artificially high. Instead, we will evaluate on real questions, written by a human and annotated manually with their ThingTalk code.

To do so, you should have somebody (ideally, somebody else) write down some questions that can be answered using Wikidata property. One good way to do so is through crowdsourcing, by showing the list of properties to a worker and asking some questions. Save those questions in a file called `$(exp)/eval/input.txt`, one per line. The input.txt file must have the single word "utterance" on the first line (the header).

After obtaining the questions, you can now annotate them with the corresponding ThingTalk code. Use:
```
make model=${model_id} eval_set=eval annotate
```
to open an interactive tool that will help you annotate.

The tool shows you the top candidates predicted by the trained model will be provided (usually just one, sometimes none). You can type in the number of the candidate to choose the correct one. If none of the candidate is correct, but some candidate is close to what we want, you can type in `e ${number}` (short for "edit"), which will allow you to modify the code based on the existing prediction. If the model failed to predict anything useful, you will need to type in the correct ThingTalk program from scratch. If you find a question cannot be represented in ThingTalk, type in `d ${comment}` (short for "dropped") to drop the sentence. You can learn more on how to write ThingTalk code from the [ThingTalk guide](https://wiki.almond.stanford.edu/en/thingtalk/guide).

The annotated sentences will be stored in `$(exp)/eval/annotated.tsv`. This file has the same format as the training set: ID, sentence, code. Dropped sentences will be saved in `$(exp)/eval/dropped.tsv`.

If you make a mistake, you can exit the annotation tool and edit the annotated files by hand. Do not edit the files by hand if the tool is still running, or you might corrupt the files. After editing, you can resume annotating with `annotate_offset`. For example, to resume on the 15th sentence, use:
```
make model=${model_id} eval_set=eval annotate_offset=15 annotate
```
(Sentences are numbered starting from one. The tool shows the sentence number as "Sentence #...").

After you have annotated the data, run
```bash
make model=${model_id} eval_set=eval evaluate
```
To obtain the new accuracy.

**Task**: Is the new accuracy similar to the accuracy you had on synthetic data? What changed?

**Task**: Now look at the error analysis file at `$(exp)/eval/${model}.debug`. Do you notice a pattern in the errors? Are there particular sentences that the model got consistently wrong?

You can use the information in the error analysis to refine the annotations (Step 3), generate a new dataset (Step 2), and train a new model (Step 4). When you train the model, you can now pass `eval_set=eval` instead of `eval_set=eval-synthetic`. This way, during training the model will cross-validate on your real data, which will boost your accuracy by a few points for free. 

## Step 5. Iterate Natural Language Annotations in the Manifest
The pretrained model is good, but not great. To improve it, we will need to improve the quality of the training data.
We will start from substituting the automatically generated annotations with manually written ones.

For Wikidata, you do so by updating `MANUAL_PROPERTY_CANONICAL_OVERRIDE` in 
`tool/autoqa/wikidata/manual-annotations.js` in the Genie folder. For example, to annotate the property date of birth (P569), write:
```js
const MANUAL_PROPERTY_CANONICAL_OVERRIDE = {
    P569: {
        base: ["date of birth", "birth date"],
        passive_verb: ["born on #"],
        adjective_argmin: ["oldest"],
        adjective_argmax: ["youngest"],
        verb_projection: ["born on"],
    }
};
```
Look at the existing automatically generated manifest for additional examples. The full list of properties and their ID is in [domains.md](domains.md).
The full list of all the various parts of speech is provided in the [annotation reference](https://wiki.almond.stanford.edu/genie/annotations#canonical-forms).

**Note**: adding a property to `MANUAL_PROPERTY_CANONICAL_OVERRIDE` will remove any automatically generated annotation. If you like some of existing annotations, make sure to copy them!

To enable the manual annotations, run 
```bash
make mode=manual $(exp)/manifest.tt
```
For properties that not specified in the `manual-annotations.js` file, Genie will keep the Wikidata labels and aliases as annotations. 

## Step 6. Generate Training Dataset

Run
```bash
make target_pruning_size=10 datadir
```
to generate a small training set. The training set is stored in the `datadir`.

The starter code is tuned to generate a full dataset, which will consume a lot of memory and take a long time. Setting `target_pruning_size` to a small number like 10, allow us quickly generate a small set to examine the quality of the generated data.

The dataset consists of two files, `train.tsv` for training and `eval.tsv` for dev set. Each file is tab-separated with three column: the ID of the sentence (consisting of [flags](https://wiki.almond.stanford.edu/nlp/dataset) and a sequential number), the sentence, and the corresponding ThingTalk code.

**Task**: Open the generated training set (`datadir/train.tsv`) in your favorite text editor or spreadsheet application. Can you see the correspondence between ThingTalk syntax and the natural language sentence? Do you notice something about the sentences? Are all sentences grammatical? Are they all meaningful? Think of a paraprase that you would use for a simple question: can you find it in the dataset?

**Hint**: Use `cat datadir/train.tsv | shuf | head -n10` on the command-line to get a small random sample of the dataset to look at.

If you are satisfied with the sentence you obtained, you can now generate the full dataset:
```bash
rm -rf datadir $(exp)/synthetic.tsv
make datadir
```
Generating a dataset requires a few hours and about 16GB of RAM.
(That is, you should run on a machine that has at least 18-20GB of RAM, so you leave enough for the OS and any other application you are running at the same time).
The process shows a progress bar, but the time estimate is unreliable.

For debugging, you can increase the verbosity with:
```bash
make custom_generate_flags="--debug $N" datadir
```
where `$N` is a number between 1 and 5 (1 or 2 are usually good choices).

**Note**: if you use `make clean` instead of removing the dataset with `rm`, you will also remove manifest.tt. The manifest will be regenerated the next time you run the dataset, and it might be regenerated with the wrong options. You can pass `mode` to `make datadir` to ensure the manifest is always generated in the right way.

If you are not satisfied with the dataset — for example, if the sentences are too ungrammatical, or if you cannot find a certain question — go to step 5 and write more annotations.

## Step 7. Train
Now you have generated a training dataset. You can do a test run for training with:
```bash
make train_iterations=30 train_save_every=10 train_log_every=5 train
```
This will train a model with a tiny number of iterations to verify the generated dataset is valid. 

You can set the unique identifier of the model by setting `model=${model_id}`. By default, the model is called "1".  The model is saved in `$(exp)/models/$(model)`.

To run the full training, run the following command:
```bash
make model=${model_id} eval_set=eval-synthetic train
```
This takes about 5 hours on a single V100 GPU.

If you want, you can also change the hyperparameters used for training with:
```bash
make model=${model_id} eval_set=eval-synthetic custom_train_nlu_flags="..." train
```
Set `custom_train_nlu_flags` to the `genienlp` command-line arguments you want to set. Use `genienlp train --help` to find the full list of available options. For example, to use 3 LSTM layers in the decoder instead of 2, use `custom_train_nlu_flags="--rnn_layers 3"`.

After training, you can evaluate again with:
```
make model=${model_id} eval_set=eval evaluate
```

**Task**: The new model is trained on data that is more similar to the dev data, thanks to the annotations you wrote in Step 5. Is this reflected in the accuracy? 

## Step 8. Test Data

In addition to the dev data, which you can use to improve the accuracy of the model, you should acquire a _test set_. The test set will give you a final accuracy number that you can for example report in a paper or benchmark. The test set should be as similar as possible to the dev set. **You should not look at the test set until you are done improving the model**.

The test data is stored and annotated identically to the dev data, except the input file goes in 

You can change the evaluation set by setting `eval_set` to "eval" (dev) or "test" as:
```bash
make model=${model} eval_set=${eval_set} evaluate
```

## Step 9. Interactive Testing 
You can test your model interactively. Run
```bash
make model=$(model) demo
```
You can type in a question in natural language, and it will return the parsed ThingTalk and a SPARQL equivalent.  Then it will try to query the Wikidata SPARQL endpoint to retrieve the results. 

It takes some time to load the model for the first time. Wait until you see the following information before you 
start testing. 
```
XX/XX/XXXX XX:XX:XX - INFO - genienlp.server -   Initializing Model
XX/XX/XXXX XX:XX:XX - INFO - genienlp.server -   Vocabulary has 30600 tokens from training
XX/XX/XXXX XX:XX:XX - INFO - genienlp.server -   Seq2Seq has 134,733,632 parameters
``` 

Note that this feature is still experimental. Some ThingTalk program might failed to be translated to SPARQL, 
and some complicated SPARQL programs might cause a TIMEOUT when querying Wikidata's server. 
