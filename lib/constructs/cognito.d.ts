import { Construct } from "constructs";
import { Duration, aws_cognito, aws_iam } from "aws-cdk-lib";
export interface CognitoProps {
    adminEmail: string;
    userName?: string;
    refreshTokenValidity?: Duration;
    /**
     * Absolute URL of the web app's sign-in page.
     * Used in the invitation email link (e.g. https://app.mucker.io/signin).
     */
    appSignInUrl?: string;
    /**
     * When set, Cognito sends email via SES using this verified identity
     * (DEVELOPER mode). Without this, Cognito falls back to the default
     * AWS-managed sender which is sandbox-limited.
     */
    ses?: {
        /** ARN of a verified SES identity (domain or email). */
        sourceArn: string;
        /** From address Cognito emails are sent from (must match the identity). */
        fromAddress: string;
        /** Optional display name ("Social Active App") to show next to the address. */
        fromName?: string;
        /** Optional reply-to address surfaced in the email headers. */
        replyToEmailAddress?: string;
    };
}
export interface CognitoParams {
    userPoolId: string;
    userPoolClientId: string;
    identityPoolId: string;
}
export declare class Cognito extends Construct {
    readonly cognitoParams: CognitoParams;
    readonly userPool: aws_cognito.UserPool;
    readonly authenticatedRole: aws_iam.IRole;
    constructor(scope: Construct, id: string, props: CognitoProps);
}
