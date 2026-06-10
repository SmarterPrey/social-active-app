import {
  Duration,
  RemovalPolicy,
  aws_s3,
  aws_kms,
  aws_iam,
  aws_cloudfront,
  aws_cloudfront_origins,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface MediaProps {
  /** Remove bucket + KMS key on stack destroy? (dev only) */
  removalPolicy?: RemovalPolicy;
  autoDeleteObjects?: boolean;
}

/**
 * KMS-encrypted S3 bucket for member/event media (event videos, vendor logos,
 * profile photos) fronted by CloudFront with Origin Access Control.
 *
 * The backend Lambda writes directly via presigned PUT URLs; members read via
 * the CloudFront domain.
 */
export class Media extends Construct {
  public readonly bucket: aws_s3.Bucket;
  public readonly key: aws_kms.Key;
  public readonly distribution: aws_cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MediaProps = {}) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;
    const autoDeleteObjects = props.autoDeleteObjects ?? false;

    this.key = new aws_kms.Key(this, "key", {
      enableKeyRotation: true,
      removalPolicy,
      description: "Social Active App media bucket CMK",
    });

    const accessLogs = new aws_s3.Bucket(this, "accessLogs", {
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      encryption: aws_s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      // CloudFront standard logging writes via the awslogsdelivery canonical
      // user and requires ACLs. S3's modern default (BUCKET_OWNER_ENFORCED)
      // disables ACLs, so we opt into BUCKET_OWNER_PREFERRED here.
      objectOwnership: aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy,
      autoDeleteObjects,
    });

    this.bucket = new aws_s3.Bucket(this, "bucket", {
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      encryption: aws_s3.BucketEncryption.KMS,
      encryptionKey: this.key,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: "s3/",
      removalPolicy,
      autoDeleteObjects,
      cors: [
        {
          allowedMethods: [
            aws_s3.HttpMethods.PUT,
            aws_s3.HttpMethods.GET,
            aws_s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(3),
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    this.distribution = new aws_cloudfront.Distribution(this, "cf", {
      minimumProtocolVersion:
        aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableLogging: true,
      logBucket: accessLogs,
      logFilePrefix: "cf/",
      defaultBehavior: {
        origin:
          aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
            this.bucket,
          ),
        viewerProtocolPolicy:
          aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      },
    });

    // CloudFront OAC needs decrypt on the key.
    this.key.grantDecrypt(
      new aws_iam.ServicePrincipal("cloudfront.amazonaws.com"),
    );

    new CfnOutput(this, "MediaBucketName", { value: this.bucket.bucketName });
    new CfnOutput(this, "MediaDomain", {
      value: this.distribution.distributionDomainName,
    });

    NagSuppressions.addResourceSuppressions(
      this.distribution,
      [
        {
          id: "AwsSolutions-CFR1",
          reason: "Geo-restrictions enforced by app-level auth.",
        },
        {
          id: "AwsSolutions-CFR2",
          reason: "WAF attached at app edge distribution, not this origin.",
        },
        {
          id: "AwsSolutions-CFR4",
          reason: "Default CloudFront cert — domain wiring handled by DnsStack.",
        },
      ],
      true,
    );
  }
}
