import { Stack, StackProps, aws_ec2, aws_iam } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
interface NeptuneScheduleConfig {
    /** Enable scheduled stop/start of Neptune (default: false) */
    enabled: boolean;
    /** IANA timezone (default: America/Los_Angeles) */
    timezone?: string;
    /** Hour to stop the cluster (default: 0 = midnight) */
    stopHour?: number;
}
interface NeptuneNetworkStackProps extends StackProps {
    /** App name prefix used for resource naming (e.g. "pr-mucker") */
    appName: string;
    natSubnet?: boolean;
    maxAz: number;
    neptuneServerlss: boolean;
    neptuneServerlssCapacity?: neptune.ServerlessScalingConfiguration;
    /** Optional schedule to stop/start Neptune during off-hours */
    neptuneSchedule?: NeptuneScheduleConfig;
    /** Enable a bastion host for remote Neptune access via SSM */
    bastion?: {
        enabled: boolean;
        /** IANA timezone (default: America/Los_Angeles) */
        timezone?: string;
        /** Hour to auto-stop the bastion (default: 0 = midnight) */
        stopHour?: number;
    };
}
export declare class NeptuneNetworkStack extends Stack {
    readonly vpc: aws_ec2.Vpc;
    readonly cluster: neptune.DatabaseCluster;
    readonly neptuneRole: aws_iam.Role;
    constructor(scope: Construct, id: string, props: NeptuneNetworkStackProps);
}
export {};
