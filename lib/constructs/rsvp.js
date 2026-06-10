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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnN2cC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJzdnAudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBWXFCO0FBQ3JCLDJDQUF1QztBQUN2QyxxQ0FBMEM7QUFVMUM7Ozs7Ozs7OztHQVNHO0FBQ0gsTUFBYSxJQUFLLFNBQVEsc0JBQVM7SUFLakMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFnQjtRQUN4RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLE1BQU0sYUFBYSxHQUFHLEtBQUssQ0FBQyxhQUFhLElBQUksMkJBQWEsQ0FBQyxNQUFNLENBQUM7UUFFbEUsbURBQW1EO1FBQ25ELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxnQ0FBa0IsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN4RSxXQUFXLEVBQUUsc0RBQXNEO1lBQ25FLG9CQUFvQixFQUFFO2dCQUNwQixjQUFjLEVBQUUsRUFBRTtnQkFDbEIsa0JBQWtCLEVBQUUsSUFBSTthQUN6QjtZQUNELGFBQWE7U0FDZCxDQUFDLENBQUM7UUFFSCxvQ0FBb0M7UUFDcEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxxQkFBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ3pDLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLGVBQWUsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7U0FDbkMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLHFCQUFPLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDNUMsVUFBVSxFQUFFLElBQUk7WUFDaEIsaUJBQWlCLEVBQUUsc0JBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ3ZDLGVBQWUsRUFBRSxFQUFFLEtBQUssRUFBRSxHQUFHLEVBQUUsZUFBZSxFQUFFLENBQUMsRUFBRTtTQUNwRCxDQUFDLENBQUM7UUFFSCxvRUFBb0U7UUFDcEUsTUFBTSxTQUFTLEdBQUcsSUFBSSxxQkFBTyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDaEUsY0FBYyxFQUFFLElBQUk7U0FDckIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxJQUFJLEdBQUcsSUFBSSxxQkFBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2pELFNBQVMsRUFBRSxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDL0QsZUFBZSxFQUFFO2dCQUNmLHFCQUFPLENBQUMsYUFBYSxDQUFDLHdCQUF3QixDQUM1QywwQ0FBMEMsQ0FDM0M7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxXQUFXLENBQ2QsSUFBSSxxQkFBTyxDQUFDLGVBQWUsQ0FBQztZQUMxQixPQUFPLEVBQUUsQ0FBQyxlQUFlLEVBQUUsa0JBQWtCLENBQUM7WUFDOUMsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FDSCxDQUFDO1FBRUYsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLCtCQUFpQixDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsV0FBVyxFQUFFO1lBQ3ZFLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ3ZDLFlBQVksRUFBRSx3QkFBVSxDQUFDLFlBQVksQ0FBQyxNQUFNO1lBQzVDLE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDN0IsSUFBSTtZQUNKLEtBQUssRUFBRSw2QkFBNkI7WUFDcEMsV0FBVyxFQUFFO2dCQUNYLGFBQWEsRUFBRSxLQUFLLENBQUMsV0FBVztnQkFDaEMsaUJBQWlCLEVBQUUsS0FBSyxDQUFDLFdBQVc7Z0JBQ3BDLGVBQWUsRUFBRSxTQUFTLENBQUMsb0JBQW9CO2FBQ2hEO1lBQ0QsUUFBUSxFQUFFO2dCQUNSLFdBQVcsRUFBRSxDQUFDLHVCQUF1QixDQUFDO2FBQ3ZDO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQzNCLElBQUksc0NBQXdCLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUU7WUFDdEQsU0FBUyxFQUFFLENBQUM7WUFDWix1QkFBdUIsRUFBRSxJQUFJO1NBQzlCLENBQUMsQ0FDSCxDQUFDO1FBRUYsSUFBSSx1QkFBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDO1FBQ3BFLElBQUksdUJBQVMsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUztTQUNwQyxDQUFDLENBQUM7UUFFSCx5QkFBZSxDQUFDLHVCQUF1QixDQUNyQyxJQUFJLEVBQ0o7WUFDRTtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsc0RBQXNEO2FBQy9EO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLHNGQUFzRjthQUN6RjtTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFoR0Qsb0JBZ0dDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxuICBhd3NfaWFtLFxuICBhd3NfbGFtYmRhLFxuICBhd3NfbGFtYmRhX25vZGVqcyxcbiAgYXdzX2xhbWJkYV9ldmVudF9zb3VyY2VzLFxuICBhd3Nfc3FzLFxuICBhd3Nfc2VzLFxuICBhd3Nfc2VjcmV0c21hbmFnZXIsXG4gIENmbk91dHB1dCxcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSc3ZwUHJvcHMge1xuICAvKiogVmVyaWZpZWQgU0VTIFwiZnJvbVwiIGFkZHJlc3MgdXNlZCBmb3IgaW52aXRlcy4gKi9cbiAgZnJvbUFkZHJlc3M6IHN0cmluZztcbiAgLyoqIFB1YmxpYyBiYXNlIFVSTCAoZS5nLiBodHRwczovL2FwcC5tdWNrZXIuaW8pIOKAlCBSU1ZQIGxpbmtzIGFyZSBidWlsdCBvZmYgdGhpcy4gKi9cbiAgcnN2cEJhc2VVcmw6IHN0cmluZztcbiAgcmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG59XG5cbi8qKlxuICogUlNWUCB3b3JrZmxvdzpcbiAqICAtIHNvY2lhbCBMYW1iZGEgKG11dGF0aW9uKSBzaWducyBhIHBlci0obWVtYmVyLGV2ZW50KSBITUFDIHRva2VuIGFuZCBwdXNoZXNcbiAqICAgIGEgbWVzc2FnZSB0byBhbiBTUVMgcXVldWUuXG4gKiAgLSBgcnN2cEVtYWlsZXJGbmAgY29uc3VtZXMgdGhlIHF1ZXVlIGFuZCBzZW5kcyBhbiBTRVMgZW1haWwgY29udGFpbmluZyBhXG4gKiAgICBvbmUtY2xpY2sgUlNWUCBVUkwuXG4gKiAgLSBXaGVuIHRoZSBpbnZpdGVlIGNsaWNrcyB0aGUgVVJMLCB0aGUgd2ViYXBwIGNhbGxzIHRoZSBwdWJsaWMgKEFQSS1rZXkpXG4gKiAgICBgc3VibWl0UnN2cCh0b2tlbiwgcmVzcG9uc2UpYCBtdXRhdGlvbjsgdGhlIG11dGF0aW9uIHZlcmlmaWVzIHRoZSBITUFDXG4gKiAgICBzaWduYXR1cmUgdXNpbmcgdGhlIHNhbWUgc2VjcmV0IGFuZCB3cml0ZXMgdGhlIFJzdnAgdmVydGV4LlxuICovXG5leHBvcnQgY2xhc3MgUnN2cCBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBxdWV1ZTogYXdzX3Nxcy5RdWV1ZTtcbiAgcHVibGljIHJlYWRvbmx5IHNpZ25pbmdTZWNyZXQ6IGF3c19zZWNyZXRzbWFuYWdlci5TZWNyZXQ7XG4gIHB1YmxpYyByZWFkb25seSBlbWFpbGVyRm46IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBSc3ZwUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3QgcmVtb3ZhbFBvbGljeSA9IHByb3BzLnJlbW92YWxQb2xpY3kgPz8gUmVtb3ZhbFBvbGljeS5SRVRBSU47XG5cbiAgICAvLyBITUFDIHNlY3JldCBmb3Igc2lnbmluZyAvIHZlcmlmeWluZyBSU1ZQIHRva2Vucy5cbiAgICB0aGlzLnNpZ25pbmdTZWNyZXQgPSBuZXcgYXdzX3NlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCBcInNpZ25pbmdTZWNyZXRcIiwge1xuICAgICAgZGVzY3JpcHRpb246IFwiSE1BQyBzZWNyZXQgZm9yIFNvY2lhbCBBY3RpdmUgQXBwIFJTVlAgdG9rZW4gc2lnbmluZ1wiLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgcGFzc3dvcmRMZW5ndGg6IDQ4LFxuICAgICAgICBleGNsdWRlUHVuY3R1YXRpb246IHRydWUsXG4gICAgICB9LFxuICAgICAgcmVtb3ZhbFBvbGljeSxcbiAgICB9KTtcblxuICAgIC8vIERlYWQtbGV0dGVyIGZvciB0aGUgaW52aXRlIHF1ZXVlLlxuICAgIGNvbnN0IGRscSA9IG5ldyBhd3Nfc3FzLlF1ZXVlKHRoaXMsIFwiZGxxXCIsIHtcbiAgICAgIGVuZm9yY2VTU0w6IHRydWUsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IER1cmF0aW9uLmRheXMoMTQpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5xdWV1ZSA9IG5ldyBhd3Nfc3FzLlF1ZXVlKHRoaXMsIFwicXVldWVcIiwge1xuICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogeyBxdWV1ZTogZGxxLCBtYXhSZWNlaXZlQ291bnQ6IDUgfSxcbiAgICB9KTtcblxuICAgIC8vIFNFUyBjb25maWd1cmF0aW9uIHNldCAoc28gd2UgY2FuIHRyYWNrIGJvdW5jZXMvY29tcGxhaW50cyBsYXRlcikuXG4gICAgY29uc3QgY29uZmlnU2V0ID0gbmV3IGF3c19zZXMuQ29uZmlndXJhdGlvblNldCh0aGlzLCBcImNvbmZpZ1NldFwiLCB7XG4gICAgICBzZW5kaW5nRW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJvbGUgPSBuZXcgYXdzX2lhbS5Sb2xlKHRoaXMsIFwiZW1haWxlclJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgYXdzX2lhbS5TZXJ2aWNlUHJpbmNpcGFsKFwibGFtYmRhLmFtYXpvbmF3cy5jb21cIiksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgYXdzX2lhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcbiAgICAgICAgICBcInNlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIixcbiAgICAgICAgKSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgcm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcInNlczpTZW5kRW1haWxcIiwgXCJzZXM6U2VuZFJhd0VtYWlsXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFtcIipcIl0sXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5lbWFpbGVyRm4gPSBuZXcgYXdzX2xhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb24odGhpcywgXCJlbWFpbGVyRm5cIiwge1xuICAgICAgcnVudGltZTogYXdzX2xhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBhd3NfbGFtYmRhLkFyY2hpdGVjdHVyZS5BUk1fNjQsXG4gICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIHJvbGUsXG4gICAgICBlbnRyeTogXCIuL2FwaS9sYW1iZGEvcnN2cEVtYWlsZXIudHNcIixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFJTVlBfQkFTRV9VUkw6IHByb3BzLnJzdnBCYXNlVXJsLFxuICAgICAgICBSU1ZQX0ZST01fQUREUkVTUzogcHJvcHMuZnJvbUFkZHJlc3MsXG4gICAgICAgIFJTVlBfQ09ORklHX1NFVDogY29uZmlnU2V0LmNvbmZpZ3VyYXRpb25TZXROYW1lLFxuICAgICAgfSxcbiAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgIG5vZGVNb2R1bGVzOiBbXCJAYXdzLXNkay9jbGllbnQtc2VzdjJcIl0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5lbWFpbGVyRm4uYWRkRXZlbnRTb3VyY2UoXG4gICAgICBuZXcgYXdzX2xhbWJkYV9ldmVudF9zb3VyY2VzLlNxc0V2ZW50U291cmNlKHRoaXMucXVldWUsIHtcbiAgICAgICAgYmF0Y2hTaXplOiA1LFxuICAgICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZSxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiUnN2cFF1ZXVlVXJsXCIsIHsgdmFsdWU6IHRoaXMucXVldWUucXVldWVVcmwgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcIlJzdnBTaWduaW5nU2VjcmV0QXJuXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNpZ25pbmdTZWNyZXQuc2VjcmV0QXJuLFxuICAgIH0pO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgcm9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU00XCIsXG4gICAgICAgICAgcmVhc29uOiBcIkJhc2ljIExhbWJkYSBleGVjdXRpb24gbWFuYWdlZCBwb2xpY3kgaXMgc3VmZmljaWVudC5cIixcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJTRVMgU2VuZEVtYWlsIHJlcXVpcmVzIHJlc291cmNlICcqJyDigJQgdGhlIGZyb20tYWRkcmVzcyBpcyB2YWxpZGF0ZWQgb24gdGhlIEFQSSBzaWRlLlwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWUsXG4gICAgKTtcbiAgfVxufVxuIl19