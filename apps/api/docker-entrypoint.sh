#!/bin/sh
# Production entrypoint: apply pending migrations, then become the API.
# Failing fast on migrate errors keeps a bad release from serving traffic.
set -e
./node_modules/.bin/prisma migrate deploy
exec node dist/main.js
