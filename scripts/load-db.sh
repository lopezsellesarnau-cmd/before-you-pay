#!/bin/sh
# Load the prepared CSVs into byp-db (docker compose up -d first).
set -e
cd "$(dirname "$0")/.."
docker exec -i byp-db psql -q -U byp -d byp -c "TRUNCATE serpavi_rent" \
  -c "\copy serpavi_rent FROM STDIN WITH (FORMAT csv, HEADER true)" < data/serpavi/serpavi_long.csv
docker exec byp-db psql -U byp -d byp -tAc "SELECT area_level, count(*) FROM serpavi_rent GROUP BY 1"
