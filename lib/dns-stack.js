"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DnsStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
class DnsStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { domainName, mxRecords, txtRecords } = props;
        // ─── Public Hosted Zone ──────────────────────────────────────────
        this.hostedZone = new aws_cdk_lib_1.aws_route53.PublicHostedZone(this, "HostedZone", {
            zoneName: domainName,
            comment: `Managed hosted zone for ${domainName}`,
        });
        // ─── MX Records (email routing) ─────────────────────────────────
        if (mxRecords && mxRecords.length > 0) {
            new aws_cdk_lib_1.aws_route53.MxRecord(this, "MxRecord", {
                zone: this.hostedZone,
                values: mxRecords,
                comment: `MX records for ${domainName}`,
            });
        }
        // ─── TXT Records (SPF, verification, etc.) ──────────────────────
        if (txtRecords) {
            txtRecords.forEach((txt, idx) => {
                new aws_cdk_lib_1.aws_route53.TxtRecord(this, `TxtRecord${idx}`, {
                    zone: this.hostedZone,
                    recordName: txt.name, // undefined = zone apex
                    values: txt.values,
                    comment: `TXT record for ${txt.name ?? domainName}`,
                });
            });
        }
        // ─── SES: verified domain identity (DKIM via Route53) ───────────
        // Cognito uses SES to deliver the invitation email. Verifying the
        // domain via DKIM removes the sandbox-like restrictions and gives us
        // branded, deliverable mail from `*@${domainName}`.
        if (props.createSesEmailIdentity) {
            this.emailIdentity = new aws_cdk_lib_1.aws_ses.EmailIdentity(this, "EmailIdentity", {
                identity: aws_cdk_lib_1.aws_ses.Identity.publicHostedZone(this.hostedZone),
            });
        }
        // ─── CDK Nag suppressions ────────────────────────────────────────
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-R53-1",
                reason: "Public hosted zone is intentional for example.com DNS management",
            },
        ]);
    }
}
exports.DnsStack = DnsStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZG5zLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZG5zLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZDQUFzRTtBQUV0RSxxQ0FBMEM7QUFnQjFDLE1BQWEsUUFBUyxTQUFRLG1CQUFLO0lBTWpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBb0I7UUFDNUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFVBQVUsRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXBELG9FQUFvRTtRQUNwRSxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUkseUJBQVcsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3JFLFFBQVEsRUFBRSxVQUFVO1lBQ3BCLE9BQU8sRUFBRSwyQkFBMkIsVUFBVSxFQUFFO1NBQ2pELENBQUMsQ0FBQztRQUVILG1FQUFtRTtRQUNuRSxJQUFJLFNBQVMsSUFBSSxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQ3RDLElBQUkseUJBQVcsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtnQkFDekMsSUFBSSxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUNyQixNQUFNLEVBQUUsU0FBUztnQkFDakIsT0FBTyxFQUFFLGtCQUFrQixVQUFVLEVBQUU7YUFDeEMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELG1FQUFtRTtRQUNuRSxJQUFJLFVBQVUsRUFBRSxDQUFDO1lBQ2YsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsRUFBRTtnQkFDOUIsSUFBSSx5QkFBVyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxHQUFHLEVBQUUsRUFBRTtvQkFDakQsSUFBSSxFQUFFLElBQUksQ0FBQyxVQUFVO29CQUNyQixVQUFVLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSx3QkFBd0I7b0JBQzlDLE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTTtvQkFDbEIsT0FBTyxFQUFFLGtCQUFrQixHQUFHLENBQUMsSUFBSSxJQUFJLFVBQVUsRUFBRTtpQkFDcEQsQ0FBQyxDQUFDO1lBQ0wsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsbUVBQW1FO1FBQ25FLGtFQUFrRTtRQUNsRSxxRUFBcUU7UUFDckUsb0RBQW9EO1FBQ3BELElBQUksS0FBSyxDQUFDLHNCQUFzQixFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLGFBQWEsR0FBRyxJQUFJLHFCQUFPLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7Z0JBQ3BFLFFBQVEsRUFBRSxxQkFBTyxDQUFDLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDO2FBQzdELENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCxvRUFBb0U7UUFDcEUseUJBQWUsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUU7WUFDekM7Z0JBQ0UsRUFBRSxFQUFFLG9CQUFvQjtnQkFDeEIsTUFBTSxFQUFFLGtFQUFrRTthQUMzRTtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXhERCw0QkF3REMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTdGFjaywgU3RhY2tQcm9wcywgYXdzX3JvdXRlNTMsIGF3c19zZXMgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIERuc1N0YWNrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgLyoqIFRoZSBkb21haW4gbmFtZSBmb3IgdGhlIGhvc3RlZCB6b25lIChlLmcuIFwiZXhhbXBsZS5jb21cIikgKi9cbiAgZG9tYWluTmFtZTogc3RyaW5nO1xuICAvKiogT3B0aW9uYWwgTVggcmVjb3JkcyBmb3IgZW1haWwgcm91dGluZyAqL1xuICBteFJlY29yZHM/OiB7IGhvc3ROYW1lOiBzdHJpbmc7IHByaW9yaXR5OiBudW1iZXIgfVtdO1xuICAvKiogT3B0aW9uYWwgVFhUIHJlY29yZHMgKGUuZy4gU1BGLCBkb21haW4gdmVyaWZpY2F0aW9uKSAqL1xuICB0eHRSZWNvcmRzPzogeyBuYW1lPzogc3RyaW5nOyB2YWx1ZXM6IHN0cmluZ1tdIH1bXTtcbiAgLyoqXG4gICAqIFdoZW4gdHJ1ZSwgY3JlYXRlcyBhIERLSU0tdmVyaWZpZWQgU0VTIEVtYWlsSWRlbnRpdHkgZm9yIHRoZSBkb21haW4gc29cbiAgICogQ29nbml0byAvIG90aGVyIHNlcnZpY2VzIGNhbiBzZW5kIG1haWwgYXMgYCpAPGRvbWFpbj5gLlxuICAgKi9cbiAgY3JlYXRlU2VzRW1haWxJZGVudGl0eT86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBEbnNTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgLyoqIFRoZSBwdWJsaWMgaG9zdGVkIHpvbmUg4oCUIGV4cG9ydCBmb3IgdXNlIGJ5IG90aGVyIHN0YWNrcyAqL1xuICBwdWJsaWMgcmVhZG9ubHkgaG9zdGVkWm9uZTogYXdzX3JvdXRlNTMuUHVibGljSG9zdGVkWm9uZTtcbiAgLyoqIFNFUyBFbWFpbElkZW50aXR5IChvbmx5IHNldCB3aGVuIGNyZWF0ZVNlc0VtYWlsSWRlbnRpdHkgaXMgdHJ1ZSkuICovXG4gIHB1YmxpYyByZWFkb25seSBlbWFpbElkZW50aXR5PzogYXdzX3Nlcy5FbWFpbElkZW50aXR5O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBEbnNTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGRvbWFpbk5hbWUsIG14UmVjb3JkcywgdHh0UmVjb3JkcyB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIDilIAgUHVibGljIEhvc3RlZCBab25lIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIHRoaXMuaG9zdGVkWm9uZSA9IG5ldyBhd3Nfcm91dGU1My5QdWJsaWNIb3N0ZWRab25lKHRoaXMsIFwiSG9zdGVkWm9uZVwiLCB7XG4gICAgICB6b25lTmFtZTogZG9tYWluTmFtZSxcbiAgICAgIGNvbW1lbnQ6IGBNYW5hZ2VkIGhvc3RlZCB6b25lIGZvciAke2RvbWFpbk5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgOKUgCBNWCBSZWNvcmRzIChlbWFpbCByb3V0aW5nKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBpZiAobXhSZWNvcmRzICYmIG14UmVjb3Jkcy5sZW5ndGggPiAwKSB7XG4gICAgICBuZXcgYXdzX3JvdXRlNTMuTXhSZWNvcmQodGhpcywgXCJNeFJlY29yZFwiLCB7XG4gICAgICAgIHpvbmU6IHRoaXMuaG9zdGVkWm9uZSxcbiAgICAgICAgdmFsdWVzOiBteFJlY29yZHMsXG4gICAgICAgIGNvbW1lbnQ6IGBNWCByZWNvcmRzIGZvciAke2RvbWFpbk5hbWV9YCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIOKUgOKUgOKUgCBUWFQgUmVjb3JkcyAoU1BGLCB2ZXJpZmljYXRpb24sIGV0Yy4pIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGlmICh0eHRSZWNvcmRzKSB7XG4gICAgICB0eHRSZWNvcmRzLmZvckVhY2goKHR4dCwgaWR4KSA9PiB7XG4gICAgICAgIG5ldyBhd3Nfcm91dGU1My5UeHRSZWNvcmQodGhpcywgYFR4dFJlY29yZCR7aWR4fWAsIHtcbiAgICAgICAgICB6b25lOiB0aGlzLmhvc3RlZFpvbmUsXG4gICAgICAgICAgcmVjb3JkTmFtZTogdHh0Lm5hbWUsIC8vIHVuZGVmaW5lZCA9IHpvbmUgYXBleFxuICAgICAgICAgIHZhbHVlczogdHh0LnZhbHVlcyxcbiAgICAgICAgICBjb21tZW50OiBgVFhUIHJlY29yZCBmb3IgJHt0eHQubmFtZSA/PyBkb21haW5OYW1lfWAsXG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8g4pSA4pSA4pSAIFNFUzogdmVyaWZpZWQgZG9tYWluIGlkZW50aXR5IChES0lNIHZpYSBSb3V0ZTUzKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBDb2duaXRvIHVzZXMgU0VTIHRvIGRlbGl2ZXIgdGhlIGludml0YXRpb24gZW1haWwuIFZlcmlmeWluZyB0aGVcbiAgICAvLyBkb21haW4gdmlhIERLSU0gcmVtb3ZlcyB0aGUgc2FuZGJveC1saWtlIHJlc3RyaWN0aW9ucyBhbmQgZ2l2ZXMgdXNcbiAgICAvLyBicmFuZGVkLCBkZWxpdmVyYWJsZSBtYWlsIGZyb20gYCpAJHtkb21haW5OYW1lfWAuXG4gICAgaWYgKHByb3BzLmNyZWF0ZVNlc0VtYWlsSWRlbnRpdHkpIHtcbiAgICAgIHRoaXMuZW1haWxJZGVudGl0eSA9IG5ldyBhd3Nfc2VzLkVtYWlsSWRlbnRpdHkodGhpcywgXCJFbWFpbElkZW50aXR5XCIsIHtcbiAgICAgICAgaWRlbnRpdHk6IGF3c19zZXMuSWRlbnRpdHkucHVibGljSG9zdGVkWm9uZSh0aGlzLmhvc3RlZFpvbmUpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8g4pSA4pSA4pSAIENESyBOYWcgc3VwcHJlc3Npb25zIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRTdGFja1N1cHByZXNzaW9ucyh0aGlzLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1SNTMtMVwiLFxuICAgICAgICByZWFzb246IFwiUHVibGljIGhvc3RlZCB6b25lIGlzIGludGVudGlvbmFsIGZvciBleGFtcGxlLmNvbSBETlMgbWFuYWdlbWVudFwiLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19