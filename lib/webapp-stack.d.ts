import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";
interface WebappStackProps extends cdk.StackProps {
    wafParamName: string;
    webBucketsRemovalPolicy?: RemovalPolicy;
    /** Custom domain names to attach to the CloudFront distribution. */
    webDomainNames?: string[];
    /** Route 53 hosted zone name (e.g. "mucker.io"). Required if webDomainNames is non-empty. */
    hostedZoneName?: string;
}
export declare class WebappStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: WebappStackProps);
}
export {};
