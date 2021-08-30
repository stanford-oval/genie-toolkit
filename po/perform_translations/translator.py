import re
import dl_translate as dlt
import polib
import os
from datetime import datetime
import subprocess


now = datetime.now()
mt = dlt.TranslationModel()
current_time = now.strftime("%H:%M:%S")


# Variables for translator to edit

print(mt.get_lang_code_map()) 

language = str(input("What is your desired language to translate to? Input the language code: ")) # change to desired language to convert TO
Reportmsgid = str(input("What is your desired Report Msgid Bugs To? " ))
PO_Revision_Date = current_time 
Last_Translator = str(input("Who do you want as the last translator? "))
Language_Team = str(input("What is the language team you want the translation to be in? Example: English <myteam@example.com> "))


while language not in mt.available_codes():
  print("Sorry, try again! This language is not supported")
  language =  str(input("What is your desired language to translate to? Input the language code: ")) # change to desired language to convert TO


pofile = polib.pofile(language + ".po") # Make sure the .po file is in the same directory
POT_Creation_Date = pofile.metadata.get('POT-Creation-Date')
msgIdArray = []
theActualArray = []
arrayOfTranslatedMsgStr = []

print(pofile.metadata)


for entry in pofile:
    theActualArray.append([entry.msgid, entry.msgstr])
    msgIdArray.append(entry.msgid)
    

  

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
         translation.append(mt.translate(part, source=dlt.lang.ENGLISH, target=language.lower()))
      else:
         translation.append(part)

    placeholder_i = iter(placeholders)
    res = ""
    for part in translation:
        res += part + " "
        res += next(placeholder_i, "") + " "

    final = re.sub(' +',' ', res)
    arrayOfTranslatedMsgStr.append(final)
 


for i in range(len(theActualArray)):
  theActualArray[i][1] = arrayOfTranslatedMsgStr[i]

po = polib.POFile()

po.metadata = {
    'Project-Id-Version': '1.0',
    'Report-Msgid-Bugs-To': Reportmsgid.rstrip(),
    'POT-Creation-Date': POTCreationDateFetched,
    'PO-Revision-Date': PO_Revision_Date.rstrip(),
    'Last-Translator':  Last_Translator.rstrip(),
    'Language-Team': Language_Team.rstrip(),
    'MIME-Version': '1.0'.rstrip(),
    'Content-Type': 'text/plain; charset=utf-8'.rstrip(),
    'Content-Transfer-Encoding': '8bit'.rstrip(),
}

for i in theActualArray:
  entry = polib.POEntry(
      msgid=i[0],
      msgstr=i[1]
  )
  po.append(entry)

po.save('newfile.po')







