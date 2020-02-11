import sys
import json
import torch
from transformers import BertTokenizer, BertModel, BertForMaskedLM

# Load tokenizer
tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')

# Load pre-trained model (weights)
model = BertForMaskedLM.from_pretrained('bert-base-uncased')
model.eval()

def predictOne(text):
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
    topk, indices = torch.topk(mask, 5)

    return tokenizer.convert_ids_to_tokens(indices.tolist())


def predict(examples):
    for qname in examples:
        for arg in examples[qname]: 
            for example in examples[qname][arg]:
                example['canonicals'] = []
                for query in example['masked']: 
                    alternatives = predictOne(query)
                    query = query.split(' ')
                    span = example['masks'][0]
                    canonical = ' '.join(query[span[0] : span[-1]+1])
                    if len(example['masks']) > 1:
                        span = example['masks'][1]
                        canonical += ' # ' + ' '.join(query[span[0] : span[-1]+1])
                    for alternative in alternatives:
                        example['canonicals'].append(canonical.replace('[MASK]', alternative))
        
    return examples



if __name__ == '__main__':
    with open('./examples.json', 'r') as fin, open('./bert-predictions.json', 'w') as fout:
        examples = json.load(fin)
        json.dump(predict(examples), fout, indent=2)
