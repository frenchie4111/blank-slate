#!/usr/bin/env bash
#
# Fails unless $TAG is a release tag (vX.Y.Z) naming the version in app.json.
#
# Shared by app.yml and desktop.yml, which must accept exactly the same tags:
# one tag ships the OTA update and the installers. The version check matters
# because nothing downstream reads the tag. The update is published under
# expo.version and electron-builder uploads to v<expo.version>, so a mismatched
# tag would ship the wrong version under its name. The format check matters
# because a dispatch against a tag skips the trigger's pattern, and pre-release
# tags would publish as full releases.
#
#   TAG=v1.2.0 scripts/check-release-tag.sh

set -euo pipefail

: "${TAG:?TAG must be set to the tag being released}"

if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "::error::$TAG is not a release tag (vX.Y.Z)."
    exit 1
fi

version=$(node -p "require('./app.json').expo.version")

if [ "$TAG" != "v$version" ]; then
    echo "::error::Tag $TAG does not match expo.version $version in app.json."
    exit 1
fi

echo "$TAG matches expo.version $version."
