import { Stack, StackProps, aws_ec2, aws_events, aws_events_targets, aws_iam, aws_kms, aws_sns, aws_rds } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { NagSuppressions } from "cdk-nag";
import { Network } from "./constructs/network";
import { Neptune } from "./constructs/neptune";
import { NeptuneScheduler } from "./constructs/neptune-scheduler";
import { Bastion } from "./constructs/bastion";
import { ParameterEmailSubscriber } from "./constructs/parameter-email-subscriber";

interface NeptuneScheduleConfig {
  /** Enable scheduled stop/start of Neptune (default: false) */
  enabled: boolean;
  /** IANA timezone (default: America/Los_Angeles) */
  timezone?: string;
  /** Hour to stop the cluster (default: 0 = midnight) */
  stopHour?: number;
}

interface NeptuneNetworkStackProps extends StackProps {
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

export class NeptuneNetworkStack extends Stack {
  public readonly vpc: aws_ec2.Vpc;
  public readonly cluster: neptune.DatabaseCluster;
  public readonly neptuneRole: aws_iam.Role;
  constructor(scope: Construct, id: string, props: NeptuneNetworkStackProps) {
    super(scope, id, props);

    const {
      natSubnet,
      maxAz,
      neptuneServerlss,
      neptuneServerlssCapacity,
      neptuneSchedule,
      bastion: bastionConfig,
    } = props;

    const network = new Network(this, "network", {
      natSubnet,
      maxAz,
    });
    this.vpc = network.vpc;

    const neptune = new Neptune(this, "neptune", {
      vpc: network.vpc,
      neptuneServerlss,
      neptuneServerlssCapacity,
    });

    this.cluster = neptune.cluster;
    this.neptuneRole = neptune.neptuneRole;

    // Bastion host for remote Neptune access via SSM
    if (bastionConfig?.enabled) {
      new Bastion(this, "bastion", {
        vpc: this.vpc,
        cluster: this.cluster,
        timezone: bastionConfig.timezone,
        stopHour: bastionConfig.stopHour,
      });
    }

    // Schedule Neptune stop/start to save costs during off-hours
    if (neptuneSchedule?.enabled) {
      new NeptuneScheduler(this, "neptune-scheduler", {
        cluster: this.cluster,
        timezone: neptuneSchedule.timezone,
        stopHour: neptuneSchedule.stopHour,
      });
    }

    // SNS topic for Neptune cluster state change notifications
    const neptuneStatusKey = new aws_kms.Key(this, "NeptuneStatusTopicKey", {
      description: "KMS key for Neptune status SNS topic encryption",
      enableKeyRotation: true,
    });

    const neptuneStatusTopic = new aws_sns.Topic(this, "NeptuneStatusTopic", {
      displayName: "Neptune Cluster Status Notifications",
      masterKey: neptuneStatusKey,
    });

    // Enforce SSL-only access to the topic (AwsSolutions-SNS3)
    neptuneStatusTopic.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowPublishThroughSSLOnly",
        effect: aws_iam.Effect.DENY,
        principals: [new aws_iam.AnyPrincipal()],
        actions: ["sns:Publish"],
        resources: [neptuneStatusTopic.topicArn],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
      })
    );

    // Allow RDS/Neptune to publish to this encrypted topic
    neptuneStatusTopic.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowRDSPublish",
        effect: aws_iam.Effect.ALLOW,
        principals: [new aws_iam.ServicePrincipal("events.rds.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [neptuneStatusTopic.topicArn],
      })
    );

    neptuneStatusKey.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowRDSUseKey",
        effect: aws_iam.Effect.ALLOW,
        principals: [new aws_iam.ServicePrincipal("events.rds.amazonaws.com")],
        actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
        resources: ["*"],
      })
    );

    // Subscribe email addresses from Parameter Store
    new ParameterEmailSubscriber(this, "NeptuneEmailSubscriber", {
      topicArn: neptuneStatusTopic.topicArn,
      parameterName: "/global-app-params/rdsnotificationemails",
    });

    // RDS Event Subscription: notify on cluster failover, maintenance, and notification events
    new aws_rds.CfnEventSubscription(this, "NeptuneEventSubscription", {
      snsTopicArn: neptuneStatusTopic.topicArn,
      sourceType: "db-cluster",
      sourceIds: [this.cluster.clusterIdentifier],
      enabled: true,
      eventCategories: ["failover", "failure", "maintenance", "notification"],
    });

    // -----------------------------------------------------------------------
    // EC2 Instance State-Change Email Notifications
    // -----------------------------------------------------------------------
    const ec2StatusKey = new aws_kms.Key(this, "EC2StatusTopicKey", {
      description: "KMS key for EC2 status SNS topic encryption",
      enableKeyRotation: true,
    });

    const ec2StatusTopic = new aws_sns.Topic(this, "EC2StatusTopic", {
      displayName: "EC2 Instance State-Change Notifications",
      masterKey: ec2StatusKey,
    });

    // Enforce SSL-only access to the topic (AwsSolutions-SNS3)
    ec2StatusTopic.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowPublishThroughSSLOnly",
        effect: aws_iam.Effect.DENY,
        principals: [new aws_iam.AnyPrincipal()],
        actions: ["sns:Publish"],
        resources: [ec2StatusTopic.topicArn],
        conditions: {
          Bool: { "aws:SecureTransport": "false" },
        },
      })
    );

    // Allow EventBridge to publish to the encrypted topic
    ec2StatusTopic.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowEventBridgePublish",
        effect: aws_iam.Effect.ALLOW,
        principals: [new aws_iam.ServicePrincipal("events.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [ec2StatusTopic.topicArn],
      })
    );

    ec2StatusKey.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowEventBridgeUseKey",
        effect: aws_iam.Effect.ALLOW,
        principals: [new aws_iam.ServicePrincipal("events.amazonaws.com")],
        actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
        resources: ["*"],
      })
    );

    // Subscribe the same email addresses from Parameter Store
    new ParameterEmailSubscriber(this, "EC2EmailSubscriber", {
      topicArn: ec2StatusTopic.topicArn,
      parameterName: "/global-app-params/rdsnotificationemails",
    });

    // EventBridge rule: EC2 instance state-change (started / stopped)
    new aws_events.Rule(this, "EC2InstanceStateChangeRule", {
      ruleName: "ec2-instance-state-change-notifications",
      description:
        "Send email when any EC2 instance in us-east-1 is started or stopped",
      eventPattern: {
        source: ["aws.ec2"],
        detailType: ["EC2 Instance State-change Notification"],
        detail: {
          state: ["running", "stopped"],
        },
      },
      targets: [
        new aws_events_targets.SnsTopic(ec2StatusTopic, {
          message: aws_events.RuleTargetInput.fromText(
            `EC2 Instance State Change — Instance ${
              aws_events.EventField.fromPath("$.detail.instance-id")
            } is now ${
              aws_events.EventField.fromPath("$.detail.state")
            } (Account: ${
              aws_events.EventField.fromPath("$.account")
            }, Region: ${
              aws_events.EventField.fromPath("$.region")
            })`
          ),
        }),
      ],
    });

    // -----------------------------------------------------------------------
    // cdk-nag stack-level suppressions
    // -----------------------------------------------------------------------
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access - CDK managed resource",
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
