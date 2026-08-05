import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
export interface ObservabilityStackProps extends StackProps {
    /** App name prefix used for resource naming (e.g. "pr-mucker") */
    appName: string;
    /** Neptune cluster identifier (e.g. "neptunedbcluster-xxx") */
    neptuneClusterId: string;
    /** CloudFront distribution ID */
    cloudFrontDistributionId: string;
    /** WAF WebACL name */
    wafWebAclName: string;
    /** AppSync GraphQL API ID */
    appSyncApiId: string;
    /** Lambda functions to monitor: label → function name */
    lambdaFunctions: Record<string, string>;
    /** Cognito User Pool ID */
    userPoolId: string;
}
export declare class ObservabilityStack extends Stack {
    constructor(scope: Construct, id: string, props: ObservabilityStackProps);
}
