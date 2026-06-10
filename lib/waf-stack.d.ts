import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
interface WafStacktackProps extends cdk.StackProps {
    allowedIps: string[];
    wafParamName: string;
}
export declare class WafCloudFrontStack extends cdk.Stack {
    readonly webAcl: cdk.aws_wafv2.CfnWebACL;
    constructor(scope: Construct, id: string, props: WafStacktackProps);
}
export {};
