import { RemovalPolicy } from "aws-cdk-lib";
export type StageConfig = {
    appName: string;
    stage: string;
    region: string;
    /** AWS account ID for this stage. Sourced from .env (e.g. DEV_ACCOUNT_ID). */
    account?: string;
    domainName: string;
    /** Public sign-in URL for the web app. Used in the Cognito invitation email. */
    appUrl: string;
    /**
     * Email sender config. Cognito sends the invitation email from this
     * address via SES using the verified identity created in DnsStack.
     */
    email: {
        fromAddress: string;
        fromName: string;
        replyTo: string;
    };
    adminEmail: string;
    allowedIps: string[];
    /** SSM parameter name storing the WAF WebACL ID — must be unique per stage. */
    wafParamName: string;
    webBucketsRemovalPolicy: RemovalPolicy;
    s3Uri: {
        edge: string;
        vertex: string;
    };
};
export declare function getConfig(stage: string): StageConfig;
/** Stage prefix used in resource/stack names: dev→dev, qa→qa, prod→pr */
export declare const stagePrefixMap: Record<string, string>;
export declare const deployConfig: StageConfig;
