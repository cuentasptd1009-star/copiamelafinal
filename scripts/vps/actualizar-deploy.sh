#!/bin/bash
# ============================================================
# Script de actualizacion (ejecutado por GitHub Actions)
# Se copia al VPS y se llama automaticamente en cada push
# ============================================================
set -e

APP_DIR="/opt/copiamelafinal"
ENV_FILE="$APP_DIR/artifacts/api-server/.env"

echo "[$(date)] Iniciando actualizacion..."

cd "$APP_DIR"

# Obtener ultimos cambios
git fetch origin main
git reset --hard origin/main

# Instalar dependencias nuevas si las hay
pnpm install --frozen-lockfile

# Recompilar backend
pnpm --filter @workspace/api-server run build

# Cargar variables de entorno
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Reiniciar servidor con zero downtime
pm2 reload copiamelafinal-api --update-env

echo "[$(date)] Actualizacion completada exitosamente"
pm2 status copiamelafinal-api
