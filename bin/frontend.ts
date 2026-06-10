#!/usr/bin/env node
import "source-map-support/register";
import * as dotenv from "dotenv";
dotenv.config();
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { WebappStack } from "../lib/webapp-stack";

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
const stagePrefix = stagePrefixMap[stage];
const config = getConfig(stage);

const appName = `${stagePrefix}-${config.appName.toLowerCase()}`;
const env = {
  account:
    config.account ||
    process.env.CDK_DEFAULT_ACCOUNT ||
    process.env.AWS_ACCOUNT_ID,
  region: config.region || process.env.CDK_DEFAULT_REGION,
};

const web = new WebappStack(app, `${appName}-WebappStack`, {
  wafParamName: config.wafParamName,
  webBucketsRemovalPolicy: config.webBucketsRemovalPolicy,
  env,
});
