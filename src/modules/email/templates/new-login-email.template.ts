interface NewLoginEmailParams {
  name: string;
  appUrl: string;
  whenIso: string;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  isFirstLogin: boolean;
}

function summarizeUserAgent(ua: string | null): string {
  if (!ua) return 'Dispositivo desconhecido';
  const isMac = /Mac/i.test(ua);
  const isWin = /Windows/i.test(ua);
  const isLinux = /Linux/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad/i.test(ua);
  const isChrome = /Chrome/i.test(ua) && !/Edg/i.test(ua);
  const isFirefox = /Firefox/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/Chrome/i.test(ua);
  const isEdge = /Edg/i.test(ua);

  const os = isAndroid ? 'Android' : isIOS ? 'iOS' : isMac ? 'macOS' : isWin ? 'Windows' : isLinux ? 'Linux' : 'Sistema desconhecido';
  const browser = isEdge ? 'Edge' : isChrome ? 'Chrome' : isFirefox ? 'Firefox' : isSafari ? 'Safari' : 'Navegador desconhecido';
  return `${browser} no ${os}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long', timeStyle: 'short' });
}

export function renderNewLoginEmail(params: NewLoginEmailParams) {
  const { name, appUrl, whenIso, ip, country, userAgent, isFirstLogin } = params;
  const firstName = name.split(' ')[0] || name;
  const device = summarizeUserAgent(userAgent);
  const when = formatTime(whenIso);
  const location = country ? `${country}` : 'localização não identificada';
  const ipShown = ip ? ip : 'IP não capturado';

  const subject = isFirstLogin
    ? `Primeiro login na sua CMOVE.AI-ZAP`
    : `Novo acesso detectado na sua CMOVE.AI-ZAP`;

  const text = `${subject}, ${firstName}.

Detectamos um login na sua conta vindo de um dispositivo ou local que não é habitual:

Quando: ${when}
De onde: ${location} (${ipShown})
Dispositivo: ${device}

Foi você? Não precisa fazer nada.

Não foi você? Vai imediatamente em ${appUrl}/settings/security trocar sua senha e revogar sessões ativas.

CMOVE.AI · cris@cmove.ai`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; border-radius: 0 !important; }
    .px { padding: 24px 20px !important; }
    .h1 { font-size: 26px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.3);">

          <tr>
            <td class="px" style="padding:36px 44px 28px;background:linear-gradient(135deg,#0a0a0a 0%,#1c1c1c 100%);">
              <div style="display:inline-block;font-size:11px;letter-spacing:2.5px;color:#fbbf24;text-transform:uppercase;font-weight:700;padding:5px 12px;border:1px solid rgba(251,191,36,0.4);border-radius:99px;margin-bottom:20px;">Aviso de segurança</div>
              <h1 class="h1" style="margin:0 0 12px;font-size:30px;line-height:1.15;color:#fff;font-weight:800;letter-spacing:-0.5px;">
                ${isFirstLogin ? 'Primeiro acesso na sua conta.' : 'Novo acesso detectado.'}
              </h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#a1a1aa;">
                Detectamos um login na sua conta CMOVE.AI-ZAP vindo de ${isFirstLogin ? 'um' : 'um novo'} dispositivo ou localização. Confirme se foi você.
              </p>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:32px 44px 16px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
                <tr>
                  <td style="padding:18px 22px;border-bottom:1px solid #e4e4e7;">
                    <div style="font-size:11px;letter-spacing:1.5px;color:#71717a;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Quando</div>
                    <div style="font-size:14px;color:#0a0a0a;font-weight:500;">${when}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 22px;border-bottom:1px solid #e4e4e7;">
                    <div style="font-size:11px;letter-spacing:1.5px;color:#71717a;text-transform:uppercase;font-weight:700;margin-bottom:4px;">De onde</div>
                    <div style="font-size:14px;color:#0a0a0a;font-weight:500;">${location} <span style="color:#71717a;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;">· ${ipShown}</span></div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 22px;">
                    <div style="font-size:11px;letter-spacing:1.5px;color:#71717a;text-transform:uppercase;font-weight:700;margin-bottom:4px;">Dispositivo</div>
                    <div style="font-size:14px;color:#0a0a0a;font-weight:500;">${device}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:24px 44px 8px;font-size:15px;line-height:1.55;color:#3f3f46;">
              <strong style="color:#0a0a0a;">Foi você?</strong> Não precisa fazer nada. Esse aviso é só pra te manter informada.
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:8px 44px 28px;">
              <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:18px 22px;">
                <div style="font-size:14px;color:#991b1b;font-weight:600;margin-bottom:6px;">Não foi você?</div>
                <div style="font-size:13px;color:#7f1d1d;line-height:1.5;margin-bottom:12px;">Troca a senha imediatamente e revoga as sessões ativas pra cortar o acesso indevido.</div>
                <a href="${appUrl}/settings/security" style="display:inline-block;background:#dc2626;color:#fff;font-size:13px;font-weight:700;padding:11px 22px;text-decoration:none;border-radius:8px;letter-spacing:0.2px;">Trocar senha agora</a>
              </div>
            </td>
          </tr>

          <tr>
            <td class="px" style="padding:0 44px 28px;font-size:12px;color:#71717a;line-height:1.5;border-top:1px solid #e4e4e7;padding-top:20px;">
              CMOVE.AI · CMOVE.AI-ZAP · <a href="mailto:cris@cmove.ai" style="color:#71717a;text-decoration:underline;">cris@cmove.ai</a><br>
              Você está recebendo este e-mail porque um login foi detectado na sua conta. Configurações de notificação ficam em <a href="${appUrl}/settings/security" style="color:#71717a;text-decoration:underline;">${appUrl}/settings/security</a>.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
