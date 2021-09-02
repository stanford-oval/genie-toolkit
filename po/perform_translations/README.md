This python script helps generate a translated template to work on to speed up the translation workflow. It generates a file $language.po.new that you can fix up and then rename to $language.po.  In order to use this translator template generator you will want to run this to install the "polib" and "dl-translate" modules. Make sure GNU gettext utilities are installed! In addition, make sure you are running Python 3.5 or above as subprocess.run() function was added in Python 3.5.

```
pip3 install polib dl-translate

```



Further documentation on the modules is available here:

- [polib](https://pypi.org/project/polib/)
- [dl-translate](https://pypi.org/project/dl-translate/)



To use this script, for example to have the translated French (fr) po file you would want to run these commands

```
git clone https://github.com/stanford-oval/genie-toolkit.git
cd genie-toolkit
npm install
npm run update-pot
cd po
cp genie-toolkit.pot ./perform_translations/fr.po
cd perform_translations
python3 translator.py 
```

Note that the po file that you have in the perform_translations directory (like fr.po in this example) must be the same as the language code you input when the script asks what language you want to translate to. For instance for the fr.po file, you must input fr as the language code in the script

After this you can examine and manually make required final changes to the newfile.po that is generated and then you can


```
msmerge newfile.po fr.po --output-file= fr.po

```

Replace fr.po with $language.po . Now you have your translated po file.



