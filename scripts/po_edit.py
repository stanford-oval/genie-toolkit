import argparse
import re
import polib

parser = argparse.ArgumentParser('PO parser')

parser.add_argument('--input_file', type=str)
parser.add_argument('--translated_file', type=str)
parser.add_argument('--output_file', type=str)
parser.add_argument('--transformation', choices=['prepare_for_translation', 'create_final'], type=str)

args = parser.parse_args()

PUNCTUATIONS = {'.', '?', '!', ','}
SPECIAL_CHARS = {':', '#'}

placeholder_regex_fw = "|".join(
    [
        r"<\${.+?}>",  # <${placeholder}>
        r"\${.+?}",  # ${placeholder}
        r"<\$.+?>",  # <placeholder>
        r"\$.+",  # placeholder
        r"[({|})]",  # {x|y} ^(x|y)
        r"\[plural=.+?(?:\[plural\])?\]" # [plural=xxx]
    ]
)

# wrap in () so re.split return placeholders too
# this ensure the order of outputs phrases is poutputerved when constructing the output
placeholder_regex_fw = '(' + placeholder_regex_fw + ')'

multi_option_regex_bw = re.compile('[{(](.+? \| )(.+? \| )*.+?[})]')

# evil as in not amenable to machine translation
# update if describe.ts is modified
EVIL_LINES = {'lib/utils/thingtalk/describe.ts:452',
              'lib/utils/thingtalk/describe.ts:931',
              'lib/utils/thingtalk/describe.ts:942',
              'lib/utils/thingtalk/describe.ts:965',
              'lib/utils/thingtalk/describe.ts:974',
              'lib/utils/thingtalk/describe.ts:1093',
              'lib/utils/thingtalk/describe.ts:1104'}

def prepare_for_translation():
    pofile = polib.pofile(args.input_file)
    with open(args.output_file, 'w') as fout:
        for entry in pofile:
            line = entry.msgid
            base_id = ':'.join(entry.occurrences[0])

            # skip this evil lines!
            if base_id in EVIL_LINES:
                continue

            line = line.strip('\n').strip('"')
            line = re.sub(r"\s{2,}", " ", line)
            parts = re.split(placeholder_regex_fw, line)
            
            for i, p in enumerate(parts):
                id_ = base_id + '/' + str(i)
                
                p = p.strip()

                # skip placeholders
                if i % 2 == 1:
                    continue

                # skip empty strings
                if p == '':
                    continue

                # skip punctuations and special characters
                if p in PUNCTUATIONS:
                    continue
                if p in SPECIAL_CHARS:
                    continue

                fout.write(id_ + '\t' + p + '\n')

def clean_translated_output(text):
    text = text.strip()
    text = re.sub(r"\s{2,}", " ", text)

    if text[-1] in PUNCTUATIONS:
        text = text[:-1]
        text = text.strip()

    if multi_option_regex_bw.search(text):
        text = text.replace(' | ', '|')
        text = text.replace('{ ', '{')
        text = text.replace(' }', '}')
        text = text.replace('( ', '(')
        text = text.replace(' )', ')')

    return text


def create_final():
    pofile = polib.pofile(args.input_file)

    translated_mapping = {}
    with open(args.translated_file, 'r') as fin:
        for line in fin:
            id_, sent, _ = line.strip('\n').split('\t')
            task_name, id_ = id_.split('/', 1)
            translated_mapping[id_] = sent.strip()
    
    
    # modifies entries inplace
    for entry in pofile:
        line = entry.msgid
        base_id = ':'.join(entry.occurrences[0])

        line = line.strip('\n').strip('"')
        line = re.sub(r"\s{2,}", " ", line)
        parts = re.split(placeholder_regex_fw, line)
        
        for i, part in enumerate(parts):
            if base_id + '/' + str(i) in translated_mapping:
                sent = translated_mapping[base_id + '/' + str(i)]

                # translation likes ending sentences "gracefully"
                # remove all ending punctuation
                # post-editors add it back if necessary
                if sent[-1] in PUNCTUATIONS:
                    sent = sent[:-1]
                    sent = sent.strip()
                parts[i] = sent

        output = ' '.join(parts)
        output = clean_translated_output(output)
        
        entry.msgstr = output
    
    pofile.save(args.output_file)


if __name__ == '__main__':

    if args.transformation == 'prepare_for_translation':
        prepare_for_translation()
    elif args.transformation == 'create_final':
        create_final()
