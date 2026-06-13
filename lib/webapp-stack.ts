import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { Web } from "./constructs/web";
import { RemovalPolicy, Stack } from "aws-cdk-lib";

interface WebappStackProps extends cdk.StackProps {
  wafParamName: string;
  webBucketsRemovalPolicy?: RemovalPolicy;
  /** Custom domain names to attach to the CloudFront distribution. */
  webDomainNames?: string[];
  /** Route 53 hosted zone name (e.g. "mucker.io"). Required if webDomainNames is non-empty. */
  hostedZoneName?: string;
}

export class WebappStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebappStackProps) {
    super(scope, id, props);

    const web = new Web(this, "webapp", {
      webappPath: "./app/web",
      webappDistFolder: "dist",
      wafParamName: props.wafParamName,
      region: Stack.of(this).region,
      domainNames: props.webDomainNames,
      hostedZoneName: props.hostedZoneName,
      webBucketProps: {
        removalPolicy: props.webBucketsRemovalPolicy
          ? props.webBucketsRemovalPolicy
          : RemovalPolicy.RETAIN,
        autoDeleteObjects:
          props.webBucketsRemovalPolicy === RemovalPolicy.DESTROY
            ? true
            : false,
      },
    });
  }
}
