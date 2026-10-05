#!/bin/bash
# sample summed chromium RSS (MB) every 0.25s until $1 exists
while [ ! -e "$1" ]; do ps -eo rss,comm | awk '/chrom|headless/ {s+=$1} END {printf "%.0f\n", s/1024}'; sleep 0.25; done
