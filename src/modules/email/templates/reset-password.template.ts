interface ResetPasswordParams {
  name: string;
  appUrl: string;
  token: string;
}

export function renderResetPasswordEmail(params: ResetPasswordParams) {
  const { name, appUrl, token } = params;
  const firstName = name.split(' ')[0] || name;
  const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  const subject = `Redefinir senha · CMOVE.AI-ZAP`;

  const text = `Redefinição de senha, ${firstName}.

Você (ou alguém) pediu pra redefinir a senha da sua conta CMOVE.AI-ZAP. Clique no link abaixo dentro de 1 hora pra cadastrar nova senha:

${resetUrl}

Se você não pediu, ignore este e-mail · sua senha continua intacta.

Cris Magalhães · CMOVE.AI`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
<style>@media only screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.px{padding:24px 20px!important}.h1{font-size:28px!important}.cta{width:100%!important;box-sizing:border-box!important}}</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,0.3);">

        <tr><td class="px" style="padding:44px 48px 32px;background:linear-gradient(135deg,#0a0a0a 0%,#1c1c1c 100%);">
          <div style="display:inline-block;font-size:11px;letter-spacing:2.5px;color:#fbbf24;text-transform:uppercase;font-weight:700;padding:5px 12px;border:1px solid rgba(251,191,36,0.4);border-radius:99px;margin-bottom:24px;">Redefinição de senha</div>
          <h1 class="h1" style="margin:0 0 12px;font-size:34px;line-height:1.1;color:#fff;font-weight:800;letter-spacing:-0.5px;">Cadastre uma nova senha, ${firstName}.</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#a1a1aa;">Recebemos um pedido de redefinição de senha pra sua conta. O link expira em 1 hora.</p>
        </td></tr>

        <tr><td class="px" align="center" style="padding:40px 48px 16px;">
          <a href="${resetUrl}" class="cta" style="display:inline-block;background:#dc2626;color:#fff;font-size:16px;font-weight:700;padding:18px 44px;text-decoration:none;border-radius:10px;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(220,38,38,0.35);">Redefinir senha</a>
        </td></tr>

        <tr><td class="px" style="padding:24px 48px;font-size:13px;color:#71717a;line-height:1.55;">
          Se o botão não funcionar, copie e cole este link no navegador:<br>
          <a href="${resetUrl}" style="color:#dc2626;word-break:break-all;text-decoration:underline;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;">${resetUrl}</a>
        </td></tr>

        <tr><td class="px" style="padding:8px 48px 24px;">
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;font-size:13px;color:#7f1d1d;line-height:1.55;">
            <strong style="color:#991b1b;">Não foi você?</strong> Ignore este e-mail. Sua senha permanece intacta. Se receber esses pedidos com frequência, troque de senha em <a href="${appUrl}/settings/security" style="color:#7f1d1d;text-decoration:underline;font-weight:600;">${appUrl}/settings/security</a>.
          </div>
        </td></tr>

        <tr><td class="px" style="padding:0 48px 32px;border-top:1px solid #e4e4e7;padding-top:20px;font-size:12px;color:#71717a;line-height:1.5;">
          CMOVE.AI · <a href="mailto:cris@cmove.ai" style="color:#71717a;text-decoration:underline;">cris@cmove.ai</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
