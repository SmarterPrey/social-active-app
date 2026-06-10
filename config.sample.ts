import { RemovalPolicy } from "aws-cdk-lib";

export type StageConfig = {
  appName: string;
  stage: string;
  region: string;
  domainName: string;
  /** Public sign-in URL for the web app. Used in the Cognito invitation email. */
  appUrl: string;
  /**
   * Email sender config. Cognito sends the invitation email from this
   * address via SES using the verified identity created in DnsStack.
   */
  email: {
    fromAddress: string;
    fromName: string;
    replyTo: string;
  };
  adminEmail: string;
  allowedIps: string[];
  /** SSM parameter name storing the WAF WebACL ID — must be unique per stage. */
  wafParamName: string;
  webBucketsRemovalPolicy: RemovalPolicy;
  s3Uri: { edge: string; vertex: string };
};

const appName = "socialActiveApp";

const stageConfigs: Record<string, StageConfig> = {
  dev: {
    appName,
    stage: "dev",
    region: "us-east-1",
    domainName: "example.com",
    appUrl: "https://app.example.com",
    email: {
      fromAddress: "no-reply@example.com",
      fromName: "Mucker",
      replyTo: "info@example.com",
    },
    adminEmail: "your_email@example.com",
    allowedIps: [],
    wafParamName: "dev-mucker-WafWebACLID",
    webBucketsRemovalPolicy: RemovalPolicy.DESTROY,
    s3Uri: { edge: "EDGE_S3_URI", vertex: "VERTEX_S3_URI" },
  },
  qa: {
    appName,
    stage: "qa",
    region: "us-east-1",
    domainName: "example.com",
    appUrl: "https://qa.example.com",
    email: {
      fromAddress: "no-reply@example.com",
      fromName: "Mucker",
      replyTo: "info@example.com",
    },
    adminEmail: "your_email@example.com",
    allowedIps: [],
    wafParamName: "qa-mucker-WafWebACLID",
    webBucketsRemovalPolicy: RemovalPolicy.DESTROY,
    s3Uri: { edge: "EDGE_S3_URI", vertex: "VERTEX_S3_URI" },
  },
  prod: {
    appName,
    stage: "prod",
    region: "us-east-1",
    domainName: "example.com",
    appUrl: "https://app.example.com",
    email: {
      fromAddress: "no-reply@example.com",
      fromName: "Mucker",
      replyTo: "info@example.com",
    },
    adminEmail: "your_email@example.com",
    allowedIps: [],
    wafParamName: "pr-mucker-WafWebACLID",
    webBucketsRemovalPolicy: RemovalPolicy.RETAIN,
    s3Uri: { edge: "EDGE_S3_URI", vertex: "VERTEX_S3_URI" },
  },
};

export function getConfig(stage: string): StageConfig {
  const config = stageConfigs[stage];
  if (!config) {
    throw new Error(
      `Unknown stage "${stage}". Valid stages: ${Object.keys(stageConfigs).join(", ")}`
    );
  }
  return config;
}

/** Stage prefix used in resource/stack names: dev→dev, qa→qa, prod→pr */
export const stagePrefixMap: Record<string, string> = {
  dev: "dev",
  qa: "qa",
  prod: "pr",
};

// Default export kept for backward compatibility (resolves to dev)
export const deployConfig: StageConfig = stageConfigs["dev"];
