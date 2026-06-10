import { Construct } from "constructs";
import { RemovalPolicy, StackProps, aws_cloudfront } from "aws-cdk-lib";
export interface WebProps extends StackProps {
    webappPath: string;
    webappDistFolder: string;
    wafParamName: string;
    region: string;
    webBucketProps: {
        removalPolicy: RemovalPolicy;
        autoDeleteObjects: boolean;
    };
}
export declare class Web extends Construct {
    readonly distribution: aws_cloudfront.Distribution;
    constructor(scope: Construct, id: string, props: WebProps);
}
