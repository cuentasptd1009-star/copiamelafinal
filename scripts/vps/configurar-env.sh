#!/bin/bash
# ============================================================
# Configura las variables de entorno del backend
# Ejecutar como root: bash /opt/copiamelafinal/scripts/vps/configurar-env.sh
# ============================================================
set -e

APP_DIR="/opt/copiamelafinal"
ENV_FILE="$APP_DIR/artifacts/api-server/.env"

echo "============================================"
echo "  Configurando variables de entorno"
echo "============================================"

echo "Necesito algunos datos para configurar el servidor."
echo ""

read -p "1. DATABASE_URL (postgresql://...): " DATABASE_URL
read -p "2. CLOUDINARY_CLOUD_NAME: " CLOUDINARY_CLOUD_NAME
read -p "3. CLOUDINARY_API_KEY: " CLOUDINARY_API_KEY
read -p "4. CLOUDINARY_API_SECRET: " CLOUDINARY_API_SECRET
read -p "5. ADMIN_PASSWORD: " ADMIN_PASSWORD
read -p "6. SESSION_SECRET (escribe cualquier frase larga): " SESSION_SECRET

cat > "$ENV_FILE" << EOF
NODE_ENV=production
PORT=4000
DATABASE_URL=$DATABASE_URL
CLOUDINARY_CLOUD_NAME=$CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY=$CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET=$CLOUDINARY_API_SECRET
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$SESSION_SECRET
EOF

echo ""
echo "Archivo .env creado en $ENV_FILE"
echo ""
echo "Ahora ejecuta: bash /opt/copiamelafinal/scripts/vps/iniciar-servidor.sh"
