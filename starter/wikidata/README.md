# Starter Code for Wikidata Single Domain

This directory contains the basic starter code to train a single-turn
Q\&A semantic parsing model for a [Wikidata](https://wikidata.org) domain.

## Installation
Genie toolkit requires`nodejs` (>=10.0) and `yarn` as a package manager. 
See [nodejs](https://nodejs.org/en/download/) and [yarn](https://classic.yarnpkg.com/en/docs/install/) for installation details. 
Genie toolkit also needs [gettext](https://www.gnu.org/software/gettext/) and [wget](https://www.gnu.org/software/wget/). 
For Mac users, you can install them by `brew install gettext wget`. 
You can check your installation by running `node --version`, `yarn --version`, `gettext --version`, and `wget --version`.

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
pip3 install --user -e .
pip3 install --user tensorboard
cd ..

```
Make sure python path is in our `PATH` environment. 
For MacOS, it should be installed under `/Users/$(username)/Library/Python/$(python-version)/bin`,
add it to your `PATH` by running:
```bash
export PATH="/Users/$(username)/Library/Python/$(python-version)/bin:$PATH"
```

## Configuration

### Set developer key
Create a file called `config.mk`  and add the following line:
```bash
developer_key = 
```
Append your Thingpedia developer key after the `=` sign. 
A Thingpedia developer account is required to obtain the developer key. 
[Register an Almond account](https://almond.stanford.edu/user/register) 
and [sign up as a developer](https://almond.stanford.edu/user/request-developer), 
then you can retrieve the developer key 
from your [user profile](https://almond.stanford.edu/user/profile) page

### Set experiment
Add the following line to the `config.mk` file:
```bash
experiment =
``` 
`experiment` specifies a domain in Wikidata ontology. 
Append the domain you want to experiment on after the `=` sign.
The starter code contains for 10 domains: `city`, `country`, `star`, `university`, `company`,
`people`, `artist`, `athlete`, `sports_team`, and `tv_series`.

## Step 1. Generate Skill Manifest and Parameter Value Sets
Genie needs a _manifest_ containing the signature of queries, to learn what can be asked. 
It includes not only the properties that can be asked for each query, but also 
natural language annotations for the properties, which will be used to generate natural sentences by Genie. 

Genie can automatically generate a `manifest.tt` file given a Wikidata domain and available properties. 
Use 
```bash
make $(exp)/manifest.tt
```
where `$(exp)` should be replaced with the domain you have chosen. 

Genie uses the Wikidata labels and [aliases](https://www.wikidata.org/wiki/Help:Aliases/en) 
as the annotations. They are categorized into different parts of speech using using a heuristic algorithm. 
A detailed introduction of the annotation syntax can be 
found in [Almond Wiki](https://wiki.almond.stanford.edu/genie/annotations).

Genie can also automatically generate natural language annotations using pretrained language models. 
To enable that, run 
```bash
# remove existing generated manifest
make clean 
# download paraphraser model
make models/paraphraser-bart
# regenerate the manifest 
make mode=auto $(exp)/manifest.tt 
```

## Step 2. Generate Training Dataset
Run
```bash
make target_pruning_size=10 datadir
```
to generate a small training set. The training set is stored in the `datadir`.

The starter code is tuned to generate a full dataset, which will consume a lot of memory and take a long time.
Setting `target_pruning_size` to a small number like 10, allow us quickly generate a small set to examine
the quality of the generated data. 

If you are not satisfied with the dataset, go to step 3.
If you are satisfied, you can now generate the full dataset:
```bash
rm -rf datadir
make datadir
``` 

## Step 3. Iterate Natural Language Annotations in the Manifest
One can also fine-tune natural language annotations, by updating `MANUAL_PROPERTY_CANONICAL_OVERRIDE` in 
`tool/autoqa/wikidata/manual-annotations.js`. To enable the manual annotations, run 
```bash
make clean
make mode=manual $(exp)/manifest.tt
```
For properties not specified, it will keep the Wikidata labels and aliases as annotations. 

Once finished, you can go back to step 2 to regenerate the dataset. 

## Step 4. Train
Now you have generated a training dataset, you can do a test run for training by:
```bash
make train_iterations=30 train_save_every=10 train_log_every=5 train
```
This will train a model with a tiny number of iterations to verify the generated dataset is valid. 

You can set the unique identifier of the model by setting `model=${model_id}`. By default, the model is called "1". 
The model is saved in `$(exp)/models/$(model)`.

To run the full training, simply run the following command:
```bash
make mode=$(model) train
```
This takes about 5 hours on a single V100 GPU.

## Step 5. Evaluate
The starter code will split the synthesized data into training set and a synthetic dev set. 
One can evaluate on the synthetic dev set by running the following command: 
```bash
make model=$(model) evaluate
```
The result will be stored under `$(exp)/eval-synthetic/${model}.results`. 
The first line shows the overall accuracy, and the rest of lines show the accuracy 
break down by the complexity, based on the number of properties used in the question (1, 2, and 3+).
For each row, the first number is the total number of examples, and the second number 
is the accuracy (ignore the rest).

Under the same directory, you will find a file named `$(exp)/eval-synthetic/${model}.debug`. 
It contains all the examples that the model failed to predict. 
Each row is tab separated with the following columns: example ID, type of failure, utterance,
expected ThingTalk, and predicted ThingTalk.

If you obtain your own evaluation data, you can add it to `$(exp)/eval/annotated.tsv` for the dev set,
and `$(exp)/test/annotated.tsv` for the test set. 
Data added to the dev set will be also used during training for cross-validation.
You can change the evaluation set
by setting `eval_set` to "eval" or "test" as:
```bash
make experiment=$(exp) model=$(model) eval_set=$(eval-set) evaluate
```


## Step 6. Testing 
You can test your model interactively. Run
```bash
make model=$(model) demo
```
You can type in a question in natural language, it will return the parsed ThingTalk and a SPARQL equivalent. 
Then it will try to query the Wikidata SPARQL endpoint to retrieve the results. 

It takes some time to load the model for the first time. Wait until you see the following information before you 
start testing. 
```
XX/XX/XXXX XX:XX:XX - INFO - genienlp.server -   Initializing Model
XX/XX/XXXX XX:XX:XX - INFO - genienlp.server -   Vocabulary has 30600 tokens from training
XX/XX/XXXX XX:XX:XX - INFO - genienlp.server -   Seq2Seq has 134,733,632 parameters
``` 

Note that this feature is still experimental. Some ThingTalk program might failed to be translated to SPARQL, 
and some complicated SPARQL programs might cause a TIMEOUT when querying Wikidata's server. 
