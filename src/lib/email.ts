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
function createTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT ?? 465);

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendMagicLinkEmail(email: string, url: string): Promise<void> {
  const transport = createTransport();

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
