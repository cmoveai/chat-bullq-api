interface VerifyEmailParams {
  name: string;
  appUrl: string;
  token: string;
}

export function renderVerifyEmail(params: VerifyEmailParams) {
  const { name, appUrl, token } = params;
  const firstName = name.split(' ')[0] || name;
  const verifyUrl = `${appUrl}/verify-email?token=${encodeURIComponent(token)}`;

  const subject = `Confirme seu e-mail · EIXXO`;

  const text = `Confirme seu e-mail, ${firstName}.

Pra liberar seu acesso à plataforma EIXXO, clique no link abaixo dentro de 24 horas:

${verifyUrl}

Se você não criou essa conta, pode ignorar este e-mail.

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

        <tr><td class="px" style="padding:44px 48px 32px;background:linear-gradient(135deg,#0a0a0a 0%,#1c2a1d 100%);">
          <div style="display:inline-block;font-size:11px;letter-spacing:2.5px;color:#22c55e;text-transform:uppercase;font-weight:700;padding:5px 12px;border:1px solid rgba(34,197,94,0.4);border-radius:99px;margin-bottom:24px;">Confirmação de e-mail</div>
          <h1 class="h1" style="margin:0 0 12px;font-size:34px;line-height:1.1;color:#fff;font-weight:800;letter-spacing:-0.5px;">Falta um clique pra começar, ${firstName}.</h1>
          <p style="margin:0;font-size:15px;line-height:1.6;color:#a1a1aa;">Confirme que este e-mail é seu pra liberar o acesso à plataforma EIXXO. O link expira em 24 horas.</p>
        </td></tr>

        <tr><td class="px" align="center" style="padding:40px 48px 16px;">
          <a href="${verifyUrl}" class="cta" style="display:inline-block;background:#16a34a;color:#fff;font-size:16px;font-weight:700;padding:18px 44px;text-decoration:none;border-radius:10px;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(22,163,74,0.35);">Confirmar e-mail</a>
        </td></tr>

        <tr><td class="px" style="padding:24px 48px;font-size:13px;color:#71717a;line-height:1.55;">
          Se o botão não funcionar, copie e cole este link no navegador:<br>
          <a href="${verifyUrl}" style="color:#16a34a;word-break:break-all;text-decoration:underline;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:12px;">${verifyUrl}</a>
        </td></tr>

        <tr><td class="px" style="padding:0 48px 32px;border-top:1px solid #e4e4e7;padding-top:20px;font-size:12px;color:#71717a;line-height:1.5;">
          Se você não criou conta na EIXXO, pode ignorar este e-mail. Nenhuma ação adicional é necessária.<br><br>
          CMOVE.AI · <a href="mailto:cris@cmove.ai" style="color:#71717a;text-decoration:underline;">cris@cmove.ai</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
