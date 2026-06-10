import * as CustomResource from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
interface SSMParameterReaderProps {
    parameterName: string;
    region: string;
}
export declare class SSMParameterReader extends CustomResource.AwsCustomResource {
    constructor(scope: Construct, name: string, props: SSMParameterReaderProps);
    getParameterValue(): string;
}
export {};
