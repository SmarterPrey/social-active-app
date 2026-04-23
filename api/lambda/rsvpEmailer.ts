import type { SQSEvent, SQSBatchResponse } from "aws-lambda";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RsvpInviteMessage {
  eventId: string;
  eventTitle: string;
  startsAt: string;
  venue?: string | null;
  city?: string | null;
  memberId: string;
  memberEmail: string;
  memberName: string;
  token: string;
}

const FROM = process.env.RSVP_FROM_ADDRESS!;
const BASE = process.env.RSVP_BASE_URL!;
const CONFIG_SET = process.env.RSVP_CONFIG_SET;

let _ses: any;
async function ses() {
  if (!_ses) {
    const mod: any = await import(
      /* webpackIgnore: true */ "@aws-sdk/client-sesv2" as string
    );
    _ses = new mod.SESv2Client({ region: process.env.AWS_REGION });
    (ses as any).send = mod.SendEmailCommand;
  }
  return _ses;
}

function renderHtml(m: RsvpInviteMessage) {
  const url = `${BASE}/rsvp?token=${encodeURIComponent(m.token)}`;
  const when = new Date(m.startsAt).toLocaleString();
  const where = [m.venue, m.city].filter(Boolean).join(" — ");
  return `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f4f2ee;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
    <h1 style="margin:0 0 8px;font-size:20px;color:#1f2937;">${m.eventTitle}</h1>
    <p style="margin:0 0 4px;color:#4b5563;">${when}</p>
    ${where ? `<p style="margin:0 0 16px;color:#4b5563;">${where}</p>` : ""}
    <p style="margin:16px 0;color:#1f2937;">Hi ${m.memberName}, you're invited. Please let us know if you can make it.</p>
    <p style="margin:24px 0;">
      <a href="${url}&r=yes" style="background:#0a66c2;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;margin-right:8px;">I'll attend</a>
      <a href="${url}&r=no" style="background:#e5e7eb;color:#1f2937;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;margin-right:8px;">Can't make it</a>
      <a href="${url}&r=maybe" style="background:transparent;color:#0a66c2;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600;border:1px solid #0a66c2;">Maybe</a>
    </p>
    <p style="margin-top:32px;color:#6b7280;font-size:12px;">This invitation is personalized — please don't forward.</p>
  </div></body></html>`;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];
  const client = await ses();
  const SendEmailCommand = (ses as any).send;

  for (const rec of event.Records) {
    try {
      const msg = JSON.parse(rec.body) as RsvpInviteMessage;
      const html = renderHtml(msg);
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: FROM,
          Destination: { ToAddresses: [msg.memberEmail] },
          Content: {
            Simple: {
              Subject: { Data: `Invitation: ${msg.eventTitle}` },
              Body: { Html: { Data: html } },
            },
          },
          ConfigurationSetName: CONFIG_SET,
        }),
      );
    } catch (err) {
      console.error("rsvp emailer failed", rec.messageId, err);
      failures.push({ itemIdentifier: rec.messageId });
    }
  }
  return { batchItemFailures: failures };
}
