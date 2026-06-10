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
        const { webappPath, webappDistFolder, wafParamName, region } = props;
        const webAclIdReader = new ssm_parameter_reader_1.SSMParameterReader(this, "WebAclIdReader", {
            parameterName: wafParamName,
            region: "us-east-1",
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2ViLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUF1QztBQUN2Qyw2Q0FXcUI7QUFDckIsaURBQXlDO0FBQ3pDLHlCQUF5QjtBQUN6QixxQ0FBMEM7QUFDMUMsaUVBQTREO0FBYTVELE1BQWEsR0FBSSxTQUFRLHNCQUFTO0lBRWhDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBZTtRQUN2RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sRUFBRSxVQUFVLEVBQUUsZ0JBQWdCLEVBQUUsWUFBWSxFQUFFLE1BQU0sRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVyRSxNQUFNLGNBQWMsR0FBRyxJQUFJLHlDQUFrQixDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNwRSxhQUFhLEVBQUUsWUFBWTtZQUMzQixNQUFNLEVBQUUsV0FBVztTQUNwQixDQUFDLENBQUM7UUFFSCxxQkFBcUI7UUFDckIsTUFBTSxtQkFBbUIsR0FBRyxJQUFJLG9CQUFNLENBQUMsTUFBTSxDQUMzQyxJQUFJLEVBQ0osMkJBQTJCLEVBQzNCO1lBQ0UsaUJBQWlCLEVBQUUsb0JBQU0sQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ3JELFVBQVUsRUFBRSxvQkFBTSxDQUFDLGdCQUFnQixDQUFDLFVBQVU7WUFDOUMsVUFBVSxFQUFFLElBQUk7WUFDaEIsU0FBUyxFQUFFLEtBQUs7WUFDaEIsR0FBRyxLQUFLLENBQUMsY0FBYztTQUN4QixDQUNGLENBQUM7UUFFRixnQkFBZ0I7UUFDaEIsTUFBTSxNQUFNLEdBQUcsSUFBSSxvQkFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQy9DLGlCQUFpQixFQUFFLG9CQUFNLENBQUMsaUJBQWlCLENBQUMsU0FBUztZQUNyRCxVQUFVLEVBQUUsb0JBQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVO1lBQzlDLFVB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O29CQUNUO3dCQUNFLEtBQUssRUFBRSxxQkFBcUI7cUJBQzdCO2lCQUNGO2FBQ0Y7U0FDRixFQUNELElBQUksQ0FDTCxDQUFDO1FBQ0YseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsSUFBSSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQ3ZCO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUFFLGtEQUFrRDthQUMzRDtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxpQkFBaUI7YUFDMUI7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsdURBQXVEO2FBQ2hFO1NBQ0YsRUFDRCxJQUFJLENBQ0wsQ0FBQztRQUVGLHlCQUFlLENBQUMsb0JBQW9CLENBQUMsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEVBQUU7WUFDbkQ7Z0JBQ0UsRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUFFLHNCQUFzQjthQUMvQjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxzQkFBc0I7Z0JBQzlCLFNBQVMsRUFBRTtvQkFDVCx1RkFBdUY7aUJBQ3hGO2FBQ0Y7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqTkQsa0JBaU5DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7XG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrUHJvcHMsXG4gIGF3c19zM19kZXBsb3ltZW50LFxuICBhd3NfY2xvdWRmcm9udCxcbiAgYXdzX3MzLFxuICBhd3NfaWFtLFxuICBhd3NfY2xvdWRmcm9udF9vcmlnaW5zLFxuICBEb2NrZXJJbWFnZSxcbiAgQ2ZuT3V0cHV0LFxuICBTdGFjayxcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBleGVjU3luYyB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XG5pbXBvcnQgKiBhcyBmcyBmcm9tIFwiZnNcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5pbXBvcnQgeyBTU01QYXJhbWV0ZXJSZWFkZXIgfSBmcm9tIFwiLi9zc20tcGFyYW1ldGVyLXJlYWRlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlByb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIHdlYmFwcFBhdGg6IHN0cmluZztcbiAgd2ViYXBwRGlzdEZvbGRlcjogc3RyaW5nO1xuICB3YWZQYXJhbU5hbWU6IHN0cmluZztcbiAgcmVnaW9uOiBzdHJpbmc7XG4gIHdlYkJ1Y2tldFByb3BzOiB7XG4gICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeTtcbiAgICBhdXRvRGVsZXRlT2JqZWN0czogYm9vbGVhbjtcbiAgfTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYiBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBkaXN0cmlidXRpb246IGF3c19jbG91ZGZyb250LkRpc3RyaWJ1dGlvbjtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFdlYlByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHsgd2ViYXBwUGF0aCwgd2ViYXBwRGlzdEZvbGRlciwgd2FmUGFyYW1OYW1lLCByZWdpb24gfSA9IHByb3BzO1xuXG4gICAgY29uc3Qgd2ViQWNsSWRSZWFkZXIgPSBuZXcgU1NNUGFyYW1ldGVyUmVhZGVyKHRoaXMsIFwiV2ViQWNsSWRSZWFkZXJcIiwge1xuICAgICAgcGFyYW1ldGVyTmFtZTogd2FmUGFyYW1OYW1lLFxuICAgICAgcmVnaW9uOiBcInVzLWVhc3QtMVwiLFxuICAgIH0pO1xuXG4gICAgLy8gQWNjZXNzIGxvZ3MgYnVja2V0XG4gICAgY29uc3QgYWNjZXNzTG9nZ2luZ0J1Y2tldCA9IG5ldyBhd3NfczMuQnVja2V0KFxuICAgICAgdGhpcyxcbiAgICAgIFwib3JpZ2luQWNjZXNzTG9nZ2luZ0J1Y2tldFwiLFxuICAgICAge1xuICAgICAgICBibG9ja1B1YmxpY0FjY2VzczogYXdzX3MzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgICAgZW5jcnlwdGlvbjogYXdzX3MzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgICAgdmVyc2lvbmVkOiBmYWxzZSxcbiAgICAgICAgLi4ucHJvcHMud2ViQnVja2V0UHJvcHMsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIE9yaWdpbiBidWNrZXRcbiAgICBjb25zdCBvcmlnaW4gPSBuZXcgYXdzX3MzLkJ1Y2tldCh0aGlzLCBcIm9yaWdpblwiLCB7XG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogYXdzX3MzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuY3J5cHRpb246IGF3c19zMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgdmVyc2lvbmVkOiBmYWxzZSxcbiAgICAgIHNlcnZlckFjY2Vzc0xvZ3NCdWNrZXQ6IGFjY2Vzc0xvZ2dpbmdCdWNrZXQsXG4gICAgICAuLi5wcm9wcy53ZWJCdWNrZXRQcm9wcyxcbiAgICB9KTtcbiAgICBjb25zdCBidWNrZXRPcmlnaW4gPSBhd3NfY2xvdWRmcm9udF9vcmlnaW5zLlMzQnVja2V0T3JpZ2luLndpdGhPcmlnaW5BY2Nlc3NDb250cm9sKG9yaWdpbik7XG5cbiAgICAvLyBBbWF6b24gQ2xvdWRGcm9udFxuICAgIGNvbnN0IGNsb3VkRnJvbnRXZWJEaXN0cmlidXRpb24gPSBuZXcgYXdzX2Nsb3VkZnJvbnQuRGlzdHJpYnV0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgIFwiY2xvdWRGcm9udFwiLFxuICAgICAge1xuICAgICAgICB3ZWJBY2xJZDogd2ViQWNsSWRSZWFkZXIuZ2V0UGFyYW1ldGVyVmFsdWUoKSxcbiAgICAgICAgbWluaW11bVByb3RvY29sVmVyc2lvbjpcbiAgICAgICAgICBhd3NfY2xvdWRmcm9udC5TZWN1cml0eVBvbGljeVByb3RvY29sLlRMU19WMV8yXzIwMjEsXG4gICAgICAgIGVuYWJsZUxvZ2dpbmc6IHRydWUsXG4gICAgICAgIGxvZ0J1Y2tldDogbmV3IGF3c19zMy5CdWNrZXQodGhpcywgXCJjZkxvZ2dpbmdCdWNrZXRcIiwge1xuICAgICAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBhd3NfczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgICAgIGVuY3J5cHRpb246IGF3c19zMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgICAgICAuLi5wcm9wcy53ZWJCdWNrZXRQcm9wcyxcbiAgICAgICAgICB2ZXJzaW9uZWQ6IGZhbHNlLFxuICAgICAgICAgIG9iamVjdE93bmVyc2hpcDogYXdzX3MzLk9iamVjdE93bmVyc2hpcC5CVUNLRVRfT1dORVJfUFJFRkVSUkVELFxuICAgICAgICB9KSxcbiAgICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgICAgb3JpZ2luOiBidWNrZXRPcmlnaW4sXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGF3c19jbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGF3c19jbG91ZGZyb250LkNhY2hlZE1ldGhvZHMuQ0FDSEVfR0VUX0hFQUQsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGF3c19jbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OlxuICAgICAgICAgICAgYXdzX2Nsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIH0sXG5cbiAgICAgICAgZXJyb3JSZXNwb25zZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBodHRwU3RhdHVzOiA0MDMsXG4gICAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiBcIi9pbmRleC5odG1sXCIsXG4gICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwNCxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6IFwiL2luZGV4Lmh0bWxcIixcbiAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIHRoaXMuZGlzdHJpYnV0aW9uID0gY2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbjtcblxuICAgIGNvbnN0IGJ1Y2tldERlcGxveW1lbnRSb2xlID0gbmV3IGF3c19pYW0uUm9sZShcbiAgICAgIHRoaXMsXG4gICAgICBcImJ1Y2tldERlcGxveW1lbnRSb2xlXCIsXG4gICAgICB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcImxhbWJkYS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgfVxuICAgICk7XG4gICAgYnVja2V0RGVwbG95bWVudFJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcImxvZ3M6Q3JlYXRlTG9nR3JvdXBcIixcbiAgICAgICAgICBcImxvZ3M6Q3JlYXRlTG9nU3RyZWFtXCIsXG4gICAgICAgICAgXCJsb2dzOlB1dExvZ0V2ZW50c1wiLFxuICAgICAgICBdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gUmVhY3QgZGVwbG95bWVudFxuICAgIG5ldyBhd3NfczNfZGVwbG95bWVudC5CdWNrZXREZXBsb3ltZW50KHRoaXMsIFwiYnVja2V0RGVwbG95bWVudFwiLCB7XG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogb3JpZ2luLFxuICAgICAgZGlzdHJpYnV0aW9uOiBjbG91ZEZyb250V2ViRGlzdHJpYnV0aW9uLFxuICAgICAgcm9sZTogYnVja2V0RGVwbG95bWVudFJvbGUsXG4gICAgICBzb3VyY2VzOiBbXG4gICAgICAgIGF3c19zM19kZXBsb3ltZW50LlNvdXJjZS5hc3NldCh3ZWJhcHBQYXRoLCB7XG4gICAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICAgIGltYWdlOiBEb2NrZXJJbWFnZS5mcm9tUmVnaXN0cnkoXCJub2RlOmx0c1wiKSxcbiAgICAgICAgICAgIGNvbW1hbmQ6IFtdLFxuICAgICAgICAgICAgbG9jYWw6IHtcbiAgICAgICAgICAgICAgdHJ5QnVuZGxlKG91dHB1dERpcjogc3RyaW5nKSB7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgIGV4ZWNTeW5jKFwicG5wbSAtLXZlcnNpb25cIik7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGV4ZWNTeW5jKGBjZCAke3dlYmFwcFBhdGh9ICYmIHBucG0gaSAmJiBwbnBtIHJ1biBidWlsZGApO1xuICAgICAgICAgICAgICAgIGZzLmNwU3luYyhgJHt3ZWJhcHBQYXRofS8ke3dlYmFwcERpc3RGb2xkZXJ9YCwgb3V0cHV0RGlyLCB7XG4gICAgICAgICAgICAgICAgICByZWN1cnNpdmU6IHRydWUsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICAgIG1lbW9yeUxpbWl0OiA1MTIsXG4gICAgfSk7XG5cbiAgICAvLyBTdXBwcmVzc2lvbnNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBhY2Nlc3NMb2dnaW5nQnVja2V0LFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLVMxXCIsXG4gICAgICAgICAgcmVhc29uOiBcIlRoaXMgYnVja2V0IGlzIHRoZSBhY2Nlc3MgbG9nIGJ1Y2tldFwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgLy8gT3V0cHV0XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcInVybFwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kaXN0cmlidXRpb24uZG9tYWluTmFtZSxcbiAgICB9KTtcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBidWNrZXREZXBsb3ltZW50Um9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJHaXZlbiB0aGUgbGVhc3QgcHJpdmlsZWdlIHRvIHRoaXMgcm9sZSBiYXNlZCBvbiBMYW1iZGFFeGVjdXRpb25Sb2xlXCIsXG4gICAgICAgICAgYXBwbGllc1RvOiBbXCJSZXNvdXJjZTo6KlwiXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJBdXRvbWF0aWNhbGx5IGNyZWF0ZWQgdGhpcyBwb2xpY3kgYW5kIGFjY2VzcyB0byB0aGUgcmVzdHJpY3RlZCBidWNrZXRcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIFwiQWN0aW9uOjpzMzpHZXRPYmplY3QqXCIsXG4gICAgICAgICAgICBcIkFjdGlvbjo6czM6TGlzdCpcIixcbiAgICAgICAgICAgIFwiQWN0aW9uOjpzMzpHZXRCdWNrZXQqXCIsXG4gICAgICAgICAgICBcIkFjdGlvbjo6czM6QWJvcnQqXCIsXG4gICAgICAgICAgICBcIkFjdGlvbjo6czM6RGVsZXRlT2JqZWN0KlwiLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJBdXRvbWF0aWNhbGx5IGNyZWF0ZWQgdGhpcyBwb2xpY3lcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcmVnZXg6IFwiL15SZXNvdXJjZTo6KC4qKSQvZ1wiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHRoaXMuZGlzdHJpYnV0aW9uLnN0YWNrLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLVMxXCIsXG4gICAgICAgICAgcmVhc29uOiBcIkNsb3VkZnJvbnRMb2dnaW5nQnVja2V0IGlzIHRoZSBhY2Nlc3MgbG9nIGJ1Y2tldFwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUNGUjFcIixcbiAgICAgICAgICByZWFzb246IFwiRGlzYWJsZSB3YXJuaW5nXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtQ0ZSNFwiLFxuICAgICAgICAgIHJlYXNvbjogXCJBdHRhY2hlZCB0aGUgbWluaW11bSBzZWN1cml0eSBwb2xpY3kgb2YgVExTX1YxXzJfMjAyMVwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKFN0YWNrLm9mKHRoaXMpLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1MMVwiLFxuICAgICAgICByZWFzb246IFwiQ0RLIG1hbmFnZWQgcmVzb3VyY2VcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU00XCIsXG4gICAgICAgIHJlYXNvbjogXCJDREsgbWFuYWdlZCByZXNvdXJjZVwiLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICBcIlBvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==