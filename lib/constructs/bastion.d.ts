import { StackProps, aws_ec2 } from "aws-cdk-lib";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { Construct } from "constructs";
interface BastionProps extends StackProps {
    vpc: aws_ec2.Vpc;
    cluster: neptune.DatabaseCluster;
    /** IANA timezone for the auto-stop schedule (default: America/Los_Angeles) */
    timezone?: string;
    /** Cron hour (0-23) to stop the bastion (default: 0 = midnight) */
    stopHour?: number;
}
export declare class Bastion extends Construct {
    readonly instance: aws_ec2.BastionHostLinux;
    constructor(scope: Construct, id: string, props: BastionProps);
}
export {};
