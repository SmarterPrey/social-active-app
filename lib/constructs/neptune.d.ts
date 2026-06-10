import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { StackProps, aws_ec2, aws_iam } from "aws-cdk-lib";
import { Construct } from "constructs";
interface NeptuneProps extends StackProps {
    vpc: aws_ec2.Vpc;
    neptuneServerlss: boolean;
    neptuneServerlssCapacity?: neptune.ServerlessScalingConfiguration;
}
export declare class Neptune extends Construct {
    readonly cluster: neptune.DatabaseCluster;
    readonly neptuneRole: aws_iam.Role;
    constructor(scope: Construct, id: string, props: NeptuneProps);
}
export {};
