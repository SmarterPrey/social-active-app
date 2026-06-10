"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Bastion = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const constructs_1 = require("constructs");
const path = require("node:path");
class Bastion extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { vpc, cluster, timezone = "America/Los_Angeles", stopHour = 0 } = props;
        // -----------------------------------------------------------------------
        // Bastion Host in a public subnet, accessible via SSM (no SSH keys)
        // -----------------------------------------------------------------------
        this.instance = new aws_cdk_lib_1.aws_ec2.BastionHostLinux(this, "bastion-host", {
            vpc,
            subnetSelection: { subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PUBLIC },
            instanceType: aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.T3, aws_cdk_lib_1.aws_ec2.InstanceSize.SMALL),
        });
        // Install Docker and run Graph Explorer on every boot (HTTP only — HTTPS cert
        // is generated for the EC2 hostname and breaks SSM port-forward tunnels to localhost)
        this.instance.instance.addUserData("yum update -y", "yum install -y docker", "systemctl enable docker", "systemctl start docker", "docker pull public.ecr.aws/neptune/graph-explorer", "docker run -d -p 80:80 --restart unless-stopped --name graph-explorer --env PROXY_SERVER_HTTPS_CONNECTION=false --env GRAPH_EXP_HTTPS_CONNECTION=false public.ecr.aws/neptune/graph-explorer");
        // Allow the bastion to reach Neptune on port 8182
        cluster.connections.allowDefaultPortFrom(this.instance);
        // Grant bastion IAM auth access to Neptune (required for Graph Explorer proxy)
        this.instance.role.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            actions: [
                "neptune-db:ReadDataViaQuery",
                "neptune-db:WriteDataViaQuery",
                "neptune-db:DeleteDataViaQuery",
                "neptune-db:connect",
            ],
            resources: [
                `arn:aws:neptune-db:${aws_cdk_lib_1.Stack.of(this).region}:${aws_cdk_lib_1.Stack.of(this).account}:${cluster.clusterResourceIdentifier}/*`,
            ],
        }));
        // -----------------------------------------------------------------------
        // Store bastion config in SSM so the monitoring UI can recreate the instance
        // -----------------------------------------------------------------------
        const cfnInstanceProfile = this.instance.instance.node.findChild("InstanceProfile");
        const bastionSg = this.instance.connections.securityGroups[0];
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-instance-id-param", {
            parameterName: "/socialActiveApp/bastion/instance-id",
            stringValue: this.instance.instanceId,
            description: "Current bastion host EC2 instance ID",
        });
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-subnet-id-param", {
            parameterName: "/socialActiveApp/bastion/subnet-id",
            stringValue: vpc.publicSubnets[0].subnetId,
            description: "Public subnet for bastion host recreation",
        });
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-sg-id-param", {
            parameterName: "/socialActiveApp/bastion/security-group-id",
            stringValue: bastionSg.securityGroupId,
            description: "Security group for bastion host (allows Neptune access)",
        });
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-profile-name-param", {
            parameterName: "/socialActiveApp/bastion/instance-profile-name",
            stringValue: cfnInstanceProfile.ref,
            description: "IAM instance profile name for SSM-managed bastion",
        });
        // -----------------------------------------------------------------------
        // Lambda that stops the bastion instance
        // -----------------------------------------------------------------------
        const stopFn = new aws_cdk_lib_1.aws_lambda_nodejs.NodejsFunction(this, "bastion-stop-fn", {
            runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_22_X,
            tracing: aws_cdk_lib_1.aws_lambda.Tracing.ACTIVE,
            entry: path.join(__dirname, "..", "..", "api", "lambda", "bastionScheduler", "index.ts"),
            handler: "handler",
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            environment: {
                INSTANCE_ID: this.instance.instanceId,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"],
                minify: true,
                sourceMap: true,
            },
        });
        stopFn.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            actions: ["ec2:StopInstances", "ec2:DescribeInstances"],
            resources: [
                aws_cdk_lib_1.Stack.of(this).formatArn({
                    service: "ec2",
                    resource: "instance",
                    resourceName: this.instance.instanceId,
                }),
            ],
        }));
        // -----------------------------------------------------------------------
        // EventBridge Scheduler role
        // -----------------------------------------------------------------------
        const schedulerRole = new aws_cdk_lib_1.aws_iam.Role(this, "bastion-scheduler-role", {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal("scheduler.amazonaws.com"),
        });
        stopFn.grantInvoke(schedulerRole);
        // -----------------------------------------------------------------------
        // Schedule: stop bastion daily at the configured hour
        // -----------------------------------------------------------------------
        new aws_cdk_lib_1.aws_scheduler.CfnSchedule(this, "bastion-stop-schedule", {
            name: "bastion-stop-schedule",
            description: `Stop bastion host at ${stopHour}:00 ${timezone}`,
            scheduleExpressionTimezone: timezone,
            scheduleExpression: `cron(0 ${stopHour} * * ? *)`,
            flexibleTimeWindow: { mode: "OFF" },
            target: {
                arn: stopFn.functionArn,
                roleArn: schedulerRole.roleArn,
                input: JSON.stringify({ action: "stop" }),
            },
            state: "ENABLED",
        });
        // -----------------------------------------------------------------------
        // cdk-nag suppressions
        // -----------------------------------------------------------------------
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.instance, [
            {
                id: "AwsSolutions-EC26",
                reason: "Bastion host is ephemeral dev tooling; EBS encryption not required",
            },
            {
                id: "AwsSolutions-EC28",
                reason: "Detailed monitoring not required for dev bastion",
            },
            {
                id: "AwsSolutions-EC29",
                reason: "Termination protection not required for dev bastion",
            },
            {
                id: "AwsSolutions-IAM4",
                reason: "SSM managed policies are required for Session Manager access on the bastion host",
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Wildcard permissions are required by SSM managed policies on the bastion host",
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(stopFn, [
            {
                id: "AwsSolutions-IAM4",
                reason: "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access",
                appliesTo: [
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                ],
            },
            {
                id: "AwsSolutions-L1",
                reason: "NODEJS_22_X is the latest supported runtime at deploy time",
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(schedulerRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Wildcard on Lambda ARN version is required by grantInvoke for EventBridge Scheduler",
            },
        ], true);
    }
}
exports.Bastion = Bastion;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhc3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBVXFCO0FBRXJCLHFDQUEwQztBQUMxQywyQ0FBdUM7QUFDdkMsa0NBQWtDO0FBV2xDLE1BQWEsT0FBUSxTQUFRLHNCQUFTO0lBR3BDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUI7UUFDM0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxRQUFRLEdBQUcscUJBQXFCLEVBQUUsUUFBUSxHQUFHLENBQUMsRUFBRSxHQUNwRSxLQUFLLENBQUM7UUFFUiwwRUFBMEU7UUFDMUUsb0VBQW9FO1FBQ3BFLDBFQUEwRTtRQUMxRSxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUkscUJBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ2pFLEdBQUc7WUFDSCxlQUFlLEVBQUUsRUFBRSxVQUFVLEVBQUUscUJBQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFO1lBQzFELFlBQVksRUFBRSxxQkFBTyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQ25DLHFCQUFPLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFDeEIscUJBQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUMzQjtTQUNGLENBQUMsQ0FBQztRQUVILDhFQUE4RTtRQUM5RSxzRkFBc0Y7UUFDdEYsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUNoQyxlQUFlLEVBQ2YsdUJBQXVCLEVBQ3ZCLHlCQUF5QixFQUN6Qix3QkFBd0IsRUFDeEIsbURBQW1ELEVBQ25ELDhMQUE4TCxDQUMvTCxDQUFDO1FBRUYsa0RBQWtEO1FBQ2xELE9BQU8sQ0FBQyxXQUFXLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXhELCtFQUErRTtRQUMvRSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FDckMsSUFBSSxxQkFBTyxDQUFDLGVBQWUsQ0FBQztZQUMxQixNQUFNLEVBQUUscUJBQU8sQ0FBQyxNQUFNLENBQUMsS0FBSztZQUM1QixPQUFPLEVBQUU7Z0JBQ1AsNkJBQTZCO2dCQUM3Qiw4QkFBOEI7Z0JBQzlCLCtCQUErQjtnQkFDL0Isb0JBQW9CO2FBQ3JCO1lBQ0QsU0FBUyxFQUFFO2dCQUNULHNCQUFzQixtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLElBQUksbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxJQUFJLE9BQU8sQ0FBQyx5QkFBeUIsSUFBSTthQUMvRztTQUNGLENBQUMsQ0FDSCxDQUFDO1FBRUYsMEVBQTBFO1FBQzFFLDZFQUE2RTtRQUM3RSwwRUFBMEU7UUFDMUUsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLGlCQUFpQixDQUErQixDQUFDO1FBQ2xILE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUU5RCxJQUFJLHFCQUFPLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUM3RCxhQUFhLEVBQUUsc0NBQXNDO1lBQ3JELFdBQVcsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVU7WUFDckMsV0FBVyxFQUFFLHNDQUFzQztTQUNwRCxDQUFDLENBQUM7UUFDSCxJQUFJLHFCQUFPLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSx5QkFBeUIsRUFBRTtZQUMzRCxhQUFhLEVBQUUsb0NBQW9DO1lBQ25ELFdBQVcsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVE7WUFDMUMsV0FBVyxFQUFFLDJDQUEyQztTQUN6RCxDQUFDLENBQUM7UUFDSCxJQUFJLHFCQUFPLENBQUMsZUFBZSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUN2RCxhQUFhLEVBQUUsNENBQTRDO1lBQzNELFdBQVcsRUFBRSxTQUFTLENBQUMsZUFBZTtZQUN0QyxXQUFXLEVBQUUseURBQXlEO1NBQ3ZFLENBQUMsQ0FBQztRQUNILElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLDRCQUE0QixFQUFFO1lBQzlELGFBQWEsRUFBRSxnREFBZ0Q7WUFDL0QsV0FBVyxFQUFFLGtCQUFrQixDQUFDLEdBQUc7WUFDbkMsV0FBVyxFQUFFLG1EQUFtRDtTQUNqRSxDQUFDLENBQUM7UUFFSCwwRUFBMEU7UUFDMUUseUNBQXlDO1FBQ3pDLDBFQUEwRTtRQUMxRSxNQUFNLE1BQU0sR0FBRyxJQUFJLCtCQUFpQixDQUFDLGNBQWMsQ0FDakQsSUFBSSxFQUNKLGlCQUFpQixFQUNqQjtZQUNFLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ3ZDLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNO1lBQ2xDLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUNkLFNBQVMsRUFDVCxJQUFJLEVBQ0osSUFBSSxFQUNKLEtBQUssRUFDTCxRQUFRLEVBQ1Isa0JBQWtCLEVBQ2xCLFVBQVUsQ0FDWDtZQUNELE9BQU8sRUFBRSxTQUFTO1lBQ2xCLE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDN0IsV0FBVyxFQUFFO2dCQUNYLFdBQVcsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVU7YUFDdEM7WUFDRCxRQUFRLEVBQUU7Z0JBQ1IsZUFBZSxFQUFFLENBQUMsWUFBWSxDQUFDO2dCQUMvQixNQUFNLEVBQUUsSUFBSTtnQkFDWixTQUFTLEVBQUUsSUFBSTthQUNoQjtTQUNGLENBQ0YsQ0FBQztRQUVGLE1BQU0sQ0FBQyxlQUFlLENBQ3BCLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsTUFBTSxFQUFFLHFCQUFPLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDNUIsT0FBTyxFQUFFLENBQUMsbUJBQW1CLEVBQUUsdUJBQXVCLENBQUM7WUFDdkQsU0FBUyxFQUFFO2dCQUNULG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLFNBQVMsQ0FBQztvQkFDdkIsT0FBTyxFQUFFLEtBQUs7b0JBQ2QsUUFBUSxFQUFFLFVBQVU7b0JBQ3BCLFlBQVksRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFVBQVU7aUJBQ3ZDLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FDSCxDQUFDO1FBRUYsMEVBQTBFO1FBQzFFLDZCQUE2QjtRQUM3QiwwRUFBMEU7UUFDMUUsTUFBTSxhQUFhLEdBQUcsSUFBSSxxQkFBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDckUsU0FBUyxFQUFFLElBQUkscUJBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyx5QkFBeUIsQ0FBQztTQUNuRSxDQUFDLENBQUM7UUFDSCxNQUFNLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBRWxDLDBFQUEwRTtRQUMxRSxzREFBc0Q7UUFDdEQsMEVBQTBFO1FBQzFFLElBQUksMkJBQWEsQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQzNELElBQUksRUFBRSx1QkFBdUI7WUFDN0IsV0FBVyxFQUFFLHdCQUF3QixRQUFRLE9BQU8sUUFBUSxFQUFFO1lBQzlELDBCQUEwQixFQUFFLFFBQVE7WUFDcEMsa0JBQWtCLEVBQUUsVUFBVSxRQUFRLFdBQVc7WUFDakQsa0JBQWtCLEVBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ25DLE1BQU0sRUFBRTtnQkFDTixHQUFHLEVBQUUsTUFBTSxDQUFDLFdBQVc7Z0JBQ3ZCLE9BQU8sRUFBRSxhQUFhLENBQUMsT0FBTztnQkFDOUIsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLENBQUM7YUFDMUM7WUFDRCxLQUFLLEVBQUUsU0FBUztTQUNqQixDQUFDLENBQUM7UUFFSCwwRUFBMEU7UUFDMUUsdUJBQXVCO1FBQ3ZCLDBFQUEwRTtRQUMxRSx5QkFBZSxDQUFDLHVCQUF1QixDQUNyQyxJQUFJLENBQUMsUUFBUSxFQUNiO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG9FQUFvRTthQUM3RTtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxrREFBa0Q7YUFDM0Q7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUscURBQXFEO2FBQzlEO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLGtGQUFrRjthQUNyRjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFDSiwrRUFBK0U7YUFDbEY7U0FDRixFQUNELElBQUksQ0FDTCxDQUFDO1FBRUYseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsTUFBTSxFQUNOO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLG9FQUFvRTtnQkFDdEUsU0FBUyxFQUFFO29CQUNULHVGQUF1RjtpQkFDeEY7YUFDRjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7U0FDRixFQUNELElBQUksQ0FDTCxDQUFDO1FBRUYseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsYUFBYSxFQUNiO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLHFGQUFxRjthQUN4RjtTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFuTkQsMEJBbU5DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgRHVyYXRpb24sXG4gIFN0YWNrLFxuICBTdGFja1Byb3BzLFxuICBhd3NfZWMyLFxuICBhd3NfaWFtLFxuICBhd3NfbGFtYmRhLFxuICBhd3NfbGFtYmRhX25vZGVqcyxcbiAgYXdzX3NjaGVkdWxlcixcbiAgYXdzX3NzbSxcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgKiBhcyBuZXB0dW5lIGZyb20gXCJAYXdzLWNkay9hd3MtbmVwdHVuZS1hbHBoYVwiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJub2RlOnBhdGhcIjtcblxuaW50ZXJmYWNlIEJhc3Rpb25Qcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICB2cGM6IGF3c19lYzIuVnBjO1xuICBjbHVzdGVyOiBuZXB0dW5lLkRhdGFiYXNlQ2x1c3RlcjtcbiAgLyoqIElBTkEgdGltZXpvbmUgZm9yIHRoZSBhdXRvLXN0b3Agc2NoZWR1bGUgKGRlZmF1bHQ6IEFtZXJpY2EvTG9zX0FuZ2VsZXMpICovXG4gIHRpbWV6b25lPzogc3RyaW5nO1xuICAvKiogQ3JvbiBob3VyICgwLTIzKSB0byBzdG9wIHRoZSBiYXN0aW9uIChkZWZhdWx0OiAwID0gbWlkbmlnaHQpICovXG4gIHN0b3BIb3VyPzogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgQmFzdGlvbiBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBpbnN0YW5jZTogYXdzX2VjMi5CYXN0aW9uSG9zdExpbnV4O1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBCYXN0aW9uUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgeyB2cGMsIGNsdXN0ZXIsIHRpbWV6b25lID0gXCJBbWVyaWNhL0xvc19BbmdlbGVzXCIsIHN0b3BIb3VyID0gMCB9ID1cbiAgICAgIHByb3BzO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBCYXN0aW9uIEhvc3QgaW4gYSBwdWJsaWMgc3VibmV0LCBhY2Nlc3NpYmxlIHZpYSBTU00gKG5vIFNTSCBrZXlzKVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgdGhpcy5pbnN0YW5jZSA9IG5ldyBhd3NfZWMyLkJhc3Rpb25Ib3N0TGludXgodGhpcywgXCJiYXN0aW9uLWhvc3RcIiwge1xuICAgICAgdnBjLFxuICAgICAgc3VibmV0U2VsZWN0aW9uOiB7IHN1Ym5ldFR5cGU6IGF3c19lYzIuU3VibmV0VHlwZS5QVUJMSUMgfSxcbiAgICAgIGluc3RhbmNlVHlwZTogYXdzX2VjMi5JbnN0YW5jZVR5cGUub2YoXG4gICAgICAgIGF3c19lYzIuSW5zdGFuY2VDbGFzcy5UMyxcbiAgICAgICAgYXdzX2VjMi5JbnN0YW5jZVNpemUuU01BTExcbiAgICAgICksXG4gICAgfSk7XG5cbiAgICAvLyBJbnN0YWxsIERvY2tlciBhbmQgcnVuIEdyYXBoIEV4cGxvcmVyIG9uIGV2ZXJ5IGJvb3QgKEhUVFAgb25seSDigJQgSFRUUFMgY2VydFxuICAgIC8vIGlzIGdlbmVyYXRlZCBmb3IgdGhlIEVDMiBob3N0bmFtZSBhbmQgYnJlYWtzIFNTTSBwb3J0LWZvcndhcmQgdHVubmVscyB0byBsb2NhbGhvc3QpXG4gICAgdGhpcy5pbnN0YW5jZS5pbnN0YW5jZS5hZGRVc2VyRGF0YShcbiAgICAgIFwieXVtIHVwZGF0ZSAteVwiLFxuICAgICAgXCJ5dW0gaW5zdGFsbCAteSBkb2NrZXJcIixcbiAgICAgIFwic3lzdGVtY3RsIGVuYWJsZSBkb2NrZXJcIixcbiAgICAgIFwic3lzdGVtY3RsIHN0YXJ0IGRvY2tlclwiLFxuICAgICAgXCJkb2NrZXIgcHVsbCBwdWJsaWMuZWNyLmF3cy9uZXB0dW5lL2dyYXBoLWV4cGxvcmVyXCIsXG4gICAgICBcImRvY2tlciBydW4gLWQgLXAgODA6ODAgLS1yZXN0YXJ0IHVubGVzcy1zdG9wcGVkIC0tbmFtZSBncmFwaC1leHBsb3JlciAtLWVudiBQUk9YWV9TRVJWRVJfSFRUUFNfQ09OTkVDVElPTj1mYWxzZSAtLWVudiBHUkFQSF9FWFBfSFRUUFNfQ09OTkVDVElPTj1mYWxzZSBwdWJsaWMuZWNyLmF3cy9uZXB0dW5lL2dyYXBoLWV4cGxvcmVyXCJcbiAgICApO1xuXG4gICAgLy8gQWxsb3cgdGhlIGJhc3Rpb24gdG8gcmVhY2ggTmVwdHVuZSBvbiBwb3J0IDgxODJcbiAgICBjbHVzdGVyLmNvbm5lY3Rpb25zLmFsbG93RGVmYXVsdFBvcnRGcm9tKHRoaXMuaW5zdGFuY2UpO1xuXG4gICAgLy8gR3JhbnQgYmFzdGlvbiBJQU0gYXV0aCBhY2Nlc3MgdG8gTmVwdHVuZSAocmVxdWlyZWQgZm9yIEdyYXBoIEV4cGxvcmVyIHByb3h5KVxuICAgIHRoaXMuaW5zdGFuY2Uucm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcIm5lcHR1bmUtZGI6UmVhZERhdGFWaWFRdWVyeVwiLFxuICAgICAgICAgIFwibmVwdHVuZS1kYjpXcml0ZURhdGFWaWFRdWVyeVwiLFxuICAgICAgICAgIFwibmVwdHVuZS1kYjpEZWxldGVEYXRhVmlhUXVlcnlcIixcbiAgICAgICAgICBcIm5lcHR1bmUtZGI6Y29ubmVjdFwiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpuZXB0dW5lLWRiOiR7U3RhY2sub2YodGhpcykucmVnaW9ufToke1N0YWNrLm9mKHRoaXMpLmFjY291bnR9OiR7Y2x1c3Rlci5jbHVzdGVyUmVzb3VyY2VJZGVudGlmaWVyfS8qYCxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gU3RvcmUgYmFzdGlvbiBjb25maWcgaW4gU1NNIHNvIHRoZSBtb25pdG9yaW5nIFVJIGNhbiByZWNyZWF0ZSB0aGUgaW5zdGFuY2VcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGNmbkluc3RhbmNlUHJvZmlsZSA9IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2Uubm9kZS5maW5kQ2hpbGQoXCJJbnN0YW5jZVByb2ZpbGVcIikgYXMgYXdzX2lhbS5DZm5JbnN0YW5jZVByb2ZpbGU7XG4gICAgY29uc3QgYmFzdGlvblNnID0gdGhpcy5pbnN0YW5jZS5jb25uZWN0aW9ucy5zZWN1cml0eUdyb3Vwc1swXTtcblxuICAgIG5ldyBhd3Nfc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBcImJhc3Rpb24taW5zdGFuY2UtaWQtcGFyYW1cIiwge1xuICAgICAgcGFyYW1ldGVyTmFtZTogXCIvc29jaWFsQWN0aXZlQXBwL2Jhc3Rpb24vaW5zdGFuY2UtaWRcIixcbiAgICAgIHN0cmluZ1ZhbHVlOiB0aGlzLmluc3RhbmNlLmluc3RhbmNlSWQsXG4gICAgICBkZXNjcmlwdGlvbjogXCJDdXJyZW50IGJhc3Rpb24gaG9zdCBFQzIgaW5zdGFuY2UgSURcIixcbiAgICB9KTtcbiAgICBuZXcgYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJiYXN0aW9uLXN1Ym5ldC1pZC1wYXJhbVwiLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBcIi9zb2NpYWxBY3RpdmVBcHAvYmFzdGlvbi9zdWJuZXQtaWRcIixcbiAgICAgIHN0cmluZ1ZhbHVlOiB2cGMucHVibGljU3VibmV0c1swXS5zdWJuZXRJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlB1YmxpYyBzdWJuZXQgZm9yIGJhc3Rpb24gaG9zdCByZWNyZWF0aW9uXCIsXG4gICAgfSk7XG4gICAgbmV3IGF3c19zc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsIFwiYmFzdGlvbi1zZy1pZC1wYXJhbVwiLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBcIi9zb2NpYWxBY3RpdmVBcHAvYmFzdGlvbi9zZWN1cml0eS1ncm91cC1pZFwiLFxuICAgICAgc3RyaW5nVmFsdWU6IGJhc3Rpb25TZy5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogXCJTZWN1cml0eSBncm91cCBmb3IgYmFzdGlvbiBob3N0IChhbGxvd3MgTmVwdHVuZSBhY2Nlc3MpXCIsXG4gICAgfSk7XG4gICAgbmV3IGF3c19zc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsIFwiYmFzdGlvbi1wcm9maWxlLW5hbWUtcGFyYW1cIiwge1xuICAgICAgcGFyYW1ldGVyTmFtZTogXCIvc29jaWFsQWN0aXZlQXBwL2Jhc3Rpb24vaW5zdGFuY2UtcHJvZmlsZS1uYW1lXCIsXG4gICAgICBzdHJpbmdWYWx1ZTogY2ZuSW5zdGFuY2VQcm9maWxlLnJlZixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIklBTSBpbnN0YW5jZSBwcm9maWxlIG5hbWUgZm9yIFNTTS1tYW5hZ2VkIGJhc3Rpb25cIixcbiAgICB9KTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gTGFtYmRhIHRoYXQgc3RvcHMgdGhlIGJhc3Rpb24gaW5zdGFuY2VcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHN0b3BGbiA9IG5ldyBhd3NfbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcImJhc3Rpb24tc3RvcC1mblwiLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBhd3NfbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICAgIHRyYWNpbmc6IGF3c19sYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcIi4uXCIsXG4gICAgICAgICAgXCJhcGlcIixcbiAgICAgICAgICBcImxhbWJkYVwiLFxuICAgICAgICAgIFwiYmFzdGlvblNjaGVkdWxlclwiLFxuICAgICAgICAgIFwiaW5kZXgudHNcIlxuICAgICAgICApLFxuICAgICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgSU5TVEFOQ0VfSUQ6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgICAgfSxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcIkBhd3Mtc2RrLypcIl0sXG4gICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgc3RvcEZuLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcImVjMjpTdG9wSW5zdGFuY2VzXCIsIFwiZWMyOkRlc2NyaWJlSW5zdGFuY2VzXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBTdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICAgICAgc2VydmljZTogXCJlYzJcIixcbiAgICAgICAgICAgIHJlc291cmNlOiBcImluc3RhbmNlXCIsXG4gICAgICAgICAgICByZXNvdXJjZU5hbWU6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gRXZlbnRCcmlkZ2UgU2NoZWR1bGVyIHJvbGVcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHNjaGVkdWxlclJvbGUgPSBuZXcgYXdzX2lhbS5Sb2xlKHRoaXMsIFwiYmFzdGlvbi1zY2hlZHVsZXItcm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBhd3NfaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJzY2hlZHVsZXIuYW1hem9uYXdzLmNvbVwiKSxcbiAgICB9KTtcbiAgICBzdG9wRm4uZ3JhbnRJbnZva2Uoc2NoZWR1bGVyUm9sZSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIFNjaGVkdWxlOiBzdG9wIGJhc3Rpb24gZGFpbHkgYXQgdGhlIGNvbmZpZ3VyZWQgaG91clxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IGF3c19zY2hlZHVsZXIuQ2ZuU2NoZWR1bGUodGhpcywgXCJiYXN0aW9uLXN0b3Atc2NoZWR1bGVcIiwge1xuICAgICAgbmFtZTogXCJiYXN0aW9uLXN0b3Atc2NoZWR1bGVcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBgU3RvcCBiYXN0aW9uIGhvc3QgYXQgJHtzdG9wSG91cn06MDAgJHt0aW1lem9uZX1gLFxuICAgICAgc2NoZWR1bGVFeHByZXNzaW9uVGltZXpvbmU6IHRpbWV6b25lLFxuICAgICAgc2NoZWR1bGVFeHByZXNzaW9uOiBgY3JvbigwICR7c3RvcEhvdXJ9ICogKiA/ICopYCxcbiAgICAgIGZsZXhpYmxlVGltZVdpbmRvdzogeyBtb2RlOiBcIk9GRlwiIH0sXG4gICAgICB0YXJnZXQ6IHtcbiAgICAgICAgYXJuOiBzdG9wRm4uZnVuY3Rpb25Bcm4sXG4gICAgICAgIHJvbGVBcm46IHNjaGVkdWxlclJvbGUucm9sZUFybixcbiAgICAgICAgaW5wdXQ6IEpTT04uc3RyaW5naWZ5KHsgYWN0aW9uOiBcInN0b3BcIiB9KSxcbiAgICAgIH0sXG4gICAgICBzdGF0ZTogXCJFTkFCTEVEXCIsXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIGNkay1uYWcgc3VwcHJlc3Npb25zXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICB0aGlzLmluc3RhbmNlLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUVDMjZcIixcbiAgICAgICAgICByZWFzb246IFwiQmFzdGlvbiBob3N0IGlzIGVwaGVtZXJhbCBkZXYgdG9vbGluZzsgRUJTIGVuY3J5cHRpb24gbm90IHJlcXVpcmVkXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtRUMyOFwiLFxuICAgICAgICAgIHJlYXNvbjogXCJEZXRhaWxlZCBtb25pdG9yaW5nIG5vdCByZXF1aXJlZCBmb3IgZGV2IGJhc3Rpb25cIixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1FQzI5XCIsXG4gICAgICAgICAgcmVhc29uOiBcIlRlcm1pbmF0aW9uIHByb3RlY3Rpb24gbm90IHJlcXVpcmVkIGZvciBkZXYgYmFzdGlvblwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTRcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIlNTTSBtYW5hZ2VkIHBvbGljaWVzIGFyZSByZXF1aXJlZCBmb3IgU2Vzc2lvbiBNYW5hZ2VyIGFjY2VzcyBvbiB0aGUgYmFzdGlvbiBob3N0XCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgIFwiV2lsZGNhcmQgcGVybWlzc2lvbnMgYXJlIHJlcXVpcmVkIGJ5IFNTTSBtYW5hZ2VkIHBvbGljaWVzIG9uIHRoZSBiYXN0aW9uIGhvc3RcIixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0cnVlXG4gICAgKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHN0b3BGbixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU00XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgcmVxdWlyZWQgZm9yIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3NcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIFwiUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZVwiLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtTDFcIixcbiAgICAgICAgICByZWFzb246IFwiTk9ERUpTXzIyX1ggaXMgdGhlIGxhdGVzdCBzdXBwb3J0ZWQgcnVudGltZSBhdCBkZXBsb3kgdGltZVwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgc2NoZWR1bGVyUm9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJXaWxkY2FyZCBvbiBMYW1iZGEgQVJOIHZlcnNpb24gaXMgcmVxdWlyZWQgYnkgZ3JhbnRJbnZva2UgZm9yIEV2ZW50QnJpZGdlIFNjaGVkdWxlclwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG59XG4iXX0=