#!/usr/bin/env bash
# Onboarding assistido de canal Instagram pra um cliente EIXXO (1 comando).
# Conecta o IG business de um cliente a plataforma (ZAP) na org/tenant dele:
#   1. descobre igBusinessId/username + page token da Pagina do cliente
#   2. subscreve a Pagina ao app (liga o webhook de DM)
#   3. cifra o token (enc:v1 AES-256-GCM) e insere/atualiza o canal na org
#   4. valida contra o Graph (token decifra e responde a conta certa)
#
# PRE-REQUISITO: o cliente JA concedeu acesso ao EIXXO (parceria no Business
# Manager dele OU admin da Pagina). Sem isso o system user token nao enxerga a
# Pagina/token. NUNCA pedir senha do cliente.
#
# Uso:
#   ./onboard-ig.sh <PAGE_ID> <ORG_ID> [CHANNEL_ID] [NOME_DO_CANAL]
# Ex (idempotente, re-roda a conta da casa pra testar):
#   ./onboard-ig.sh 1274094392443764 cmoqc75wn0001ny0703uwnnpl
set -euo pipefail

PAGE_ID="${1:?uso: $0 <PAGE_ID> <ORG_ID> [CHANNEL_ID] [NOME]}"
ORG_ID="${2:?falta ORG_ID (tenant do cliente)}"
CHANNEL_ID="${3:-}"
CHANNEL_NAME="${4:-}"

SU_TOKEN=$(grep '^WHATSAPP_TOKEN=' ~/.config/cmove-secrets/whatsapp-cloud.env | sed 's/^WHATSAPP_TOKEN=//' | tr -d '"')
GRAPH="https://graph.facebook.com/v22.0"
FWD_SECRET="32d3e4d407dfcc32f65c8ee9cae7607c"   # forward secret (re-assinatura netlify <-> ZAP)
say(){ printf '\n\033[1;36m== %s\033[0m\n' "$1"; }

# 1. descobrir IG + page token
say "1/5 descobrindo IG + page token da Pagina $PAGE_ID"
curl -s "$GRAPH/$PAGE_ID?fields=name,access_token,instagram_business_account%7Bid,username%7D&access_token=$SU_TOKEN" > /tmp/onb_page.json
PAGE_NAME=$(python3 -c "import json;print(json.load(open('/tmp/onb_page.json')).get('name',''))")
IG_ID=$(python3 -c "import json;d=json.load(open('/tmp/onb_page.json'));print((d.get('instagram_business_account') or {}).get('id',''))")
IG_USER=$(python3 -c "import json;d=json.load(open('/tmp/onb_page.json'));print((d.get('instagram_business_account') or {}).get('username',''))")
PAGE_TOKEN=$(python3 -c "import json;print(json.load(open('/tmp/onb_page.json')).get('access_token',''))")
rm -f /tmp/onb_page.json
[ -z "$IG_ID" ] && { echo "ERRO: Pagina '$PAGE_NAME' sem IG business, ou EIXXO sem acesso (cliente concedeu parceria?)."; exit 1; }
[ -z "$PAGE_TOKEN" ] && { echo "ERRO: sem page token (acesso nao concedido pelo cliente)."; exit 1; }
[ -z "$CHANNEL_ID" ] && CHANNEL_ID="eixxo_chan_ig_${IG_USER//./_}"
[ -z "$CHANNEL_NAME" ] && CHANNEL_NAME="Instagram - @$IG_USER"
echo "  Pagina: $PAGE_NAME | IG: @$IG_USER ($IG_ID) | token ${#PAGE_TOKEN} chars | canal: $CHANNEL_ID"

# 2. subscrever a Pagina ao app (webhook de DM)
say "2/5 subscrevendo a Pagina ao app (webhook de mensagens)"
SUB=$(curl -s -X POST "$GRAPH/$PAGE_ID/subscribed_apps" \
  -d "subscribed_fields=messages,messaging_postbacks,message_reactions,message_reads,messaging_referrals" \
  -d "access_token=$PAGE_TOKEN")
echo "  $SUB"
echo "$SUB" | grep -q '"success":true' || { echo "ERRO ao subscrever a Pagina"; exit 1; }

# 3+4. cifrar token e inserir/atualizar canal (na VPS)
say "3+4/5 cifrando token e gravando canal $CHANNEL_ID na org $ORG_ID"
printf '%s' "$PAGE_TOKEN" | ssh eixxo-vps 'cat > /tmp/onb_pt.txt && chmod 600 /tmp/onb_pt.txt'
# vars locais -> arquivo no VPS (heredoc nao-quotado expande aqui; aspas simples protegem)
ssh eixxo-vps 'cat > /tmp/onb_vars.sh && chmod 600 /tmp/onb_vars.sh' <<VARS
PAGE_ID='$PAGE_ID'
IG_ID='$IG_ID'
IG_USER='$IG_USER'
ORG_ID='$ORG_ID'
CHANNEL_ID='$CHANNEL_ID'
CHANNEL_NAME='$CHANNEL_NAME'
FWD_SECRET='$FWD_SECRET'
VARS
# heredoc QUOTADO (literal): node -e intacto; \$ expande no remoto; vars via source
ssh eixxo-vps 'bash -s' <<'REMOTE'
set -e
source /tmp/onb_vars.sh
PT=$(cat /tmp/onb_pt.txt)
ENC=$(docker exec -e PLAIN="$PT" cmove-bullq-api-1 node -e '
const c=require("crypto");
const key=Buffer.from(process.env.ENCRYPTION_KEY,"hex");
const iv=c.randomBytes(12);
const ci=c.createCipheriv("aes-256-gcm",key,iv);
const ct=Buffer.concat([ci.update(process.env.PLAIN,"utf8"),ci.final()]);
const tag=ci.getAuthTag();
const enc="enc:v1:"+iv.toString("hex")+":"+tag.toString("hex")+":"+ct.toString("hex");
const p=enc.split(":");
const de=c.createDecipheriv("aes-256-gcm",key,Buffer.from(p[2],"hex"));
de.setAuthTag(Buffer.from(p[3],"hex"));
if(Buffer.concat([de.update(Buffer.from(p[4],"hex")),de.final()]).toString("utf8")!==process.env.PLAIN){console.error("ROUNDTRIP_FAIL");process.exit(1);}
process.stdout.write(enc);
')
case "$ENC" in enc:v1:*) : ;; *) echo "ENC invalido"; exit 1;; esac
docker exec -i cmove-bullq-postgres-1 psql -U bullq -d chat_bullq \
  -v enc="$ENC" -v pid="$PAGE_ID" -v ig="$IG_ID" -v usr="$IG_USER" -v org="$ORG_ID" -v cid="$CHANNEL_ID" -v cname="$CHANNEL_NAME" -v fwd="$FWD_SECRET" <<'SQL'
INSERT INTO channels (id, organization_id, type, name, config, is_active, visibility, created_at, updated_at)
VALUES (:'cid', :'org', 'INSTAGRAM', :'cname',
 jsonb_build_object('pageId',:'pid','igUserId',:'ig','igBusinessId',:'ig','username',:'usr','appSecret',:'fwd','apiVersion','v22.0','accessToken',:'enc'),
 true, 'ORG', now(), now())
ON CONFLICT (id) DO UPDATE SET config=EXCLUDED.config, name=EXCLUDED.name, organization_id=EXCLUDED.organization_id, is_active=true, updated_at=now();
SQL
rm -f /tmp/onb_pt.txt /tmp/onb_vars.sh
REMOTE

# 5. validar contra o Graph
say "5/5 validando (decifra token gravado + Graph responde a conta certa)"
ssh eixxo-vps 'cat > /tmp/onb_v5.sh' <<V5
CHANNEL_ID='$CHANNEL_ID'
IG_ID='$IG_ID'
GRAPH='$GRAPH'
V5
ssh eixxo-vps 'bash -s' <<'REMOTE'
source /tmp/onb_v5.sh
ENC=$(docker exec cmove-bullq-postgres-1 psql -U bullq -d chat_bullq -t -A -c "SELECT config->>'accessToken' FROM channels WHERE id='$CHANNEL_ID';")
PLAIN=$(docker exec -e ENC="$ENC" cmove-bullq-api-1 node -e '
const c=require("crypto");const key=Buffer.from(process.env.ENCRYPTION_KEY,"hex");const p=process.env.ENC.split(":");
const de=c.createDecipheriv("aes-256-gcm",key,Buffer.from(p[2],"hex"));de.setAuthTag(Buffer.from(p[3],"hex"));
process.stdout.write(Buffer.concat([de.update(Buffer.from(p[4],"hex")),de.final()]).toString("utf8"));')
docker exec -e PLAIN="$PLAIN" -e IG_ID="$IG_ID" -e GRAPH="$GRAPH" cmove-bullq-api-1 sh -c 'curl -s "$GRAPH/$IG_ID?fields=username,name&access_token=$PLAIN"'
rm -f /tmp/onb_v5.sh
REMOTE
echo ""
say "FEITO. Canal $CHANNEL_ID conectado p/ @$IG_USER na org $ORG_ID."
echo "Confirmacao final: peca 1 DM de teste pro @$IG_USER e veja 'Enqueued inbound' no log do ZAP."
