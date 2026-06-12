# Guía: Mover backend de Render al VPS Hetzner

## Por qué hacemos esto
Tu backend en Render free tier se duerme y no aguanta el tráfico. El VPS de Hetzner
corre 24/7 sin límites de tráfico.

## Pasos (en orden)

### PASO 1 — Crear el VPS en Hetzner
1. Ve a https://console.hetzner.cloud
2. Crea un proyecto nuevo (o usa uno existente)
3. Click "Add Server"
4. Configuración recomendada:
   - **Location**: Cualquiera (Finland o Germany son los más baratos)
   - **Image**: Ubuntu 24.04
   - **Type**: CX22 (2 vCPU, 4GB RAM) — €3.29/mes, suficiente para 100 usuarios
   - **SSH Key**: Agrega una o usa contraseña (más fácil para empezar)
5. Click "Create & Buy"
6. Anota la **IP pública** que aparece (ej: 65.21.100.200)

### PASO 2 — Conectarte al VPS por SSH
Desde tu computadora, abre una terminal y escribe:
```
ssh root@TU_IP_AQUI
```
Acepta el mensaje que aparece (escribe "yes") y pon la contraseña.

### PASO 3 — Instalar todo automáticamente
Una vez dentro del VPS, copia y pega este comando:
```bash
curl -fsSL https://raw.githubusercontent.com/cuentasptd1009-star/copiamelafinal/main/scripts/vps/instalar-vps.sh | bash
```
Esto instala Node.js, pnpm, PM2, nginx y clona tu repositorio.
**Espera ~5 minutos** hasta que termine.

### PASO 4 — Configurar las variables de entorno
```bash
bash /opt/copiamelafinal/scripts/vps/configurar-env.sh
```
Te pedirá estos datos (los tienes guardados en Render):
- DATABASE_URL: `postgresql://neondb_owner:npg_hFPyjeI6Xb0r@ep-billowing-wildflower-apka4m91.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require`
- CLOUDINARY_CLOUD_NAME: `dn2s7kqxv`
- CLOUDINARY_API_KEY: `887494878519261`
- CLOUDINARY_API_SECRET: (lo ves en Render → copiamelafinal-api → Environment)
- ADMIN_PASSWORD: `850221`
- SESSION_SECRET: escribe cualquier frase larga (ej: `mi-super-secreto-2024-hetzner`)

### PASO 5 — Iniciar el servidor
```bash
bash /opt/copiamelafinal/scripts/vps/iniciar-servidor.sh
```

### PASO 6 — Configurar nginx
```bash
bash /opt/copiamelafinal/scripts/vps/configurar-nginx.sh
```
Te pedirá la IP del VPS. Ponla y listo.

### PASO 7 — Verificar que funciona
Abre en tu navegador:
```
http://TU_IP/api/healthz
```
Debes ver: `{"status":"ok"}`

### PASO 8 — Actualizar Cloudflare Pages
Yo (el agente) actualizaré automáticamente la variable VITE_API_URL en Cloudflare
cuando me digas la IP de tu VPS. El frontend apuntará al VPS en lugar de Render.

### PASO 9 — Deploy automático (GitHub Actions)
Agrega estos secretos en tu repositorio de GitHub:
- Ve a: https://github.com/cuentasptd1009-star/copiamelafinal/settings/secrets/actions
- Agrega:
  - `VPS_IP` → tu IP del VPS
  - `VPS_SSH_USER` → root
  - `VPS_SSH_PASSWORD` → tu contraseña del VPS

A partir de ahí, cada vez que hagas push a main, el backend se actualiza solo.

## Resultado final
- Frontend: Cloudflare Pages (gratis, sin límites)
- Backend: VPS Hetzner CX22 (~€3.29/mes, 24/7, sin dormir)
- Base de datos: Neon (ya está bien, no se mueve)
- Deploy automático: cada push actualiza el VPS
