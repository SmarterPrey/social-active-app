#!/usr/bin/env node
/**
 * Shared DNS stack — deployed ONCE per AWS account/region.
 * All stages (dev, qa, prod) share a single Route 53 hosted zone and
 * SES domain identity for mucker.io. Deploy with:
 *
 *   npm run deployDns -- --profile <PROFILE>
 */
import "source-map-support/register";
import * as dotenv from "dotenv";
dotenv.config();
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { DnsStack } from "../lib/dns-stack";

import { deployConfig } from "../config";
import { NagLogger } from "../nag/NagLogger";

const app = new cdk.App();
const logger = new NagLogger();

cdk.Aspects.of(app).add(
  new AwsSolutionsChecks({ verbose: true, additionalLoggers: [logger] })
);

// DnsStack is shared. Account comes from PROD_ACCOUNT_ID by default since
// the hosted zone usually lives in the prod (production-of-record) account.
const env = {
  account:
    process.env.PROD_ACCOUNT_ID ||
    process.env.CDK_DEFAULT_ACCOUNT ||
    process.env.AWS_ACCOUNT_ID,
  region: deployConfig.region || process.env.CDK_DEFAULT_REGION,
};

// Intentionally no stage prefix — this stack is shared across all stages.
new DnsStack(app, "mucker-DnsStack", {
  domainName: deployConfig.domainName,
  createSesEmailIdentity: true,
  env,
});
