#!/bin/bash
# ============================================================
# Configura nginx como proxy reverso
# Ejecutar como root: bash /opt/copiamelafinal/scripts/vps/configurar-nginx.sh
# ============================================================
set -e

echo "============================================"
echo "  Configurando nginx"
echo "============================================"

read -p "Ingresa la IP publica de este VPS (ej: 65.21.100.200): " VPS_IP

# Crear configuracion nginx
cat > /etc/nginx/sites-available/copiamelafinal << EOF
server {
    listen 80;
    server_name $VPS_IP;

    # Aumentar limites para uploads
    client_max_body_size 100M;

    # Compresion gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    # Headers de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # CORS para Cloudflare Pages
    add_header Access-Control-Allow-Origin "https://copiamelafinal.pages.dev" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, PATCH, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization, Cookie" always;
    add_header Access-Control-Allow-Credentials "true" always;

    # Preflight OPTIONS
    if (\$request_method = OPTIONS) {
        return 204;
    }

    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    location /health {
        proxy_pass http://127.0.0.1:4000/api/healthz;
        access_log off;
    }
}
EOF

# Activar sitio
ln -sf /etc/nginx/sites-available/copiamelafinal /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Verificar configuracion
nginx -t

# Reiniciar nginx
systemctl restart nginx
systemctl enable nginx

echo ""
echo "============================================"
echo "  nginx configurado correctamente"
echo ""
echo "  Tu backend esta disponible en:"
echo "  http://$VPS_IP/api/healthz"
echo ""
echo "  PROXIMO PASO:"
echo "  Actualiza la variable VITE_API_URL en Cloudflare Pages"
echo "  de: https://copiamelafinal-api.onrender.com"
echo "  a:  http://$VPS_IP"
echo "============================================"

# Guardar IP para el script de actualizacion de Cloudflare
echo "$VPS_IP" > /opt/copiamelafinal/scripts/vps/.vps_ip
