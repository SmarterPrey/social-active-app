import { Stack, StackProps, aws_route53, aws_ses } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface DnsStackProps extends StackProps {
  /** The domain name for the hosted zone (e.g. "example.com") */
  domainName: string;
  /** Optional MX records for email routing */
  mxRecords?: { hostName: string; priority: number }[];
  /** Optional TXT records (e.g. SPF, domain verification) */
  txtRecords?: { name?: string; values: string[] }[];
  /**
   * When true, creates a DKIM-verified SES EmailIdentity for the domain so
   * Cognito / other services can send mail as `*@<domain>`.
   */
  createSesEmailIdentity?: boolean;
}

export class DnsStack extends Stack {
  /** The public hosted zone — export for use by other stacks */
  public readonly hostedZone: aws_route53.PublicHostedZone;
  /** SES EmailIdentity (only set when createSesEmailIdentity is true). */
  public readonly emailIdentity?: aws_ses.EmailIdentity;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const { domainName, mxRecords, txtRecords } = props;

    // ─── Public Hosted Zone ──────────────────────────────────────────
    this.hostedZone = new aws_route53.PublicHostedZone(this, "HostedZone", {
      zoneName: domainName,
      comment: `Managed hosted zone for ${domainName}`,
    });

    // ─── MX Records (email routing) ─────────────────────────────────
    if (mxRecords && mxRecords.length > 0) {
      new aws_route53.MxRecord(this, "MxRecord", {
        zone: this.hostedZone,
        values: mxRecords,
        comment: `MX records for ${domainName}`,
      });
    }

    // ─── TXT Records (SPF, verification, etc.) ──────────────────────
    if (txtRecords) {
      txtRecords.forEach((txt, idx) => {
        new aws_route53.TxtRecord(this, `TxtRecord${idx}`, {
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
      this.emailIdentity = new aws_ses.EmailIdentity(this, "EmailIdentity", {
        identity: aws_ses.Identity.publicHostedZone(this.hostedZone),
      });
    }

    // ─── CDK Nag suppressions ────────────────────────────────────────
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-R53-1",
        reason: "Public hosted zone is intentional for example.com DNS management",
      },
    ]);
  }
}
