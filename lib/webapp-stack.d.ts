import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib";
interface WebappStackProps extends cdk.StackProps {
    wafParamName: string;
    webBucketsRemovalPolicy?: RemovalPolicy;
}
export declare class WebappStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: WebappStackProps);
}
export {};
