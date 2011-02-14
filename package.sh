#!/bin/sh

HOST_FILES="manifest.json"
CWD=`pwd`
#KEY="/PATH/to/chrome_extension.pem"
# KEY=$1

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -f "$CHROME" ]; then
    echo error: ${CHROME} is not accessible
    echo "hint: run this from your mac"
    exit 1;
fi

if [ ! -f "$CWD/src/manifest.json" ]; then
    echo "must be run from the chrome_extension directory"
    exit 1;
fi

# support and check for separate oauth file
if [ ! -f "$CWD/src/js/bitly_oauth_credentials.js" ]; then
    echo "valid oauth file is needed to build the extension correctly"
    echo "create: src/js/bitly_oauth_credentials.js with instructions from README.md"
    exit 1;
fi

## now increment the trailing version number
perl -pe 's/(\s+.version.: .\d+\.\d+\.\d+\.)(\d+)/$1.($2+1)/eg' -i "src/manifest.json"

VERSION=`cat src/manifest.json | grep '"version"' | awk -F '"' '{print $4}'`
echo "new extension version is $VERSION"

## remove the sample file and any Mac specific files
zip -q -r "bitly_ext-$VERSION.zip" "$CWD/src" --exclude \*.DS_Store \*bitly_oauth_credentials.js.sample

echo "upload: bitly_ext-$VERSION.zip"
exit 0;

