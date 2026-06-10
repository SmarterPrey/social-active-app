"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Media = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const cdk_nag_1 = require("cdk-nag");
/**
 * KMS-encrypted S3 bucket for member/event media (event videos, vendor logos,
 * profile photos) fronted by CloudFront with Origin Access Control.
 *
 * The backend Lambda writes directly via presigned PUT URLs; members read via
 * the CloudFront domain.
 */
class Media extends constructs_1.Construct {
    constructor(scope, id, props = {}) {
        super(scope, id);
        const removalPolicy = props.removalPolicy ?? aws_cdk_lib_1.RemovalPolicy.RETAIN;
        const autoDeleteObjects = props.autoDeleteObjects ?? false;
        this.key = new aws_cdk_lib_1.aws_kms.Key(this, "key", {
            enableKeyRotation: true,
            removalPolicy,
            description: "Social Active App media bucket CMK",
        });
        const accessLogs = new aws_cdk_lib_1.aws_s3.Bucket(this, "accessLogs", {
            blockPublicAccess: aws_cdk_lib_1.aws_s3.BlockPublicAccess.BLOCK_ALL,
            encryption: aws_cdk_lib_1.aws_s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            versioned: false,
            // CloudFront standard logging writes via the awslogsdelivery canonical
            // user and requires ACLs. S3's modern default (BUCKET_OWNER_ENFORCED)
            // disables ACLs, so we opt into BUCKET_OWNER_PREFERRED here.
            objectOwnership: aws_cdk_lib_1.aws_s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
            removalPolicy,
            autoDeleteObjects,
        });
        this.bucket = new aws_cdk_lib_1.aws_s3.Bucket(this, "bucket", {
            blockPublicAccess: aws_cdk_lib_1.aws_s3.BlockPublicAccess.BLOCK_ALL,
            encryption: aws_cdk_lib_1.aws_s3.BucketEncryption.KMS,
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
                        aws_cdk_lib_1.aws_s3.HttpMethods.PUT,
                        aws_cdk_lib_1.aws_s3.HttpMethods.GET,
                        aws_cdk_lib_1.aws_s3.HttpMethods.HEAD,
                    ],
                    allowedOrigins: ["*"],
                    allowedHeaders: ["*"],
                    exposedHeaders: ["ETag"],
                    maxAge: 3000,
                },
            ],
            lifecycleRules: [
                {
                    abortIncompleteMultipartUploadAfter: aws_cdk_lib_1.Duration.days(3),
                    noncurrentVersionExpiration: aws_cdk_lib_1.Duration.days(30),
                },
            ],
        });
        this.distribution = new aws_cdk_lib_1.aws_cloudfront.Distribution(this, "cf", {
            minimumProtocolVersion: aws_cdk_lib_1.aws_cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            enableLogging: true,
            logBucket: accessLogs,
            logFilePrefix: "cf/",
            defaultBehavior: {
                origin: aws_cdk_lib_1.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
                viewerProtocolPolicy: aws_cdk_lib_1.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: aws_cdk_lib_1.aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
                allowedMethods: aws_cdk_lib_1.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            },
        });
        // CloudFront OAC needs decrypt on the key.
        this.key.grantDecrypt(new aws_cdk_lib_1.aws_iam.ServicePrincipal("cloudfront.amazonaws.com"));
        new aws_cdk_lib_1.CfnOutput(this, "MediaBucketName", { value: this.bucket.bucketName });
        new aws_cdk_lib_1.CfnOutput(this, "MediaDomain", {
            value: this.distribution.distributionDomainName,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.distribution, [
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
        ], true);
    }
}
exports.Media = Media;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWVkaWEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJtZWRpYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FTcUI7QUFDckIsMkNBQXVDO0FBQ3ZDLHFDQUEwQztBQVExQzs7Ozs7O0dBTUc7QUFDSCxNQUFhLEtBQU0sU0FBUSxzQkFBUztJQUtsQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFFBQW9CLEVBQUU7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLGFBQWEsR0FBRyxLQUFLLENBQUMsYUFBYSxJQUFJLDJCQUFhLENBQUMsTUFBTSxDQUFDO1FBQ2xFLE1BQU0saUJBQWlCLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixJQUFJLEtBQUssQ0FBQztRQUUzRCxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUkscUJBQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUN0QyxpQkFBaUIsRUFBRSxJQUFJO1lBQ3ZCLGFBQWE7WUFDYixXQUFXLEVBQUUsb0NBQW9DO1NBQ2xELENBQUMsQ0FBQztRQUVILE1BQU0sVUFBVSxHQUFHLElBQUksb0JBQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN2RCxpQkFBaUIsRUFBRSxvQkFBTSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDckQsVUFBVSxFQUFFLG9CQUFNLENBQUMsZ0JBQWdCLENBQUMsVUFBVTtZQUM5QyxVQUFVLEVBQUUsSUFBSTtZQUNoQixTQUFTLEVBQUUsS0FBSztZQUNoQix1RUFBdUU7WUFDdkUsc0VBQXNFO1lBQ3RFLDZEQUE2RDtZQUM3RCxlQUFlLEVBQUUsb0JBQU0sQ0FBQyxlQUFlLENBQUMsc0JBQXNCO1lBQzlELGFBQWE7WUFDYixpQkFBaUI7U0FDbEIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLG9CQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUU7WUFDOUMsaUJBQWlCLEVBQUUsb0JBQU0sQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTO1lBQ3JELFVBQVUsRUFBRSxvQkFBTSxDQUFDLGdCQUFnQixDQUFDLEdBQUc7WUFDdkMsYUFBYSxFQUFFLElBQUksQ0FBQyxHQUFHO1lBQ3ZCLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLFNBQVMsRUFBRSxJQUFJO1lBQ2Ysc0JBQXNCLEVBQUUsVUFBVTtZQUNsQyxzQkFBc0IsRUFBRSxLQUFLO1lBQzdCLGFBQWE7WUFDYixpQkFBaUI7WUFDakIsSUFBSSxFQUFFO2dCQUNKO29CQUNFLGNBQWMsRUFBRTt3QkFDZCxvQkFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHO3dCQUN0QixvQkFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHO3dCQUN0QixvQkFBTSxDQUFDLFdBQVcsQ0FBQyxJQUFJO3FCQUN4QjtvQkFDRCxjQUFjLEVBQUUsQ0FBQyxHQUFHLENBQUM7b0JBQ3JCLGNBQWMsRUFBRSxDQUFDLEdBQUcsQ0FBQztvQkFDckIsY0FBYyxFQUFFLENBQUMsTUFBTSxDQUFDO29CQUN4QixNQUFNLEVBQUUsSUFBSTtpQkFDYjthQUNGO1lBQ0QsY0FBYyxFQUFFO2dCQUNkO29CQUNFLG1DQUFtQyxFQUFFLHNCQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztvQkFDckQsMkJBQTJCLEVBQUUsc0JBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO2lCQUMvQzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLDRCQUFjLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUU7WUFDOUQsc0JBQXNCLEVBQ3BCLDRCQUFjLENBQUMsc0JBQXNCLENBQUMsYUFBYTtZQUNyRCxhQUFhLEVBQUUsSUFBSTtZQUNuQixTQUFTLEVBQUUsVUFBVTtZQUNyQixhQUFhLEVBQUUsS0FBSztZQUNwQixlQUFlLEVBQUU7Z0JBQ2YsTUFBTSxFQUNKLG9DQUFzQixDQUFDLGNBQWMsQ0FBQyx1QkFBdUIsQ0FDM0QsSUFBSSxDQUFDLE1BQU0sQ0FDWjtnQkFDSCxvQkFBb0IsRUFDbEIsNEJBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxpQkFBaUI7Z0JBQ3ZELFdBQVcsRUFBRSw0QkFBYyxDQUFDLFdBQVcsQ0FBQyxpQkFBaUI7Z0JBQ3pELGNBQWMsRUFBRSw0QkFBYyxDQUFDLGNBQWMsQ0FBQyxjQUFjO2FBQzdEO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsMkNBQTJDO1FBQzNDLElBQUksQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUNuQixJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsMEJBQTBCLENBQUMsQ0FDekQsQ0FBQztRQUVGLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQzFFLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2pDLEtBQUssRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLHNCQUFzQjtTQUNoRCxDQUFDLENBQUM7UUFFSCx5QkFBZSxDQUFDLHVCQUF1QixDQUNyQyxJQUFJLENBQUMsWUFBWSxFQUNqQjtZQUNFO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSw4Q0FBOEM7YUFDdkQ7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUseURBQXlEO2FBQ2xFO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLDhEQUE4RDthQUN2RTtTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUE1R0Qsc0JBNEdDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG4gIGF3c19zMyxcbiAgYXdzX2ttcyxcbiAgYXdzX2lhbSxcbiAgYXdzX2Nsb3VkZnJvbnQsXG4gIGF3c19jbG91ZGZyb250X29yaWdpbnMsXG4gIENmbk91dHB1dCxcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcblxuZXhwb3J0IGludGVyZmFjZSBNZWRpYVByb3BzIHtcbiAgLyoqIFJlbW92ZSBidWNrZXQgKyBLTVMga2V5IG9uIHN0YWNrIGRlc3Ryb3k/IChkZXYgb25seSkgKi9cbiAgcmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG4gIGF1dG9EZWxldGVPYmplY3RzPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBLTVMtZW5jcnlwdGVkIFMzIGJ1Y2tldCBmb3IgbWVtYmVyL2V2ZW50IG1lZGlhIChldmVudCB2aWRlb3MsIHZlbmRvciBsb2dvcyxcbiAqIHByb2ZpbGUgcGhvdG9zKSBmcm9udGVkIGJ5IENsb3VkRnJvbnQgd2l0aCBPcmlnaW4gQWNjZXNzIENvbnRyb2wuXG4gKlxuICogVGhlIGJhY2tlbmQgTGFtYmRhIHdyaXRlcyBkaXJlY3RseSB2aWEgcHJlc2lnbmVkIFBVVCBVUkxzOyBtZW1iZXJzIHJlYWQgdmlhXG4gKiB0aGUgQ2xvdWRGcm9udCBkb21haW4uXG4gKi9cbmV4cG9ydCBjbGFzcyBNZWRpYSBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBidWNrZXQ6IGF3c19zMy5CdWNrZXQ7XG4gIHB1YmxpYyByZWFkb25seSBrZXk6IGF3c19rbXMuS2V5O1xuICBwdWJsaWMgcmVhZG9ubHkgZGlzdHJpYnV0aW9uOiBhd3NfY2xvdWRmcm9udC5EaXN0cmlidXRpb247XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE1lZGlhUHJvcHMgPSB7fSkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCByZW1vdmFsUG9saWN5ID0gcHJvcHMucmVtb3ZhbFBvbGljeSA/PyBSZW1vdmFsUG9saWN5LlJFVEFJTjtcbiAgICBjb25zdCBhdXRvRGVsZXRlT2JqZWN0cyA9IHByb3BzLmF1dG9EZWxldGVPYmplY3RzID8/IGZhbHNlO1xuXG4gICAgdGhpcy5rZXkgPSBuZXcgYXdzX2ttcy5LZXkodGhpcywgXCJrZXlcIiwge1xuICAgICAgZW5hYmxlS2V5Um90YXRpb246IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5LFxuICAgICAgZGVzY3JpcHRpb246IFwiU29jaWFsIEFjdGl2ZSBBcHAgbWVkaWEgYnVja2V0IENNS1wiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYWNjZXNzTG9ncyA9IG5ldyBhd3NfczMuQnVja2V0KHRoaXMsIFwiYWNjZXNzTG9nc1wiLCB7XG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogYXdzX3MzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIGVuY3J5cHRpb246IGF3c19zMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgdmVyc2lvbmVkOiBmYWxzZSxcbiAgICAgIC8vIENsb3VkRnJvbnQgc3RhbmRhcmQgbG9nZ2luZyB3cml0ZXMgdmlhIHRoZSBhd3Nsb2dzZGVsaXZlcnkgY2Fub25pY2FsXG4gICAgICAvLyB1c2VyIGFuZCByZXF1aXJlcyBBQ0xzLiBTMydzIG1vZGVybiBkZWZhdWx0IChCVUNLRVRfT1dORVJfRU5GT1JDRUQpXG4gICAgICAvLyBkaXNhYmxlcyBBQ0xzLCBzbyB3ZSBvcHQgaW50byBCVUNLRVRfT1dORVJfUFJFRkVSUkVEIGhlcmUuXG4gICAgICBvYmplY3RPd25lcnNoaXA6IGF3c19zMy5PYmplY3RPd25lcnNoaXAuQlVDS0VUX09XTkVSX1BSRUZFUlJFRCxcbiAgICAgIHJlbW92YWxQb2xpY3ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0cyxcbiAgICB9KTtcblxuICAgIHRoaXMuYnVja2V0ID0gbmV3IGF3c19zMy5CdWNrZXQodGhpcywgXCJidWNrZXRcIiwge1xuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IGF3c19zMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICBlbmNyeXB0aW9uOiBhd3NfczMuQnVja2V0RW5jcnlwdGlvbi5LTVMsXG4gICAgICBlbmNyeXB0aW9uS2V5OiB0aGlzLmtleSxcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsXG4gICAgICBzZXJ2ZXJBY2Nlc3NMb2dzQnVja2V0OiBhY2Nlc3NMb2dzLFxuICAgICAgc2VydmVyQWNjZXNzTG9nc1ByZWZpeDogXCJzMy9cIixcbiAgICAgIHJlbW92YWxQb2xpY3ksXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0cyxcbiAgICAgIGNvcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBbXG4gICAgICAgICAgICBhd3NfczMuSHR0cE1ldGhvZHMuUFVULFxuICAgICAgICAgICAgYXdzX3MzLkh0dHBNZXRob2RzLkdFVCxcbiAgICAgICAgICAgIGF3c19zMy5IdHRwTWV0aG9kcy5IRUFELFxuICAgICAgICAgIF0sXG4gICAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFtcIipcIl0sXG4gICAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFtcIipcIl0sXG4gICAgICAgICAgZXhwb3NlZEhlYWRlcnM6IFtcIkVUYWdcIl0sXG4gICAgICAgICAgbWF4QWdlOiAzMDAwLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhYm9ydEluY29tcGxldGVNdWx0aXBhcnRVcGxvYWRBZnRlcjogRHVyYXRpb24uZGF5cygzKSxcbiAgICAgICAgICBub25jdXJyZW50VmVyc2lvbkV4cGlyYXRpb246IER1cmF0aW9uLmRheXMoMzApLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIHRoaXMuZGlzdHJpYnV0aW9uID0gbmV3IGF3c19jbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCBcImNmXCIsIHtcbiAgICAgIG1pbmltdW1Qcm90b2NvbFZlcnNpb246XG4gICAgICAgIGF3c19jbG91ZGZyb250LlNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgIGVuYWJsZUxvZ2dpbmc6IHRydWUsXG4gICAgICBsb2dCdWNrZXQ6IGFjY2Vzc0xvZ3MsXG4gICAgICBsb2dGaWxlUHJlZml4OiBcImNmL1wiLFxuICAgICAgZGVmYXVsdEJlaGF2aW9yOiB7XG4gICAgICAgIG9yaWdpbjpcbiAgICAgICAgICBhd3NfY2xvdWRmcm9udF9vcmlnaW5zLlMzQnVja2V0T3JpZ2luLndpdGhPcmlnaW5BY2Nlc3NDb250cm9sKFxuICAgICAgICAgICAgdGhpcy5idWNrZXQsXG4gICAgICAgICAgKSxcbiAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6XG4gICAgICAgICAgYXdzX2Nsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgIGNhY2hlUG9saWN5OiBhd3NfY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGF3c19jbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFELFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENsb3VkRnJvbnQgT0FDIG5lZWRzIGRlY3J5cHQgb24gdGhlIGtleS5cbiAgICB0aGlzLmtleS5ncmFudERlY3J5cHQoXG4gICAgICBuZXcgYXdzX2lhbS5TZXJ2aWNlUHJpbmNpcGFsKFwiY2xvdWRmcm9udC5hbWF6b25hd3MuY29tXCIpLFxuICAgICk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiTWVkaWFCdWNrZXROYW1lXCIsIHsgdmFsdWU6IHRoaXMuYnVja2V0LmJ1Y2tldE5hbWUgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcIk1lZGlhRG9tYWluXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICAgIH0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgdGhpcy5kaXN0cmlidXRpb24sXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtQ0ZSMVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJHZW8tcmVzdHJpY3Rpb25zIGVuZm9yY2VkIGJ5IGFwcC1sZXZlbCBhdXRoLlwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUNGUjJcIixcbiAgICAgICAgICByZWFzb246IFwiV0FGIGF0dGFjaGVkIGF0IGFwcCBlZGdlIGRpc3RyaWJ1dGlvbiwgbm90IHRoaXMgb3JpZ2luLlwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUNGUjRcIixcbiAgICAgICAgICByZWFzb246IFwiRGVmYXVsdCBDbG91ZEZyb250IGNlcnQg4oCUIGRvbWFpbiB3aXJpbmcgaGFuZGxlZCBieSBEbnNTdGFjay5cIixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0cnVlLFxuICAgICk7XG4gIH1cbn1cbiJdfQ==