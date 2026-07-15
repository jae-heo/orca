#!/bin/bash
set -e

link="/usr/bin/neurorca"

for dir in /opt/Neurorca /opt/neurorca; do
  sandbox="$dir/chrome-sandbox"
  if [ -f "$sandbox" ]; then
    chmod 4755 "$sandbox" || true
  fi

  shim="$dir/resources/bin/neurorca"
  if [ -x "$shim" ]; then
    if [ ! -e "$link" ] || [ -L "$link" ]; then
      ln -sf "$shim" "$link"
    fi
    break
  fi
done

exit 0
