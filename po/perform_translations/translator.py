import re
import dl_translate as dlt
import polib

# Variables for translator to edit

language = "fr" # change to desired language to convert TO


mt = dlt.TranslationModel()
arrayOfTranslated = []
msgIdArray = []
msgStrArray = []
pofile = polib.pofile(language + ".po") # Make sure the .po file is in the same directory

for entry in pofile:
    msgIdArray.append(entry.msgid)
    msgStrArray.append(entry.msgstr)

for messageId in msgIdArray:
    reg = "|".join(
        (
            r"<\${\w+?}>",  # <${link}>
            r"\${\w+?}",  # ${link}
            r"<\$\w+?>",  # <$link>
            r"\$\w+",  # $link
            r"[{|}]",  # {a | b}
        )
    )
    parts = re.split(reg, messageId)
    placeholders = re.findall(reg, messageId)
    translation = []
    for part in parts:
      if part.strip() != "":
         translation.append(mt.translate(part, source=dlt.lang.ENGLISH, target=dlt.lang.FRENCH))
      else:
         translation.append(part)

    placeholder_i = iter(placeholders)
    res = ""
    for part in translation:
        res += part + " "
        res += next(placeholder_i, "") + " "

    a = re.sub(' +',' ', res)
    arrayOfTranslated.append("msgstr " + f'"{a}"')

arrayOfTranslated.insert(0,'msgstr ""')
 
with open("fr.po", "r") as r, open("fr.po.new", "w") as w:
    for line in r:
        if line.startswith('msgstr'):
            w.write(arrayOfTranslated[0] + '\n')
            arrayOfTranslated.pop(0)
        else:
            w.write(line)



