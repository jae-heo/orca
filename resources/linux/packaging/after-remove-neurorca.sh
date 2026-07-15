#!/bin/bash
set -e

link="/usr/bin/neurorca"

if [ -L "$link" ]; then
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/Neurorca/*|/opt/neurorca/*)
      rm -f "$link"
      ;;
  esac
fi

exit 0
