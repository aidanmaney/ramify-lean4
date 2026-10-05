#!/bin/bash
# raw / gzip -9 / brotli -q 11 sizes of each argument
for f in "$@"; do
  raw=$(stat -c %s "$f"); gz=$(gzip -9 -c "$f" | wc -c); br=$(brotli -q 11 -c "$f" | wc -c)
  printf "%-28s raw %6.1f MB  gz %6.1f MB  br %6.1f MB\n" "$(basename $f)" $(echo "$raw/1000000" | bc -l) $(echo "$gz/1000000" | bc -l) $(echo "$br/1000000" | bc -l)
done
