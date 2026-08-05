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
        const { vpc, cluster, appName, timezone = "America/Los_Angeles", stopHour = 0 } = props;
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
            parameterName: `/${appName}/bastion/instance-id`,
            stringValue: this.instance.instanceId,
            description: "Current bastion host EC2 instance ID",
        });
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-subnet-id-param", {
            parameterName: `/${appName}/bastion/subnet-id`,
            stringValue: vpc.publicSubnets[0].subnetId,
            description: "Public subnet for bastion host recreation",
        });
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-sg-id-param", {
            parameterName: `/${appName}/bastion/security-group-id`,
            stringValue: bastionSg.securityGroupId,
            description: "Security group for bastion host (allows Neptune access)",
        });
        new aws_cdk_lib_1.aws_ssm.StringParameter(this, "bastion-profile-name-param", {
            parameterName: `/${appName}/bastion/instance-profile-name`,
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
            depsLockFilePath: path.join(__dirname, "..", "..", "api", "lambda", "package-lock.json"),
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
            name: `${appName}-bastion-stop-schedule`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhc3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBVXFCO0FBRXJCLHFDQUEwQztBQUMxQywyQ0FBdUM7QUFDdkMsa0NBQWtDO0FBYWxDLE1BQWEsT0FBUSxTQUFRLHNCQUFTO0lBR3BDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUI7UUFDM0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsUUFBUSxHQUFHLHFCQUFxQixFQUFFLFFBQVEsR0FBRyxDQUFDLEVBQUUsR0FDN0UsS0FBSyxDQUFDO1FBRVIsMEVBQTBFO1FBQzFFLG9FQUFvRTtRQUNwRSwwRUFBMEU7UUFDMUUsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRTtZQUNqRSxHQUFHO1lBQ0gsZUFBZSxFQUFFLEVBQUUsVUFBVSxFQUFFLHFCQUFPLENBQUMsVUFBVSxDQUFDLE1BQU0sRUFBRTtZQUMxRCxZQUFZLEVBQUUscUJBQU8sQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUNuQyxxQkFBTyxDQUFDLGFBQWEsQ0FBQyxFQUFFLEVBQ3hCLHFCQUFPLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FDM0I7U0FDRixDQUFDLENBQUM7UUFFSCw4RUFBOEU7UUFDOUUsc0ZBQXNGO1FBQ3RGLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FDaEMsZUFBZSxFQUNmLHVCQUF1QixFQUN2Qix5QkFBeUIsRUFDekIsd0JBQXdCLEVBQ3hCLG1EQUFtRCxFQUNuRCw4TEFBOEwsQ0FDL0wsQ0FBQztRQUVGLGtEQUFrRDtRQUNsRCxPQUFPLENBQUMsV0FBVyxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztR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Q3hGO1NBQ0YsRUFDRCxJQUFJLENBQ0wsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTNORCwwQkEyTkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBEdXJhdGlvbixcbiAgU3RhY2ssXG4gIFN0YWNrUHJvcHMsXG4gIGF3c19lYzIsXG4gIGF3c19pYW0sXG4gIGF3c19sYW1iZGEsXG4gIGF3c19sYW1iZGFfbm9kZWpzLFxuICBhd3Nfc2NoZWR1bGVyLFxuICBhd3Nfc3NtLFxufSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIG5lcHR1bmUgZnJvbSBcIkBhd3MtY2RrL2F3cy1uZXB0dW5lLWFscGhhXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiO1xuXG5pbnRlcmZhY2UgQmFzdGlvblByb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIHZwYzogYXdzX2VjMi5WcGM7XG4gIGNsdXN0ZXI6IG5lcHR1bmUuRGF0YWJhc2VDbHVzdGVyO1xuICAvKiogQXBwIG5hbWUgcHJlZml4IHVzZWQgZm9yIFNTTSBwYXJhbWV0ZXIgcGF0aHMgYW5kIHNjaGVkdWxlciBuYW1lcyAoZS5nLiBcInByLW11Y2tlclwiKSAqL1xuICBhcHBOYW1lOiBzdHJpbmc7XG4gIC8qKiBJQU5BIHRpbWV6b25lIGZvciB0aGUgYXV0by1zdG9wIHNjaGVkdWxlIChkZWZhdWx0OiBBbWVyaWNhL0xvc19BbmdlbGVzKSAqL1xuICB0aW1lem9uZT86IHN0cmluZztcbiAgLyoqIENyb24gaG91ciAoMC0yMykgdG8gc3RvcCB0aGUgYmFzdGlvbiAoZGVmYXVsdDogMCA9IG1pZG5pZ2h0KSAqL1xuICBzdG9wSG91cj86IG51bWJlcjtcbn1cblxuZXhwb3J0IGNsYXNzIEJhc3Rpb24gZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgaW5zdGFuY2U6IGF3c19lYzIuQmFzdGlvbkhvc3RMaW51eDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQmFzdGlvblByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHsgdnBjLCBjbHVzdGVyLCBhcHBOYW1lLCB0aW1lem9uZSA9IFwiQW1lcmljYS9Mb3NfQW5nZWxlc1wiLCBzdG9wSG91ciA9IDAgfSA9XG4gICAgICBwcm9wcztcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gQmFzdGlvbiBIb3N0IGluIGEgcHVibGljIHN1Ym5ldCwgYWNjZXNzaWJsZSB2aWEgU1NNIChubyBTU0gga2V5cylcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIHRoaXMuaW5zdGFuY2UgPSBuZXcgYXdzX2VjMi5CYXN0aW9uSG9zdExpbnV4KHRoaXMsIFwiYmFzdGlvbi1ob3N0XCIsIHtcbiAgICAgIHZwYyxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogeyBzdWJuZXRUeXBlOiBhd3NfZWMyLlN1Ym5ldFR5cGUuUFVCTElDIH0sXG4gICAgICBpbnN0YW5jZVR5cGU6IGF3c19lYzIuSW5zdGFuY2VUeXBlLm9mKFxuICAgICAgICBhd3NfZWMyLkluc3RhbmNlQ2xhc3MuVDMsXG4gICAgICAgIGF3c19lYzIuSW5zdGFuY2VTaXplLlNNQUxMXG4gICAgICApLFxuICAgIH0pO1xuXG4gICAgLy8gSW5zdGFsbCBEb2NrZXIgYW5kIHJ1biBHcmFwaCBFeHBsb3JlciBvbiBldmVyeSBib290IChIVFRQIG9ubHkg4oCUIEhUVFBTIGNlcnRcbiAgICAvLyBpcyBnZW5lcmF0ZWQgZm9yIHRoZSBFQzIgaG9zdG5hbWUgYW5kIGJyZWFrcyBTU00gcG9ydC1mb3J3YXJkIHR1bm5lbHMgdG8gbG9jYWxob3N0KVxuICAgIHRoaXMuaW5zdGFuY2UuaW5zdGFuY2UuYWRkVXNlckRhdGEoXG4gICAgICBcInl1bSB1cGRhdGUgLXlcIixcbiAgICAgIFwieXVtIGluc3RhbGwgLXkgZG9ja2VyXCIsXG4gICAgICBcInN5c3RlbWN0bCBlbmFibGUgZG9ja2VyXCIsXG4gICAgICBcInN5c3RlbWN0bCBzdGFydCBkb2NrZXJcIixcbiAgICAgIFwiZG9ja2VyIHB1bGwgcHVibGljLmVjci5hd3MvbmVwdHVuZS9ncmFwaC1leHBsb3JlclwiLFxuICAgICAgXCJkb2NrZXIgcnVuIC1kIC1wIDgwOjgwIC0tcmVzdGFydCB1bmxlc3Mtc3RvcHBlZCAtLW5hbWUgZ3JhcGgtZXhwbG9yZXIgLS1lbnYgUFJPWFlfU0VSVkVSX0hUVFBTX0NPTk5FQ1RJT049ZmFsc2UgLS1lbnYgR1JBUEhfRVhQX0hUVFBTX0NPTk5FQ1RJT049ZmFsc2UgcHVibGljLmVjci5hd3MvbmVwdHVuZS9ncmFwaC1leHBsb3JlclwiXG4gICAgKTtcblxuICAgIC8vIEFsbG93IHRoZSBiYXN0aW9uIHRvIHJlYWNoIE5lcHR1bmUgb24gcG9ydCA4MTgyXG4gICAgY2x1c3Rlci5jb25uZWN0aW9ucy5hbGxvd0RlZmF1bHRQb3J0RnJvbSh0aGlzLmluc3RhbmNlKTtcblxuICAgIC8vIEdyYW50IGJhc3Rpb24gSUFNIGF1dGggYWNjZXNzIHRvIE5lcHR1bmUgKHJlcXVpcmVkIGZvciBHcmFwaCBFeHBsb3JlciBwcm94eSlcbiAgICB0aGlzLmluc3RhbmNlLnJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgXCJuZXB0dW5lLWRiOlJlYWREYXRhVmlhUXVlcnlcIixcbiAgICAgICAgICBcIm5lcHR1bmUtZGI6V3JpdGVEYXRhVmlhUXVlcnlcIixcbiAgICAgICAgICBcIm5lcHR1bmUtZGI6RGVsZXRlRGF0YVZpYVF1ZXJ5XCIsXG4gICAgICAgICAgXCJuZXB0dW5lLWRiOmNvbm5lY3RcIixcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgYGFybjphd3M6bmVwdHVuZS1kYjoke1N0YWNrLm9mKHRoaXMpLnJlZ2lvbn06JHtTdGFjay5vZih0aGlzKS5hY2NvdW50fToke2NsdXN0ZXIuY2x1c3RlclJlc291cmNlSWRlbnRpZmllcn0vKmAsXG4gICAgICAgIF0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIFN0b3JlIGJhc3Rpb24gY29uZmlnIGluIFNTTSBzbyB0aGUgbW9uaXRvcmluZyBVSSBjYW4gcmVjcmVhdGUgdGhlIGluc3RhbmNlXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBjZm5JbnN0YW5jZVByb2ZpbGUgPSB0aGlzLmluc3RhbmNlLmluc3RhbmNlLm5vZGUuZmluZENoaWxkKFwiSW5zdGFuY2VQcm9maWxlXCIpIGFzIGF3c19pYW0uQ2ZuSW5zdGFuY2VQcm9maWxlO1xuICAgIGNvbnN0IGJhc3Rpb25TZyA9IHRoaXMuaW5zdGFuY2UuY29ubmVjdGlvbnMuc2VjdXJpdHlHcm91cHNbMF07XG5cbiAgICBuZXcgYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJiYXN0aW9uLWluc3RhbmNlLWlkLXBhcmFtXCIsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHthcHBOYW1lfS9iYXN0aW9uL2luc3RhbmNlLWlkYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiB0aGlzLmluc3RhbmNlLmluc3RhbmNlSWQsXG4gICAgICBkZXNjcmlwdGlvbjogXCJDdXJyZW50IGJhc3Rpb24gaG9zdCBFQzIgaW5zdGFuY2UgSURcIixcbiAgICB9KTtcbiAgICBuZXcgYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJiYXN0aW9uLXN1Ym5ldC1pZC1wYXJhbVwiLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgLyR7YXBwTmFtZX0vYmFzdGlvbi9zdWJuZXQtaWRgLFxuICAgICAgc3RyaW5nVmFsdWU6IHZwYy5wdWJsaWNTdWJuZXRzWzBdLnN1Ym5ldElkLFxuICAgICAgZGVzY3JpcHRpb246IFwiUHVibGljIHN1Ym5ldCBmb3IgYmFzdGlvbiBob3N0IHJlY3JlYXRpb25cIixcbiAgICB9KTtcbiAgICBuZXcgYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJiYXN0aW9uLXNnLWlkLXBhcmFtXCIsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHthcHBOYW1lfS9iYXN0aW9uL3NlY3VyaXR5LWdyb3VwLWlkYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBiYXN0aW9uU2cuc2VjdXJpdHlHcm91cElkLFxuICAgICAgZGVzY3JpcHRpb246IFwiU2VjdXJpdHkgZ3JvdXAgZm9yIGJhc3Rpb24gaG9zdCAoYWxsb3dzIE5lcHR1bmUgYWNjZXNzKVwiLFxuICAgIH0pO1xuICAgIG5ldyBhd3Nfc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBcImJhc3Rpb24tcHJvZmlsZS1uYW1lLXBhcmFtXCIsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAvJHthcHBOYW1lfS9iYXN0aW9uL2luc3RhbmNlLXByb2ZpbGUtbmFtZWAsXG4gICAgICBzdHJpbmdWYWx1ZTogY2ZuSW5zdGFuY2VQcm9maWxlLnJlZixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIklBTSBpbnN0YW5jZSBwcm9maWxlIG5hbWUgZm9yIFNTTS1tYW5hZ2VkIGJhc3Rpb25cIixcbiAgICB9KTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gTGFtYmRhIHRoYXQgc3RvcHMgdGhlIGJhc3Rpb24gaW5zdGFuY2VcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHN0b3BGbiA9IG5ldyBhd3NfbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcImJhc3Rpb24tc3RvcC1mblwiLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBhd3NfbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICAgIHRyYWNpbmc6IGF3c19sYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcIi4uXCIsXG4gICAgICAgICAgXCJhcGlcIixcbiAgICAgICAgICBcImxhbWJkYVwiLFxuICAgICAgICAgIFwiYmFzdGlvblNjaGVkdWxlclwiLFxuICAgICAgICAgIFwiaW5kZXgudHNcIlxuICAgICAgICApLFxuICAgICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oXG4gICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcIi4uXCIsXG4gICAgICAgICAgXCJhcGlcIixcbiAgICAgICAgICBcImxhbWJkYVwiLFxuICAgICAgICAgIFwicGFja2FnZS1sb2NrLmpzb25cIlxuICAgICAgICApLFxuICAgICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgSU5TVEFOQ0VfSUQ6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgICAgfSxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcIkBhd3Mtc2RrLypcIl0sXG4gICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgc3RvcEZuLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcImVjMjpTdG9wSW5zdGFuY2VzXCIsIFwiZWMyOkRlc2NyaWJlSW5zdGFuY2VzXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBTdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICAgICAgc2VydmljZTogXCJlYzJcIixcbiAgICAgICAgICAgIHJlc291cmNlOiBcImluc3RhbmNlXCIsXG4gICAgICAgICAgICByZXNvdXJjZU5hbWU6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gRXZlbnRCcmlkZ2UgU2NoZWR1bGVyIHJvbGVcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHNjaGVkdWxlclJvbGUgPSBuZXcgYXdzX2lhbS5Sb2xlKHRoaXMsIFwiYmFzdGlvbi1zY2hlZHVsZXItcm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBhd3NfaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJzY2hlZHVsZXIuYW1hem9uYXdzLmNvbVwiKSxcbiAgICB9KTtcbiAgICBzdG9wRm4uZ3JhbnRJbnZva2Uoc2NoZWR1bGVyUm9sZSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIFNjaGVkdWxlOiBzdG9wIGJhc3Rpb24gZGFpbHkgYXQgdGhlIGNvbmZpZ3VyZWQgaG91clxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IGF3c19zY2hlZHVsZXIuQ2ZuU2NoZWR1bGUodGhpcywgXCJiYXN0aW9uLXN0b3Atc2NoZWR1bGVcIiwge1xuICAgICAgbmFtZTogYCR7YXBwTmFtZX0tYmFzdGlvbi1zdG9wLXNjaGVkdWxlYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgU3RvcCBiYXN0aW9uIGhvc3QgYXQgJHtzdG9wSG91cn06MDAgJHt0aW1lem9uZX1gLFxuICAgICAgc2NoZWR1bGVFeHByZXNzaW9uVGltZXpvbmU6IHRpbWV6b25lLFxuICAgICAgc2NoZWR1bGVFeHByZXNzaW9uOiBgY3JvbigwICR7c3RvcEhvdXJ9ICogKiA/ICopYCxcbiAgICAgIGZsZXhpYmxlVGltZVdpbmRvdzogeyBtb2RlOiBcIk9GRlwiIH0sXG4gICAgICB0YXJnZXQ6IHtcbiAgICAgICAgYXJuOiBzdG9wRm4uZnVuY3Rpb25Bcm4sXG4gICAgICAgIHJvbGVBcm46IHNjaGVkdWxlclJvbGUucm9sZUFybixcbiAgICAgICAgaW5wdXQ6IEpTT04uc3RyaW5naWZ5KHsgYWN0aW9uOiBcInN0b3BcIiB9KSxcbiAgICAgIH0sXG4gICAgICBzdGF0ZTogXCJFTkFCTEVEXCIsXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIGNkay1uYWcgc3VwcHJlc3Npb25zXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICB0aGlzLmluc3RhbmNlLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUVDMjZcIixcbiAgICAgICAgICByZWFzb246IFwiQmFzdGlvbiBob3N0IGlzIGVwaGVtZXJhbCBkZXYgdG9vbGluZzsgRUJTIGVuY3J5cHRpb24gbm90IHJlcXVpcmVkXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtRUMyOFwiLFxuICAgICAgICAgIHJlYXNvbjogXCJEZXRhaWxlZCBtb25pdG9yaW5nIG5vdCByZXF1aXJlZCBmb3IgZGV2IGJhc3Rpb25cIixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1FQzI5XCIsXG4gICAgICAgICAgcmVhc29uOiBcIlRlcm1pbmF0aW9uIHByb3RlY3Rpb24gbm90IHJlcXVpcmVkIGZvciBkZXYgYmFzdGlvblwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTRcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIlNTTSBtYW5hZ2VkIHBvbGljaWVzIGFyZSByZXF1aXJlZCBmb3IgU2Vzc2lvbiBNYW5hZ2VyIGFjY2VzcyBvbiB0aGUgYmFzdGlvbiBob3N0XCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgIFwiV2lsZGNhcmQgcGVybWlzc2lvbnMgYXJlIHJlcXVpcmVkIGJ5IFNTTSBtYW5hZ2VkIHBvbGljaWVzIG9uIHRoZSBiYXN0aW9uIGhvc3RcIixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0cnVlXG4gICAgKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHN0b3BGbixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU00XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgcmVxdWlyZWQgZm9yIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3NcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIFwiUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZVwiLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtTDFcIixcbiAgICAgICAgICByZWFzb246IFwiTk9ERUpTXzIyX1ggaXMgdGhlIGxhdGVzdCBzdXBwb3J0ZWQgcnVudGltZSBhdCBkZXBsb3kgdGltZVwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgc2NoZWR1bGVyUm9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJXaWxkY2FyZCBvbiBMYW1iZGEgQVJOIHZlcnNpb24gaXMgcmVxdWlyZWQgYnkgZ3JhbnRJbnZva2UgZm9yIEV2ZW50QnJpZGdlIFNjaGVkdWxlclwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG59XG4iXX0=