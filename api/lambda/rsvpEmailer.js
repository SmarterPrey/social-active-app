"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const FROM = process.env.RSVP_FROM_ADDRESS;
const BASE = process.env.RSVP_BASE_URL;
const CONFIG_SET = process.env.RSVP_CONFIG_SET;
let _ses;
async function ses() {
    if (!_ses) {
        const mod = await Promise.resolve(`${
        /* webpackIgnore: true */ "@aws-sdk/client-sesv2"}`).then(s => require(s));
        _ses = new mod.SESv2Client({ region: process.env.AWS_REGION });
        ses.send = mod.SendEmailCommand;
    }
    return _ses;
}
function renderHtml(m) {
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
async function handler(event) {
    const failures = [];
    const client = await ses();
    const SendEmailCommand = ses.send;
    for (const rec of event.Records) {
        try {
            const msg = JSON.parse(rec.body);
            const html = renderHtml(msg);
            await client.send(new SendEmailCommand({
                FromEmailAddress: FROM,
                Destination: { ToAddresses: [msg.memberEmail] },
                Content: {
                    Simple: {
                        Subject: { Data: `Invitation: ${msg.eventTitle}` },
                        Body: { Html: { Data: html } },
                    },
                },
                ConfigurationSetName: CONFIG_SET,
            }));
        }
        catch (err) {
            console.error("rsvp emailer failed", rec.messageId, err);
            failures.push({ itemIdentifier: rec.messageId });
        }
    }
    return { batchItemFailures: failures };
}
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnN2cEVtYWlsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJyc3ZwRW1haWxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFnQkEsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBa0IsQ0FBQztBQUM1QyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWMsQ0FBQztBQUN4QyxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsQ0FBQztBQUUvQyxJQUFJLElBQVMsQ0FBQztBQUNkLEtBQUssVUFBVSxHQUFHO0lBQ2hCLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNWLE1BQU0sR0FBRyxHQUFRO1FBQ2YseUJBQXlCLENBQUMsdUJBQWlDLHlCQUM1RCxDQUFDO1FBQ0YsSUFBSSxHQUFHLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDOUQsR0FBVyxDQUFDLElBQUksR0FBRyxHQUFHLENBQUMsZ0JBQWdCLENBQUM7SUFDM0MsQ0FBQztJQUNELE9BQU8sSUFBSSxDQUFDO0FBQ2QsQ0FBQztBQUVELFNBQVMsVUFBVSxDQUFDLENBQW9CO0lBQ3RDLE1BQU0sR0FBRyxHQUFHLEdBQUcsSUFBSSxlQUFlLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO0lBQ2hFLE1BQU0sSUFBSSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxjQUFjLEVBQUUsQ0FBQztJQUNuRCxNQUFNLEtBQUssR0FBRyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDNUQsT0FBTzs7K0RBRXNELENBQUMsQ0FBQyxVQUFVOytDQUM1QixJQUFJO01BQzdDLEtBQUssQ0FBQyxDQUFDLENBQUMsNkNBQTZDLEtBQUssTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFO2lEQUMxQixDQUFDLENBQUMsVUFBVTs7aUJBRTVDLEdBQUc7aUJBQ0gsR0FBRztpQkFDSCxHQUFHOzs7dUJBR0csQ0FBQztBQUN4QixDQUFDO0FBRU0sS0FBSyxVQUFVLE9BQU8sQ0FBQyxLQUFlO0lBQzNDLE1BQU0sUUFBUSxHQUFpQyxFQUFFLENBQUM7SUFDbEQsTUFBTSxNQUFNLEdBQUcsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUMzQixNQUFNLGdCQUFnQixHQUFJLEdBQVcsQ0FBQyxJQUFJLENBQUM7SUFFM0MsS0FBSyxNQUFNLEdBQUcsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDaEMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFzQixDQUFDO1lBQ3RELE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUM3QixNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQ2YsSUFBSSxnQkFBZ0IsQ0FBQztnQkFDbkIsZ0JBQWdCLEVBQUUsSUFBSTtnQkFDdEIsV0FBVyxFQUFFLEVBQUUsV0FBVyxFQUFFLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFO2dCQUMvQyxPQUFPLEVBQUU7b0JBQ1AsTUFBTSxFQUFFO3dCQUNOLE9BQU8sRUFBRSxFQUFFLElBQUksRUFBRSxlQUFlLEdBQUcsQ0FBQyxVQUFVLEVBQUUsRUFBRTt3QkFDbEQsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFO3FCQUMvQjtpQkFDRjtnQkFDRCxvQkFBb0IsRUFBRSxVQUFVO2FBQ2pDLENBQUMsQ0FDSCxDQUFDO1FBQ0osQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYixPQUFPLENBQUMsS0FBSyxDQUFDLHFCQUFxQixFQUFFLEdBQUcsQ0FBQyxTQUFTLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDekQsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLGNBQWMsRUFBRSxHQUFHLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNuRCxDQUFDO0lBQ0gsQ0FBQztJQUNELE9BQU8sRUFBRSxpQkFBaUIsRUFBRSxRQUFRLEVBQUUsQ0FBQztBQUN6QyxDQUFDO0FBNUJELDBCQTRCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgU1FTRXZlbnQsIFNRU0JhdGNoUmVzcG9uc2UgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG4vKiBlc2xpbnQtZGlzYWJsZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55ICovXG5cbmludGVyZmFjZSBSc3ZwSW52aXRlTWVzc2FnZSB7XG4gIGV2ZW50SWQ6IHN0cmluZztcbiAgZXZlbnRUaXRsZTogc3RyaW5nO1xuICBzdGFydHNBdDogc3RyaW5nO1xuICB2ZW51ZT86IHN0cmluZyB8IG51bGw7XG4gIGNpdHk/OiBzdHJpbmcgfCBudWxsO1xuICBtZW1iZXJJZDogc3RyaW5nO1xuICBtZW1iZXJFbWFpbDogc3RyaW5nO1xuICBtZW1iZXJOYW1lOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG59XG5cbmNvbnN0IEZST00gPSBwcm9jZXNzLmVudi5SU1ZQX0ZST01fQUREUkVTUyE7XG5jb25zdCBCQVNFID0gcHJvY2Vzcy5lbnYuUlNWUF9CQVNFX1VSTCE7XG5jb25zdCBDT05GSUdfU0VUID0gcHJvY2Vzcy5lbnYuUlNWUF9DT05GSUdfU0VUO1xuXG5sZXQgX3NlczogYW55O1xuYXN5bmMgZnVuY3Rpb24gc2VzKCkge1xuICBpZiAoIV9zZXMpIHtcbiAgICBjb25zdCBtb2Q6IGFueSA9IGF3YWl0IGltcG9ydChcbiAgICAgIC8qIHdlYnBhY2tJZ25vcmU6IHRydWUgKi8gXCJAYXdzLXNkay9jbGllbnQtc2VzdjJcIiBhcyBzdHJpbmdcbiAgICApO1xuICAgIF9zZXMgPSBuZXcgbW9kLlNFU3YyQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xuICAgIChzZXMgYXMgYW55KS5zZW5kID0gbW9kLlNlbmRFbWFpbENvbW1hbmQ7XG4gIH1cbiAgcmV0dXJuIF9zZXM7XG59XG5cbmZ1bmN0aW9uIHJlbmRlckh0bWwobTogUnN2cEludml0ZU1lc3NhZ2UpIHtcbiAgY29uc3QgdXJsID0gYCR7QkFTRX0vcnN2cD90b2tlbj0ke2VuY29kZVVSSUNvbXBvbmVudChtLnRva2VuKX1gO1xuICBjb25zdCB3aGVuID0gbmV3IERhdGUobS5zdGFydHNBdCkudG9Mb2NhbGVTdHJpbmcoKTtcbiAgY29uc3Qgd2hlcmUgPSBbbS52ZW51ZSwgbS5jaXR5XS5maWx0ZXIoQm9vbGVhbikuam9pbihcIiDigJQgXCIpO1xuICByZXR1cm4gYDwhZG9jdHlwZSBodG1sPjxodG1sPjxib2R5IHN0eWxlPVwiZm9udC1mYW1pbHk6SW50ZXIsc3lzdGVtLXVpLHNhbnMtc2VyaWY7YmFja2dyb3VuZDojZjRmMmVlO21hcmdpbjowO3BhZGRpbmc6MjRweDtcIj5cbiAgPGRpdiBzdHlsZT1cIm1heC13aWR0aDo1NjBweDttYXJnaW46MCBhdXRvO2JhY2tncm91bmQ6I2ZmZmZmZjtib3JkZXItcmFkaXVzOjhweDtwYWRkaW5nOjMycHg7XCI+XG4gICAgPGgxIHN0eWxlPVwibWFyZ2luOjAgMCA4cHg7Zm9udC1zaXplOjIwcHg7Y29sb3I6IzFmMjkzNztcIj4ke20uZXZlbnRUaXRsZX08L2gxPlxuICAgIDxwIHN0eWxlPVwibWFyZ2luOjAgMCA0cHg7Y29sb3I6IzRiNTU2MztcIj4ke3doZW59PC9wPlxuICAgICR7d2hlcmUgPyBgPHAgc3R5bGU9XCJtYXJnaW46MCAwIDE2cHg7Y29sb3I6IzRiNTU2MztcIj4ke3doZXJlfTwvcD5gIDogXCJcIn1cbiAgICA8cCBzdHlsZT1cIm1hcmdpbjoxNnB4IDA7Y29sb3I6IzFmMjkzNztcIj5IaSAke20ubWVtYmVyTmFtZX0sIHlvdSdyZSBpbnZpdGVkLiBQbGVhc2UgbGV0IHVzIGtub3cgaWYgeW91IGNhbiBtYWtlIGl0LjwvcD5cbiAgICA8cCBzdHlsZT1cIm1hcmdpbjoyNHB4IDA7XCI+XG4gICAgICA8YSBocmVmPVwiJHt1cmx9JnI9eWVzXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiMwYTY2YzI7Y29sb3I6I2ZmZjtwYWRkaW5nOjEwcHggMThweDtib3JkZXItcmFkaXVzOjk5OXB4O3RleHQtZGVjb3JhdGlvbjpub25lO2ZvbnQtd2VpZ2h0OjYwMDttYXJnaW4tcmlnaHQ6OHB4O1wiPkknbGwgYXR0ZW5kPC9hPlxuICAgICAgPGEgaHJlZj1cIiR7dXJsfSZyPW5vXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiNlNWU3ZWI7Y29sb3I6IzFmMjkzNztwYWRkaW5nOjEwcHggMThweDtib3JkZXItcmFkaXVzOjk5OXB4O3RleHQtZGVjb3JhdGlvbjpub25lO2ZvbnQtd2VpZ2h0OjYwMDttYXJnaW4tcmlnaHQ6OHB4O1wiPkNhbid0IG1ha2UgaXQ8L2E+XG4gICAgICA8YSBocmVmPVwiJHt1cmx9JnI9bWF5YmVcIiBzdHlsZT1cImJhY2tncm91bmQ6dHJhbnNwYXJlbnQ7Y29sb3I6IzBhNjZjMjtwYWRkaW5nOjEwcHggMThweDtib3JkZXItcmFkaXVzOjk5OXB4O3RleHQtZGVjb3JhdGlvbjpub25lO2ZvbnQtd2VpZ2h0OjYwMDtib3JkZXI6MXB4IHNvbGlkICMwYTY2YzI7XCI+TWF5YmU8L2E+XG4gICAgPC9wPlxuICAgIDxwIHN0eWxlPVwibWFyZ2luLXRvcDozMnB4O2NvbG9yOiM2YjcyODA7Zm9udC1zaXplOjEycHg7XCI+VGhpcyBpbnZpdGF0aW9uIGlzIHBlcnNvbmFsaXplZCDigJQgcGxlYXNlIGRvbid0IGZvcndhcmQuPC9wPlxuICA8L2Rpdj48L2JvZHk+PC9odG1sPmA7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBTUVNFdmVudCk6IFByb21pc2U8U1FTQmF0Y2hSZXNwb25zZT4ge1xuICBjb25zdCBmYWlsdXJlczogeyBpdGVtSWRlbnRpZmllcjogc3RyaW5nIH1bXSA9IFtdO1xuICBjb25zdCBjbGllbnQgPSBhd2FpdCBzZXMoKTtcbiAgY29uc3QgU2VuZEVtYWlsQ29tbWFuZCA9IChzZXMgYXMgYW55KS5zZW5kO1xuXG4gIGZvciAoY29uc3QgcmVjIG9mIGV2ZW50LlJlY29yZHMpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbXNnID0gSlNPTi5wYXJzZShyZWMuYm9keSkgYXMgUnN2cEludml0ZU1lc3NhZ2U7XG4gICAgICBjb25zdCBodG1sID0gcmVuZGVySHRtbChtc2cpO1xuICAgICAgYXdhaXQgY2xpZW50LnNlbmQoXG4gICAgICAgIG5ldyBTZW5kRW1haWxDb21tYW5kKHtcbiAgICAgICAgICBGcm9tRW1haWxBZGRyZXNzOiBGUk9NLFxuICAgICAgICAgIERlc3RpbmF0aW9uOiB7IFRvQWRkcmVzc2VzOiBbbXNnLm1lbWJlckVtYWlsXSB9LFxuICAgICAgICAgIENvbnRlbnQ6IHtcbiAgICAgICAgICAgIFNpbXBsZToge1xuICAgICAgICAgICAgICBTdWJqZWN0OiB7IERhdGE6IGBJbnZpdGF0aW9uOiAke21zZy5ldmVudFRpdGxlfWAgfSxcbiAgICAgICAgICAgICAgQm9keTogeyBIdG1sOiB7IERhdGE6IGh0bWwgfSB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIENvbmZpZ3VyYXRpb25TZXROYW1lOiBDT05GSUdfU0VULFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwicnN2cCBlbWFpbGVyIGZhaWxlZFwiLCByZWMubWVzc2FnZUlkLCBlcnIpO1xuICAgICAgZmFpbHVyZXMucHVzaCh7IGl0ZW1JZGVudGlmaWVyOiByZWMubWVzc2FnZUlkIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBiYXRjaEl0ZW1GYWlsdXJlczogZmFpbHVyZXMgfTtcbn1cbiJdfQ==