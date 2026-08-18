#!/bin/sh
set -eu

display="${XVFB_DISPLAY:-:99}"
Xvfb "$display" -screen 0 1280x1024x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
export DISPLAY="$display"

exec node dist/api/main.js
