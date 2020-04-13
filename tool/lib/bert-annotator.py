import csv
import argparse
import json
import sys
import torch
import torch.nn.functional as F
from transformers import BertTokenizer, BertForMaskedLM, GPT2Tokenizer, GPT2LMHeadModel

BLACK_LIST = ['a', 'an', 'the', 'its', 'their', 'his', 'her']


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


def template_query(cat, query_canonical, prefix, value='', suffix=''):
    """
    return a template query sentence for bert

    :param cat: the grammar category of the prefix, value, and suffix
    :param query_canonical: the canonical form of the query (table), e.g., restaurant, person
    :param prefix: the prefix of the canonical form
    :param value: an example value of the property
    :param suffix: the suffix of the canonical form
    :return: a template query string
    """
    if cat == 'base':
        return f"what is the {prefix} of the {query_canonical} ?".split()
    if cat == 'property':
        return f"show me a {query_canonical} with {prefix} {value} {suffix} .".split()
    if cat == 'verb':
        return f"which {query_canonical} {prefix} {value} {suffix} ?".split()
    if cat == 'passive_verb':
        return f"show me a {query_canonical} {prefix} {value} {suffix} .".split()
    if cat == 'reverse_property':
        return f"which {query_canonical} is a {prefix} {value} {suffix} ?".split()
    raise Exception('Invalid grammar category: ', cat)


class GPT2Ranker:
    def __init__(self):
        self.tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
        self.model = GPT2LMHeadModel.from_pretrained('gpt2')
        self.model.eval()

        self.prompt_token = '<paraphrase>'
        self.end_token = '</paraphrase>'

    def rank(self, phrases):
        return sorted(phrases, key=lambda p: self.score(p), reverse=True)

    def score(self, sentence):
        indexed_tokens = self.tokenizer.encode(sentence)
        position_ids = list(range(len(indexed_tokens)))
        segments_ids = [0] * len(indexed_tokens)

        tokens_tensor = torch.tensor(indexed_tokens)
        segments_tensors = torch.tensor(segments_ids)
        position_tensors = torch.tensor(position_ids)

        with torch.no_grad():
            outputs = self.model(
                input_ids=tokens_tensor,
                token_type_ids=segments_tensors,
                position_ids=position_tensors
            )
            next_token = tokens_tensor.unsqueeze(-1)
            logprobs = F.log_softmax(outputs[0], dim=-1)
            score = torch.exp(torch.mean(logprobs.gather(1, next_token)))

        return score.item()


class BertLM:
    def __init__(self, queries, mask, k, model_name_or_path, is_paraphraser):
        """
        :param queries: an object contains the canonicals, values, paths for args in each query
        :param mask: a boolean indicates if we do masking before prediction
        :param k: number of top candidates to return per example
        :param model_name_or_path: a string specifying a model name recognizable by the Transformers package
            (e.g. bert-base-uncased), or a path to the directory where the model is saved
        :param is_paraphraser: Set to True if model_name_or_path was fine-tuned on a paraphrasing dataset. The input to
            the model will be changed to match what the model has seen during fine-tuning.
        """

        # Load tokenizer
        self.tokenizer = BertTokenizer.from_pretrained(model_name_or_path)

        # Load pre-trained model (weights)
        self.model = BertForMaskedLM.from_pretrained(model_name_or_path)
        self.model.eval()

        self.ranker = GPT2Ranker()

        self.is_paraphraser = is_paraphraser
        self.mask = mask
        self.k = k
        self.queries = queries
        self.canonicals = {}  # canonical of queries
        self.values = {}  # values of arguments
        for query in queries:
            self.canonicals[query] = queries[query]['canonical']
            self.values[query] = {}
            for arg in queries[query]['args']:
                if 'path' in queries[query]['args'][arg]:
                    self.values[query][arg] = self.load_values(queries[query]['args'][arg]['path'])

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
            k = self.k

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
        candidates = []
        for i in [*masks['prefix'], *masks['suffix']]:
            predictions = self.predict_one(table, arg, query, query.split(' ')[i], None)
            for token in predictions:
                candidate = self.construct_canonical(query, masks, i, token)
                candidates.append(candidate)
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
                    count = {}
                    candidates[query][arg][category] = {}
                    candidates[query][arg][category]['examples'] = []
                    for example in examples[category]['examples']:
                        sentence, masks = example['query'], example['masks']
                        predictions = self.predict_one_type(query, arg, sentence, masks)
                        candidates[query][arg][category]['examples'].append({
                            "sentence": example,
                            "candidates": predictions
                        })
                        for prediction in predictions:
                            count[prediction] = count[prediction] + 1 if prediction in count else 1
                    candidates[query][arg][category]['candidates'] = count
        return candidates

    def predict_adjectives(self, k=500):
        """
        Predict which property can be used as an adjective form

        :param k: number of top candidates to generate
        :return: an array of properties
        """
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
        for category in ['base', 'property', 'verb', 'passive_verb', 'reverse_property']:
            if category in arg_canonicals:
                examples[category] = {"examples": [], "candidates": []}

        if 'base' in arg_canonicals:
            for canonical in arg_canonicals['base']:
                query = template_query('base', query_canonical, canonical)
                mask_indices = list(map(lambda x: query.index(x), canonical.split()))
                examples['base']['examples'].append({
                    "query": ' '.join(query),
                    "masks": {"prefix": mask_indices, "suffix": []},
                    "value": []
                })

        for value in self.queries[query_name]['args'][arg_name]['values']:
            for category in arg_canonicals:
                if category in ['default', 'adjective', 'implicit_identity', 'base']:
                    continue
                for canonical in arg_canonicals[category]:
                    prefix, suffix = split_canonical(canonical)
                    query = template_query(category, query_canonical, prefix, value, suffix)
                    prefix_indices = list(map(lambda x: query.index(x), prefix.split()))
                    suffix_indices = list(map(lambda x: query.index(x), suffix.split()))
                    value_indices = list(map(lambda x: query.index(x), value.split()))
                    examples[category]['examples'].append({
                        "query": ' '.join(query),
                        "masks": {"prefix": prefix_indices, "suffix": suffix_indices},
                        "value": value_indices
                    })
        return examples

    @staticmethod
    def load_values(path):
        """
        Load values from a given tsv file
        :param path: a string of the path to the tsv file
        :return: an array of string values
        """
        values = []
        with open(path, 'r', encoding='utf-8') as tsvfile:
            rows = csv.reader(tsvfile, delimiter='\t')
            for row in rows:
                if len(row) > 1:
                    values.append(row[1])
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
        query = query.split(' ')
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
            return ' '.join(prefix) + ' #' + ' '.join(suffix)
        return ' '.join(prefix)


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
                        dest='k',
                        type=int,
                        default=5,
                        help='top-k candidates per example to return when generating synonyms')
    parser.add_argument('--k-adjectives',
                        type=int,
                        default=500,
                        help='top-k candidates to return when generating adjectives')
    parser.add_argument('--model-name-or-path',
                        type=str,
                        default='bert-large-uncased',
                        help='The name of the model (e.g. bert-large-uncased) or the path to the directory where the '
                             'model is saved.')
    parser.add_argument('--is-paraphraser',
                        action='store_true',
                        help='If the model has been trained on a paraphrasing corpus')
    parser.add_argument('--gpt2-order',
                        action='store_true',
                        help='Use gpt2 model to rank different orders')
    args = parser.parse_args()

    queries = json.load(sys.stdin)

    bert = BertLM(queries, args.mask, args.k, args.model_name_or_path, args.is_paraphraser)

    output = {}
    if args.command == 'synonyms' or args.command == 'all':
        output['synonyms'] = bert.predict()
    if args.command == 'adjectives' or args.command == 'all':
        output['adjectives'] = bert.predict_adjectives(args.k_adjectives)

    print(json.dumps(output))
