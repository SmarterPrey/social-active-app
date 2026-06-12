#!/usr/bin/env node
import "source-map-support/register";
import * as dotenv from "dotenv";
// Load root .env so per-stage account IDs (DEV_ACCOUNT_ID, etc.) are
// available to getConfig() before any stack is constructed.
dotenv.config();
import * as cdk from "aws-cdk-lib";
import { NeptuneNetworkStack } from "../lib/neptune-network-stack";
import { ApiStack } from "../lib/api-stack";
import { WafCloudFrontStack } from "../lib/waf-stack";
import { ObservabilityStack } from "../lib/observability-stack";
import { AwsSolutionsChecks, NagSuppressions } from "cdk-nag";

import { getConfig, stagePrefixMap } from "../config";
import { NagLogger } from "../nag/NagLogger";

const app = new cdk.App();
const logger = new NagLogger();

cdk.Aspects.of(app).add(
  new AwsSolutionsChecks({ verbose: true, additionalLoggers: [logger] })
);

const stage = app.node.tryGetContext("stage") ?? "dev";
if (!stagePrefixMap[stage]) {
  throw new Error(`Invalid stage "${stage}". Valid stages: ${Object.keys(stagePrefixMap).join(", ")}`);
}
const stagePrefix = stagePrefixMap[stage]; // dev→dev, qa→qa, prod→pr
const config = getConfig(stage);

/** Stack/resource name prefix: dev-mucker, qa-mucker, pr-mucker */
const appName = `${stagePrefix}-${config.appName.toLowerCase()}`;
const env = {
  account:
    config.account ||
    process.env.CDK_DEFAULT_ACCOUNT ||
    process.env.AWS_ACCOUNT_ID,
  region: config.region || process.env.CDK_DEFAULT_REGION,
};
const neptuneNetwork = new NeptuneNetworkStack(
  app,
  `${appName}-NeptuneNetworkStack`,
  {
    appName,
    natSubnet: false,
    maxAz: 2,
    neptuneServerlss: true,
    neptuneServerlssCapacity: {
      minCapacity: 1,
      maxCapacity: 4.5,
    },
    // Stop Neptune at midnight Pacific to save costs
    neptuneSchedule: {
      enabled: true,
      timezone: "America/Los_Angeles",
      stopHour: 0,   // midnight Pacific — cluster stops
    },
    // Bastion host for remote Neptune access via SSM
    bastion: {
      enabled: true,
      timezone: "America/Los_Angeles",
      stopHour: 0,  // midnight Pacific — bastion stops
    },
    env,
  }
);

// SES identity ARN is deterministic — the shared mucker-DnsStack
// (bin/dns.ts) creates this identity once for all stages.
const sesIdentityArn = `arn:aws:ses:${env.region}:${env.account}:identity/${config.domainName}`;

const apiStack = new ApiStack(app, `${appName}-ApiStack`, {
  cognito: {
    adminEmail: config.adminEmail,
    appSignInUrl: `${config.appUrl}/signin`,
    ses: {
      sourceArn: sesIdentityArn,
      fromAddress: config.email.fromAddress,
      fromName: config.email.fromName,
      replyToEmailAddress: config.email.replyTo,
    },
  },
  vpc: neptuneNetwork.vpc,
  cluster: neptuneNetwork.cluster,
  clusterRole: neptuneNetwork.neptuneRole,
  graphqlFieldName: ["getGraph", "getProfile", "getRelationName", "insertData", "askGraph", "searchEntities", "getEntityProperties", "getEntityEdges", "searchProjects", "getProjectAccounts", "addProjectAccount", "deleteProjectAccount", "inviteMember"],
  s3Uri: config.s3Uri,
  env,
});

new WafCloudFrontStack(app, `${appName}-WafStack`, {
  allowedIps: config.allowedIps,
  wafParamName: config.wafParamName,
  env: {
    ...env,
    region: "us-east-1",
  },
});

// ── Observability: Dashboard, Alarms, and Cognito read-only policies ──
const observability = new ObservabilityStack(app, `${appName}-ObservabilityStack`, {
  neptuneClusterId: neptuneNetwork.cluster.clusterIdentifier,
  cloudFrontDistributionId: "PLACEHOLDER", // Resolved at deploy via SSM or manual update
  wafWebAclName: config.wafParamName,
  appSyncApiId: apiStack.graphqlApiId,
  lambdaFunctions: apiStack.lambdaFunctionNames,
  userPoolId: apiStack.cognito.cognitoParams.userPoolId,
  env,
});

// Grant the Cognito authenticated role read-only access for the monitoring UI
const authRole = apiStack.cognito.authenticatedRole;
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringCloudWatchReadOnly",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricWidgetImage",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:GetDashboard",
      "cloudwatch:ListDashboards",
      "cloudwatch:ListMetrics",
    ],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringEC2ReadOnly",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceStatus",
    ],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringEC2StartStop",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "ec2:StartInstances",
      "ec2:StopInstances",
    ],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringNeptuneReadOnly",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "rds:DescribeDBClusters",
      "rds:DescribeDBInstances",
    ],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringNeptuneStartStop",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "rds:StartDBCluster",
      "rds:StopDBCluster",
    ],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringAppSyncReadOnly",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: ["appsync:GetGraphqlApi"],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringLambdaReadOnly",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: ["lambda:GetFunction", "lambda:ListFunctions"],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringXRayReadOnly",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "xray:GetTraceSummaries",
      "xray:BatchGetTraces",
      "xray:GetServiceGraph",
    ],
    resources: ["*"],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringSSMBastionParams",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: ["ssm:GetParameter", "ssm:PutParameter"],
    resources: [`arn:aws:ssm:${env.region}:${env.account}:parameter/${appName}/bastion/*`],
  })
);
authRole.addToPrincipalPolicy(
  new cdk.aws_iam.PolicyStatement({
    sid: "MonitoringEC2CreateBastion",
    effect: cdk.aws_iam.Effect.ALLOW,
    actions: [
      "ec2:RunInstances",
      "ec2:CreateTags",
      "iam:PassRole",
    ],
    resources: ["*"],
  })
);

// Suppress IAM5 for the SSM bastion parameter path. The wildcard is scoped to
// /${appName}/bastion/* because the bastion instance ID is not known at synth
// time — it is written/read dynamically at runtime.
NagSuppressions.addResourceSuppressions(
  authRole,
  [
    {
      id: "AwsSolutions-IAM5",
      reason:
        "SSM parameter path wildcard is scoped to /${appName}/bastion/* — the bastion instance ID is written at runtime so a fully-qualified ARN cannot be used at synth time.",
      appliesTo: [
        `Resource::arn:aws:ssm:${env.region}:${env.account}:parameter/${appName}/bastion/*`,
      ],
    },
  ],
  true // applyToChildren — targets the DefaultPolicy on the role
);

