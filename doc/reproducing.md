# Reproducing the results the PLDI 2019 paper

Genie was used in the paper _Genie: A Generator of Natural Language Parsers for Compositional Virtual Assistants_,
published in PLDI 2019.

To reproduce those results, first download the dataset from:
<https://oval.cs.stanford.edu/datasets/pldi2019.zip>

The dataset contains four folders:
- `new-combinations`
- `spotify`
- `aggregate-ext`
- `policy`

These correspond to the four experiments described in the paper.

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
genie train --data-dir <DATADIR> --output-dir <OUTPUTDIR> --workdir <WORKDIR> [--synthetic-only | --paraphrase-only] --config-file config.json
```
`<DATADIR>` is the path to the TSV files, `<OUTPUTDIR>` is a directory that will
contained the best trained model, and `<WORKDIR>` is a temporary directory containing
preprocessed dataset files, intermediate training steps, Tensorboard event files,
and debugging logs from `luinet`.

Training will also automatically evaluate on the validation set, and output the best
scores and error analysis.

To evaluate on the test set, use:
```
genie evaluate --data-dir <DATADIR> --output-dir <OUTPUTDIR> --workdir <WORKDIR> --config-file config.json
```

The following flags can be used for ablation studies:
- `--synthetic-only`: use only synthetic data
- `--paraphrase-only`: use only non-augmented paraphrase data
- `--config-file ablation/no-keyword-params.json`: use positional parameters instead of keyword
- `--config-file ablation/no-spans.json`: use word-level copying instead of span copying
- `--config-file ablation/no-max-margin.json`: use softmax (cross-entropy) loss instead of max-margin
- `--config-file ablation/no-blowup.json`: disable the use of parameter expansion

You must pass the same `<FLAGS>` between training and evaluation.

To customize parameters other than the one in the ablation studies, you
can create a customized configuration file, or use luinet directly.
Please refer to the luinet documentation for details.
