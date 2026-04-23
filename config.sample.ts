import { RemovalPolicy } from "aws-cdk-lib";

/* Base config */
const stage = "dev";
const baseConfig = {
  appName: "socialActiveApp",
  region: "us-east-1",
  domainName: "example.com",
  /** Public sign-in URL for the web app. Used in the Cognito invitation email. */
  appUrl: "https://app.example.com",
  /**
   * Email sender config. Cognito sends the invitation email from this
   * address via SES using the verified identity created in DnsStack.
   */
  email: {
    fromAddress: "no-reply@example.com",
    fromName: "Mucker",
    replyTo: "info@example.com",
  },
  adminEmail: "your_email@example.com",
  allowedIps: [],
  wafParamName: "socialActiveAppWafWebACLID",
  webBucketsRemovalPolicy: RemovalPolicy.DESTROY,
  s3Uri: {
    edge: "EDGE_S3_URI",
    vertex: "VERTEX_S3_URI",
  },
};

const deployConfig = { ...baseConfig, stage };

export { deployConfig };
