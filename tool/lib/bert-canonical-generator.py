import csv
import argparse
import json
import torch
import torch.nn.functional as F
import sys
from transformers import BertTokenizer, BertModel, BertForMaskedLM, GPT2Tokenizer, GPT2LMHeadModel

BLACK_LIST = ['a', 'an', 'the', 'its', 'their', 'his', 'her']

class GPT2Ranker:
    def __init__(self, model_name_or_path, prompt_token='<paraphrase>', end_token='</paraphrase>'):
        self.tokenizer = GPT2Tokenizer.from_pretrained(model_name_or_path)
        self.model = GPT2LMHeadModel.from_pretrained(model_name_or_path)
        self.prompt_token = prompt_token
        self.end_token = end_token
        # model.to(args.device)

        self.model.eval()
        
    def choose_more_natural(self, phrases):
        best = phrases[0]
        best_idx = 0
        for i in range(1, len(phrases)):
            best, idx = self._choose_more_natural(best, phrases[i])
            if idx == 1:
                best_idx = i
        return best, best_idx

    def _choose_more_natural(self, phrase1, phrase2):
        s1 = self._assign_score(phrase1, phrase2)
        s2 = self._assign_score(phrase2, phrase1)
        if s1 > s2:
            return phrase2, 1
        else:
            return phrase1, 0

    def similarity(self, phrase1, phrase2):
        return (self._assign_score(phrase1, phrase2) + self._assign_score(phrase2, phrase1)) / 2.0

    def _assign_score(self, original, paraphrase):
        original += self.prompt_token
        paraphrase += self.end_token
        original_tokens = self.tokenizer.encode(original, add_special_tokens=False)
        paraphrase_tokens = self.tokenizer.encode(paraphrase, add_special_tokens=False)
        position_ids = list(range(len(original_tokens))) + list(range(len(paraphrase_tokens)))
        segment_ids = [self.tokenizer.convert_tokens_to_ids(self.prompt_token)] *len(original_tokens) + \
                      [self.tokenizer.convert_tokens_to_ids(self.end_token)] * len(paraphrase_tokens)

        input_ids = torch.tensor(original_tokens + paraphrase_tokens, dtype=torch.long)
        position_ids = torch.tensor(position_ids, dtype=torch.long)
        segment_ids = torch.tensor(segment_ids, dtype=torch.long)

        with torch.no_grad():
            outputs = self.model(input_ids=input_ids, position_ids=position_ids, token_type_ids=segment_ids)
            next_token = input_ids[len(original_tokens):].unsqueeze(-1)
            logprobs = F.log_softmax(outputs[0][len(original_tokens)-1:-1], dim=-1) # shift one token to left
            score = torch.exp(torch.mean(logprobs.gather(1, next_token)))
            # print('score = %.3f' % score.item())

        return score.item()


class BertLM:
    def __init__(self, domain, examples, mask, k, model_name_or_path, is_paraphraser, ranker_path, check_permutations, rank):
        """
        :param domain: an object contains the canonical form and paths to parameters for each table in the domain
        :param examples: an object of examples for each grammar category of each property of each table
        :param mask: a boolean indicates if we do masking before prediction
        :param k: number of top candidates to return per example
        :param model_name_or_path: a string specifying a model name recognizable by the Transformers package (e.g. bert-base-uncased), or a path to the directory where the model is saved
        :is_paraphraser: Set to True if model_name_or_path was fine-tuned on a paraphrasing dataset. The input to the model will be changed to match what the model has seen during fine-tuning.
        """
        
        # Load tokenizer
        self.tokenizer = BertTokenizer.from_pretrained(model_name_or_path)

        # Load pre-trained model (weights)
        self.model = BertForMaskedLM.from_pretrained(model_name_or_path)
        self.model.eval()
        self.is_paraphraser = is_paraphraser
        self.check_permutations = check_permutations
        self.rank = rank
        if self.check_permutations or self.rank:
            self.ranker= GPT2Ranker(ranker_path)

        self.mask = mask
        self.k = k
        self.canonicals = {}
        self.values = {}
        for table in domain:
            self.canonicals[table] = domain[table]['canonical']
            self.values[table] = {}
            for param in domain[table]['params']:
                self.values[table][param] = self.load_values(domain[table]['params'][param])
        self.examples = examples

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
            middle_position = tokenized_text.index('<paraphrase>')
            masked_index = tokenized_text[middle_position:].index(word) + middle_position
            segments_ids = [0] * (middle_position+1) + [1] * (len(tokenized_text)-middle_position-1)
            position_ids = list(range(middle_position+1)) + list(range(len(indexed_tokens)-middle_position-1))
        else:
            # Input to BERT should be [CLS] query [SEP]
            if self.mask:
                query = query.replace(word, '[MASK]')
                word = '[MASK]'
            text = '[CLS] ' + query + ' [SEP]'

            tokenized_text = self.tokenizer.tokenize(text)
            indexed_tokens = self.tokenizer.convert_tokens_to_ids(tokenized_text)
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
            predictions = self.model(input_ids=tokens_tensor, token_type_ids=segments_tensors, position_ids=position_tensors)

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
                if self.check_permutations:
                    _, candidate, _ = self._make_more_natural(query, masks, candidate)

                candidates.append(candidate)

            
        return candidates

    def predict(self):
        """
        Get top-k predictions for all examples

        :return: updated examples with additional candidates field for new canonicals
        """
        for table, arg, pos in ((a, b, c) for a in self.examples for b in self.examples[a] for c in self.examples[a][b]):
            count = {}
            for example in self.examples[table][arg][pos]['examples']:
                query, masks = example['query'], example['masks']
                ### for older versions
                if 'value' not in masks:
                    if len(masks['suffix'])==0:
                        masks['value'] = list(range(max(masks['prefix'])+1, len(query.split(' '))-1))
                    else:
                        masks['value'] = list(range(max(masks['prefix'])+1, min(masks['suffix'])))
                ###
                natural_query, natural_candidate, natural_masks = self._make_more_natural(query, masks)
                candidates1 = self.predict_one_type(table, arg, query, masks)

                if self.check_permutations:
                    candidates2 = self.predict_one_type(table, arg, natural_query, natural_masks) # we might be double counting if query==natural_query
                else:
                    candidates2 = []
                
                example['candidates'] = candidates1 + candidates2
                for candidate in candidates1 + candidates2:
                    new_query = self._plug_in_query(query, masks, candidate)
                    if self.rank:
                        # TODO we sum ranker scores, but we should sum logits. The problem now is that if a candidate does not appear for a query, it gets logit=0 which is the max, not min
                        score = self.ranker.similarity(natural_query, new_query)
                    else:
                        score = 1 # just count
                    if candidate in count:
                        count[candidate] += score
                    else:
                        count[candidate] = score
            self.examples[table][arg][pos]['candidates'] = count

        return self.examples

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
    def _get_original_candidate(query, masks):
        query = query.split(' ')
        pre, prefix, value, suffix, post = BertLM._split_query_to_sections(query, masks)
        candidate = ' '.join(prefix)
        if len(suffix) > 0:
            candidate += ' #'
        candidate += ' '.join(suffix)
        candidate = candidate.strip()
        return candidate

    def _make_more_natural(self, query, masks, candidate=None):
        if candidate is None:
            candidate = self._get_original_candidate(query, masks)
        permutations, permutations_candidate, permutations_masks = self._get_query_permutations(query, masks, candidate)
        most_natural, most_natural_idx = self.ranker.choose_more_natural(permutations)
        new_candidate = permutations_candidate[most_natural_idx]
        new_masks = permutations_masks[most_natural_idx]
        return most_natural, new_candidate, new_masks


    @staticmethod
    def _plug_in_query(query, masks, candidate):
        query = query.split(' ')
        pre, prefix, value, suffix, post = BertLM._split_query_to_sections(query, masks)
        candidate = candidate.split(' ')
        value_index = [i for i in candidate if i.startswith('#')]
        if len(value_index)==0:
            value_index = len(candidate)
        else:
            value_index = candidate.index(value_index[0])
        candidate = [c.replace('#', '') for c in candidate]
        assert len(prefix+suffix) == len(candidate)

        return ' '.join(pre + candidate[:value_index]+value+candidate[value_index:] + post)

    @staticmethod
    def _split_query_to_sections(query, masks):
        """
        query is a list of tokens
        """
        changeable_part = masks['prefix']+masks['value']+masks['suffix']
        pre = query[:min(changeable_part)]
        if len(masks['prefix']) == 0:
            prefix = []
        else:
            prefix = query[min(masks['prefix']):max(masks['prefix'])+1]
        value = query[min(masks['value']):max(masks['value'])+1]
        if len(masks['suffix']) == 0:
            suffix = []
        else:
            suffix  = query[min(masks['suffix']):max(masks['suffix'])+1]
        post = query[max(changeable_part)+1:]

        assert ' '.join(pre + prefix + value + suffix + post) == ' '.join(query)

        return pre, prefix, value, suffix, post

    @staticmethod
    def _get_query_permutations(query, masks, candidate):
        # We assume masks['prefix'] + masks['value'] + masks['suffix'] is a list of consecutive integers
        query = query.split(' ')
        candidate = candidate.replace('#', '').split(' ')
        for idx, position in enumerate(masks['prefix']+masks['suffix']):
            query[position] = candidate[idx]
        
        pre, prefix, value, suffix, post = BertLM._split_query_to_sections(query, masks)

        prefix = prefix+suffix
        suffix = []
        permutations = []
        permutations_candidate = []
        permutations_masks = []
        itarations = len(prefix)+len(suffix)+1
        for i in range(itarations):
            permutations.append(' '.join(pre + prefix + value + suffix + post))
            permutations_masks.append({
                'prefix': list(range(len(pre), len(pre)+len(prefix))),
                'value': list(range(len(pre)+len(prefix), len(pre)+len(prefix)+len(value))),
                'suffix': list(range(len(pre)+len(prefix)+len(value), len(pre)+len(prefix)+len(value)+len(suffix)))
            })
            c = ' '.join([candidate[j] for j in range(len(prefix))])
            if len(suffix) > 0:
                c += ' #'
            c += ' '.join([candidate[j] for j in range(len(prefix), len(prefix)+len(suffix))])
            c = c.strip()

            permutations_candidate.append(c)
            
            if len(prefix) > 0:
                suffix.insert(0, prefix[-1])
                prefix = prefix[:-1]
                
        return permutations, permutations_candidate, permutations_masks

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
            return (' '.join(prefix) + ' #' + ' '.join(suffix)).strip()
        return ' '.join(prefix).strip()


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
                        help='The name of the model (e.g. bert-large-uncased) or the path to the directory where the model is saved.')
    parser.add_argument('--is-paraphraser',
                        action='store_true',
                        help='If the model has been trained on a paraphrasing corpus')
    parser.add_argument('--check-permutations',
                        action='store_true',
                        help='Use a GPT2-based model to select the best location for the value in the input queries')
    parser.add_argument('--ranker-path',
                        type=str,
                        help='The path to the directory where the ranker model is saved.')
    parser.add_argument('--rank',
                        action='store_true',
                        help='Use a GPT2-based ranker to rank the outputs of bert')
    parser.add_argument('--output-file',
                        type=str,
                        default=None,
                        help='If provided, the output will be written into the file instead of stdout')
    args = parser.parse_args()

    examples, domain = json.load(sys.stdin).values()

    bert = BertLM(domain, examples, args.mask, args.k, args.model_name_or_path, args.is_paraphraser,
                  args.ranker_path, args.check_permutations, args.rank)

    output = {}
    if args.command == 'synonyms' or args.command == 'all':
        output['synonyms'] = bert.predict()
    if args.command == 'adjectives' or args.command == 'all':
        output['adjectives'] = bert.predict_adjectives(args.k_adjectives)

    if args.output_file is None:
        print(json.dumps(output, indent=2))
    else:
        with open(args.output_file, 'w') as f:
            json.dump(output, f)