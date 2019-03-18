# Reproducing the results the PLDI 2019 paper

Genie was used in the paper _Genie: A Generator of Natural Language Parsers for Compositional Virtual Assistants_,
conditionally accepted to PLDI 2019.

To reproduce those results, first download the dataset from:
<https://oval.cs.stanford.edu/datasets/pldi19-quote-free.zip>

The dataset contains the following folders:
- `new-combinations`
- `new-combinations-noparamexpansion`
- `new-combinations-posparams`
- `spotify`
- `aggregate-ext`
- `policy`

These correspond to the four experiments described in the paper, plus two datasets
that are needed for ablation studies (see below).

Each folder contains three files:
- `train.tsv`
- `eval.tsv`
- `test.tsv`
corresponding respectively to the train, validation and test sets.

Each file contains one data point per line, formatted as:
```
<id>\t<sentence>\t<program>
```
where `<id>` combines a unique identifier for the data point and a set of flags that
indicate how the data point was obtained:
- S: \[S\]ynthetic
- P: Augmented with \[P\]PDB
- R: Had parameters \[R\]replaced

To train, use:
```
genie train --datadir <DATADIR> --outputdir <OUTPUTDIR> --workdir <WORKDIR> --config-file data/ablation/full.json
```
`<DATADIR>` is the path to the TSV files, `<OUTPUTDIR>` is a directory that will
contained the best trained model, and `<WORKDIR>` is a temporary directory containing
preprocessed dataset files, intermediate training steps, Tensorboard event files,
and debugging logs.

Training will also automatically evaluate on the validation set, and it will output the best
scores and error analysis.

To evaluate on the test set, use:
```
genie evaluate --datadir <DATADIR> --outputdir <OUTPUTDIR> --workdir <WORKDIR> --config-file config.json
```

The following flags can be used for ablation studies:
- `--config-file data/ablation/no-spans.json`: use word-level copying instead of span copying
- `--config-file data/ablation/no-max-margin.json`: use softmax (cross-entropy) loss instead of max-margin

Use instead the following datasets for the ablation studies:
- `new-combinations-noparamexpansion`: training without parameter expansion
- `new-combinations-posparams`: positional instead of keyword parameters; you must also pass `--config-file data/ablation/posparams.json`

You must pass the same flags for training and evaluation.

You can use `grep -P '^R?P?S'` to construct a training set containing only synthetic sentences,
and `grep -v -P '^R?(P|S)'` to construct a training set with only paraphrased sentences,
without augmentation. The resulting training set must be called `train.tsv`, so it's recommended
to copy everything over to a new folder.

To customize parameters other than the one in the ablation studies, you
can create a customized configuration file, or use [genie-parser](https://github.com/Stanford-Mobisocial-IoT-Lab/genie-parser) directly.
Please refer to the genie-parser documentation for details.
