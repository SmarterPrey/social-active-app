"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Web = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const child_process_1 = require("child_process");
const fs = require("fs");
const cdk_nag_1 = require("cdk-nag");
const ssm_parameter_reader_1 = require("./ssm-parameter-reader");
class Web extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { webappPath, webappDistFolder, wafParamName, region, domainNames, hostedZoneName } = props;
        const webAclIdReader = new ssm_parameter_reader_1.SSMParameterReader(this, "WebAclIdReader", {
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
        let certificate;
        let hostedZone;
        if (domainNames && domainNames.length > 0) {
            if (!hostedZoneName) {
                throw new Error("Web construct: hostedZoneName is required when domainNames is provided");
            }
            hostedZone = aws_cdk_lib_1.aws_route53.HostedZone.fromLookup(this, "HostedZone", {
                domainName: hostedZoneName,
            });
            certificate = new aws_cdk_lib_1.aws_certificatemanager.Certificate(this, "Certificate", {
                domainName: domainNames[0],
                subjectAlternativeNames: domainNames.slice(1),
                validation: aws_cdk_lib_1.aws_certificatemanager.CertificateValidation.fromDns(hostedZone),
            });
        }
        // Access logs bucket
        const accessLoggingBucket = new aws_cdk_lib_1.aws_s3.Bucket(this, "originAccessLoggingBucket", {
            blockPublicAccess: aws_cdk_lib_1.aws_s3.BlockPublicAccess.BLOCK_ALL,
            encryption: aws_cdk_lib_1.aws_s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            versioned: false,
            ...props.webBucketProps,
        });
        // Origin bucket
        const origin = new aws_cdk_lib_1.aws_s3.Bucket(this, "origin", {
            blockPublicAccess: aws_cdk_lib_1.aws_s3.BlockPublicAccess.BLOCK_ALL,
            encryption: aws_cdk_lib_1.aws_s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            versioned: false,
            serverAccessLogsBucket: accessLoggingBucket,
            ...props.webBucketProps,
        });
        const bucketOrigin = aws_cdk_lib_1.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(origin);
        // Amazon CloudFront
        const cloudFrontWebDistribution = new aws_cdk_lib_1.aws_cloudfront.Distribution(this, "cloudFront", {
            webAclId: webAclIdReader.getParameterValue(),
            ...(domainNames && domainNames.length > 0
                ? { domainNames, certificate }
                : {}),
            minimumProtocolVersion: aws_cdk_lib_1.aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            enableLogging: true,
            logBucket: new aws_cdk_lib_1.aws_s3.Bucket(this, "cfLoggingBucket", {
                blockPublicAccess: aws_cdk_lib_1.aws_s3.BlockPublicAccess.BLOCK_ALL,
                encryption: aws_cdk_lib_1.aws_s3.BucketEncryption.S3_MANAGED,
                enforceSSL: true,
                ...props.webBucketProps,
                versioned: false,
                objectOwnership: aws_cdk_lib_1.aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
            }),
            defaultBehavior: {
                origin: bucketOrigin,
                allowedMethods: aws_cdk_lib_1.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD,
                cachedMethods: aws_cdk_lib_1.aws_cloudfront.CachedMethods.CACHE_GET_HEAD,
                cachePolicy: aws_cdk_lib_1.aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
                viewerProtocolPolicy: aws_cdk_lib_1.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
        });
        this.distribution = cloudFrontWebDistribution;
        // Route 53 alias records for each custom domain → CloudFront
        if (hostedZone && domainNames && domainNames.length > 0) {
            const target = aws_cdk_lib_1.aws_route53.RecordTarget.fromAlias(new aws_cdk_lib_1.aws_route53_targets.CloudFrontTarget(cloudFrontWebDistribution));
            for (const name of domainNames) {
                // Use the FQDN as the recordName; CDK strips the zone suffix.
                // For the apex (`mucker.io`), recordName resolves to the zone
                // root, which Route 53 represents as an empty/zone-apex record.
                new aws_cdk_lib_1.aws_route53.ARecord(this, `AliasA-${name}`, {
                    zone: hostedZone,
                    recordName: name,
                    target,
                    comment: `Webapp alias for ${name}`,
                });
                new aws_cdk_lib_1.aws_route53.AaaaRecord(this, `AliasAAAA-${name}`, {
                    zone: hostedZone,
                    recordName: name,
                    target,
                    comment: `Webapp alias for ${name}`,
                });
            }
        }
        const bucketDeploymentRole = new aws_cdk_lib_1.aws_iam.Role(this, "bucketDeploymentRole", {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
        });
        bucketDeploymentRole.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            resources: ["*"],
            actions: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
            ],
        }));
        // React deployment
        new aws_cdk_lib_1.aws_s3_deployment.BucketDeployment(this, "bucketDeployment", {
            destinationBucket: origin,
            distribution: cloudFrontWebDistribution,
            role: bucketDeploymentRole,
            sources: [
                aws_cdk_lib_1.aws_s3_deployment.Source.asset(webappPath, {
                    bundling: {
                        image: aws_cdk_lib_1.DockerImage.fromRegistry("node:lts"),
                        command: [],
                        local: {
                            tryBundle(outputDir) {
                                try {
                                    (0, child_process_1.execSync)("pnpm --version");
                                }
                                catch {
                                    return false;
                                }
                                (0, child_process_1.execSync)(`cd ${webappPath} && pnpm i && pnpm run build`);
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
        cdk_nag_1.NagSuppressions.addResourceSuppressions(accessLoggingBucket, [
            {
                id: "AwsSolutions-S1",
                reason: "This bucket is the access log bucket",
            },
        ], true);
        // Output
        new aws_cdk_lib_1.CfnOutput(this, "url", {
            value: this.distribution.domainName,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(bucketDeploymentRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Given the least privilege to this role based on LambdaExecutionRole",
                appliesTo: ["Resource::*"],
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Automatically created this policy and access to the restricted bucket",
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
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.distribution.stack, [
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
        ], true);
        cdk_nag_1.NagSuppressions.addStackSuppressions(aws_cdk_lib_1.Stack.of(this), [
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
exports.Web = Web;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2ViLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUF1QztBQUN2Qyw2Q0FjcUI7QUFDckIsaURBQXlDO0FBQ3pDLHlCQUF5QjtBQUN6QixxQ0FBMEM7QUFDMUMsaUVBQTREO0FBMEI1RCxNQUFhLEdBQUksU0FBUSxzQkFBUztJQUVoQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWU7UUFDdkQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLEVBQUUsVUFBVSxFQUFFLGdCQUFnQixFQUFFLFlBQVksRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLGNBQWMsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVsRyxNQUFNLGNBQWMsR0FBRyxJQUFJLHlDQUFrQixDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNwRSxhQUFhLEVBQUUsWUFBWTtZQUMzQixNQUFNLEVBQUUsV0FBVztTQUNwQixDQUFDLENBQUM7UUFFSCxtRUFBbUU7UUFDbkUsOERBQThEO1FBQzlELGtFQUFrRTtRQUNsRSxnRUFBZ0U7UUFDaEUsZ0VBQWdFO1FBQ2hFLCtEQUErRDtRQUMvRCxnQkFBZ0I7UUFDaEIsSUFBSSxXQUE0RCxDQUFDO1FBQ2pFLElBQUksVUFBK0MsQ0FBQztRQUNwRCxJQUFJLFdBQVcsSUFBSSxXQUFXLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO1lBQzFDLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxJQUFJLEtBQUssQ0FDYix3RUFBd0UsQ0FDekUsQ0FBQztZQUNKLENBQUM7WUFDRCxVQUFVLEdBQUcseUJBQVcsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7Z0JBQ2pFLFVBQVUsRUFBRSxjQUFjO2FBQzNCLENBQUMsQ0FBQztZQUNILFdBQVcsR0FBRyxJQUFJLG9DQUFzQixDQUFDLFdB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QjtnQkFDckIsTUFBTSxFQUFFLHNCQUFzQjthQUMvQjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxzQkFBc0I7Z0JBQzlCLFNBQVMsRUFBRTtvQkFDVCx1RkFBdUY7aUJBQ3hGO2FBQ0Y7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUExUUQsa0JBMFFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7XG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrUHJvcHMsXG4gIGF3c19zM19kZXBsb3ltZW50LFxuICBhd3NfY2xvdWRmcm9udCxcbiAgYXdzX3MzLFxuICBhd3NfaWFtLFxuICBhd3NfY2xvdWRmcm9udF9vcmlnaW5zLFxuICBhd3NfY2VydGlmaWNhdGVtYW5hZ2VyLFxuICBhd3Nfcm91dGU1MyxcbiAgYXdzX3JvdXRlNTNfdGFyZ2V0cyxcbiAgRG9ja2VySW1hZ2UsXG4gIENmbk91dHB1dCxcbiAgU3RhY2ssXG59IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0ICogYXMgZnMgZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuaW1wb3J0IHsgU1NNUGFyYW1ldGVyUmVhZGVyIH0gZnJvbSBcIi4vc3NtLXBhcmFtZXRlci1yZWFkZXJcIjtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICB3ZWJhcHBQYXRoOiBzdHJpbmc7XG4gIHdlYmFwcERpc3RGb2xkZXI6IHN0cmluZztcbiAgd2FmUGFyYW1OYW1lOiBzdHJpbmc7XG4gIHJlZ2lvbjogc3RyaW5nO1xuICAvKipcbiAgICogQ3VzdG9tIGRvbWFpbiBuYW1lcyB0byBzZXJ2ZSB0aGUgd2ViYXBwIG9uIChlLmcuXG4gICAqIGBbXCJtdWNrZXIuaW9cIiwgXCJ3d3cubXVja2VyLmlvXCJdYCkuIEFsbCBuYW1lcyBtdXN0IGJlbG9uZyB0byB0aGVcbiAgICogUm91dGUgNTMgcHVibGljIGhvc3RlZCB6b25lIGlkZW50aWZpZWQgYnkgYGhvc3RlZFpvbmVOYW1lYC4gTGVhdmVcbiAgICogZW1wdHkgdG8gc2VydmUgb25seSBvbiB0aGUgZGVmYXVsdCBgKi5jbG91ZGZyb250Lm5ldGAgZG9tYWluLlxuICAgKi9cbiAgZG9tYWluTmFtZXM/OiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIFRoZSBSb3V0ZSA1MyBwdWJsaWMgaG9zdGVkIHpvbmUgbmFtZSAoZS5nLiBgbXVja2VyLmlvYCkuIFJlcXVpcmVkXG4gICAqIHdoZW4gYGRvbWFpbk5hbWVzYCBpcyBub24tZW1wdHkgc28gdGhlIGNvbnN0cnVjdCBjYW4gaXNzdWUgYW4gQUNNXG4gICAqIGNlcnRpZmljYXRlIHZpYSBETlMgdmFsaWRhdGlvbiBhbmQgY3JlYXRlIGFsaWFzIHJlY29yZHMuXG4gICAqL1xuICBob3N0ZWRab25lTmFtZT86IHN0cmluZztcbiAgd2ViQnVja2V0UHJvcHM6IHtcbiAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5O1xuICAgIGF1dG9EZWxldGVPYmplY3RzOiBib29sZWFuO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgV2ViIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IGRpc3RyaWJ1dGlvbjogYXdzX2Nsb3VkZnJvbnQuRGlzdHJpYnV0aW9uO1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogV2ViUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgeyB3ZWJhcHBQYXRoLCB3ZWJhcHBEaXN0Rm9sZGVyLCB3YWZQYXJhbU5hbWUsIHJlZ2lvbiwgZG9tYWluTmFtZXMsIGhvc3RlZFpvbmVOYW1lIH0gPSBwcm9wcztcblxuICAgIGNvbnN0IHdlYkFjbElkUmVhZGVyID0gbmV3IFNTTVBhcmFtZXRlclJlYWRlcih0aGlzLCBcIldlYkFjbElkUmVhZGVyXCIsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IHdhZlBhcmFtTmFtZSxcbiAgICAgIHJlZ2lvbjogXCJ1cy1lYXN0LTFcIixcbiAgICB9KTtcblxuICAgIC8vIOKUgOKUgCBDdXN0b20gZG9tYWluIHdpcmluZyAob3B0aW9uYWwpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIElmIGRvbWFpbk5hbWVzIGlzIHByb3ZpZGVkIHdlIGxvb2sgdXAgdGhlIGV4aXN0aW5nIFJvdXRlIDUzXG4gICAgLy8gaG9zdGVkIHpvbmUsIGlzc3VlIGEgRE5TLXZhbGlkYXRlZCBBQ00gY2VydGlmaWNhdGUgY292ZXJpbmcgYWxsXG4gICAgLy8gb2YgdGhvc2UgbmFtZXMsIGFuZCBjcmVhdGUgQS9BQUFBIGFsaWFzIHJlY29yZHMgcG9pbnRpbmcgZWFjaFxuICAgIC8vIG5hbWUgYXQgdGhlIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uLiBUaGUgd2ViYXBwIHN0YWNrIG11c3QgYmVcbiAgICAvLyBkZXBsb3llZCBpbiB1cy1lYXN0LTEg4oCUIHJlcXVpcmVkIGZvciBDbG91ZEZyb250LWF0dGFjaGVkIEFDTVxuICAgIC8vIGNlcnRpZmljYXRlcy5cbiAgICBsZXQgY2VydGlmaWNhdGU6IGF3c19jZXJ0aWZpY2F0ZW1hbmFnZXIuSUNlcnRpZmljYXRlIHwgdW5kZWZpbmVkO1xuICAgIGxldCBob3N0ZWRab25lOiBhd3Nfcm91dGU1My5JSG9zdGVkWm9uZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoZG9tYWluTmFtZXMgJiYgZG9tYWluTmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKCFob3N0ZWRab25lTmFtZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJXZWIgY29uc3RydWN0OiBob3N0ZWRab25lTmFtZSBpcyByZXF1aXJlZCB3aGVuIGRvbWFpbk5hbWVzIGlzIHByb3ZpZGVkXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGhvc3RlZFpvbmUgPSBhd3Nfcm91dGU1My5Ib3N0ZWRab25lLmZyb21Mb29rdXAodGhpcywgXCJIb3N0ZWRab25lXCIsIHtcbiAgICAgICAgZG9tYWluTmFtZTogaG9zdGVkWm9uZU5hbWUsXG4gICAgICB9KTtcbiAgICAgIGNlcnRpZmljYXRlID0gbmV3IGF3c19jZXJ0aWZpY2F0ZW1hbmFnZXIuQ2VydGlmaWNhdGUoXG4gICAgICAgIHRoaXMsXG4gICAgICAgIFwiQ2VydGlmaWNhdGVcIixcbiAgICAgICAge1xuICAgICAgICAgIGRvbWFpbk5hbWU6IGRvbWFpbk5hbWVzWzBdLFxuICAgICAgICAgIHN1YmplY3RBbHRlcm5hdGl2ZU5hbWVzOiBkb21haW5OYW1lcy5zbGljZSgxKSxcbiAgICAgICAgICB2YWxpZGF0aW9uOlxuICAgICAgICAgICAgYXdzX2NlcnRpZmljYXRlbWFuYWdlci5DZXJ0aWZpY2F0ZVZhbGlkYXRpb24uZnJvbURucyhob3N0ZWRab25lKSxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBY2Nlc3MgbG9ncyBidWNrZXRcbiAgICBjb25zdCBhY2Nlc3NMb2dnaW5nQnVja2V0ID0gbmV3IGF3c19zMy5CdWNrZXQoXG4gICAgICB0aGlzLFxuICAgICAgXCJvcmlnaW5BY2Nlc3NMb2dnaW5nQnVja2V0XCIsXG4gICAgICB7XG4gICAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBhd3NfczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgICBlbmNyeXB0aW9uOiBhd3NfczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgICB2ZXJzaW9uZWQ6IGZhbHNlLFxuICAgICAgICAuLi5wcm9wcy53ZWJCdWNrZXRQcm9wcyxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gT3JpZ2luIGJ1Y2tldFxuICAgIGNvbnN0IG9yaWdpbiA9IG5ldyBhd3NfczMuQnVja2V0KHRoaXMsIFwib3JpZ2luXCIsIHtcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBhd3NfczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgZW5jcnlwdGlvbjogYXdzX3MzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICB2ZXJzaW9uZWQ6IGZhbHNlLFxuICAgICAgc2VydmVyQWNjZXNzTG9nc0J1Y2tldDogYWNjZXNzTG9nZ2luZ0J1Y2tldCxcbiAgICAgIC4uLnByb3BzLndlYkJ1Y2tldFByb3BzLFxuICAgIH0pO1xuICAgIGNvbnN0IGJ1Y2tldE9yaWdpbiA9IGF3c19jbG91ZGZyb250X29yaWdpbnMuUzNCdWNrZXRPcmlnaW4ud2l0aE9yaWdpbkFjY2Vzc0NvbnRyb2wob3JpZ2luKTtcblxuICAgIC8vIEFtYXpvbiBDbG91ZEZyb250XG4gICAgY29uc3QgY2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbiA9IG5ldyBhd3NfY2xvdWRmcm9udC5EaXN0cmlidXRpb24oXG4gICAgICB0aGlzLFxuICAgICAgXCJjbG91ZEZyb250XCIsXG4gICAgICB7XG4gICAgICAgIHdlYkFjbElkOiB3ZWJBY2xJZFJlYWRlci5nZXRQYXJhbWV0ZXJWYWx1ZSgpLFxuICAgICAgICAuLi4oZG9tYWluTmFtZXMgJiYgZG9tYWluTmFtZXMubGVuZ3RoID4gMFxuICAgICAgICAgID8geyBkb21haW5OYW1lcywgY2VydGlmaWNhdGUgfVxuICAgICAgICAgIDoge30pLFxuICAgICAgICBtaW5pbXVtUHJvdG9jb2xWZXJzaW9uOlxuICAgICAgICAgIGF3c19jbG91ZGZyb250LlNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgZW5hYmxlTG9nZ2luZzogdHJ1ZSxcbiAgICAgICAgbG9nQnVja2V0OiBuZXcgYXdzX3MzLkJ1Y2tldCh0aGlzLCBcImNmTG9nZ2luZ0J1Y2tldFwiLCB7XG4gICAgICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IGF3c19zMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICAgICAgZW5jcnlwdGlvbjogYXdzX3MzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgICAgIC4uLnByb3BzLndlYkJ1Y2tldFByb3BzLFxuICAgICAgICAgIHZlcnNpb25lZDogZmFsc2UsXG4gICAgICAgICAgb2JqZWN0T3duZXJzaGlwOiBhd3NfczMuT2JqZWN0T3duZXJzaGlwLkJVQ0tFVF9PV05FUl9QUkVGRVJSRUQsXG4gICAgICAgIH0pLFxuICAgICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgICBvcmlnaW46IGJ1Y2tldE9yaWdpbixcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogYXdzX2Nsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVkTWV0aG9kczogYXdzX2Nsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogYXdzX2Nsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6XG4gICAgICAgICAgICBhd3NfY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgfSxcblxuICAgICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwMyxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6IFwiL2luZGV4Lmh0bWxcIixcbiAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaHR0cFN0YXR1czogNDA0LFxuICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogXCIvaW5kZXguaHRtbFwiLFxuICAgICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgdGhpcy5kaXN0cmlidXRpb24gPSBjbG91ZEZyb250V2ViRGlzdHJpYnV0aW9uO1xuXG4gICAgLy8gUm91dGUgNTMgYWxpYXMgcmVjb3JkcyBmb3IgZWFjaCBjdXN0b20gZG9tYWluIOKGkiBDbG91ZEZyb250XG4gICAgaWYgKGhvc3RlZFpvbmUgJiYgZG9tYWluTmFtZXMgJiYgZG9tYWluTmFtZXMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgdGFyZ2V0ID0gYXdzX3JvdXRlNTMuUmVjb3JkVGFyZ2V0LmZyb21BbGlhcyhcbiAgICAgICAgbmV3IGF3c19yb3V0ZTUzX3RhcmdldHMuQ2xvdWRGcm9udFRhcmdldChjbG91ZEZyb250V2ViRGlzdHJpYnV0aW9uKVxuICAgICAgKTtcbiAgICAgIGZvciAoY29uc3QgbmFtZSBvZiBkb21haW5OYW1lcykge1xuICAgICAgICAvLyBVc2UgdGhlIEZRRE4gYXMgdGhlIHJlY29yZE5hbWU7IENESyBzdHJpcHMgdGhlIHpvbmUgc3VmZml4LlxuICAgICAgICAvLyBGb3IgdGhlIGFwZXggKGBtdWNrZXIuaW9gKSwgcmVjb3JkTmFtZSByZXNvbHZlcyB0byB0aGUgem9uZVxuICAgICAgICAvLyByb290LCB3aGljaCBSb3V0ZSA1MyByZXByZXNlbnRzIGFzIGFuIGVtcHR5L3pvbmUtYXBleCByZWNvcmQuXG4gICAgICAgIG5ldyBhd3Nfcm91dGU1My5BUmVjb3JkKHRoaXMsIGBBbGlhc0EtJHtuYW1lfWAsIHtcbiAgICAgICAgICB6b25lOiBob3N0ZWRab25lLFxuICAgICAgICAgIHJlY29yZE5hbWU6IG5hbWUsXG4gICAgICAgICAgdGFyZ2V0LFxuICAgICAgICAgIGNvbW1lbnQ6IGBXZWJhcHAgYWxpYXMgZm9yICR7bmFtZX1gLFxuICAgICAgICB9KTtcbiAgICAgICAgbmV3IGF3c19yb3V0ZTUzLkFhYWFSZWNvcmQodGhpcywgYEFsaWFzQUFBQS0ke25hbWV9YCwge1xuICAgICAgICAgIHpvbmU6IGhvc3RlZFpvbmUsXG4gICAgICAgICAgcmVjb3JkTmFtZTogbmFtZSxcbiAgICAgICAgICB0YXJnZXQsXG4gICAgICAgICAgY29tbWVudDogYFdlYmFwcCBhbGlhcyBmb3IgJHtuYW1lfWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGJ1Y2tldERlcGxveW1lbnRSb2xlID0gbmV3IGF3c19pYW0uUm9sZShcbiAgICAgIHRoaXMsXG4gICAgICBcImJ1Y2tldERlcGxveW1lbnRSb2xlXCIsXG4gICAgICB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcImxhbWJkYS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgfVxuICAgICk7XG4gICAgYnVja2V0RGVwbG95bWVudFJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcImxvZ3M6Q3JlYXRlTG9nR3JvdXBcIixcbiAgICAgICAgICBcImxvZ3M6Q3JlYXRlTG9nU3RyZWFtXCIsXG4gICAgICAgICAgXCJsb2dzOlB1dExvZ0V2ZW50c1wiLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gUmVhY3QgZGVwbG95bWVudFxuICAgIG5ldyBhd3NfczNfZGVwbG95bWVudC5CdWNrZXREZXBsb3ltZW50KHRoaXMsIFwiYnVja2V0RGVwbG95bWVudFwiLCB7XG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogb3JpZ2luLFxuICAgICAgZGlzdHJpYnV0aW9uOiBjbG91ZEZyb250V2ViRGlzdHJpYnV0aW9uLFxuICAgICAgcm9sZTogYnVja2V0RGVwbG95bWVudFJvbGUsXG4gICAgICBzb3VyY2VzOiBbXG4gICAgICAgIGF3c19zM19kZXBsb3ltZW50LlNvdXJjZS5hc3NldCh3ZWJhcHBQYXRoLCB7XG4gICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIGltYWdlOiBEb2NrZXJJbWFnZS5mcm9tUmVnaXN0cnkoXCJub2RlOmx0c1wiKSxcbiAgICAgICAgICAgIGNvbW1hbmQ6IFtdLFxuICAgICAgICAgICAgbG9jYWw6IHtcbiAgICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGV4ZWNTeW5jKFwicG5wbSAtLXZlcnNpb25cIik7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGV4ZWNTeW5jKGBjZCAke3dlYmFwcFBhdGh9ICYmIHBucG0gaSAmJiBwbnBtIHJ1biBidWlsZGApO1xuICAgICAgICAgICAgICAgIGZzLmNwU3luYyhgJHt3ZWJhcHBQYXRofS8ke3dlYmFwcERpc3RGb2xkZXJ9YCwgb3V0cHV0RGlyLCB7XG4gICAgICAgICAgICAgICAgICByZWN1cnNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICAgIG1lbW9yeUxpbWl0OiA1MTIsXG4gICAgfSk7XG5cbiAgICAvLyBTdXBwcmVzc2lvbnNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBhY2Nlc3NMb2dnaW5nQnVja2V0LFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLVMxXCIsXG4gICAgICAgICAgcmVhc29uOiBcIlRoaXMgYnVja2V0IGlzIHRoZSBhY2Nlc3MgbG9nIGJ1Y2tldFwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcInVybFwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kaXN0cmlidXRpb24uZG9tYWluTmFtZSxcbiAgICB9KTtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBidWNrZXREZXBsb3ltZW50Um9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJHaXZlbiB0aGUgbGVhc3QgcHJpdmlsZWdlIHRvIHRoaXMgcm9sZSBiYXNlZCBvbiBMYW1iZGFFeGVjdXRpb25Sb2xlXCIsXG4gICAgICAgICAgYXBwbGllc1RvOiBbXCJSZXNvdXJjZTo6KlwiXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJBdXRvbWF0aWNhbGx5IGNyZWF0ZWQgdGhpcyBwb2xpY3kgYW5kIGFjY2VzcyB0byB0aGUgcmVzdHJpY3RlZCBidWNrZXRcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIFwiQWN0aW9uOjpzMzpHZXRPYmplY3QqXCIsXG4gICAgICAgICAgICBcIkFjdGlvbjo6czM6TGlzdCpcIixcbiAgICAgICAgICAgIFwiQWN0aW9uOjpzMzpHZXRCdWNrZXQqXCIsXG4gICAgICAgICAgICBcIkFjdGlvbjo6czM6QWJvcnQqXCIsXG4gICAgICAgICAgICBcIkFjdGlvbjo6czM6RGVsZXRlT2JqZWN0KlwiLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJBdXRvbWF0aWNhbGx5IGNyZWF0ZWQgdGhpcyBwb2xpY3lcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcmVnZXg6IFwiL15SZXNvdXJjZTo6KC4qKSQvZ1wiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHRoaXMuZGlzdHJpYnV0aW9uLnN0YWNrLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLVMxXCIsXG4gICAgICAgICAgcmVhc29uOiBcIkNsb3VkZnJvbnRMb2dnaW5nQnVja2V0IGlzIHRoZSBhY2Nlc3MgbG9nIGJ1Y2tldFwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUNGUjFcIixcbiAgICAgICAgICByZWFzb246IFwiRGlzYWJsZSB3YXJuaW5nXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtQ0ZSNFwiLFxuICAgICAgICAgIHJlYXNvbjogXCJBdHRhY2hlZCB0aGUgbWluaW11bSBzZWN1cml0eSBwb2xpY3kgb2YgVExTX1YxXzJfMjAyMVwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKFN0YWNrLm9mKHRoaXMpLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1MMVwiLFxuICAgICAgICByZWFzb246IFwiQ0RLIG1hbmFnZWQgcmVzb3VyY2VcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU00XCIsXG4gICAgICAgIHJlYXNvbjogXCJDREsgbWFuYWdlZCByZXNvdXJjZVwiLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICBcIlBvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==