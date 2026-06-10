import { StackProps, aws_ec2 } from "aws-cdk-lib";
import { Construct } from "constructs";
interface NetworkProps extends StackProps {
    natSubnet?: boolean;
    maxAz: number;
}
export declare class Network extends Construct {
    readonly vpc: aws_ec2.Vpc;
    constructor(scope: Construct, id: string, props: NetworkProps);
}
export {};
