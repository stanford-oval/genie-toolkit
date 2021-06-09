# Tutorial 2: MTurk Paraphrasing

In this tutorial, you will learn how to use Amazon Mechanical Turk to obtain
paraphrase datasets that will improve the quality of your trained models.



Note: this tutorial assumes familiarity with the basics of Genie. It is
recommended to follow [Tutorial 1](tutorial-basic.md) first.

## Step 1: Acquire the Skill Definition

The first step is to define the skill you want to improve with paraphrasing,
in terms of thingpedia.tt, dataset.tt and entities.json.
See [the first tutorial](tutorial-basic.md) for how to do so.

## Step 2: Synthesize Sentences To Paraphrase

Next, you should synthesize a set of sentences to show the MTurk workers.
To do so, use:

```bash
genie generate --locale en-US --thingpedia thingpedia.tt --entities entities.json --dataset dataset.tt
  -o synthesized.tsv --set-flag turking
```

This command is similar to the usual synthesis command, but includes the
`--set-flag turking` option. This indicates that the sentences should be
optimized for human paraphrasing, rather than training.

## Step 3: Choose The Sentences To Paraphrases.

A synthesized dataset is usually very big, and it would be too expensive
to paraphrase fully, so we will sample a subset from it.
To choose which sentences to paraphrase, use:
```
genie sample synthesized.tsv --constants constants.tsv --sampling-strategy bySignature --sampling-control easy-hard-functions.tsv -o mturk-input.tsv
```

Use `constants.tsv` to choose which values to use for each constant, based on type and parameter name.
This parameter cannot be omitted.
A default that is appropriate for English and the reference Thingpedia can be found at [data/en-US/constants.tsv](data/en-US/constants.tsv).

Use `--sampling-control` to choose which functions are hard and which functions are easy; this affect
the proportion of paraphrase inputs that will use each functions. See [data/easy-hard-functions.tsv](data/easy-hard-functions.tsv) for details of the file format. If omitted, all functions are considered equally hard.

You can also modify [lib/paraphrase-sampler.js](lib/paraphrase-sampler.js) to further adapt how
sampling occurs, based on program complexity, sentence complexity or other heuristics.

Note: The output of this step is in a format
suitable for use with the paraphrasing website provided by [almond-cloud](https://github.com/stanford-oval/almond-cloud),
which provides one-click integration with Amazon MTurk.

### Step 4: Paraphrasing

Next, we'll deploy a _Human Intelligence Task_ (HIT) asking workers to paraphrase
our synthetic sentences.
Prepare the paraphrasing HITs with:
```
genie mturk-make-paraphrase-hits -o paraphrasing-hits.csv < mturk-input.tsv
```
The resulting `paraphrasing-hits.csv` will be suitable to use on Amazon MTurk using the template provided
in [data/mturk/paraphrasing-template.html](data/mturk/paraphrasing-template.html).

When the HIT is complete, download the result from the MTurk website, and name it "paraphrasing-results.csv".

### Step 5: Validation

To reduce errors in the obtained paraphrases, we'll then run another HIT, validating
that the paraphrases are correct. You can prepare the validation HITs with:
```
genie mturk-make-validation-hits -o validation-hits.csv < paraphrasing-results.csv
```

The template for validation HITs lives at [data/mturk/validation-template.html](data/mturk/validation-template.html)

When the HIT is complete, download the result from the MTurk website, and name it "validation-results.csv".

Note: if you trust the MTurk workers, you can skip this step, saving some money.
Usually, 10% of the paraphrases are found to be erroneous at this step.

### Step 6: Complete The Dataset

Finally, after completing the validation HITs, you can obtain the paraphrasing dataset with:
```
genie mturk-validate
  --paraphrasing-input paraphrasing-results.csv --validation-input validation-hits.csv
  --validation-count 4 --validation-threshold 4
  -o paraphrasing.tsv
  --paraphrasing-rejects paraphrasing-rejects.csv --validation-rejects validation-rejects.csv
```
The resulting `paraphrasing.tsv` can then passed to `genie augment` and used
for training.

`--validation-count` controls the number of workers that vote on each sentence
(which must match the setting "number of workers per HIT" on the MTurk website
for the validation task), and `--validation-threshold` is the number of workers
that must approve of a sentence before it is included in the datasets.
The `--paraphrasing-rejects` and `--validation-rejects` arguments generate reject files
that can be used in Amazon MTurk to reject the completed tasks.

If you wish to skip manual validation, use a `--validation-threshold` of 0.
In that case, `--validation-input` is not necessary.
The script will still perform automatic validation.
