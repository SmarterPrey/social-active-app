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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImJhc3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBVXFCO0FBRXJCLHFDQUEwQztBQUMxQywyQ0FBdUM7QUFDdkMsa0NBQWtDO0FBV2xDLE1BQWEsT0FBUSxTQUFRLHNCQUFTO0lBR3BDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUI7UUFDM0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxRQUFRLEdBQUcscUJBQXFCLEVBQUUsUUFBUSxHQUFHLENBQUMsRUFBRSxHQUNwRSxLQUFLLENBQUM7UUFFUiwwRUFBMEU7UUFDMUUsb0VBQW9FO1FBQ3BFLDBFQUEwRTtRQUMxRSxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUkscUJBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ2pFLEdBQUc7WUFDSCxlQUFlLEVBQUUsRUFBRSxVQUFVLEVBQUUscUJBQU8sQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFO1lBQzFELFlBQVksRUFBRSxxQkFBTyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQ25DLHFCQUFPLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFDeEIscUJBQU8sQ0FBQyxZQUFZLENBQUMsS0FBSyxDQUMzQjtTQUNGLENBQUMsQ0FBQztRQUVILDhFQUE4RTtRQUM5RSxzRkFBc0Y7UUFDdEYsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUNoQyxlQUFlLEVBQ2YsdUJBQXVCLEVBQ3ZCLHlCQUF5QixFQUN6Qix3QkFBd0IsRUFDeEIsbURBQW1ELEVBQ25ELDhMQUE4TCxDQUMvTCxDQUFDO1FBRUYsa0RBQWtEO1FBQ2xELE9BQU8sQ0FBQyxXQUFXLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXhELCtFQUEr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b3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBEdXJhdGlvbixcbiAgU3RhY2ssXG4gIFN0YWNrUHJvcHMsXG4gIGF3c19lYzIsXG4gIGF3c19pYW0sXG4gIGF3c19sYW1iZGEsXG4gIGF3c19sYW1iZGFfbm9kZWpzLFxuICBhd3Nfc2NoZWR1bGVyLFxuICBhd3Nfc3NtLFxufSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIG5lcHR1bmUgZnJvbSBcIkBhd3MtY2RrL2F3cy1uZXB0dW5lLWFscGhhXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiO1xuXG5pbnRlcmZhY2UgQmFzdGlvblByb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIHZwYzogYXdzX2VjMi5WcGM7XG4gIGNsdXN0ZXI6IG5lcHR1bmUuRGF0YWJhc2VDbHVzdGVyO1xuICAvKiogSUFOQSB0aW1lem9uZSBmb3IgdGhlIGF1dG8tc3RvcCBzY2hlZHVsZSAoZGVmYXVsdDogQW1lcmljYS9Mb3NfQW5nZWxlcykgKi9cbiAgdGltZXpvbmU/OiBzdHJpbmc7XG4gIC8qKiBDcm9uIGhvdXIgKDAtMjMpIHRvIHN0b3AgdGhlIGJhc3Rpb24gKGRlZmF1bHQ6IDAgPSBtaWRuaWdodCkgKi9cbiAgc3RvcEhvdXI/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBCYXN0aW9uIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IGluc3RhbmNlOiBhd3NfZWMyLkJhc3Rpb25Ib3N0TGludXg7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEJhc3Rpb25Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCB7IHZwYywgY2x1c3RlciwgdGltZXpvbmUgPSBcIkFtZXJpY2EvTG9zX0FuZ2VsZXNcIiwgc3RvcEhvdXIgPSAwIH0gPVxuICAgICAgcHJvcHM7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIEJhc3Rpb24gSG9zdCBpbiBhIHB1YmxpYyBzdWJuZXQsIGFjY2Vzc2libGUgdmlhIFNTTSAobm8gU1NIIGtleXMpXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICB0aGlzLmluc3RhbmNlID0gbmV3IGF3c19lYzIuQmFzdGlvbkhvc3RMaW51eCh0aGlzLCBcImJhc3Rpb24taG9zdFwiLCB7XG4gICAgICB2cGMsXG4gICAgICBzdWJuZXRTZWxlY3Rpb246IHsgc3VibmV0VHlwZTogYXdzX2VjMi5TdWJuZXRUeXBlLlBVQkxJQyB9LFxuICAgICAgaW5zdGFuY2VUeXBlOiBhd3NfZWMyLkluc3RhbmNlVHlwZS5vZihcbiAgICAgICAgYXdzX2VjMi5JbnN0YW5jZUNsYXNzLlQzLFxuICAgICAgICBhd3NfZWMyLkluc3RhbmNlU2l6ZS5TTUFMTFxuICAgICAgKSxcbiAgICB9KTtcblxuICAgIC8vIEluc3RhbGwgRG9ja2VyIGFuZCBydW4gR3JhcGggRXhwbG9yZXIgb24gZXZlcnkgYm9vdCAoSFRUUCBvbmx5IOKAlCBIVFRQUyBjZXJ0XG4gICAgLy8gaXMgZ2VuZXJhdGVkIGZvciB0aGUgRUMyIGhvc3RuYW1lIGFuZCBicmVha3MgU1NNIHBvcnQtZm9yd2FyZCB0dW5uZWxzIHRvIGxvY2FsaG9zdClcbiAgICB0aGlzLmluc3RhbmNlLmluc3RhbmNlLmFkZFVzZXJEYXRhKFxuICAgICAgXCJ5dW0gdXBkYXRlIC15XCIsXG4gICAgICBcInl1bSBpbnN0YWxsIC15IGRvY2tlclwiLFxuICAgICAgXCJzeXN0ZW1jdGwgZW5hYmxlIGRvY2tlclwiLFxuICAgICAgXCJzeXN0ZW1jdGwgc3RhcnQgZG9ja2VyXCIsXG4gICAgICBcImRvY2tlciBwdWxsIHB1YmxpYy5lY3IuYXdzL25lcHR1bmUvZ3JhcGgtZXhwbG9yZXJcIixcbiAgICAgIFwiZG9ja2VyIHJ1biAtZCAtcCA4MDo4MCAtLXJlc3RhcnQgdW5sZXNzLXN0b3BwZWQgLS1uYW1lIGdyYXBoLWV4cGxvcmVyIC0tZW52IFBST1hZX1NFUlZFUl9IVFRQU19DT05ORUNUSU9OPWZhbHNlIC0tZW52IEdSQVBIX0VYUF9IVFRQU19DT05ORUNUSU9OPWZhbHNlIHB1YmxpYy5lY3IuYXdzL25lcHR1bmUvZ3JhcGgtZXhwbG9yZXJcIlxuICAgICk7XG5cbiAgICAvLyBBbGxvdyB0aGUgYmFzdGlvbiB0byByZWFjaCBOZXB0dW5lIG9uIHBvcnQgODE4MlxuICAgIGNsdXN0ZXIuY29ubmVjdGlvbnMuYWxsb3dEZWZhdWx0UG9ydEZyb20odGhpcy5pbnN0YW5jZSk7XG5cbiAgICAvLyBHcmFudCBiYXN0aW9uIElBTSBhdXRoIGFjY2VzcyB0byBOZXB0dW5lIChyZXF1aXJlZCBmb3IgR3JhcGggRXhwbG9yZXIgcHJveHkpXG4gICAgdGhpcy5pbnN0YW5jZS5yb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KFxuICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwibmVwdHVuZS1kYjpSZWFkRGF0YVZpYVF1ZXJ5XCIsXG4gICAgICAgICAgXCJuZXB0dW5lLWRiOldyaXRlRGF0YVZpYVF1ZXJ5XCIsXG4gICAgICAgICAgXCJuZXB0dW5lLWRiOkRlbGV0ZURhdGFWaWFRdWVyeVwiLFxuICAgICAgICAgIFwibmVwdHVuZS1kYjpjb25uZWN0XCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGBhcm46YXdzOm5lcHR1bmUtZGI6JHtTdGFjay5vZih0aGlzKS5yZWdpb259OiR7U3RhY2sub2YodGhpcykuYWNjb3VudH06JHtjbHVzdGVyLmNsdXN0ZXJSZXNvdXJjZUlkZW50aWZpZXJ9LypgLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBTdG9yZSBiYXN0aW9uIGNvbmZpZyBpbiBTU00gc28gdGhlIG1vbml0b3JpbmcgVUkgY2FuIHJlY3JlYXRlIHRoZSBpbnN0YW5jZVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgY2ZuSW5zdGFuY2VQcm9maWxlID0gdGhpcy5pbnN0YW5jZS5pbnN0YW5jZS5ub2RlLmZpbmRDaGlsZChcIkluc3RhbmNlUHJvZmlsZVwiKSBhcyBhd3NfaWFtLkNmbkluc3RhbmNlUHJvZmlsZTtcbiAgICBjb25zdCBiYXN0aW9uU2cgPSB0aGlzLmluc3RhbmNlLmNvbm5lY3Rpb25zLnNlY3VyaXR5R3JvdXBzWzBdO1xuXG4gICAgbmV3IGF3c19zc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsIFwiYmFzdGlvbi1pbnN0YW5jZS1pZC1wYXJhbVwiLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBcIi9zb2NpYWxBY3RpdmVBcHAvYmFzdGlvbi9pbnN0YW5jZS1pZFwiLFxuICAgICAgc3RyaW5nVmFsdWU6IHRoaXMuaW5zdGFuY2UuaW5zdGFuY2VJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkN1cnJlbnQgYmFzdGlvbiBob3N0IEVDMiBpbnN0YW5jZSBJRFwiLFxuICAgIH0pO1xuICAgIG5ldyBhd3Nfc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCBcImJhc3Rpb24tc3VibmV0LWlkLXBhcmFtXCIsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IFwiL3NvY2lhbEFjdGl2ZUFwcC9iYXN0aW9uL3N1Ym5ldC1pZFwiLFxuICAgICAgc3RyaW5nVmFsdWU6IHZwYy5wdWJsaWNTdWJuZXRzWzBdLnN1Ym5ldElkLFxuICAgICAgZGVzY3JpcHRpb246IFwiUHVibGljIHN1Ym5ldCBmb3IgYmFzdGlvbiBob3N0IHJlY3JlYXRpb25cIixcbiAgICB9KTtcbiAgICBuZXcgYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJiYXN0aW9uLXNnLWlkLXBhcmFtXCIsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IFwiL3NvY2lhbEFjdGl2ZUFwcC9iYXN0aW9uL3NlY3VyaXR5LWdyb3VwLWlkXCIsXG4gICAgICBzdHJpbmdWYWx1ZTogYmFzdGlvblNnLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlNlY3VyaXR5IGdyb3VwIGZvciBiYXN0aW9uIGhvc3QgKGFsbG93cyBOZXB0dW5lIGFjY2VzcylcIixcbiAgICB9KTtcbiAgICBuZXcgYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJiYXN0aW9uLXByb2ZpbGUtbmFtZS1wYXJhbVwiLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBcIi9zb2NpYWxBY3RpdmVBcHAvYmFzdGlvbi9pbnN0YW5jZS1wcm9maWxlLW5hbWVcIixcbiAgICAgIHN0cmluZ1ZhbHVlOiBjZm5JbnN0YW5jZVByb2ZpbGUucmVmLFxuICAgICAgZGVzY3JpcHRpb246IFwiSUFNIGluc3RhbmNlIHByb2ZpbGUgbmFtZSBmb3IgU1NNLW1hbmFnZWQgYmFzdGlvblwiLFxuICAgIH0pO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBMYW1iZGEgdGhhdCBzdG9wcyB0aGUgYmFzdGlvbiBpbnN0YW5jZVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3Qgc3RvcEZuID0gbmV3IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgIFwiYmFzdGlvbi1zdG9wLWZuXCIsXG4gICAgICB7XG4gICAgICAgIHJ1bnRpbWU6IGF3c19sYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgICAgdHJhY2luZzogYXdzX2xhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgXCIuLlwiLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcImFwaVwiLFxuICAgICAgICAgIFwibGFtYmRhXCIsXG4gICAgICAgICAgXCJiYXN0aW9uU2NoZWR1bGVyXCIsXG4gICAgICAgICAgXCJpbmRleC50c1wiXG4gICAgICAgICksXG4gICAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihcbiAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgXCIuLlwiLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcImFwaVwiLFxuICAgICAgICAgIFwibGFtYmRhXCIsXG4gICAgICAgICAgXCJwYWNrYWdlLWxvY2suanNvblwiXG4gICAgICAgICksXG4gICAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBJTlNUQU5DRV9JRDogdGhpcy5pbnN0YW5jZS5pbnN0YW5jZUlkLFxuICAgICAgICB9LFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1wiQGF3cy1zZGsvKlwiXSxcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG5cbiAgICBzdG9wRm4uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1wiZWMyOlN0b3BJbnN0YW5jZXNcIiwgXCJlYzI6RGVzY3JpYmVJbnN0YW5jZXNcIl0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIFN0YWNrLm9mKHRoaXMpLmZvcm1hdEFybih7XG4gICAgICAgICAgICBzZXJ2aWNlOiBcImVjMlwiLFxuICAgICAgICAgICAgcmVzb3VyY2U6IFwiaW5zdGFuY2VcIixcbiAgICAgICAgICAgIHJlc291cmNlTmFtZTogdGhpcy5pbnN0YW5jZS5pbnN0YW5jZUlkLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBFdmVudEJyaWRnZSBTY2hlZHVsZXIgcm9sZVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3Qgc2NoZWR1bGVyUm9sZSA9IG5ldyBhd3NfaWFtLlJvbGUodGhpcywgXCJiYXN0aW9uLXNjaGVkdWxlci1yb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcInNjaGVkdWxlci5hbWF6b25hd3MuY29tXCIpLFxuICAgIH0pO1xuICAgIHN0b3BGbi5ncmFudEludm9rZShzY2hlZHVsZXJSb2xlKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gU2NoZWR1bGU6IHN0b3AgYmFzdGlvbiBkYWlseSBhdCB0aGUgY29uZmlndXJlZCBob3VyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBuZXcgYXdzX3NjaGVkdWxlci5DZm5TY2hlZHVsZSh0aGlzLCBcImJhc3Rpb24tc3RvcC1zY2hlZHVsZVwiLCB7XG4gICAgICBuYW1lOiBcImJhc3Rpb24tc3RvcC1zY2hlZHVsZVwiLFxuICAgICAgZGVzY3JpcHRpb246IGBTdG9wIGJhc3Rpb24gaG9zdCBhdCAke3N0b3BIb3VyfTowMCAke3RpbWV6b25lfWAsXG4gICAgICBzY2hlZHVsZUV4cHJlc3Npb25UaW1lem9uZTogdGltZXpvbmUsXG4gICAgICBzY2hlZHVsZUV4cHJlc3Npb246IGBjcm9uKDAgJHtzdG9wSG91cn0gKiAqID8gKilgLFxuICAgICAgZmxleGlibGVUaW1lV2luZG93OiB7IG1vZGU6IFwiT0ZGXCIgfSxcbiAgICAgIHRhcmdldDoge1xuICAgICAgICBhcm46IHN0b3BGbi5mdW5jdGlvbkFybixcbiAgICAgICAgcm9sZUFybjogc2NoZWR1bGVyUm9sZS5yb2xlQXJuLFxuICAgICAgICBpbnB1dDogSlNPTi5zdHJpbmdpZnkoeyBhY3Rpb246IFwic3RvcFwiIH0pLFxuICAgICAgfSxcbiAgICAgIHN0YXRlOiBcIkVOQUJMRURcIixcbiAgICB9KTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gY2RrLW5hZyBzdXBwcmVzc2lvbnNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHRoaXMuaW5zdGFuY2UsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtRUMyNlwiLFxuICAgICAgICAgIHJlYXNvbjogXCJCYXN0aW9uIGhvc3QgaXMgZXBoZW1lcmFsIGRldiB0b29saW5nOyBFQlMgZW5jcnlwdGlvbiBub3QgcmVxdWlyZWRcIixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1FQzI4XCIsXG4gICAgICAgICAgcmVhc29uOiBcIkRldGFpbGVkIG1vbml0b3Jpbmcgbm90IHJlcXVpcmVkIGZvciBkZXYgYmFzdGlvblwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUVDMjlcIixcbiAgICAgICAgICByZWFzb246IFwiVGVybWluYXRpb24gcHJvdGVjdGlvbiBub3QgcmVxdWlyZWQgZm9yIGRldiBiYXN0aW9uXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNFwiLFxuICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgIFwiU1NNIG1hbmFnZWQgcG9saWNpZXMgYXJlIHJlcXVpcmVkIGZvciBTZXNzaW9uIE1hbmFnZXIgYWNjZXNzIG9uIHRoZSBiYXN0aW9uIGhvc3RcIixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJXaWxkY2FyZCBwZXJtaXNzaW9ucyBhcmUgcmVxdWlyZWQgYnkgU1NNIG1hbmFnZWQgcG9saWNpZXMgb24gdGhlIGJhc3Rpb24gaG9zdFwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgc3RvcEZuLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTRcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIkFXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyByZXF1aXJlZCBmb3IgQ2xvdWRXYXRjaCBMb2dzIGFjY2Vzc1wiLFxuICAgICAgICAgIGFwcGxpZXNUbzogW1xuICAgICAgICAgICAgXCJQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1MMVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJOT0RFSlNfMjJfWCBpcyB0aGUgbGF0ZXN0IHN1cHBvcnRlZCBydW50aW1lIGF0IGRlcGxveSB0aW1lXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBzY2hlZHVsZXJSb2xlLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTVcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIldpbGRjYXJkIG9uIExhbWJkYSBBUk4gdmVyc2lvbiBpcyByZXF1aXJlZCBieSBncmFudEludm9rZSBmb3IgRXZlbnRCcmlkZ2UgU2NoZWR1bGVyXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZVxuICAgICk7XG4gIH1cbn1cbiJdfQ==