#!/bin/bash
# ============================================================
# Inicia el servidor backend con PM2
# Ejecutar como root: bash /opt/copiamelafinal/scripts/vps/iniciar-servidor.sh
# ============================================================
set -e

APP_DIR="/opt/copiamelafinal"
ENV_FILE="$APP_DIR/artifacts/api-server/.env"

echo "============================================"
echo "  Iniciando servidor con PM2"
echo "============================================"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: No existe el archivo .env"
  echo "Ejecuta primero: bash $APP_DIR/scripts/vps/configurar-env.sh"
  exit 1
fi

cd "$APP_DIR"

# Cargar variables de entorno
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Parar instancia anterior si existe
pm2 delete copiamelafinal-api 2>/dev/null || true

# Iniciar con PM2
pm2 start artifacts/api-server/dist/index.mjs \
  --name "copiamelafinal-api" \
  --env-file "$ENV_FILE" \
  --max-memory-restart 400M \
  --restart-delay 3000 \
  --max-restarts 10

# Guardar configuracion PM2 para que inicie al reiniciar el servidor
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash 2>/dev/null || pm2 startup | tail -1 | bash 2>/dev/null || true
pm2 save

echo ""
echo "============================================"
echo "  Servidor iniciado en puerto 4000"
echo "  Verificando estado..."
echo "============================================"
sleep 3
pm2 status

echo ""
echo "Ahora ejecuta: bash $APP_DIR/scripts/vps/configurar-nginx.sh"
