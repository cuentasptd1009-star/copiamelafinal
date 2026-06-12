#!/bin/bash
# ============================================================
# Script de instalacion del backend en VPS Hetzner
# Ejecutar como root: bash instalar-vps.sh
# ============================================================
set -e

echo "============================================"
echo "  Instalando backend SuperTV en VPS Hetzner"
echo "============================================"

# 1. Actualizar sistema
echo "[1/8] Actualizando sistema..."
apt-get update -y && apt-get upgrade -y

# 2. Instalar Node.js 22 (LTS)
echo "[2/8] Instalando Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 3. Instalar pnpm
echo "[3/8] Instalando pnpm..."
npm install -g pnpm@9

# 4. Instalar PM2 (gestor de procesos)
echo "[4/8] Instalando PM2..."
npm install -g pm2

# 5. Instalar nginx
echo "[5/8] Instalando nginx..."
apt-get install -y nginx

# 6. Instalar git
echo "[6/8] Instalando git..."
apt-get install -y git

# 7. Clonar repositorio
echo "[7/8] Clonando repositorio..."
cd /opt
if [ -d "copiamelafinal" ]; then
  echo "  -> Repositorio ya existe, actualizando..."
  cd copiamelafinal
  git pull origin main
else
  git clone https://github.com/cuentasptd1009-star/copiamelafinal.git
  cd copiamelafinal
fi

# 8. Instalar dependencias y compilar
echo "[8/8] Instalando dependencias..."
pnpm install --frozen-lockfile

echo "Compilando backend..."
pnpm --filter @workspace/api-server run build

echo ""
echo "============================================"
echo "  INSTALACION BASE COMPLETADA"
echo "  Ahora ejecuta: bash /opt/copiamelafinal/scripts/vps/configurar-env.sh"
echo "============================================"
