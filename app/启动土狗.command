#!/bin/sh
set -eu
cd "$(dirname "$0")"
unset TUGOU_DATA_DIR
exec ./node_modules/.bin/electron .
