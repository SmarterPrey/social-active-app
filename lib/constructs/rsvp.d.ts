import { RemovalPolicy, aws_lambda_nodejs, aws_sqs, aws_secretsmanager } from "aws-cdk-lib";
import { Construct } from "constructs";
export interface RsvpProps {
    /** Verified SES "from" address used for invites. */
    fromAddress: string;
    /** Public base URL (e.g. https://app.mucker.io) — RSVP links are built off this. */
    rsvpBaseUrl: string;
    removalPolicy?: RemovalPolicy;
}
/**
 * RSVP workflow:
 *  - social Lambda (mutation) signs a per-(member,event) HMAC token and pushes
 *    a message to an SQS queue.
 *  - `rsvpEmailerFn` consumes the queue and sends an SES email containing a
 *    one-click RSVP URL.
 *  - When the invitee clicks the URL, the webapp calls the public (API-key)
 *    `submitRsvp(token, response)` mutation; the mutation verifies the HMAC
 *    signature using the same secret and writes the Rsvp vertex.
 */
export declare class Rsvp extends Construct {
    readonly queue: aws_sqs.Queue;
    readonly signingSecret: aws_secretsmanager.Secret;
    readonly emailerFn: aws_lambda_nodejs.NodejsFunction;
    constructor(scope: Construct, id: string, props: RsvpProps);
}
