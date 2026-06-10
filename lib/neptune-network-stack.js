"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeptuneNetworkStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const network_1 = require("./constructs/network");
const neptune_1 = require("./constructs/neptune");
const neptune_scheduler_1 = require("./constructs/neptune-scheduler");
const bastion_1 = require("./constructs/bastion");
const parameter_email_subscriber_1 = require("./constructs/parameter-email-subscriber");
class NeptuneNetworkStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { natSubnet, maxAz, neptuneServerlss, neptuneServerlssCapacity, neptuneSchedule, bastion: bastionConfig, } = props;
        const network = new network_1.Network(this, "network", {
            natSubnet,
            maxAz,
        });
        this.vpc = network.vpc;
        const neptune = new neptune_1.Neptune(this, "neptune", {
            vpc: network.vpc,
            neptuneServerlss,
            neptuneServerlssCapacity,
        });
        this.cluster = neptune.cluster;
        this.neptuneRole = neptune.neptuneRole;
        // Bastion host for remote Neptune access via SSM
        if (bastionConfig?.enabled) {
            new bastion_1.Bastion(this, "bastion", {
                vpc: this.vpc,
                cluster: this.cluster,
                timezone: bastionConfig.timezone,
                stopHour: bastionConfig.stopHour,
            });
        }
        // Schedule Neptune stop/start to save costs during off-hours
        if (neptuneSchedule?.enabled) {
            new neptune_scheduler_1.NeptuneScheduler(this, "neptune-scheduler", {
                cluster: this.cluster,
                timezone: neptuneSchedule.timezone,
                stopHour: neptuneSchedule.stopHour,
            });
        }
        // SNS topic for Neptune cluster state change notifications
        const neptuneStatusKey = new aws_cdk_lib_1.aws_kms.Key(this, "NeptuneStatusTopicKey", {
            description: "KMS key for Neptune status SNS topic encryption",
            enableKeyRotation: true,
        });
        const neptuneStatusTopic = new aws_cdk_lib_1.aws_sns.Topic(this, "NeptuneStatusTopic", {
            displayName: "Neptune Cluster Status Notifications",
            masterKey: neptuneStatusKey,
        });
        // Enforce SSL-only access to the topic (AwsSolutions-SNS3)
        neptuneStatusTopic.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowPublishThroughSSLOnly",
            effect: aws_cdk_lib_1.aws_iam.Effect.DENY,
            principals: [new aws_cdk_lib_1.aws_iam.AnyPrincipal()],
            actions: ["sns:Publish"],
            resources: [neptuneStatusTopic.topicArn],
            conditions: {
                Bool: { "aws:SecureTransport": "false" },
            },
        }));
        // Allow RDS/Neptune to publish to this encrypted topic
        neptuneStatusTopic.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowRDSPublish",
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            principals: [new aws_cdk_lib_1.aws_iam.ServicePrincipal("events.rds.amazonaws.com")],
            actions: ["sns:Publish"],
            resources: [neptuneStatusTopic.topicArn],
        }));
        neptuneStatusKey.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowRDSUseKey",
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            principals: [new aws_cdk_lib_1.aws_iam.ServicePrincipal("events.rds.amazonaws.com")],
            actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
            resources: ["*"],
        }));
        // Subscribe email addresses from Parameter Store
        new parameter_email_subscriber_1.ParameterEmailSubscriber(this, "NeptuneEmailSubscriber", {
            topicArn: neptuneStatusTopic.topicArn,
            parameterName: "/global-app-params/rdsnotificationemails",
        });
        // RDS Event Subscription: notify on cluster failover, maintenance, and notification events
        new aws_cdk_lib_1.aws_rds.CfnEventSubscription(this, "NeptuneEventSubscription", {
            snsTopicArn: neptuneStatusTopic.topicArn,
            sourceType: "db-cluster",
            sourceIds: [this.cluster.clusterIdentifier],
            enabled: true,
            eventCategories: ["failover", "failure", "maintenance", "notification"],
        });
        // -----------------------------------------------------------------------
        // EC2 Instance State-Change Email Notifications
        // -----------------------------------------------------------------------
        const ec2StatusKey = new aws_cdk_lib_1.aws_kms.Key(this, "EC2StatusTopicKey", {
            description: "KMS key for EC2 status SNS topic encryption",
            enableKeyRotation: true,
        });
        const ec2StatusTopic = new aws_cdk_lib_1.aws_sns.Topic(this, "EC2StatusTopic", {
            displayName: "EC2 Instance State-Change Notifications",
            masterKey: ec2StatusKey,
        });
        // Enforce SSL-only access to the topic (AwsSolutions-SNS3)
        ec2StatusTopic.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowPublishThroughSSLOnly",
            effect: aws_cdk_lib_1.aws_iam.Effect.DENY,
            principals: [new aws_cdk_lib_1.aws_iam.AnyPrincipal()],
            actions: ["sns:Publish"],
            resources: [ec2StatusTopic.topicArn],
            conditions: {
                Bool: { "aws:SecureTransport": "false" },
            },
        }));
        // Allow EventBridge to publish to the encrypted topic
        ec2StatusTopic.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowEventBridgePublish",
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            principals: [new aws_cdk_lib_1.aws_iam.ServicePrincipal("events.amazonaws.com")],
            actions: ["sns:Publish"],
            resources: [ec2StatusTopic.topicArn],
        }));
        ec2StatusKey.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowEventBridgeUseKey",
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            principals: [new aws_cdk_lib_1.aws_iam.ServicePrincipal("events.amazonaws.com")],
            actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
            resources: ["*"],
        }));
        // Subscribe the same email addresses from Parameter Store
        new parameter_email_subscriber_1.ParameterEmailSubscriber(this, "EC2EmailSubscriber", {
            topicArn: ec2StatusTopic.topicArn,
            parameterName: "/global-app-params/rdsnotificationemails",
        });
        // EventBridge rule: EC2 instance state-change (started / stopped)
        new aws_cdk_lib_1.aws_events.Rule(this, "EC2InstanceStateChangeRule", {
            ruleName: "ec2-instance-state-change-notifications",
            description: "Send email when any EC2 instance in us-east-1 is started or stopped",
            eventPattern: {
                source: ["aws.ec2"],
                detailType: ["EC2 Instance State-change Notification"],
                detail: {
                    state: ["running", "stopped"],
                },
            },
            targets: [
                new aws_cdk_lib_1.aws_events_targets.SnsTopic(ec2StatusTopic, {
                    message: aws_cdk_lib_1.aws_events.RuleTargetInput.fromText(`EC2 Instance State Change — Instance ${aws_cdk_lib_1.aws_events.EventField.fromPath("$.detail.instance-id")} is now ${aws_cdk_lib_1.aws_events.EventField.fromPath("$.detail.state")} (Account: ${aws_cdk_lib_1.aws_events.EventField.fromPath("$.account")}, Region: ${aws_cdk_lib_1.aws_events.EventField.fromPath("$.region")})`),
                }),
            ],
        });
        // -----------------------------------------------------------------------
        // cdk-nag stack-level suppressions
        // -----------------------------------------------------------------------
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-IAM4",
                reason: "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access - CDK managed resource",
                appliesTo: [
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                ],
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Wildcard permissions required for CDK managed resources",
                appliesTo: ["Resource::*"],
            },
            {
                id: "AwsSolutions-L1",
                reason: "NODEJS_22_X is the latest supported runtime at deploy time - CDK managed resource",
            },
        ]);
    }
}
exports.NeptuneNetworkStack = NeptuneNetworkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmVwdHVuZS1uZXR3b3JrLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibmVwdHVuZS1uZXR3b3JrLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZDQUE2SDtBQUc3SCxxQ0FBMEM7QUFDMUMsa0RBQStDO0FBQy9DLGtEQUErQztBQUMvQyxzRUFBa0U7QUFDbEUsa0RBQStDO0FBQy9DLHdGQUFtRjtBQTRCbkYsTUFBYSxtQkFBb0IsU0FBUSxtQkFBSztJQUk1QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFDSixTQUFTLEVBQ1QsS0FBSyxFQUNMLGdCQUFnQixFQUNoQix3QkFBd0IsRUFDeEIsZUFBZSxFQUNmLE9BQU8sRUFBRSxhQUFhLEdBQ3ZCLEdBQUcsS0FBSyxDQUFDO1FBRVYsTUFBTSxPQUFPLEdBQUcsSUFBSSxpQkFBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDM0MsU0FBUztZQUNULEtBQUs7U0FDTixDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsR0FBRyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFFdkIsTUFBTSxPQUFPLEdBQUcsSUFBSSxpQkFBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDM0MsR0FBRyxFQUFFLE9BQU8sQ0FBQyxHQUFHO1lBQ2hCLGdCQUFnQjtZQUNoQix3QkFBd0I7U0FDekIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFDO1FBQy9CLElBQUksQ0FBQyxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsQ0FBQztRQUV2QyxpREFBaUQ7UUFDakQsSUFBSSxhQUFhLEVBQUUsT0FBTyxFQUFFLENBQUM7WUFDM0IsSUFBSSxpQkFBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7Z0JBQzNCLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztnQkFDYixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87Z0JBQ3JCLFFBQVEsRUFBRSxhQUFhLENBQUMsUUFBUTtnQkFDaEMsUUFBUSxFQUFFLGFBQWEsQ0FBQyxRQUFRO2FBQ2pDLENBQUMsQ0FBQztRQUNMLENBQUM7UUFFRCw2REFBNkQ7UUFDN0QsSUFBSSxlQUFlLEVBQUUsT0FBTyxFQUFFLENBQUM7WUFDN0IsSUFBSSxvQ0FBZ0IsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7Z0JBQzlDLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztnQkFDckIsUUFBUSxFQUFFLGVBQWUsQ0FBQyxRQUFRO2dCQUNsQyxRQUFRLEVBQUUsZUFBZSxDQUFDLFFBQVE7YUFDbkMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELDJEQUEyRDtRQUMzRCxNQUFNLGdCQUFnQixHQUFHLElBQUkscUJBQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQ3RFLFdBQVcsRUFBRSxpREFBaUQ7WUFDOUQsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFDLENBQUM7UUFFSCxNQUFNLGtCQUFrQixHQUFHLElBQUkscUJBQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLG9CQUFvQixFQUFFO1lBQ3ZFLFdBQVcsRUFBRSxzQ0FBc0M7WUFDbkQsU0FBUyxFQUFFLGdCQUFnQjtTQUM1QixDQUFDLENBQUM7UUFFSCwyREFBMkQ7UUFDM0Qsa0JBQWtCLENBQUMsbUJBQW1CLENBQ3BDLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsR0FBRyxFQUFFLDRCQUE0QjtZQUNqQyxNQUFNLEVBQUUscUJBQU8sQ0FBQyxNQUFNLENBQUMsSUFBSTtZQUMzQixVQUFVLEVBQUUsQ0FBQyxJQUFJLHFCQUFPLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDeEMsT0FBTyxFQUFFLENBQUMsYUFBYSxDQUFDO1lBQ3hCLFNBQVMsRUFBRSxDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQztZQUN4QyxVQUFVLEVBQUU7Z0JBQ1YsSUFBSSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsT0FBTyxFQUFFO2FBQ3pDO1NBQ0YsQ0FBQyxDQUNILENBQUM7UUFFRix1REFBdUQ7UUFDdkQsa0JBQWtCLENBQUMsbUJBQW1CLENBQ3BDLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsR0FBRyxFQUFFLGlCQUFpQjtZQUN0QixNQUFNLEVBQUUscUJBQU8sQ0FBQyxNQUFNLENBQUMsS0FBSztZQUM1QixVQUFVLEVBQUUsQ0FBQyxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsMEJBQTBCLENBQUMsQ0FBQztZQUN0RSxPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDeEIsU0FBUyxFQUFFLENBQUMsa0JBQWtCLENBQUMsUUFBUSxDQUFDO1NBQ3pDLENBQUMsQ0FDSCxDQUFDO1FBRUYsZ0JBQWdCLENBQUMsbUJBQW1CLENBQ2xDLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsR0FBRyxFQUFFLGdCQUFnQjtZQUNyQixNQUFNLEVBQUUscUJBQU8sQ0FBQyxNQUFNLENBQUMsS0FBSztZQUM1QixVQUFVLEVBQUUsQ0FBQyxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsMEJBQTBCLENBQUMsQ0FBQztZQUN0RSxPQUFPLEVBQUUsQ0FBQyxhQUFhLEVBQUUsc0JBQXNCLENBQUM7WUFDaEQsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFDO1FBRUYsaURBQWlEO1FBQ2pELElBQUkscURBQXdCLENBQUMsSUFBSSxFQUFFLHdCQUF3QixFQUFFO1lBQzNELFFBQVEsRUFBRSxrQkFBa0IsQ0FBQyxRQUFRO1lBQ3JDLGFBQWEsRUFBRSwwQ0FBMEM7U0FDMUQsQ0FBQyxDQUFDO1FBRUgsMkZBQTJGO1FBQzNGLElBQUkscUJBQU8sQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDakUsV0FBVyxFQUFFLGtCQUFrQixDQUFDLFFBQVE7WUFDeEMsVUFBVSxFQUFFLFlBQVk7WUFDeEIsU0FBUyxFQUFFLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztZQUMzQyxPQUFPLEVBQUUsSUFBSTtZQUNiLGVBQWUsRUFBRSxDQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsYUFBYSxFQUFFLGNBQWMsQ0FBQztTQUN4RSxDQUFDLENBQUM7UUFFSCwwRUFBMEU7UUFDMUUsZ0RBQWdEO1FBQ2hELDBFQUEwRTtRQUMxRSxNQUFNLFlBQVksR0FBRyxJQUFJLHFCQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUM5RCxXQUFXLEVBQUUsNkNBQTZDO1lBQzFELGlCQUFpQixFQUFFLElBQUk7U0FDeEIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxjQUFjLEdBQUcsSUFBSSxxQkFBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDL0QsV0FBVyxFQUFFLHlDQUF5QztZQUN0RCxTQUFTLEVBQUUsWUFBWTtTQUN4QixDQUFDLENBQUM7UUFFSCwyREFBMkQ7UUFDM0QsY0FBYyxDQUFDLG1CQUFtQixDQUNoQyxJQUFJLHFCQUFPLENBQUMsZUFBZSxDQUFDO1lBQzFCLEdBQUcsRUFBRSw0QkFBNEI7WUFDakMsTUFBTSxFQUFFLHFCQUFPLENBQUMsTUFBTSxDQUFDLElBQUk7WUFDM0IsVUFBVSxFQUFFLENBQUMsSUFBSSxxQkFBTyxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3hDLE9BQU8sRUFBRSxDQUFDLGFBQWEsQ0FBQztZQUN4QixTQUFTLEVBQUUsQ0FBQyxjQUFjLENBQUMsUUFBUSxDQUFDO1lBQ3BDLFVBQVUsRUFBRTtnQkFDVixJQUFJLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxPQUFPLEVBQUU7YUFDekM7U0FDRixDQUFDLENBQ0gsQ0FBQztRQUVGLHNEQUFzRDtRQUN0RCxjQUFjLENBQUMsbUJBQW1CLENBQ2hDLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsR0FBRyxFQUFFLHlCQUF5QjtZQUM5QixNQUFNLEVBQUUscUJBQU8sQ0FBQyxNQUFNLENBQUMsS0FBSztZQUM1QixVQUFVLEVBQUUsQ0FBQyxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUMsQ0FBQztZQUNsRSxPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDeEIsU0FBUyxFQUFFLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQztTQUNyQyxDQUFDLENBQ0gsQ0FBQztRQUVGLFlBQVksQ0FBQyxtQkFBbUIsQ0FDOUIsSUFBSSxxQkFBTyxDQUFDLGVBQWUsQ0FBQztZQUMxQixHQUFHLEVBQUUsd0JBQXdCO1lBQzdCLE1BQU0sRUFBRSxxQkFBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLO1lBQzVCLFVBQVUsRUFBRSxDQUFDLElBQUkscUJBQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO1lBQ2xFLE9BQU8sRUFBRSxDQUFDLGFBQWEsRUFBRSxzQkFBc0IsQ0FBQztZQUNoRCxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUNILENBQUM7UUFFRiwwREFBMEQ7UUFDMUQsSUFBSSxxREFBd0IsQ0FBQyxJQUFJLEVBQUUsb0JBQW9CLEVBQUU7WUFDdkQsUUFBUSxFQUFFLGNBQWMsQ0FBQyxRQUFRO1lBQ2pDLGFBQWEsRUFBRSwwQ0FBMEM7U0FDMUQsQ0FBQyxDQUFDO1FBRUgsa0VBQWtFO1FBQ2xFLElBQUksd0JBQVUsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLDRCQUE0QixFQUFFO1lBQ3RELFFBQVEsRUFBRSx5Q0FBeUM7WUFDbkQsV0FBVyxFQUNULHFFQUFxRTtZQUN2RSxZQUFZLEVBQUU7Z0JBQ1osTUFBTSxFQUFFLENBQUMsU0FBUyxDQUFDO2dCQUNuQixVQUFVLEVBQUUsQ0FBQyx3Q0FBd0MsQ0FBQztnQkFDdEQsTUFBTSxFQUFFO29CQUNOLEtBQUssRUFBRSxDQUFDLFNBQVMsRUFBRSxTQUFTLENBQUM7aUJBQzlCO2FBQ0Y7WUFDRCxPQUFPLEVBQUU7Z0JBQ1AsSUFBSSxnQ0FBa0IsQ0FBQyxRQUFRLENBQUMsY0FBYyxFQUFFO29CQUM5QyxPQUFPLEVBQUUsd0JBQVUsQ0FBQyxlQUFlLENBQUMsUUFBUSxDQUMxQyx3Q0FDRSx3QkFBVSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsc0JBQXNCLENBQ3ZELFdBQ0Usd0JBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLGdCQUFnQixDQUNqRCxjQUNFLHdCQUFVLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQzVDLGFBQ0Usd0JBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FDM0MsR0FBRyxDQUNKO2lCQUNGLENBQUM7YUFDSDtTQUNGLENBQUMsQ0FBQztRQUVILDBFQUEwRTtRQUMxRSxtQ0FBbUM7UUFDbkMsMEVBQTBFO1FBQzFFLHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFDSiwyRkFBMkY7Z0JBQzdGLFNBQVMsRUFBRTtvQkFDVCx1RkFBdUY7aUJBQ3hGO2FBQ0Y7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUseURBQXlEO2dCQUNqRSxTQUFTLEVBQUUsQ0FBQyxhQUFhLENBQUM7YUFDM0I7WUFDRDtnQkFDRSxFQUFFLEVBQUUsaUJBQWlCO2dCQUNyQixNQUFNLEVBQUUsbUZBQW1GO2FBQzVGO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBek5ELGtEQXlOQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFN0YWNrLCBTdGFja1Byb3BzLCBhd3NfZWMyLCBhd3NfZXZlbnRzLCBhd3NfZXZlbnRzX3RhcmdldHMsIGF3c19pYW0sIGF3c19rbXMsIGF3c19zbnMsIGF3c19yZHMgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgKiBhcyBuZXB0dW5lIGZyb20gXCJAYXdzLWNkay9hd3MtbmVwdHVuZS1hbHBoYVwiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcbmltcG9ydCB7IE5ldHdvcmsgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL25ldHdvcmtcIjtcbmltcG9ydCB7IE5lcHR1bmUgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL25lcHR1bmVcIjtcbmltcG9ydCB7IE5lcHR1bmVTY2hlZHVsZXIgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL25lcHR1bmUtc2NoZWR1bGVyXCI7XG5pbXBvcnQgeyBCYXN0aW9uIH0gZnJvbSBcIi4vY29uc3RydWN0cy9iYXN0aW9uXCI7XG5pbXBvcnQgeyBQYXJhbWV0ZXJFbWFpbFN1YnNjcmliZXIgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL3BhcmFtZXRlci1lbWFpbC1zdWJzY3JpYmVyXCI7XG5cbmludGVyZmFjZSBOZXB0dW5lU2NoZWR1bGVDb25maWcge1xuICAvKiogRW5hYmxlIHNjaGVkdWxlZCBzdG9wL3N0YXJ0IG9mIE5lcHR1bmUgKGRlZmF1bHQ6IGZhbHNlKSAqL1xuICBlbmFibGVkOiBib29sZWFuO1xuICAvKiogSUFOQSB0aW1lem9uZSAoZGVmYXVsdDogQW1lcmljYS9Mb3NfQW5nZWxlcykgKi9cbiAgdGltZXpvbmU/OiBzdHJpbmc7XG4gIC8qKiBIb3VyIHRvIHN0b3AgdGhlIGNsdXN0ZXIgKGRlZmF1bHQ6IDAgPSBtaWRuaWdodCkgKi9cbiAgc3RvcEhvdXI/OiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBOZXB0dW5lTmV0d29ya1N0YWNrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgbmF0U3VibmV0PzogYm9vbGVhbjtcbiAgbWF4QXo6IG51bWJlcjtcbiAgbmVwdHVuZVNlcnZlcmxzczogYm9vbGVhbjtcbiAgbmVwdHVuZVNlcnZlcmxzc0NhcGFjaXR5PzogbmVwdHVuZS5TZXJ2ZXJsZXNzU2NhbGluZ0NvbmZpZ3VyYXRpb247XG4gIC8qKiBPcHRpb25hbCBzY2hlZHVsZSB0byBzdG9wL3N0YXJ0IE5lcHR1bmUgZHVyaW5nIG9mZi1ob3VycyAqL1xuICBuZXB0dW5lU2NoZWR1bGU/OiBOZXB0dW5lU2NoZWR1bGVDb25maWc7XG4gIC8qKiBFbmFibGUgYSBiYXN0aW9uIGhvc3QgZm9yIHJlbW90ZSBOZXB0dW5lIGFjY2VzcyB2aWEgU1NNICovXG4gIGJhc3Rpb24/OiB7XG4gICAgZW5hYmxlZDogYm9vbGVhbjtcbiAgICAvKiogSUFOQSB0aW1lem9uZSAoZGVmYXVsdDogQW1lcmljYS9Mb3NfQW5nZWxlcykgKi9cbiAgICB0aW1lem9uZT86IHN0cmluZztcbiAgICAvKiogSG91ciB0byBhdXRvLXN0b3AgdGhlIGJhc3Rpb24gKGRlZmF1bHQ6IDAgPSBtaWRuaWdodCkgKi9cbiAgICBzdG9wSG91cj86IG51bWJlcjtcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIE5lcHR1bmVOZXR3b3JrU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSB2cGM6IGF3c19lYzIuVnBjO1xuICBwdWJsaWMgcmVhZG9ubHkgY2x1c3RlcjogbmVwdHVuZS5EYXRhYmFzZUNsdXN0ZXI7XG4gIHB1YmxpYyByZWFkb25seSBuZXB0dW5lUm9sZTogYXdzX2lhbS5Sb2xlO1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTmVwdHVuZU5ldHdvcmtTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7XG4gICAgICBuYXRTdWJuZXQsXG4gICAgICBtYXhBeixcbiAgICAgIG5lcHR1bmVTZXJ2ZXJsc3MsXG4gICAgICBuZXB0dW5lU2VydmVybHNzQ2FwYWNpdHksXG4gICAgICBuZXB0dW5lU2NoZWR1bGUsXG4gICAgICBiYXN0aW9uOiBiYXN0aW9uQ29uZmlnLFxuICAgIH0gPSBwcm9wcztcblxuICAgIGNvbnN0IG5ldHdvcmsgPSBuZXcgTmV0d29yayh0aGlzLCBcIm5ldHdvcmtcIiwge1xuICAgICAgbmF0U3VibmV0LFxuICAgICAgbWF4QXosXG4gICAgfSk7XG4gICAgdGhpcy52cGMgPSBuZXR3b3JrLnZwYztcblxuICAgIGNvbnN0IG5lcHR1bmUgPSBuZXcgTmVwdHVuZSh0aGlzLCBcIm5lcHR1bmVcIiwge1xuICAgICAgdnBjOiBuZXR3b3JrLnZwYyxcbiAgICAgIG5lcHR1bmVTZXJ2ZXJsc3MsXG4gICAgICBuZXB0dW5lU2VydmVybHNzQ2FwYWNpdHksXG4gICAgfSk7XG5cbiAgICB0aGlzLmNsdXN0ZXIgPSBuZXB0dW5lLmNsdXN0ZXI7XG4gICAgdGhpcy5uZXB0dW5lUm9sZSA9IG5lcHR1bmUubmVwdHVuZVJvbGU7XG5cbiAgICAvLyBCYXN0aW9uIGhvc3QgZm9yIHJlbW90ZSBOZXB0dW5lIGFjY2VzcyB2aWEgU1NNXG4gICAgaWYgKGJhc3Rpb25Db25maWc/LmVuYWJsZWQpIHtcbiAgICAgIG5ldyBCYXN0aW9uKHRoaXMsIFwiYmFzdGlvblwiLCB7XG4gICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgIGNsdXN0ZXI6IHRoaXMuY2x1c3RlcixcbiAgICAgICAgdGltZXpvbmU6IGJhc3Rpb25Db25maWcudGltZXpvbmUsXG4gICAgICAgIHN0b3BIb3VyOiBiYXN0aW9uQ29uZmlnLnN0b3BIb3VyLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gU2NoZWR1bGUgTmVwdHVuZSBzdG9wL3N0YXJ0IHRvIHNhdmUgY29zdHMgZHVyaW5nIG9mZi1ob3Vyc1xuICAgIGlmIChuZXB0dW5lU2NoZWR1bGU/LmVuYWJsZWQpIHtcbiAgICAgIG5ldyBOZXB0dW5lU2NoZWR1bGVyKHRoaXMsIFwibmVwdHVuZS1zY2hlZHVsZXJcIiwge1xuICAgICAgICBjbHVzdGVyOiB0aGlzLmNsdXN0ZXIsXG4gICAgICAgIHRpbWV6b25lOiBuZXB0dW5lU2NoZWR1bGUudGltZXpvbmUsXG4gICAgICAgIHN0b3BIb3VyOiBuZXB0dW5lU2NoZWR1bGUuc3RvcEhvdXIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTTlMgdG9waWMgZm9yIE5lcHR1bmUgY2x1c3RlciBzdGF0ZSBjaGFuZ2Ugbm90aWZpY2F0aW9uc1xuICAgIGNvbnN0IG5lcHR1bmVTdGF0dXNLZXkgPSBuZXcgYXdzX2ttcy5LZXkodGhpcywgXCJOZXB0dW5lU3RhdHVzVG9waWNLZXlcIiwge1xuICAgICAgZGVzY3JpcHRpb246IFwiS01TIGtleSBmb3IgTmVwdHVuZSBzdGF0dXMgU05TIHRvcGljIGVuY3J5cHRpb25cIixcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbmVwdHVuZVN0YXR1c1RvcGljID0gbmV3IGF3c19zbnMuVG9waWModGhpcywgXCJOZXB0dW5lU3RhdHVzVG9waWNcIiwge1xuICAgICAgZGlzcGxheU5hbWU6IFwiTmVwdHVuZSBDbHVzdGVyIFN0YXR1cyBOb3RpZmljYXRpb25zXCIsXG4gICAgICBtYXN0ZXJLZXk6IG5lcHR1bmVTdGF0dXNLZXksXG4gICAgfSk7XG5cbiAgICAvLyBFbmZvcmNlIFNTTC1vbmx5IGFjY2VzcyB0byB0aGUgdG9waWMgKEF3c1NvbHV0aW9ucy1TTlMzKVxuICAgIG5lcHR1bmVTdGF0dXNUb3BpYy5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiBcIkFsbG93UHVibGlzaFRocm91Z2hTU0xPbmx5XCIsXG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuREVOWSxcbiAgICAgICAgcHJpbmNpcGFsczogW25ldyBhd3NfaWFtLkFueVByaW5jaXBhbCgpXSxcbiAgICAgICAgYWN0aW9uczogW1wic25zOlB1Ymxpc2hcIl0sXG4gICAgICAgIHJlc291cmNlczogW25lcHR1bmVTdGF0dXNUb3BpYy50b3BpY0Fybl0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICBCb29sOiB7IFwiYXdzOlNlY3VyZVRyYW5zcG9ydFwiOiBcImZhbHNlXCIgfSxcbiAgICAgICAgfSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFsbG93IFJEUy9OZXB0dW5lIHRvIHB1Ymxpc2ggdG8gdGhpcyBlbmNyeXB0ZWQgdG9waWNcbiAgICBuZXB0dW5lU3RhdHVzVG9waWMuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogXCJBbGxvd1JEU1B1Ymxpc2hcIixcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW25ldyBhd3NfaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJldmVudHMucmRzLmFtYXpvbmF3cy5jb21cIildLFxuICAgICAgICBhY3Rpb25zOiBbXCJzbnM6UHVibGlzaFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbbmVwdHVuZVN0YXR1c1RvcGljLnRvcGljQXJuXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIG5lcHR1bmVTdGF0dXNLZXkuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogXCJBbGxvd1JEU1VzZUtleVwiLFxuICAgICAgICBlZmZlY3Q6IGF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcImV2ZW50cy5yZHMuYW1hem9uYXdzLmNvbVwiKV0sXG4gICAgICAgIGFjdGlvbnM6IFtcImttczpEZWNyeXB0XCIsIFwia21zOkdlbmVyYXRlRGF0YUtleSpcIl0sXG4gICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFN1YnNjcmliZSBlbWFpbCBhZGRyZXNzZXMgZnJvbSBQYXJhbWV0ZXIgU3RvcmVcbiAgICBuZXcgUGFyYW1ldGVyRW1haWxTdWJzY3JpYmVyKHRoaXMsIFwiTmVwdHVuZUVtYWlsU3Vic2NyaWJlclwiLCB7XG4gICAgICB0b3BpY0FybjogbmVwdHVuZVN0YXR1c1RvcGljLnRvcGljQXJuLFxuICAgICAgcGFyYW1ldGVyTmFtZTogXCIvZ2xvYmFsLWFwcC1wYXJhbXMvcmRzbm90aWZpY2F0aW9uZW1haWxzXCIsXG4gICAgfSk7XG5cbiAgICAvLyBSRFMgRXZlbnQgU3Vic2NyaXB0aW9uOiBub3RpZnkgb24gY2x1c3RlciBmYWlsb3ZlciwgbWFpbnRlbmFuY2UsIGFuZCBub3RpZmljYXRpb24gZXZlbnRzXG4gICAgbmV3IGF3c19yZHMuQ2ZuRXZlbnRTdWJzY3JpcHRpb24odGhpcywgXCJOZXB0dW5lRXZlbnRTdWJzY3JpcHRpb25cIiwge1xuICAgICAgc25zVG9waWNBcm46IG5lcHR1bmVTdGF0dXNUb3BpYy50b3BpY0FybixcbiAgICAgIHNvdXJjZVR5cGU6IFwiZGItY2x1c3RlclwiLFxuICAgICAgc291cmNlSWRzOiBbdGhpcy5jbHVzdGVyLmNsdXN0ZXJJZGVudGlmaWVyXSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBldmVudENhdGVnb3JpZXM6IFtcImZhaWxvdmVyXCIsIFwiZmFpbHVyZVwiLCBcIm1haW50ZW5hbmNlXCIsIFwibm90aWZpY2F0aW9uXCJdLFxuICAgIH0pO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBFQzIgSW5zdGFuY2UgU3RhdGUtQ2hhbmdlIEVtYWlsIE5vdGlmaWNhdGlvbnNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGVjMlN0YXR1c0tleSA9IG5ldyBhd3Nfa21zLktleSh0aGlzLCBcIkVDMlN0YXR1c1RvcGljS2V5XCIsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBcIktNUyBrZXkgZm9yIEVDMiBzdGF0dXMgU05TIHRvcGljIGVuY3J5cHRpb25cIixcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZWMyU3RhdHVzVG9waWMgPSBuZXcgYXdzX3Nucy5Ub3BpYyh0aGlzLCBcIkVDMlN0YXR1c1RvcGljXCIsIHtcbiAgICAgIGRpc3BsYXlOYW1lOiBcIkVDMiBJbnN0YW5jZSBTdGF0ZS1DaGFuZ2UgTm90aWZpY2F0aW9uc1wiLFxuICAgICAgbWFzdGVyS2V5OiBlYzJTdGF0dXNLZXksXG4gICAgfSk7XG5cbiAgICAvLyBFbmZvcmNlIFNTTC1vbmx5IGFjY2VzcyB0byB0aGUgdG9waWMgKEF3c1NvbHV0aW9ucy1TTlMzKVxuICAgIGVjMlN0YXR1c1RvcGljLmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6IFwiQWxsb3dQdWJsaXNoVGhyb3VnaFNTTE9ubHlcIixcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGF3c19pYW0uQW55UHJpbmNpcGFsKCldLFxuICAgICAgICBhY3Rpb25zOiBbXCJzbnM6UHVibGlzaFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbZWMyU3RhdHVzVG9waWMudG9waWNBcm5dLFxuICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgQm9vbDogeyBcImF3czpTZWN1cmVUcmFuc3BvcnRcIjogXCJmYWxzZVwiIH0sXG4gICAgICAgIH0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBBbGxvdyBFdmVudEJyaWRnZSB0byBwdWJsaXNoIHRvIHRoZSBlbmNyeXB0ZWQgdG9waWNcbiAgICBlYzJTdGF0dXNUb3BpYy5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiBcIkFsbG93RXZlbnRCcmlkZ2VQdWJsaXNoXCIsXG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFtuZXcgYXdzX2lhbS5TZXJ2aWNlUHJpbmNpcGFsKFwiZXZlbnRzLmFtYXpvbmF3cy5jb21cIildLFxuICAgICAgICBhY3Rpb25zOiBbXCJzbnM6UHVibGlzaFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbZWMyU3RhdHVzVG9waWMudG9waWNBcm5dLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgZWMyU3RhdHVzS2V5LmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6IFwiQWxsb3dFdmVudEJyaWRnZVVzZUtleVwiLFxuICAgICAgICBlZmZlY3Q6IGF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcImV2ZW50cy5hbWF6b25hd3MuY29tXCIpXSxcbiAgICAgICAgYWN0aW9uczogW1wia21zOkRlY3J5cHRcIiwgXCJrbXM6R2VuZXJhdGVEYXRhS2V5KlwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXCIqXCJdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gU3Vic2NyaWJlIHRoZSBzYW1lIGVtYWlsIGFkZHJlc3NlcyBmcm9tIFBhcmFtZXRlciBTdG9yZVxuICAgIG5ldyBQYXJhbWV0ZXJFbWFpbFN1YnNjcmliZXIodGhpcywgXCJFQzJFbWFpbFN1YnNjcmliZXJcIiwge1xuICAgICAgdG9waWNBcm46IGVjMlN0YXR1c1RvcGljLnRvcGljQXJuLFxuICAgICAgcGFyYW1ldGVyTmFtZTogXCIvZ2xvYmFsLWFwcC1wYXJhbXMvcmRzbm90aWZpY2F0aW9uZW1haWxzXCIsXG4gICAgfSk7XG5cbiAgICAvLyBFdmVudEJyaWRnZSBydWxlOiBFQzIgaW5zdGFuY2Ugc3RhdGUtY2hhbmdlIChzdGFydGVkIC8gc3RvcHBlZClcbiAgICBuZXcgYXdzX2V2ZW50cy5SdWxlKHRoaXMsIFwiRUMySW5zdGFuY2VTdGF0ZUNoYW5nZVJ1bGVcIiwge1xuICAgICAgcnVsZU5hbWU6IFwiZWMyLWluc3RhbmNlLXN0YXRlLWNoYW5nZS1ub3RpZmljYXRpb25zXCIsXG4gICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgXCJTZW5kIGVtYWlsIHdoZW4gYW55IEVDMiBpbnN0YW5jZSBpbiB1cy1lYXN0LTEgaXMgc3RhcnRlZCBvciBzdG9wcGVkXCIsXG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbXCJhd3MuZWMyXCJdLFxuICAgICAgICBkZXRhaWxUeXBlOiBbXCJFQzIgSW5zdGFuY2UgU3RhdGUtY2hhbmdlIE5vdGlmaWNhdGlvblwiXSxcbiAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgc3RhdGU6IFtcInJ1bm5pbmdcIiwgXCJzdG9wcGVkXCJdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHRhcmdldHM6IFtcbiAgICAgICAgbmV3IGF3c19ldmVudHNfdGFyZ2V0cy5TbnNUb3BpYyhlYzJTdGF0dXNUb3BpYywge1xuICAgICAgICAgIG1lc3NhZ2U6IGF3c19ldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21UZXh0KFxuICAgICAgICAgICAgYEVDMiBJbnN0YW5jZSBTdGF0ZSBDaGFuZ2Ug4oCUIEluc3RhbmNlICR7XG4gICAgICAgICAgICAgIGF3c19ldmVudHMuRXZlbnRGaWVsZC5mcm9tUGF0aChcIiQuZGV0YWlsLmluc3RhbmNlLWlkXCIpXG4gICAgICAgICAgICB9IGlzIG5vdyAke1xuICAgICAgICAgICAgICBhd3NfZXZlbnRzLkV2ZW50RmllbGQuZnJvbVBhdGgoXCIkLmRldGFpbC5zdGF0ZVwiKVxuICAgICAgICAgICAgfSAoQWNjb3VudDogJHtcbiAgICAgICAgICAgICAgYXdzX2V2ZW50cy5FdmVudEZpZWxkLmZyb21QYXRoKFwiJC5hY2NvdW50XCIpXG4gICAgICAgICAgICB9LCBSZWdpb246ICR7XG4gICAgICAgICAgICAgIGF3c19ldmVudHMuRXZlbnRGaWVsZC5mcm9tUGF0aChcIiQucmVnaW9uXCIpXG4gICAgICAgICAgICB9KWBcbiAgICAgICAgICApLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIGNkay1uYWcgc3RhY2stbGV2ZWwgc3VwcHJlc3Npb25zXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNFwiLFxuICAgICAgICByZWFzb246XG4gICAgICAgICAgXCJBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgcmVxdWlyZWQgZm9yIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3MgLSBDREsgbWFuYWdlZCByZXNvdXJjZVwiLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICBcIlBvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgIHJlYXNvbjogXCJXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgQ0RLIG1hbmFnZWQgcmVzb3VyY2VzXCIsXG4gICAgICAgIGFwcGxpZXNUbzogW1wiUmVzb3VyY2U6OipcIl0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtTDFcIixcbiAgICAgICAgcmVhc29uOiBcIk5PREVKU18yMl9YIGlzIHRoZSBsYXRlc3Qgc3VwcG9ydGVkIHJ1bnRpbWUgYXQgZGVwbG95IHRpbWUgLSBDREsgbWFuYWdlZCByZXNvdXJjZVwiLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19