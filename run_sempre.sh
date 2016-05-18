#!/bin/sh

# The overnight paper does not include "rule" features
# I have them because they help the parser ignore too many
# derivation that use $StringValue (which is a catch all)
exec java -ea '-Dmodules=core,overnight,freebase' \
              '-cp' 'libsempre/*:lib/*' \
              'edu.stanford.nlp.sempre.Main' \
              '-LanguageAnalyzer' 'corenlp.CoreNLPAnalyzer' \
              '-Builder.parser' 'FloatingParser' \
              '-FloatingParser.executeAllDerivations' 'true' \
              '-Builder.executor' 'NormalFormExecutor' \
              '-Grammar.inPaths' '../data/thingtalk.grammar' \
              '-FeatureExtractor.featureDomains' 'denotation' 'rule' \
              '-FeatureExtractor.featureComputers' 'overnight.OvernightFeatureComputer' \
              '-OvernightFeatureComputer.featureDomains' \
              'match' 'ppdb' 'skip-bigram' 'root' 'alignment' 'lexical' \
              'root_lexical' 'lf' 'coarsePrune' \
              '-OvernightDerivationPruningComputer.applyHardConstraints' \
              '-DerivationPruner.pruningComputer' 'overnight.OvernightDerivationPruningComputer' \
              '-FloatingParser.maxDepth' '11' \
              '-Parser.beamSize' '5' \
              '-wordAlignmentPath' '../data/thingtalk.word_alignments.berkeley' \
              '-phraseAlignmentPath' '../data/thingtalk.phrase_alignments' \
              '-PPDBModel.ppdbModelPath' '../data/thingtalk-ppdb.txt' \
              '-Learner.maxTrainIters' '1' \
              '-SimpleLexicon.inPaths' '../data/thingtalk.lexicon' \
              '-DataSet.inPaths' 'train:../data/thingtalk.examples' \
              "$@"
