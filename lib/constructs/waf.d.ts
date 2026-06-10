import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";
export interface WafRule {
    name: string;
    rule: wafv2.CfnWebACL.RuleProperty;
}
export declare class Waf extends Construct {
    readonly waf: wafv2.CfnWebACL;
    constructor(scope: Construct, id: string, props: {
        useCloudFront?: boolean;
        wafParamName: string;
        webACLResourceArn?: string;
        allowedIps: Array<string>;
    });
}
export declare class WAF extends wafv2.CfnWebACL {
    constructor(scope: Construct, id: string, ipset: cdk.aws_wafv2.CfnIPSet | null, distScope: string, extraRules?: Array<WafRule>);
}
export declare class WebACLAssociation extends wafv2.CfnWebACLAssociation {
    constructor(scope: Construct, id: string, props: wafv2.CfnWebACLAssociationProps);
}
