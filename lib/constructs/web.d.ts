import { Construct } from "constructs";
import { RemovalPolicy, StackProps, aws_cloudfront } from "aws-cdk-lib";
export interface WebProps extends StackProps {
    webappPath: string;
    webappDistFolder: string;
    wafParamName: string;
    region: string;
    /**
     * Custom domain names to serve the webapp on (e.g.
     * `["mucker.io", "www.mucker.io"]`). All names must belong to the
     * Route 53 public hosted zone identified by `hostedZoneName`. Leave
     * empty to serve only on the default `*.cloudfront.net` domain.
     */
    domainNames?: string[];
    /**
     * The Route 53 public hosted zone name (e.g. `mucker.io`). Required
     * when `domainNames` is non-empty so the construct can issue an ACM
     * certificate via DNS validation and create alias records.
     */
    hostedZoneName?: string;
    webBucketProps: {
        removalPolicy: RemovalPolicy;
        autoDeleteObjects: boolean;
    };
}
export declare class Web extends Construct {
    readonly distribution: aws_cloudfront.Distribution;
    constructor(scope: Construct, id: string, props: WebProps);
}
