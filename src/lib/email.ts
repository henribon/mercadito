import nodemailer from "nodemailer";

/**
 * Envio do link de acesso.
 *
 * Funciona com qualquer SMTP. O caminho mais simples e gratuito e uma senha de
 * app do Gmail (Conta Google > Segurança > Verificação em duas etapas >
 * Senhas de app) — envia para qualquer destinatário, sem precisar de domínio
 * próprio como exigem Resend e afins.
 *
 * Sem SMTP configurado o link vai para o console, o que permite testar o app
 * inteiro antes de mexer com e-mail.
 */
/**
 * O transporte e criado uma vez e reaproveitado: abrir conexao TLS com o Gmail
 * do zero custa varios segundos, e pagar isso a cada login deixaria a funcao
 * perigosamente perto do tempo limite da Vercel. `undefined` = ainda nao
 * resolvido; `null` = sem SMTP configurado.
 */
let cachedTransport: nodemailer.Transporter | null | undefined;

function getTransport() {
  if (cachedTransport !== undefined) return cachedTransport;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    cachedTransport = null;
    return cachedTransport;
  }

  const port = Number(process.env.SMTP_PORT ?? 465);

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // Mantem a conexao viva entre envios na mesma instancia.
    pool: true,
    maxConnections: 1,
  });

  return cachedTransport;
}

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const transport = getTransport();

  if (!transport) {
    console.warn(
      `\n[Mercadito] SMTP não configurado. Link de acesso para ${email}:\n${url}\n`,
    );
    return;
  }

  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER!;

  await transport.sendMail({
    from: `Mercadito <${from}>`,
    to: email,
    subject: "Seu acesso ao Mercadito",
    text: `Toque no link para entrar no Mercadito:\n\n${url}\n\nO link vale por 15 minutos. Se não foi você que pediu, ignore este e-mail.`,
    html: `
      <div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#191918">
        <h1 style="margin:0 0 8px;font-size:20px;font-weight:600">Mercadito</h1>
        <p style="margin:0 0 24px;font-size:14px;color:#6f6f6b">
          Toque no botão abaixo para entrar. O link vale por 15 minutos.
        </p>
        <a href="${url}"
           style="display:inline-block;background:#1f7a4d;color:#fff;text-decoration:none;
                  padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500">
          Entrar no Mercadito
        </a>
        <p style="margin:24px 0 0;font-size:12px;color:#6f6f6b">
          Se não foi você que pediu, pode ignorar este e-mail.
        </p>
      </div>
    `,
  });
}
