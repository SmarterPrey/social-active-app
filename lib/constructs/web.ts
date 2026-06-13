import { Construct } from "constructs";
import {
  RemovalPolicy,
  StackProps,
  aws_s3_deployment,
  aws_cloudfront,
  aws_s3,
  aws_iam,
  aws_cloudfront_origins,
  aws_certificatemanager,
  aws_route53,
  aws_route53_targets,
  DockerImage,
  CfnOutput,
  Stack,
} from "aws-cdk-lib";
import { execSync } from "child_process";
import * as fs from "fs";
import { NagSuppressions } from "cdk-nag";
import { SSMParameterReader } from "./ssm-parameter-reader";

export interface WebProps extends StackProps {
  webappPath: string;
  webappDistFolder: string;
  wafParamName: string;
  region: string;
  /**
   * Custom domain names to serve the webapp on (e.g.
   * `["mucker.io", "www.mucker.io"]`). All names must belong to the
   * Route 53 public hosted zone identified by `hostedZoneName`. Leave
   * empty to serve only on the default `*.cloudfront.net` domain.
   */
  domainNames?: string[];
  /**
   * The Route 53 public hosted zone name (e.g. `mucker.io`). Required
   * when `domainNames` is non-empty so the construct can issue an ACM
   * certificate via DNS validation and create alias records.
   */
  hostedZoneName?: string;
  webBucketProps: {
    removalPolicy: RemovalPolicy;
    autoDeleteObjects: boolean;
  };
}

export class Web extends Construct {
  public readonly distribution: aws_cloudfront.Distribution;
  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);

    const { webappPath, webappDistFolder, wafParamName, region, domainNames, hostedZoneName } = props;

    const webAclIdReader = new SSMParameterReader(this, "WebAclIdReader", {
      parameterName: wafParamName,
      region: "us-east-1",
    });

    // ── Custom domain wiring (optional) ─────────────────────────────
    // If domainNames is provided we look up the existing Route 53
    // hosted zone, issue a DNS-validated ACM certificate covering all
    // of those names, and create A/AAAA alias records pointing each
    // name at the CloudFront distribution. The webapp stack must be
    // deployed in us-east-1 — required for CloudFront-attached ACM
    // certificates.
    let certificate: aws_certificatemanager.ICertificate | undefined;
    let hostedZone: aws_route53.IHostedZone | undefined;
    if (domainNames && domainNames.length > 0) {
      if (!hostedZoneName) {
        throw new Error(
          "Web construct: hostedZoneName is required when domainNames is provided"
        );
      }
      hostedZone = aws_route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: hostedZoneName,
      });
      certificate = new aws_certificatemanager.Certificate(
        this,
        "Certificate",
        {
          domainName: domainNames[0],
          subjectAlternativeNames: domainNames.slice(1),
          validation:
            aws_certificatemanager.CertificateValidation.fromDns(hostedZone),
        }
      );
    }

    // Access logs bucket
    const accessLoggingBucket = new aws_s3.Bucket(
      this,
      "originAccessLoggingBucket",
      {
        blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
        encryption: aws_s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        versioned: false,
        ...props.webBucketProps,
      }
    );

    // Origin bucket
    const origin = new aws_s3.Bucket(this, "origin", {
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      encryption: aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      serverAccessLogsBucket: accessLoggingBucket,
      ...props.webBucketProps,
    });
    const bucketOrigin = aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(origin);

    // Amazon CloudFront
    const cloudFrontWebDistribution = new aws_cloudfront.Distribution(
      this,
      "cloudFront",
      {
        webAclId: webAclIdReader.getParameterValue(),
        ...(domainNames && domainNames.length > 0
          ? { domainNames, certificate }
          : {}),
        minimumProtocolVersion:
          aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        enableLogging: true,
        logBucket: new aws_s3.Bucket(this, "cfLoggingBucket", {
          blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
          encryption: aws_s3.BucketEncryption.S3_MANAGED,
          enforceSSL: true,
          ...props.webBucketProps,
          versioned: false,
          objectOwnership: aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
        }),
        defaultBehavior: {
          origin: bucketOrigin,
          allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: aws_cloudfront.CachedMethods.CACHE_GET_HEAD,
          cachePolicy: aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy:
            aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },

        errorResponses: [
          {
            httpStatus: 403,
            responsePagePath: "/index.html",
            responseHttpStatus: 200,
          },
          {
            httpStatus: 404,
            responsePagePath: "/index.html",
            responseHttpStatus: 200,
          },
        ],
      }
    );

    this.distribution = cloudFrontWebDistribution;

    // Route 53 alias records for each custom domain → CloudFront
    if (hostedZone && domainNames && domainNames.length > 0) {
      const target = aws_route53.RecordTarget.fromAlias(
        new aws_route53_targets.CloudFrontTarget(cloudFrontWebDistribution)
      );
      for (const name of domainNames) {
        // Use the FQDN as the recordName; CDK strips the zone suffix.
        // For the apex (`mucker.io`), recordName resolves to the zone
        // root, which Route 53 represents as an empty/zone-apex record.
        new aws_route53.ARecord(this, `AliasA-${name}`, {
          zone: hostedZone,
          recordName: name,
          target,
          comment: `Webapp alias for ${name}`,
        });
        new aws_route53.AaaaRecord(this, `AliasAAAA-${name}`, {
          zone: hostedZone,
          recordName: name,
          target,
          comment: `Webapp alias for ${name}`,
        });
      }
    }

    const bucketDeploymentRole = new aws_iam.Role(
      this,
      "bucketDeploymentRole",
      {
        assumedBy: new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      }
    );
    bucketDeploymentRole.addToPrincipalPolicy(
      new aws_iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
      })
    );

    // React deployment
    new aws_s3_deployment.BucketDeployment(this, "bucketDeployment", {
      destinationBucket: origin,
      distribution: cloudFrontWebDistribution,
      role: bucketDeploymentRole,
      sources: [
        aws_s3_deployment.Source.asset(webappPath, {
          bundling: {
            image: DockerImage.fromRegistry("node:lts"),
            command: [],
            local: {
              tryBundle(outputDir: string) {
                try {
                  execSync("pnpm --version");
                } catch {
                  return false;
                }
                execSync(`cd ${webappPath} && pnpm i && pnpm run build`);
                fs.cpSync(`${webappPath}/${webappDistFolder}`, outputDir, {
                  recursive: true,
                });
                return true;
              },
            },
          },
        }),
      ],
      memoryLimit: 512,
    });

    // Suppressions
    NagSuppressions.addResourceSuppressions(
      accessLoggingBucket,
      [
        {
          id: "AwsSolutions-S1",
          reason: "This bucket is the access log bucket",
        },
      ],
      true
    );

    // Output
    new CfnOutput(this, "url", {
      value: this.distribution.domainName,
    });
    NagSuppressions.addResourceSuppressions(
      bucketDeploymentRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Given the least privilege to this role based on LambdaExecutionRole",
          appliesTo: ["Resource::*"],
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Automatically created this policy and access to the restricted bucket",
          appliesTo: [
            "Action::s3:GetObject*",
            "Action::s3:List*",
            "Action::s3:GetBucket*",
            "Action::s3:Abort*",
            "Action::s3:DeleteObject*",
          ],
        },
        {
          id: "AwsSolutions-IAM5",
          reason: "Automatically created this policy",
          appliesTo: [
            {
              regex: "/^Resource::(.*)$/g",
            },
          ],
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      this.distribution.stack,
      [
        {
          id: "AwsSolutions-S1",
          reason: "CloudfrontLoggingBucket is the access log bucket",
        },
        {
          id: "AwsSolutions-CFR1",
          reason: "Disable warning",
        },
        {
          id: "AwsSolutions-CFR4",
          reason: "Attached the minimum security policy of TLS_V1_2_2021",
        },
      ],
      true
    );

    NagSuppressions.addStackSuppressions(Stack.of(this), [
      {
        id: "AwsSolutions-L1",
        reason: "CDK managed resource",
      },
      {
        id: "AwsSolutions-IAM4",
        reason: "CDK managed resource",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ],
      },
    ]);
  }
}
