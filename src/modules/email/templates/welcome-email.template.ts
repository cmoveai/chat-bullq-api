interface WelcomeEmailParams {
  name: string;
  appUrl: string;
}

export function renderWelcomeEmail(params: WelcomeEmailParams) {
  const { name, appUrl } = params;
  const firstName = name.split(' ')[0] || name;

  const subject = `Sua EIXXO está pronta, ${firstName}`;

  const text = `Sua EIXXO está pronta, ${firstName}.

Você acaba de entrar no atendimento omnichannel mais inteligente do Brasil. WhatsApp, Instagram e DM, tudo num inbox só, com agentes de IA que delegam, cobram Pix sozinhos e nunca dormem.

EM 15 MINUTOS VOCÊ ESTÁ ATENDENDO

Passo 1 · Conectar canal
Liga seu WhatsApp Cloud API ou Instagram Business em poucos cliques.
${appUrl}/settings/channels

Passo 2 · Criar primeiro agente IA
Defina persona, modelo e ferramentas. Júlia, Silvia, Marcelo. Quem você quiser.
${appUrl}/ai-agents

Passo 3 · Testar primeira conversa
Manda mensagem pro número conectado e veja a IA responder.
${appUrl}/inbox

COMEÇAR AGORA → ${appUrl}/dashboard

Travou em algum passo? Me chama no WhatsApp:
https://wa.me/5511943464000

Cris Magalhães
Founder · CMOVE.AI
cris@cmove.ai · cmove.ai`;

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${subject}</title>
<style>
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; border-radius: 0 !important; }
    .px-outer { padding: 24px 20px !important; }
    .px-inner { padding-left: 24px !important; padding-right: 24px !important; }
    .hero-h1 { font-size: 32px !important; line-height: 1.15 !important; }
    .step-num { font-size: 32px !important; }
    .cta-btn { width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none;max-height:0;overflow:hidden;color:transparent;">Atendimento omnichannel com IA. WhatsApp + Instagram num inbox só.</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:40px 16px;" class="px-outer">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,0.4);">

          <!-- HERO -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a0a0a 0%,#171717 60%,#1c2a1d 100%);padding:56px 48px 48px 48px;position:relative;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="display:inline-block;font-size:11px;letter-spacing:3px;color:#22c55e;text-transform:uppercase;font-weight:700;padding:6px 12px;border:1px solid rgba(34,197,94,0.3);border-radius:999px;margin-bottom:32px;">EIXXO</div>
                    <h1 class="hero-h1" style="margin:0 0 16px 0;font-size:42px;line-height:1.1;color:#ffffff;font-weight:800;letter-spacing:-1.5px;">
                      Sua plataforma<br>está pronta, <span style="color:#22c55e;">${firstName}</span>.
                    </h1>
                    <p style="margin:0;font-size:17px;line-height:1.55;color:#a1a1aa;font-weight:400;max-width:480px;">
                      Atendimento omnichannel com IA que delega, cobra Pix sozinha e nunca dorme. WhatsApp, Instagram e DM num inbox só.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- STATUS BAR -->
          <tr>
            <td style="background:#f0fdf4;padding:14px 48px;border-bottom:1px solid #dcfce7;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:13px;color:#15803d;font-weight:600;letter-spacing:0.3px;">
                    Conta criada · Workspace ativo · Primeira mensagem em 15 min
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- INTRO PASSOS -->
          <tr>
            <td style="padding:48px 48px 16px 48px;" class="px-inner">
              <div style="font-size:11px;letter-spacing:2.5px;color:#71717a;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Próximos 15 minutos</div>
              <h2 style="margin:0;font-size:26px;line-height:1.25;color:#0a0a0a;font-weight:700;letter-spacing:-0.5px;">
                Três passos pra começar a vender.
              </h2>
            </td>
          </tr>

          <!-- PASSO 1 -->
          <tr>
            <td style="padding:24px 48px 0 48px;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="56" style="vertical-align:top;">
                          <div class="step-num" style="font-size:36px;font-weight:800;color:#22c55e;line-height:1;letter-spacing:-2px;">01</div>
                        </td>
                        <td style="vertical-align:top;padding-left:8px;">
                          <h3 style="margin:0 0 6px 0;font-size:18px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">Conectar canal</h3>
                          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#52525b;">
                            WhatsApp Cloud API oficial ou Instagram Business. Um cola token, outro pelo painel Meta. Pronto em 3 minutos.
                          </p>
                          <a href="${appUrl}/settings/channels" style="display:inline-block;font-size:13px;color:#16a34a;text-decoration:none;font-weight:700;letter-spacing:0.3px;border-bottom:1px solid #16a34a;padding-bottom:1px;">CONECTAR CANAL →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PASSO 2 -->
          <tr>
            <td style="padding:16px 48px 0 48px;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="56" style="vertical-align:top;">
                          <div class="step-num" style="font-size:36px;font-weight:800;color:#22c55e;line-height:1;letter-spacing:-2px;">02</div>
                        </td>
                        <td style="vertical-align:top;padding-left:8px;">
                          <h3 style="margin:0 0 6px 0;font-size:18px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">Criar primeiro agente IA</h3>
                          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#52525b;">
                            Defina persona, modelo (Anthropic, OpenAI ou Groq) e ferramentas. Júlia delega, Silvia cobra Pix, você dorme tranquila.
                          </p>
                          <a href="${appUrl}/ai-agents" style="display:inline-block;font-size:13px;color:#16a34a;text-decoration:none;font-weight:700;letter-spacing:0.3px;border-bottom:1px solid #16a34a;padding-bottom:1px;">CRIAR AGENTE →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PASSO 3 -->
          <tr>
            <td style="padding:16px 48px 0 48px;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="56" style="vertical-align:top;">
                          <div class="step-num" style="font-size:36px;font-weight:800;color:#22c55e;line-height:1;letter-spacing:-2px;">03</div>
                        </td>
                        <td style="vertical-align:top;padding-left:8px;">
                          <h3 style="margin:0 0 6px 0;font-size:18px;font-weight:700;color:#0a0a0a;letter-spacing:-0.3px;">Testar primeira conversa</h3>
                          <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55;color:#52525b;">
                            Manda mensagem pro número conectado e vê o agente responder em tempo real. Acompanha tudo no inbox unificado.
                          </p>
                          <a href="${appUrl}/inbox" style="display:inline-block;font-size:13px;color:#16a34a;text-decoration:none;font-weight:700;letter-spacing:0.3px;border-bottom:1px solid #16a34a;padding-bottom:1px;">ABRIR INBOX →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA HERO -->
          <tr>
            <td align="center" style="padding:40px 48px 24px 48px;" class="px-inner">
              <a href="${appUrl}/dashboard" class="cta-btn" style="display:inline-block;background:#16a34a;color:#ffffff;font-size:16px;font-weight:700;padding:18px 44px;text-decoration:none;border-radius:10px;letter-spacing:0.3px;box-shadow:0 6px 20px rgba(22,163,74,0.35);">
                Abrir dashboard agora
              </a>
            </td>
          </tr>

          <!-- DIVISOR + SUPORTE -->
          <tr>
            <td style="padding:24px 48px 0 48px;" class="px-inner">
              <div style="border-top:1px solid #e4e4e7;padding-top:32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:top;">
                      <div style="font-size:11px;letter-spacing:2.5px;color:#71717a;text-transform:uppercase;font-weight:700;margin-bottom:8px;">Suporte direto</div>
                      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#27272a;font-weight:500;">
                        Travou em algum passo? Me chama no WhatsApp que eu ajudo na hora.
                      </p>
                      <a href="https://wa.me/5511943464000?text=Oi%20Cris%2C%20travei%20no%20onboarding%20da%20EIXXO" style="display:inline-block;font-size:14px;color:#0a0a0a;text-decoration:none;font-weight:700;background:#f4f4f5;padding:12px 20px;border-radius:8px;border:1px solid #e4e4e7;">
                        WhatsApp · 11 94346-4000
                      </a>
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- ASSINATURA -->
          <tr>
            <td style="padding:32px 48px 24px 48px;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size:15px;color:#0a0a0a;font-weight:700;line-height:1.4;">Cris Magalhães</div>
                    <div style="font-size:13px;color:#71717a;margin-top:2px;">Founder · CMOVE.AI</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#0a0a0a;padding:32px 48px;" class="px-inner">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size:11px;letter-spacing:3px;color:#22c55e;text-transform:uppercase;font-weight:700;margin-bottom:12px;">CMOVE.AI</div>
                    <p style="margin:0 0 16px 0;font-size:13px;line-height:1.6;color:#a1a1aa;">
                      Plataforma de IA pra negócios que querem vender mais e atender melhor sem contratar mais gente.
                    </p>
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:20px;">
                          <a href="https://cmove.ai" style="font-size:12px;color:#71717a;text-decoration:none;font-weight:600;">cmove.ai</a>
                        </td>
                        <td style="padding-right:20px;">
                          <a href="https://app.eixxohub.com" style="font-size:12px;color:#71717a;text-decoration:none;font-weight:600;">app.eixxohub.com</a>
                        </td>
                        <td>
                          <a href="mailto:cris@cmove.ai" style="font-size:12px;color:#71717a;text-decoration:none;font-weight:600;">cris@cmove.ai</a>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:24px;padding-top:20px;border-top:1px solid #27272a;font-size:11px;color:#52525b;line-height:1.5;">
                      Você recebeu este e-mail porque criou conta na EIXXO.<br>
                      © ${new Date().getFullYear()} CMOVE.AI · CNPJ 66.432.401/0001-29
                    </div>
                  </td>
                </tr>
              </table>
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
