"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Rsvp = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const cdk_nag_1 = require("cdk-nag");
/**
 * RSVP workflow:
 *  - social Lambda (mutation) signs a per-(member,event) HMAC token and pushes
 *    a message to an SQS queue.
 *  - `rsvpEmailerFn` consumes the queue and sends an SES email containing a
 *    one-click RSVP URL.
 *  - When the invitee clicks the URL, the webapp calls the public (API-key)
 *    `submitRsvp(token, response)` mutation; the mutation verifies the HMAC
 *    signature using the same secret and writes the Rsvp vertex.
 */
class Rsvp extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const removalPolicy = props.removalPolicy ?? aws_cdk_lib_1.RemovalPolicy.RETAIN;
        // HMAC secret for signing / verifying RSVP tokens.
        this.signingSecret = new aws_cdk_lib_1.aws_secretsmanager.Secret(this, "signingSecret", {
            description: "HMAC secret for Social Active App RSVP token signing",
            generateSecretString: {
                passwordLength: 48,
                excludePunctuation: true,
            },
            removalPolicy,
        });
        // Dead-letter for the invite queue.
        const dlq = new aws_cdk_lib_1.aws_sqs.Queue(this, "dlq", {
            enforceSSL: true,
            retentionPeriod: aws_cdk_lib_1.Duration.days(14),
        });
        this.queue = new aws_cdk_lib_1.aws_sqs.Queue(this, "queue", {
            enforceSSL: true,
            visibilityTimeout: aws_cdk_lib_1.Duration.seconds(60),
            deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
        });
        // SES configuration set (so we can track bounces/complaints later).
        const configSet = new aws_cdk_lib_1.aws_ses.ConfigurationSet(this, "configSet", {
            sendingEnabled: true,
        });
        const role = new aws_cdk_lib_1.aws_iam.Role(this, "emailerRole", {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal("lambda.amazonaws.com"),
            managedPolicies: [
                aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
            ],
        });
        role.addToPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ["ses:SendEmail", "ses:SendRawEmail"],
            resources: ["*"],
        }));
        this.emailerFn = new aws_cdk_lib_1.aws_lambda_nodejs.NodejsFunction(this, "emailerFn", {
            runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_22_X,
            architecture: aws_cdk_lib_1.aws_lambda.Architecture.ARM_64,
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            role,
            entry: "./api/lambda/rsvpEmailer.ts",
            depsLockFilePath: "./api/lambda/package-lock.json",
            environment: {
                RSVP_BASE_URL: props.rsvpBaseUrl,
                RSVP_FROM_ADDRESS: props.fromAddress,
                RSVP_CONFIG_SET: configSet.configurationSetName,
            },
            bundling: {
                nodeModules: ["@aws-sdk/client-sesv2"],
            },
        });
        this.emailerFn.addEventSource(new aws_cdk_lib_1.aws_lambda_event_sources.SqsEventSource(this.queue, {
            batchSize: 5,
            reportBatchItemFailures: true,
        }));
        new aws_cdk_lib_1.CfnOutput(this, "RsvpQueueUrl", { value: this.queue.queueUrl });
        new aws_cdk_lib_1.CfnOutput(this, "RsvpSigningSecretArn", {
            value: this.signingSecret.secretArn,
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(role, [
            {
                id: "AwsSolutions-IAM4",
                reason: "Basic Lambda execution managed policy is sufficient.",
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "SES SendEmail requires resource '*' — the from-address is validated on the API side.",
            },
        ], true);
    }
}
exports.Rsvp = Rsvp;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnN2cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJzdnAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBWXFCO0FBQ3JCLDJDQUF1QztBQUN2QyxxQ0FBMEM7QUFVMUM7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBYSxJQUFLLFNBQVEsc0JBQVM7SUFLakMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFnQjtRQUN4RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLElBQUksMkJBQWEsQ0FBQyxNQUFNLENBQUM7UUFFbEUsbURBQW1EO1FBQ25ELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxnQ0FBa0IsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN4RSxXQUFXLEVBQUUsc0RBQXNEO1lBQ25FLG9CQUFvQixFQUFFO2dCQUNwQixjQUFjLEVBQUUsRUFBRTtnQkFDbEIsa0JBQWtCLEVBQUUsSUFBSTthQUN6QjtZQUNELGFBQWE7U0FDZCxDQUFDLENBQUM7UUFFSCxvQ0FBb0M7UUFDcEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxxQkFBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ3pDLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLGVBQWUsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7U0FDbkMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLHFCQUFPLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDNUMsVUFBVSxFQUFFLElBQUk7WUFDaEIsaUJBQWlCLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLGVBQWUsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsZUFBZSxFQUFFLENBQUMsRUFBRTtTQUNwRCxDQUFDLENBQUM7UUFFSCxvRUFBb0U7UUFDcEUsTUFBTSxTQUFTLEdBQUcsSUFBSSxxQkFBTyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDaEUsY0FBYyxFQUFFLElBQUk7U0FDckIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxJQUFJLEdBQUcsSUFBSSxxQkFBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2pELFNBQVMsRUFBRSxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDL0QsZUFBZSxFQUFFO2dCQUNmLHFCQUFPLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUM1QywwQ0FBMEMsQ0FDM0M7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxXQUFXLENBQ2QsSUFBSSxxQkFBTyxDQUFDLGVBQWUsQ0FBQztZQUMxQixPQUFPLEVBQUUsQ0FBQyxlQUFlLEVBQUUsa0JBQWtCLENBQUM7WUFDOUMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFDO1FBRUYsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLCtCQUFpQixDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ3ZFLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ3ZDLFlBQVksRUFBRSx3QkFBVSxDQUFDLFlBQVksQ0FBQyxNQUFNO1lBQzVDLE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDN0IsSUFBSTtZQUNKLEtBQUssRUFBRSw2QkFBNkI7WUFDcEMsZ0JBQWdCLEVBQUUsZ0NBQWdDO1lBQ2xELFdBQVcsRUFBRTtnQkFDWCxhQUFhLEVBQUUsS0FBSyxDQUFDLFdBQVc7Z0JBQ2hDLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxXQUFXO2dCQUNwQyxlQUFlLEVBQUUsU0FBUyxDQUFDLG9CQUFvQjthQUNoRDtZQUNELFFBQVEsRUFBRTtnQkFDUixXQUFXLEVBQUUsQ0FBQyx1QkFBdUIsQ0FBQzthQUN2QztTQUNGLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUMzQixJQUFJLHNDQUF3QixDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFO1lBQ3RELFNBQVMsRUFBRSxDQUFDO1lBQ1osdUJBQXVCLEVBQUUsSUFBSTtTQUM5QixDQUFDLENBQ0gsQ0FBQztRQUVGLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUNwRSxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQzFDLEtBQUssRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7U0FDcEMsQ0FBQyxDQUFDO1FBRUgseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsSUFBSSxFQUNKO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHNEQUFzRDthQUMvRDtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFDSixzRkFBc0Y7YUFDekY7U0FDRixFQUNELElBQUksQ0FDTCxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBakdELG9CQWlHQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxuICBTdGFjayxcbiAgYXdzX2lhbSxcbiAgYXdzX2xhbWJkYSxcbiAgYXdzX2xhbWJkYV9ub2RlanMsXG4gIGF3c19sYW1iZGFfZXZlbnRfc291cmNlcyxcbiAgYXdzX3NxcyxcbiAgYXdzX3NlcyxcbiAgYXdzX3NlY3JldHNtYW5hZ2VyLFxuICBDZm5PdXRwdXQsXG59IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnN2cFByb3BzIHtcbiAgLyoqIFZlcmlmaWVkIFNFUyBcImZyb21cIiBhZGRyZXNzIHVzZWQgZm9yIGludml0ZXMuICovXG4gIGZyb21BZGRyZXNzOiBzdHJpbmc7XG4gIC8qKiBQdWJsaWMgYmFzZSBVUkwgKGUuZy4gaHR0cHM6Ly9hcHAubXVja2VyLmlvKSDigJQgUlNWUCBsaW5rcyBhcmUgYnVpbHQgb2ZmIHRoaXMuICovXG4gIHJzdnBCYXNlVXJsOiBzdHJpbmc7XG4gIHJlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xufVxuXG4vKipcbiAqIFJTVlAgd29ya2Zsb3c6XG4gKiAgLSBzb2NpYWwgTGFtYmRhIChtdXRhdGlvbikgc2lnbnMgYSBwZXItKG1lbWJlcixldmVudCkgSE1BQyB0b2tlbiBhbmQgcHVzaGVzXG4gKiAgICBhIG1lc3NhZ2UgdG8gYW4gU1FTIHF1ZXVlLlxuICogIC0gYHJzdnBFbWFpbGVyRm5gIGNvbnN1bWVzIHRoZSBxdWV1ZSBhbmQgc2VuZHMgYW4gU0VTIGVtYWlsIGNvbnRhaW5pbmcgYVxuICogICAgb25lLWNsaWNrIFJTVlAgVVJMLlxuICogIC0gV2hlbiB0aGUgaW52aXRlZSBjbGlja3MgdGhlIFVSTCwgdGhlIHdlYmFwcCBjYWxscyB0aGUgcHVibGljIChBUEkta2V5KVxuICogICAgYHN1Ym1pdFJzdnAodG9rZW4sIHJlc3BvbnNlKWAgbXV0YXRpb247IHRoZSBtdXRhdGlvbiB2ZXJpZmllcyB0aGUgSE1BQ1xuICogICAgc2lnbmF0dXJlIHVzaW5nIHRoZSBzYW1lIHNlY3JldCBhbmQgd3JpdGVzIHRoZSBSc3ZwIHZlcnRleC5cbiAqL1xuZXhwb3J0IGNsYXNzIFJzdnAgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgcXVldWU6IGF3c19zcXMuUXVldWU7XG4gIHB1YmxpYyByZWFkb25seSBzaWduaW5nU2VjcmV0OiBhd3Nfc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuICBwdWJsaWMgcmVhZG9ubHkgZW1haWxlckZuOiBhd3NfbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogUnN2cFByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHJlbW92YWxQb2xpY3kgPSBwcm9wcy5yZW1vdmFsUG9saWN5ID8/IFJlbW92YWxQb2xpY3kuUkVUQUlOO1xuXG4gICAgLy8gSE1BQyBzZWNyZXQgZm9yIHNpZ25pbmcgLyB2ZXJpZnlpbmcgUlNWUCB0b2tlbnMuXG4gICAgdGhpcy5zaWduaW5nU2VjcmV0ID0gbmV3IGF3c19zZWNyZXRzbWFuYWdlci5TZWNyZXQodGhpcywgXCJzaWduaW5nU2VjcmV0XCIsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkhNQUMgc2VjcmV0IGZvciBTb2NpYWwgQWN0aXZlIEFwcCBSU1ZQIHRva2VuIHNpZ25pbmdcIixcbiAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgIHBhc3N3b3JkTGVuZ3RoOiA0OCxcbiAgICAgICAgZXhjbHVkZVB1bmN0dWF0aW9uOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHJlbW92YWxQb2xpY3ksXG4gICAgfSk7XG5cbiAgICAvLyBEZWFkLWxldHRlciBmb3IgdGhlIGludml0ZSBxdWV1ZS5cbiAgICBjb25zdCBkbHEgPSBuZXcgYXdzX3Nxcy5RdWV1ZSh0aGlzLCBcImRscVwiLCB7XG4gICAgICBlbmZvcmNlU1NMOiB0cnVlLFxuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBEdXJhdGlvbi5kYXlzKDE0KSxcbiAgICB9KTtcblxuICAgIHRoaXMucXVldWUgPSBuZXcgYXdzX3Nxcy5RdWV1ZSh0aGlzLCBcInF1ZXVlXCIsIHtcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHsgcXVldWU6IGRscSwgbWF4UmVjZWl2ZUNvdW50OiA1IH0sXG4gICAgfSk7XG5cbiAgICAvLyBTRVMgY29uZmlndXJhdGlvbiBzZXQgKHNvIHdlIGNhbiB0cmFjayBib3VuY2VzL2NvbXBsYWludHMgbGF0ZXIpLlxuICAgIGNvbnN0IGNvbmZpZ1NldCA9IG5ldyBhd3Nfc2VzLkNvbmZpZ3VyYXRpb25TZXQodGhpcywgXCJjb25maWdTZXRcIiwge1xuICAgICAgc2VuZGluZ0VuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCByb2xlID0gbmV3IGF3c19pYW0uUm9sZSh0aGlzLCBcImVtYWlsZXJSb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcImxhbWJkYS5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGF3c19pYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgXCJzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCIsXG4gICAgICAgICksXG4gICAgICBdLFxuICAgIH0pO1xuICAgIHJvbGUuYWRkVG9Qb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXCJzZXM6U2VuZEVtYWlsXCIsIFwic2VzOlNlbmRSYXdFbWFpbFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXCIqXCJdLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuZW1haWxlckZuID0gbmV3IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIFwiZW1haWxlckZuXCIsIHtcbiAgICAgIHJ1bnRpbWU6IGF3c19sYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgIGFyY2hpdGVjdHVyZTogYXdzX2xhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0LFxuICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICByb2xlLFxuICAgICAgZW50cnk6IFwiLi9hcGkvbGFtYmRhL3JzdnBFbWFpbGVyLnRzXCIsXG4gICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBcIi4vYXBpL2xhbWJkYS9wYWNrYWdlLWxvY2suanNvblwiLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgUlNWUF9CQVNFX1VSTDogcHJvcHMucnN2cEJhc2VVcmwsXG4gICAgICAgIFJTVlBfRlJPTV9BRERSRVNTOiBwcm9wcy5mcm9tQWRkcmVzcyxcbiAgICAgICAgUlNWUF9DT05GSUdfU0VUOiBjb25maWdTZXQuY29uZmlndXJhdGlvblNldE5hbWUsXG4gICAgICB9LFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbm9kZU1vZHVsZXM6IFtcIkBhd3Mtc2RrL2NsaWVudC1zZXN2MlwiXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmVtYWlsZXJGbi5hZGRFdmVudFNvdXJjZShcbiAgICAgIG5ldyBhd3NfbGFtYmRhX2V2ZW50X3NvdXJjZXMuU3FzRXZlbnRTb3VyY2UodGhpcy5xdWV1ZSwge1xuICAgICAgICBiYXRjaFNpemU6IDUsXG4gICAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJSc3ZwUXVldWVVcmxcIiwgeyB2YWx1ZTogdGhpcy5xdWV1ZS5xdWV1ZVVybCB9KTtcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiUnN2cFNpZ25pbmdTZWNyZXRBcm5cIiwge1xuICAgICAgdmFsdWU6IHRoaXMuc2lnbmluZ1NlY3JldC5zZWNyZXRBcm4sXG4gICAgfSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICByb2xlLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTRcIixcbiAgICAgICAgICByZWFzb246IFwiQmFzaWMgTGFtYmRhIGV4ZWN1dGlvbiBtYW5hZ2VkIHBvbGljeSBpcyBzdWZmaWNpZW50LlwiLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTVcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIlNFUyBTZW5kRW1haWwgcmVxdWlyZXMgcmVzb3VyY2UgJyonIOKAlCB0aGUgZnJvbS1hZGRyZXNzIGlzIHZhbGlkYXRlZCBvbiB0aGUgQVBJIHNpZGUuXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZSxcbiAgICApO1xuICB9XG59XG4iXX0=