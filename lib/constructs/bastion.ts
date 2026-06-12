import {
  Duration,
  Stack,
  StackProps,
  aws_ec2,
  aws_iam,
  aws_lambda,
  aws_lambda_nodejs,
  aws_scheduler,
  aws_ssm,
} from "aws-cdk-lib";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";
import * as path from "node:path";

interface BastionProps extends StackProps {
  vpc: aws_ec2.Vpc;
  cluster: neptune.DatabaseCluster;
  /** IANA timezone for the auto-stop schedule (default: America/Los_Angeles) */
  timezone?: string;
  /** Cron hour (0-23) to stop the bastion (default: 0 = midnight) */
  stopHour?: number;
}

export class Bastion extends Construct {
  public readonly instance: aws_ec2.BastionHostLinux;

  constructor(scope: Construct, id: string, props: BastionProps) {
    super(scope, id);

    const { vpc, cluster, timezone = "America/Los_Angeles", stopHour = 0 } =
      props;

    // -----------------------------------------------------------------------
    // Bastion Host in a public subnet, accessible via SSM (no SSH keys)
    // -----------------------------------------------------------------------
    this.instance = new aws_ec2.BastionHostLinux(this, "bastion-host", {
      vpc,
      subnetSelection: { subnetType: aws_ec2.SubnetType.PUBLIC },
      instanceType: aws_ec2.InstanceType.of(
        aws_ec2.InstanceClass.T3,
        aws_ec2.InstanceSize.SMALL
      ),
    });

    // Install Docker and run Graph Explorer on every boot (HTTP only — HTTPS cert
    // is generated for the EC2 hostname and breaks SSM port-forward tunnels to localhost)
    this.instance.instance.addUserData(
      "yum update -y",
      "yum install -y docker",
      "systemctl enable docker",
      "systemctl start docker",
      "docker pull public.ecr.aws/neptune/graph-explorer",
      "docker run -d -p 80:80 --restart unless-stopped --name graph-explorer --env PROXY_SERVER_HTTPS_CONNECTION=false --env GRAPH_EXP_HTTPS_CONNECTION=false public.ecr.aws/neptune/graph-explorer"
    );

    // Allow the bastion to reach Neptune on port 8182
    cluster.connections.allowDefaultPortFrom(this.instance);

    // Grant bastion IAM auth access to Neptune (required for Graph Explorer proxy)
    this.instance.role.addToPrincipalPolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: [
          "neptune-db:ReadDataViaQuery",
          "neptune-db:WriteDataViaQuery",
          "neptune-db:DeleteDataViaQuery",
          "neptune-db:connect",
        ],
        resources: [
          `arn:aws:neptune-db:${Stack.of(this).region}:${Stack.of(this).account}:${cluster.clusterResourceIdentifier}/*`,
        ],
      })
    );

    // -----------------------------------------------------------------------
    // Store bastion config in SSM so the monitoring UI can recreate the instance
    // -----------------------------------------------------------------------
    const cfnInstanceProfile = this.instance.instance.node.findChild("InstanceProfile") as aws_iam.CfnInstanceProfile;
    const bastionSg = this.instance.connections.securityGroups[0];

    new aws_ssm.StringParameter(this, "bastion-instance-id-param", {
      parameterName: "/socialActiveApp/bastion/instance-id",
      stringValue: this.instance.instanceId,
      description: "Current bastion host EC2 instance ID",
    });
    new aws_ssm.StringParameter(this, "bastion-subnet-id-param", {
      parameterName: "/socialActiveApp/bastion/subnet-id",
      stringValue: vpc.publicSubnets[0].subnetId,
      description: "Public subnet for bastion host recreation",
    });
    new aws_ssm.StringParameter(this, "bastion-sg-id-param", {
      parameterName: "/socialActiveApp/bastion/security-group-id",
      stringValue: bastionSg.securityGroupId,
      description: "Security group for bastion host (allows Neptune access)",
    });
    new aws_ssm.StringParameter(this, "bastion-profile-name-param", {
      parameterName: "/socialActiveApp/bastion/instance-profile-name",
      stringValue: cfnInstanceProfile.ref,
      description: "IAM instance profile name for SSM-managed bastion",
    });

    // -----------------------------------------------------------------------
    // Lambda that stops the bastion instance
    // -----------------------------------------------------------------------
    const stopFn = new aws_lambda_nodejs.NodejsFunction(
      this,
      "bastion-stop-fn",
      {
        runtime: aws_lambda.Runtime.NODEJS_22_X,
        tracing: aws_lambda.Tracing.ACTIVE,
        entry: path.join(
          __dirname,
          "..",
          "..",
          "api",
          "lambda",
          "bastionScheduler",
          "index.ts"
        ),
        depsLockFilePath: path.join(
          __dirname,
          "..",
          "..",
          "api",
          "lambda",
          "package-lock.json"
        ),
        handler: "handler",
        timeout: Duration.seconds(30),
        environment: {
          INSTANCE_ID: this.instance.instanceId,
        },
        bundling: {
          externalModules: ["@aws-sdk/*"],
          minify: true,
          sourceMap: true,
        },
      }
    );

    stopFn.addToRolePolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: ["ec2:StopInstances", "ec2:DescribeInstances"],
        resources: [
          Stack.of(this).formatArn({
            service: "ec2",
            resource: "instance",
            resourceName: this.instance.instanceId,
          }),
        ],
      })
    );

    // -----------------------------------------------------------------------
    // EventBridge Scheduler role
    // -----------------------------------------------------------------------
    const schedulerRole = new aws_iam.Role(this, "bastion-scheduler-role", {
      assumedBy: new aws_iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    stopFn.grantInvoke(schedulerRole);

    // -----------------------------------------------------------------------
    // Schedule: stop bastion daily at the configured hour
    // -----------------------------------------------------------------------
    new aws_scheduler.CfnSchedule(this, "bastion-stop-schedule", {
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
    NagSuppressions.addResourceSuppressions(
      this.instance,
      [
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
          reason:
            "SSM managed policies are required for Session Manager access on the bastion host",
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard permissions are required by SSM managed policies on the bastion host",
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      stopFn,
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
        {
          id: "AwsSolutions-L1",
          reason: "NODEJS_22_X is the latest supported runtime at deploy time",
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      schedulerRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Wildcard on Lambda ARN version is required by grantInvoke for EventBridge Scheduler",
        },
      ],
      true
    );
  }
}
