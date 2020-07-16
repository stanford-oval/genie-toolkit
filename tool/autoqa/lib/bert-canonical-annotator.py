import csv
import argparse
import json
import sys
import torch
import torch.nn.functional as F
from transformers import BertTokenizer, BertForMaskedLM, GPT2Tokenizer, GPT2LMHeadModel

BLACK_LIST = ['a', 'an', 'the', 'its', 'their', 'his', 'her']
ALL_CATEGORIES = ['base', 'property', 'verb', 'passive_verb', 'reverse_property', 'reverse_verb', 'preposition']

def split_canonical(canonical):
    """
    Split a canonical into prefix and suffix based on value sign #

    :param canonical: the canonical to split
    :return: prefix and suffix
    """
    if '#' not in canonical:
        return canonical, ''
    if canonical.startswith('#'):
        return '', canonical[1:].strip()
    return list(map(lambda x: x.strip(), canonical.split('#')))


def template_query(cat, query_canonical='', prefix='', value='', suffix=''):
    """
    return a template query sentence for bert

    :param cat: the grammar category of the prefix, value, and suffix
    :param query_canonical: the canonical form of the query (table), e.g., restaurant, person
    :param prefix: the prefix of the canonical form
    :param value: an example value of the property
    :param suffix: the suffix of the canonical form
    :return: a template query string
    """
    question_start = "who" if query_canonical == "person" else f"which {query_canonical}"
    if cat == 'base':
        return [
            f"what is the {prefix} of the {query_canonical} ?".split(),
            f"what is the {query_canonical} 's {prefix} ?".split(),
            f"what {prefix} does the {query_canonical} have ? ".split(),
        ]
    if cat == 'property':
        return [
            f"show me a {query_canonical} with {prefix} {value} {suffix} .".split(),
            f"{question_start} has {prefix} {value} {suffix} ?".split()
        ]
    if cat == 'verb':
        return [
            f"{question_start} {prefix} {value} {suffix} ?".split(),
            f"show me a {query_canonical} that {prefix} {value} {suffix} .".split()
        ]
    if cat in ('passive_verb', 'preposition'):
        return [
            f"show me a {query_canonical} {prefix} {value} {suffix} .".split(),
            f"{question_start} is {prefix} {value} {suffix} .".split()
        ]
    if cat == 'reverse_property':
        return [
            f"{question_start} is a {prefix} {value} {suffix} ?".split()
        ]
    # currently only do this for human properties
    if cat == 'reverse_verb':
        return [
            f"who {prefix} the {query_canonical} ?".split()
        ]

    raise Exception('Invalid grammar category: ', cat)


class GPT2Ranker:
    def __init__(self):
        self.tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
        self.model = GPT2LMHeadModel.from_pretrained('gpt2')
        self.model.eval()

    def rank(self, phrases):
        """
        Return the indices of elements in `phrases` in descending naturalness order. So phrases[GPT2Ranker.rank(phrases)[0]] is the most natural phrase
        :param phrases: a list of strings
        """
        return sorted(range(len(phrases)), key=lambda i: self.score(phrases[i]), reverse=False) # lower score means more natural sentence

    def score(self, sentence):
        indexed_tokens = self.tokenizer.encode(sentence)
        tokens_tensor = torch.tensor(indexed_tokens)

        with torch.no_grad():
            outputs = self.model(
                input_ids=tokens_tensor,
                labels=tokens_tensor
            )
            loss = outputs[0]
            score = torch.exp(loss).item() # perplexity

        return score


class BertLM:
    def __init__(self, queries, mask, k_synonyms, k_adjectives, pruning_threshold, model_name_or_path, is_paraphraser, gpt2_ordering):
        """
        :param queries: an object contains the canonicals, values, paths for args in each query
        :param mask: a boolean indicates if we do masking before prediction
        :param k_synonyms: number of top candidates to return per example when predicting synonyms
        :param k_adjectives: number of top candidates to return when predicting adjectives
        :param pruning_threshold: frequency a candidate needs to appear to be considered valid
        :param model_name_or_path: a string specifying a model name recognizable by the Transformers package
            (e.g. bert-base-uncased), or a path to the directory where the model is saved
        :param is_paraphraser: Set to True if model_name_or_path was fine-tuned on a paraphrasing dataset. The input to
            the model will be changed to match what the model has seen during fine-tuning.
        :param gpt2_ordering: a boolean indicates if we use gpt2 to check where we place value
        """

        # Load tokenizer
        self.tokenizer = BertTokenizer.from_pretrained(model_name_or_path)

        # Load pre-trained model (weights)
        self.model = BertForMaskedLM.from_pretrained(model_name_or_path)
        self.model.eval()

        self.gpt2_ordering = gpt2_ordering
        if gpt2_ordering:
            self.ranker = GPT2Ranker()

        self.is_paraphraser = is_paraphraser
        self.mask = mask
        self.k_synonyms = k_synonyms
        self.k_adjectives = k_adjectives
        self.pruning_threshold = pruning_threshold
        self.queries = queries
        self.canonicals = {}  # canonical of queries
        self.values = {}  # values of arguments
        for query in queries:
            self.canonicals[query] = queries[query]['canonical']
            self.values[query] = {}
            for arg in queries[query]['args']:
                if 'path' in queries[query]['args'][arg]:
                    self.values[query][arg] = self.load_values(queries[query]['args'][arg]['path'])
                elif 'values' in queries[query]['args'][arg]:
                    self.values[query][arg] = self.queries[query]['args'][arg]['values']

    def predict_one(self, table, arg, query, word, k):
        """
        Get top-k predictions at the position of `word` in `text`

        :param table: the function/table used in the command
        :param arg: the argument used in the command
        :param query: a string where `word` appears once
        :param word: a string of word which we want to find the alternatives
        :param k: number of top candidates to return, this defaults to self.k if absent
        :return: a array in length k of predicted tokens
        """
        if k is None:
            k = self.k_synonyms

        if self.is_paraphraser:
            # Input to BERT should be [CLS] query <paraphrase> query </paraphrase> [SEP]
            first_half = query
            second_half = query
            if self.mask:
                second_half = second_half.replace(word, '[MASK]')
                word = '[MASK]'
            text = '[CLS] ' + first_half + ' <paraphrase> ' + second_half + ' </paraphrase> [SEP]'
            tokenized_text = self.tokenizer.tokenize(text)
            indexed_tokens = self.tokenizer.convert_tokens_to_ids(tokenized_text)
            if word not in tokenized_text:
                return []
            middle_position = tokenized_text.index('<paraphrase>')
            masked_index = tokenized_text[middle_position:].index(word) + middle_position
            segments_ids = [0] * (middle_position + 1) + [1] * (len(tokenized_text) - middle_position - 1)
            position_ids = list(range(middle_position + 1)) + list(range(len(indexed_tokens) - middle_position - 1))
        else:
            # Input to BERT should be [CLS] query [SEP]
            if self.mask:
                query = query.replace(word, '[MASK]')
                word = '[MASK]'
            text = '[CLS] ' + query + ' [SEP]'

            tokenized_text = self.tokenizer.tokenize(text)
            indexed_tokens = self.tokenizer.convert_tokens_to_ids(tokenized_text)
            if word not in tokenized_text:
                return []
            masked_index = tokenized_text.index(word)

            # Create the segments tensors.
            segments_ids = [0] * len(tokenized_text)
            position_ids = list(range(len(indexed_tokens)))

        # Convert inputs to PyTorch tensors
        tokens_tensor = torch.tensor([indexed_tokens])
        segments_tensors = torch.tensor([segments_ids])
        position_tensors = torch.tensor([position_ids])

        # Predict all tokens
        with torch.no_grad():
            predictions = self.model(input_ids=tokens_tensor, token_type_ids=segments_tensors,
                                     position_ids=position_tensors)

        mask = predictions[0][0, masked_index]
        scores, indices = torch.topk(mask, max(k, 100))

        candidates = self.tokenizer.convert_ids_to_tokens(indices.tolist())
        topk = []
        for candidate in candidates:
            if candidate == word:
                continue
            if candidate in BLACK_LIST:
                continue
            if not candidate.isalpha():
                continue
            if self.canonicals[table] in candidate:
                continue
            if arg is not None and arg in self.values[table] and candidate in self.values[table][arg]:
                continue
            topk.append(candidate)
            if len(topk) == k:
                return topk
        return topk

    def predict_one_type(self, table, arg, query, masks):
        """
        Get predictions for one grammar category of given a query
        :param table: the function/table used in the command
        :param arg: the argument used in the command
        :param query: a string of the original command
        :param masks: an object containing the indices we want to predict in the form of `{ prefix: [], suffix: [] }`
        :return: an array of generated new canonicals
        """
        candidates = {}
        for i in [*masks['prefix'], *masks['suffix']]:
            predictions = self.predict_one(table, arg, query, query.split(' ')[i], None)
            for token in predictions:
                candidate = self.construct_canonical(query, masks, i, token)
                candidates[candidate] = self.replace_canonical(query, i, token)
        return candidates

    def predict(self):
        """
        Get top-k predictions for all examples

        :return: updated examples with additional candidates field for new canonicals
        """
        candidates = {}
        for query in self.queries:
            candidates[query] = {}
            for arg in self.queries[query]['args']:
                candidates[query][arg] = {}
                examples = self.construct_examples(query, arg)
                for category in examples:
                    result = {}
                    for example in examples[category]['examples']:
                        # add the original canonical
                        if example['canonical'] in result:
                            result[example['canonical']].append(example['query'])
                        else:
                            result[example['canonical']] = [example['query']]

                        # add predictions
                        sentence, masks = example['query'], example['masks']
                        predictions = self.predict_one_type(query, arg, sentence, masks)
                        for canonical, sentence in predictions.items():
                            if canonical in result:
                                result[canonical].append(sentence)
                            else:
                                result[canonical] = [sentence]
                    max_count = max([len(x) for x in result.values()])
                    pruned = self.prune_canonicals(result, max_count)
                    candidates[query][arg][category] = pruned
        return candidates

    def predict_adjectives(self):
        """
        Predict which property can be used as an adjective form

        :return: an array of properties
        """
        k = self.k_adjectives
        properties = []
        for table in self.values:
            query_canonical = self.canonicals[table]
            predictions = self.predict_one(table, None, 'show me a [MASK] ' + query_canonical, '[MASK]', k)
            for param in self.values[table]:
                values = self.values[table][param]
                for v in predictions:
                    if v in values:
                        properties.append(table + '.' + param)
                        break
        return properties

    def construct_examples(self, query_name, arg_name):
        """
        construct examples for a given argument of a query

        :param query_name: the name of the query
        :param arg_name: the name of the argument
        :return: an object containing examples in different grammar categories
        """
        examples = {}
        query_canonical = self.canonicals[query_name]
        if 'canonicals' not in self.queries[query_name]['args'][arg_name]:
            return examples

        arg_canonicals = self.queries[query_name]['args'][arg_name]['canonicals']
        for category in ALL_CATEGORIES:
            if category in arg_canonicals:
                examples[category] = {"examples": [], "candidates": []}

        if 'base' in arg_canonicals:
            for canonical in arg_canonicals['base']:
                for query in template_query('base', query_canonical, canonical):
                    mask_indices = list(map(lambda x: query.index(x), canonical.split()))
                    examples['base']['examples'].append({
                        'canonical': canonical,
                        "query": ' '.join(query),
                        "masks": {"prefix": mask_indices, "suffix": []},
                        "value": []
                    })

        if 'reverse_verb' in arg_canonicals:
            for canonical in arg_canonicals['reverse_verb']:
                for query in template_query('reverse_verb', query_canonical, canonical):
                    mask_indices = list(map(lambda x: query.index(x), canonical.split()))
                    examples['reverse_verb']['examples'].append({
                        'canonical': canonical,
                        "query": ' '.join(query),
                        "masks": {"prefix": mask_indices, "suffix": []},
                        "value": []
                    })

        # check where to put value
        if self.gpt2_ordering:
            for category in arg_canonicals:
                if category in ['default', 'adjective', 'implicit_identity', 'base', 'reverse_verb']:
                    continue
                needs_reorder = []
                for canonical in arg_canonicals[category]:
                    count_prefix = 0
                    count_suffix = 0
                    for value in self.queries[query_name]['args'][arg_name]['values']:
                        if '#' not in canonical:
                            prefix_queries = template_query(category, query_canonical, canonical, value, '')
                            suffix_queries = template_query(category, query_canonical, '', value, canonical)
                            for i in range(len(prefix_queries)):
                                rank = self.ranker.rank([' '.join(prefix_queries[i]), ' '.join(suffix_queries[i])])
                                if rank[0] == 0:
                                    count_prefix += 1
                                else:
                                    count_suffix += 1
                    if count_suffix > count_prefix:
                        needs_reorder.append(canonical)
                for canonical in needs_reorder:
                    arg_canonicals[category].remove(canonical)
                    arg_canonicals[category].append(f"# {canonical}")

        for value in self.queries[query_name]['args'][arg_name]['values']:
            for category in arg_canonicals:
                if category in ['default', 'adjective', 'implicit_identity', 'base', 'reverse_verb']:
                    continue
                for canonical in arg_canonicals[category]:
                    prefix, suffix = split_canonical(canonical)
                    for query in template_query(category, query_canonical, prefix, value, suffix):
                        prefix_indices = list(map(lambda x: query.index(x), prefix.split()))
                        suffix_indices = list(map(lambda x: query.index(x), suffix.split()))
                        value_indices = list(map(lambda x: query.index(x), value.split()))
                        examples[category]['examples'].append({
                            "canonical": canonical,
                            "query": ' '.join(query),
                            "masks": {"prefix": prefix_indices, "suffix": suffix_indices},
                            "value": value_indices
                        })
        return examples

    @staticmethod
    def load_values(type_and_path):
        """
        Load values from a given file
        :param type_and_path: a string of the path to the tsv file
        :return: an array of string values
        """
        _type, path = type_and_path

        if _type == 'string':
            with open(path, 'r', encoding='utf-8') as tsvfile:
                rows = csv.reader(tsvfile, delimiter='\t')
                values = [row[1] for row in rows if len(row) > 1]
        else:
            with open(path, 'r', encoding='utf-8') as jsonfile:
                data = json.load(jsonfile)
                values = [row['canonical'] for row in data['data']]
        return values

    @staticmethod
    def construct_canonical(query, masks, current_index, replacement):
        """
        Construct the full canonical form after getting the prediction

        :param query: a string of the original query
        :param masks: an object containing the indices we want to predict in the form of `{ prefix: [], suffix: [] }`
        :param current_index: the index of where `replacement` should be in `query`
        :param replacement: a string to be used to replace word in original query
        :return: A string represents the new canonical form
        """
        query = query.split()
        prefix, suffix = [], []
        for i in masks['prefix']:
            if i == current_index:
                prefix.append(replacement)
            else:
                prefix.append(query[i])

        for i in masks['suffix']:
            if i == current_index:
                suffix.append(replacement)
            else:
                suffix.append(query[i])

        if len(suffix) > 0:
            return (' '.join(prefix) + ' # ' + ' '.join(suffix)).strip()
        return ' '.join(prefix)

    @staticmethod
    def replace_canonical(query, index, replacement):
        """
        Replace the canonical in the original sentence

        :param query: a string of the original query
        :param index: the index of where `replacement` should be in `query`
        :param replacement: a string to be used to replace word in original query
        :return: the original query with canonical replaced
        """

        query = query.split()
        query[index] = replacement
        return ' '.join(query)

    def prune_canonicals(self, candidates, max_count):
        """
        Prune candidate canonicals of one grammar type for a parameter

        :param candidates: an object where keys are candidate canonicals, values are list of sentences
        :param max_count: the maximum possible sentences a candidate can have
        :return: a pruned version of candidates
        """

        pruned = {}
        for canonical, sentences in candidates.items():
            if len(sentences) > max_count * self.pruning_threshold:
                pruned[canonical] = sentences
        return pruned


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command',
                        choices=['adjectives', 'synonyms', 'all'],
                        help='Which command do you want to run?')
    parser.add_argument('--mask',
                        action='store_true',
                        default=True,
                        help='mask token before predicting')
    parser.add_argument('--no-mask',
                        action='store_false',
                        dest='mask',
                        help='predict without masking tokens')
    parser.add_argument('--k-synonyms',
                        type=int,
                        default=5,
                        help='top-k candidates per example to return when generating synonyms')
    parser.add_argument('--k-adjectives',
                        type=int,
                        default=500,
                        help='top-k candidates to return when generating adjectives')
    parser.add_argument('--pruning-threshold',
                        type=float,
                        default=0.5,
                        help='the frequency a candidate needs to be predicted, to be considered as a valid canonical')
    parser.add_argument('--model-name-or-path',
                        type=str,
                        default='bert-large-uncased',
                        help='The name of the model (e.g. bert-large-uncased) or the path to the directory where the '
                             'model is saved.')
    parser.add_argument('--is-paraphraser',
                        action='store_true',
                        help='If the model has been trained on a paraphrasing corpus')
    parser.add_argument('--gpt2-ordering',
                        action='store_true',
                        help='Use gpt2 model to rank different orders')
    args = parser.parse_args()

    queries = json.load(sys.stdin)

    bert = BertLM(queries, args.mask, args.k_synonyms, args.k_adjectives, args.pruning_threshold,
                  args.model_name_or_path, args.is_paraphraser, args.gpt2_ordering)

    output = {}
    if args.command == 'synonyms' or args.command == 'all':
        output['synonyms'] = bert.predict()
    if args.command == 'adjectives' or args.command == 'all':
        output['adjectives'] = bert.predict_adjectives()

    print(json.dumps(output))
