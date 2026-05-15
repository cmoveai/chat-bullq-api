#!/usr/bin/env bash
# Cyber Onda 2 · #29 · Secret rotation manual (alternativa zero-custo a Doppler)
#
# Rotaciona secrets app-level no .env do VPS · sem dependência externa.
# Roda no Mac local · cada secret pode ser rotacionado isoladamente.
#
# Cuidado: alguns rotates QUEBRAM sessões ativas (JWT_SECRET) · planeje janela.
# Outros são silenciosos (BACKUP_ENCRYPTION_KEY · só novos backups usam).
#
# Uso:
#   ./scripts/rotate-secrets.sh <key>
#   ./scripts/rotate-secrets.sh JWT_SECRET
#   ./scripts/rotate-secrets.sh TOTP_ENC_KEY
#   ./scripts/rotate-secrets.sh BACKUP_ENCRYPTION_KEY
#   ./scripts/rotate-secrets.sh JWT_REFRESH_SECRET
#
# Setup:
# 1. VPS_HOST=2.24.77.40
# 2. SSH key autorizada em root@VPS_HOST
# 3. /opt/chat-bullq/.env existe no VPS

set -euo pipefail

VPS_HOST="${VPS_HOST:-root@2.24.77.40}"
ENV_PATH="/opt/chat-bullq/.env"

ROTATABLE=(
  JWT_SECRET
  JWT_REFRESH_SECRET
  TOTP_ENC_KEY
  BACKUP_ENCRYPTION_KEY
)

INVALIDATES_SESSIONS=(
  JWT_SECRET
  JWT_REFRESH_SECRET
)

key="${1:-}"
if [[ -z "$key" ]]; then
  echo "Cyber Onda 2 · Secret Rotation"
  echo
  echo "Uso: $0 <key>"
  echo
  echo "Keys rotacionáveis:"
  for k in "${ROTATABLE[@]}"; do
    warn=""
    for w in "${INVALIDATES_SESSIONS[@]}"; do
      [[ "$w" == "$k" ]] && warn=" (⚠ invalida sessões ativas)"
    done
    echo "  · $k$warn"
  done
  exit 1
fi

# Valida key
ok=0
for k in "${ROTATABLE[@]}"; do
  [[ "$k" == "$key" ]] && ok=1
done
if [[ $ok -eq 0 ]]; then
  echo "ERRO: '$key' não está na whitelist · rotação manual" >&2
  exit 1
fi

# Confirma se invalida sessões
for w in "${INVALIDATES_SESSIONS[@]}"; do
  if [[ "$w" == "$key" ]]; then
    echo "⚠ Atenção: rotacionar $key invalida TODAS as sessões ativas."
    read -p "Continuar? (yes/no) " ans
    [[ "$ans" != "yes" ]] && { echo "Abortado."; exit 0; }
  fi
done

# Gera novo valor (32 bytes base64)
new_value=$(openssl rand -base64 32)

# Backup do .env antes
ts=$(date +%Y%m%d-%H%M%S)
ssh "$VPS_HOST" "cp $ENV_PATH $ENV_PATH.backup.$ts"
echo "Backup: $ENV_PATH.backup.$ts"

# Substitui no .env
ssh "$VPS_HOST" "sed -i 's|^${key}=.*|${key}=${new_value}|' $ENV_PATH"

# Confirma que entrou
if ! ssh "$VPS_HOST" "grep -q '^${key}=' $ENV_PATH"; then
  echo "ERRO: key não encontrada no .env após sed · restaurando backup" >&2
  ssh "$VPS_HOST" "cp $ENV_PATH.backup.$ts $ENV_PATH"
  exit 1
fi
echo "✓ $key rotacionado no $ENV_PATH"

# Restart api
echo "Restartando container api..."
ssh "$VPS_HOST" "cd /opt/chat-bullq && docker compose up -d --no-deps api" >/dev/null

# Audit
echo "✓ Rotação completa · $key · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "Próximos passos manuais:"
case "$key" in
  JWT_SECRET|JWT_REFRESH_SECRET)
    echo "  · Avisar clientes ativos sobre re-login (sessões invalidadas)"
    ;;
  TOTP_ENC_KEY)
    echo "  · ATENÇÃO: secrets 2FA dos users foram cifrados com chave antiga"
    echo "    → users com 2FA precisam re-setup. Pra evitar, NÃO rotacionar"
    echo "    TOTP_ENC_KEY em produção sem migration de re-encryption."
    ;;
  BACKUP_ENCRYPTION_KEY)
    echo "  · Backups antigos cifrados com chave anterior continuam válidos"
    echo "    APENAS se você guardou a chave antiga em local seguro"
    ;;
esac
