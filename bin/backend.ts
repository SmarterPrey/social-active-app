#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NeptuneNetworkStack } from "../lib/neptune-network-stack";
import { ApiStack } from "../lib/api-stack";
import { WafCloudFrontStack } from "../lib/waf-stack";
import { ObservabilityStack } from "../lib/observability-stack";
import { DnsStack } from "../lib/dns-stack";
import { AwsSolutionsChecks } from "cdk-nag";

import { deployConfig } from "../config";
import { NagLogger } from "../nag/NagLogger";

const app = new cdk.App();
const logger = new NagLogger();

cdk.Aspects.of(app).add(
  new AwsSolutionsChecks({ verbose: true, additionalLoggers: [logger] })
);

const appName = deployConfig.appName || "socialActiveApp";
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: deployConfig.region || process.env.CDK_DEFAULT_REGION,
};
const neptuneNetwork = new NeptuneNetworkStack(
  app,
  `${appName}-NeptuneNetworkStack`,
  {
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

// ── DNS + SES identity (must exist before Cognito references it) ───
const dnsStack = new DnsStack(app, `${appName}-DnsStack`, {
  domainName: deployConfig.domainName,
  createSesEmailIdentity: true,
  env,
});

// Deterministic ARN of the SES domain identity created above. Cognito
// references it by ARN, so we also add an explicit stack dependency to
// guarantee the identity exists before the user pool is created/updated.
const sesIdentityArn = `arn:aws:ses:${env.region}:${env.account}:identity/${deployConfig.domainName}`;

const apiStack = new ApiStack(app, `${appName}-ApiStack`, {
  cognito: {
    adminEmail: deployConfig.adminEmail,
    appSignInUrl: `${deployConfig.appUrl}/signin`,
    ses: {
      sourceArn: sesIdentityArn,
      fromAddress: deployConfig.email.fromAddress,
      fromName: deployConfig.email.fromName,
      replyToEmailAddress: deployConfig.email.replyTo,
    },
  },
  vpc: neptuneNetwork.vpc,
  cluster: neptuneNetwork.cluster,
  clusterRole: neptuneNetwork.neptuneRole,
  graphqlFieldName: ["getGraph", "getProfile", "getRelationName", "insertData", "askGraph", "searchEntities", "getEntityProperties", "getEntityEdges", "searchProjects", "getProjectAccounts", "addProjectAccount", "deleteProjectAccount", "inviteMember"],
  s3Uri: deployConfig.s3Uri,
  env,
});
apiStack.addDependency(dnsStack);

new WafCloudFrontStack(app, `${appName}-WafStack`, {
  allowedIps: deployConfig.allowedIps,
  wafParamName: deployConfig.wafParamName,
  env: {
    ...env,
    region: "us-east-1",
  },
});

// ── Observability: Dashboard, Alarms, and Cognito read-only policies ──
const observability = new ObservabilityStack(app, `${appName}-ObservabilityStack`, {
  neptuneClusterId: neptuneNetwork.cluster.clusterIdentifier,
  cloudFrontDistributionId: "PLACEHOLDER", // Resolved at deploy via SSM or manual update
  wafWebAclName: deployConfig.wafParamName,
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
    resources: [`arn:aws:ssm:${env.region}:${env.account}:parameter/socialActiveApp/bastion/*`],
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

// DnsStack is created above so Cognito can reference the SES identity it creates.
