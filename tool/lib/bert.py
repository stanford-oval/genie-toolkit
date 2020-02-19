import csv
import argparse
import json
import torch
from transformers import BertTokenizer, BertModel, BertForMaskedLM

# Load tokenizer
tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')

# Load pre-trained model (weights)
model = BertForMaskedLM.from_pretrained('bert-base-uncased')
model.eval()


def predict_one(text, k=5):
    text = '[CLS] ' + text + ' [SEP]'
    tokenized_text = tokenizer.tokenize(text)
    indexed_tokens = tokenizer.convert_tokens_to_ids(tokenized_text)
    masked_index = tokenized_text.index('[MASK]')

    # Create the segments tensors.
    segments_ids = [0] * len(tokenized_text)

    # Convert inputs to PyTorch tensors
    tokens_tensor = torch.tensor([indexed_tokens])
    segments_tensors = torch.tensor([segments_ids])

    # Predict all tokens
    with torch.no_grad():
        predictions = model(tokens_tensor, segments_tensors)

    mask = predictions[0][0, masked_index]
    scores, indices = torch.topk(mask, k)

    return tokenizer.convert_ids_to_tokens(indices.tolist())


def predict(examples):
    for qname in examples:
        for arg in examples[qname]:
            for example in examples[qname][arg]:
                example['canonicals'] = []
                for query in example['masked']:
                    alternatives = predict_one(query)
                    query = query.split(' ')
                    span = example['masks'][0]
                    canonical = ' '.join(query[span[0]: span[-1] + 1])
                    if len(example['masks']) > 1:
                        span = example['masks'][1]
                        canonical += ' #' + ' '.join(query[span[0]: span[-1] + 1])
                    for alternative in alternatives:
                        example['canonicals'].append(canonical.replace('[MASK]', alternative))

    return examples


def load_values(path):
    values = []
    with open(path, 'r') as tsvfile:
        rows = csv.reader(tsvfile, delimiter='\t')
        for row in rows:
            if len(row) > 1:
                values.append(row[1])
    return values


def predict_adjectives(paths):
    result = []
    for query in paths:
        predictions = predict_one('show me a [MASK] ' + paths[query]['canonical'])
        for param in paths[query]['params']:
            values = load_values(paths[query]['params'][param])
            for v in predictions:
                if v in values:
                    result.append(query + '.' + param)
                    break
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command',
                        choices=['adjectives', 'synonyms', 'test', 'all'],
                        help='Which command do you want to run?')
    parser.add_argument('--utterance',
                        help='Utterance used for testing.')
    args = parser.parse_args()

    if args.command == 'synonyms' or args.command == 'all':
        with open('./examples.json', 'r') as fin, open('./bert-predictions.json', 'w') as fout:
            examples = json.load(fin)
            json.dump(predict(examples), fout, indent=2)

    if args.command == 'adjectives' or args.command == 'all':
        with open('./param-dataset-paths.json', 'r') as fin, open('./adjective-properties.json', 'w') as fout:
            adjectives = predict_adjectives(json.load(fin))
            json.dump(adjectives, fout, indent=2)

    if args.command == 'test':
        print(predict_one(args.utterance.replace('_', ' '), 100))
