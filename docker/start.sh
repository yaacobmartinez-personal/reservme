#!/bin/sh
# The web container's start command (render.yaml → dockerCommand: sh start.sh).
# Migrations first: migrate.js records what it has applied, so a restart
# re-runs nothing, and if one fails the server never starts and the previous
# deploy keeps serving. A script rather than an inline `sh -c "…"` because
# Render does not shell-parse quotes in dockerCommand.
set -e
node migrate.js
exec node server.js
