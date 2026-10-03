#!/bin/sh
set -e
cd /Users/adarsh/Documents/ring-api-helloworld-main
echo "=== prisma generate ==="
npx prisma generate 2>&1
echo "EXIT_PRISMA:$?"
echo "=== tsc ==="
rm -f tsconfig.tsbuildinfo
npx tsc --noEmit --incremental false 2>&1
echo "EXIT_TSC:$?"
echo "=== vitest ==="
npx vitest run 2>&1
echo "EXIT_VITEST:$?"
