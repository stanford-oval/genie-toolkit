#!/usr/bin/env python3
# coding=utf-8
#
# This file is part of Genie
#
# Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#    http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import torch
import torch.nn
from transformers import GPT2Tokenizer, GPT2LMHeadModel
import sys
import numpy as np
import sys


def main():
	tokenizer = GPT2Tokenizer.from_pretrained('gpt2')
	model = GPT2LMHeadModel.from_pretrained('gpt2')
	model.eval()

	with torch.no_grad():
		for query in sys.stdin:
			#new_query = tokenizer.bos_token + ' ' + query + ' ' + tokenizer.eos_token
			new_query = 'Hey Alexa, please search for ' + query + '.'
			#new_query = query
			#print(new_query, file=sys.stderr)

			indexed_tokens = tokenizer.encode(new_query)
			#print(indexed_tokens, file=sys.stderr)
			#print('the tokenized query length: ', len(indexed_tokens))
			tokens_tensor = torch.tensor([indexed_tokens])

			outputs = model(tokens_tensor)
			predictions = outputs[0]

			softmax = torch.nn.Softmax(dim=-1)
			prob = softmax(predictions[0])

			assert prob.dim() == 2
			assert prob.size()[0] == len(indexed_tokens)

			perplexity = 0
			for i,t in enumerate(indexed_tokens[1:]):
				perplexity += -1 * np.log(prob[i][t].item())

			perplexity = perplexity / (len(indexed_tokens)-1)
			#print ('the perplexity is: ', perplexity)

			print(perplexity)

main()
