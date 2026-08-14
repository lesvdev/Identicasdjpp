#!/bin/bash
# ══════════════════════════════════════════════════════════════════
#  deploy.sh — Script de despliegue en VPS (Ubuntu/Debian)
#  Ejecutar como root: bash deploy.sh
# ══════════════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  IdentiCASD-JPP — Despliegue en VPS                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

APP_DIR="/var/www/identicasd"
NODE_VERSION="20"

# ── 1. Actualizar sistema ─────────────────────────────────────────
echo "▶ Actualizando sistema..."
apt-get update -q && apt-get upgrade -y -q

# ── 2. Instalar Node.js ───────────────────────────────────────────
echo "▶ Instalando Node.js $NODE_VERSION..."
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs

# ── 3. Instalar Nginx ─────────────────────────────────────────────
echo "▶ Instalando Nginx..."
apt-get install -y nginx

# ── 4. Instalar PM2 ──────────────────────────────────────────────
echo "▶ Instalando PM2..."
npm install -g pm2

# ── 5. Crear directorio de la app ────────────────────────────────
echo "▶ Creando directorio $APP_DIR..."
mkdir -p "$APP_DIR/uploads"
mkdir -p "$APP_DIR/public"

# ── 6. Copiar archivos del backend ───────────────────────────────
echo "▶ Copiando archivos..."
cp server.js db.js drive.js package.json "$APP_DIR/"

# Copiar el frontend HTML compilado al directorio público
if [ -f "identicasd-jpp.html" ]; then
    cp identicasd-jpp.html "$APP_DIR/public/index.html"
    echo "   ✓ Frontend copiado"
else
    echo "   ⚠ identicasd-jpp.html no encontrado — cópialo manualmente a $APP_DIR/public/index.html"
fi

# ── 7. Configurar variables de entorno ───────────────────────────
if [ ! -f "$APP_DIR/.env" ]; then
    cp .env.example "$APP_DIR/.env"
    echo ""
    echo "   ⚠ IMPORTANTE: Edita $APP_DIR/.env con tus valores reales:"
    echo "      nano $APP_DIR/.env"
    echo ""
fi

# ── 8. Instalar dependencias Node ────────────────────────────────
echo "▶ Instalando dependencias npm..."
cd "$APP_DIR"
npm install --omit=dev

# ── 9. Configurar Nginx ───────────────────────────────────────────
echo "▶ Configurando Nginx..."
cp /tmp/identicasd-deploy/nginx.conf /etc/nginx/sites-available/identicasd
ln -sf /etc/nginx/sites-available/identicasd /etc/nginx/sites-enabled/identicasd
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 10. Iniciar con PM2 ───────────────────────────────────────────
echo "▶ Iniciando servidor con PM2..."
cd "$APP_DIR"
pm2 delete identicasd 2>/dev/null || true
pm2 start server.js --name identicasd --env production
pm2 save
pm2 startup | tail -1 | bash   # activa el inicio automático

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Despliegue completado                             ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  Próximos pasos:"
echo "  1. Edita $APP_DIR/.env con tu dominio y credenciales de Drive"
echo "  2. Sube google-service-account.json a $APP_DIR/"
echo "  3. Edita /etc/nginx/sites-available/identicasd (reemplaza TU_DOMINIO_O_IP)"
echo "  4. sudo nginx -t && sudo systemctl reload nginx"
echo "  5. Para HTTPS: sudo apt install certbot python3-certbot-nginx"
echo "     sudo certbot --nginx -d tudominio.com"
echo ""
echo "  Ver logs: pm2 logs identicasd"
echo "  Estado:   pm2 status"
