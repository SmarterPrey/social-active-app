import { Stack, StackProps, aws_route53, aws_ses } from "aws-cdk-lib";
import { Construct } from "constructs";
export interface DnsStackProps extends StackProps {
    /** The domain name for the hosted zone (e.g. "example.com") */
    domainName: string;
    /** Optional MX records for email routing */
    mxRecords?: {
        hostName: string;
        priority: number;
    }[];
    /** Optional TXT records (e.g. SPF, domain verification) */
    txtRecords?: {
        name?: string;
        values: string[];
    }[];
    /**
     * When true, creates a DKIM-verified SES EmailIdentity for the domain so
     * Cognito / other services can send mail as `*@<domain>`.
     */
    createSesEmailIdentity?: boolean;
}
export declare class DnsStack extends Stack {
    /** The public hosted zone — export for use by other stacks */
    readonly hostedZone: aws_route53.PublicHostedZone;
    /** SES EmailIdentity (only set when createSesEmailIdentity is true). */
    readonly emailIdentity?: aws_ses.EmailIdentity;
    constructor(scope: Construct, id: string, props: DnsStackProps);
}
