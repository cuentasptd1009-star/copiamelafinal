#!/bin/bash
set -e
APP_DIR=/opt/copiamelafinal
echo Iniciando actualizacion...
cd $APP_DIR
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/api-server run build
pm2 reload copiamelafinal-api --update-env
echo Actualizacion completada
