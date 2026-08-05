"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const parameter_email_subscriber_1 = require("./constructs/parameter-email-subscriber");
class ObservabilityStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { appName, neptuneClusterId, cloudFrontDistributionId, wafWebAclName, appSyncApiId, lambdaFunctions, userPoolId, } = props;
        // ─── SNS topic for alarms ────────────────────────────────────────
        const alarmKey = new aws_cdk_lib_1.aws_kms.Key(this, "AlarmTopicKey", {
            description: "KMS key for observability alarm SNS topic",
            enableKeyRotation: true,
        });
        const alarmTopic = new aws_cdk_lib_1.aws_sns.Topic(this, "AlarmTopic", {
            displayName: "Observability Alarms",
            masterKey: alarmKey,
        });
        alarmTopic.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowPublishThroughSSLOnly",
            effect: aws_cdk_lib_1.aws_iam.Effect.DENY,
            principals: [new aws_cdk_lib_1.aws_iam.AnyPrincipal()],
            actions: ["sns:Publish"],
            resources: [alarmTopic.topicArn],
            conditions: { Bool: { "aws:SecureTransport": "false" } },
        }));
        // Allow CloudWatch Alarms to publish
        alarmTopic.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowCloudWatchAlarmPublish",
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            principals: [
                new aws_cdk_lib_1.aws_iam.ServicePrincipal("cloudwatch.amazonaws.com"),
            ],
            actions: ["sns:Publish"],
            resources: [alarmTopic.topicArn],
        }));
        alarmKey.addToResourcePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            sid: "AllowCloudWatchUseKey",
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            principals: [
                new aws_cdk_lib_1.aws_iam.ServicePrincipal("cloudwatch.amazonaws.com"),
            ],
            actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
            resources: ["*"],
        }));
        new parameter_email_subscriber_1.ParameterEmailSubscriber(this, "AlarmEmailSubscriber", {
            topicArn: alarmTopic.topicArn,
            parameterName: "/global-app-params/rdsnotificationemails",
        });
        const snsAction = new aws_cdk_lib_1.aws_cloudwatch_actions.SnsAction(alarmTopic);
        // ─── Lambda Metrics & Alarms ─────────────────────────────────────
        const lambdaWidgets = [];
        for (const [label, fnName] of Object.entries(lambdaFunctions)) {
            const errorMetric = new aws_cdk_lib_1.aws_cloudwatch.Metric({
                namespace: "AWS/Lambda",
                metricName: "Errors",
                dimensionsMap: { FunctionName: fnName },
                statistic: "Sum",
                period: aws_cdk_lib_1.Duration.minutes(5),
            });
            const durationMetric = new aws_cdk_lib_1.aws_cloudwatch.Metric({
                namespace: "AWS/Lambda",
                metricName: "Duration",
                dimensionsMap: { FunctionName: fnName },
                statistic: "p99",
                period: aws_cdk_lib_1.Duration.minutes(5),
            });
            const invocationsMetric = new aws_cdk_lib_1.aws_cloudwatch.Metric({
                namespace: "AWS/Lambda",
                metricName: "Invocations",
                dimensionsMap: { FunctionName: fnName },
                statistic: "Sum",
                period: aws_cdk_lib_1.Duration.minutes(5),
            });
            const throttlesMetric = new aws_cdk_lib_1.aws_cloudwatch.Metric({
                namespace: "AWS/Lambda",
                metricName: "Throttles",
                dimensionsMap: { FunctionName: fnName },
                statistic: "Sum",
                period: aws_cdk_lib_1.Duration.minutes(5),
            });
            // Alarms
            const errorAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, `${label}-ErrorAlarm`, {
                metric: errorMetric,
                threshold: 1,
                evaluationPeriods: 1,
                comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                    .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
                alarmDescription: `Lambda ${label} errors >= 1 in 5 minutes`,
            });
            errorAlarm.addAlarmAction(snsAction);
            const throttleAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, `${label}-ThrottleAlarm`, {
                metric: throttlesMetric,
                threshold: 1,
                evaluationPeriods: 1,
                comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                    .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
                treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
                alarmDescription: `Lambda ${label} throttles >= 1 in 5 minutes`,
            });
            throttleAlarm.addAlarmAction(snsAction);
            lambdaWidgets.push(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
                title: `${label} — Invocations & Errors`,
                left: [invocationsMetric],
                right: [errorMetric],
                width: 12,
            }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
                title: `${label} — Duration (p99) & Throttles`,
                left: [durationMetric],
                right: [throttlesMetric],
                width: 12,
            }));
        }
        // ─── Neptune Metrics & Alarms ────────────────────────────────────
        const neptuneMetrics = (metricName, stat = "Average") => new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: "AWS/Neptune",
            metricName,
            dimensionsMap: { DBClusterIdentifier: neptuneClusterId },
            statistic: stat,
            period: aws_cdk_lib_1.Duration.minutes(5),
        });
        const neptuneCpu = neptuneMetrics("CPUUtilization");
        const neptuneCapacity = neptuneMetrics("ServerlessDatabaseCapacity");
        const neptuneMemory = neptuneMetrics("FreeableMemory");
        const neptuneGremlin = neptuneMetrics("GremlinRequestsPerSec");
        const neptuneQueue = neptuneMetrics("MainRequestQueuePendingRequests");
        const neptuneTxOpen = neptuneMetrics("NumTxOpened", "Sum");
        const neptuneTxCommit = neptuneMetrics("NumTxCommitted", "Sum");
        const neptuneCpuAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, "Neptune-CpuAlarm", {
            metric: neptuneCpu,
            threshold: 80,
            evaluationPeriods: 3,
            comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: "Neptune CPU > 80% for 15 minutes",
        });
        neptuneCpuAlarm.addAlarmAction(snsAction);
        const neptuneCapacityAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, "Neptune-CapacityAlarm", {
            metric: neptuneCapacity,
            threshold: 6,
            evaluationPeriods: 3,
            comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: "Neptune serverless capacity approaching max (>= 6 of 8 NCU)",
        });
        neptuneCapacityAlarm.addAlarmAction(snsAction);
        const neptuneQueueAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, "Neptune-QueueAlarm", {
            metric: neptuneQueue,
            threshold: 10,
            evaluationPeriods: 2,
            comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: "Neptune pending queue > 10 for 10 minutes",
        });
        neptuneQueueAlarm.addAlarmAction(snsAction);
        // ─── AppSync Metrics & Alarms ────────────────────────────────────
        const appSyncMetric = (metricName, stat = "Sum") => new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: "AWS/AppSync",
            metricName,
            dimensionsMap: { GraphQLAPIId: appSyncApiId },
            statistic: stat,
            period: aws_cdk_lib_1.Duration.minutes(5),
        });
        const appsync5xx = appSyncMetric("5XXError");
        const appsync4xx = appSyncMetric("4XXError");
        const appsyncLatency = appSyncMetric("Latency", "p99");
        const appsyncRequests = appSyncMetric("Requests");
        const appsync5xxAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, "AppSync-5xxAlarm", {
            metric: appsync5xx,
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: "AppSync 5XX errors >= 1 in 5 minutes",
        });
        appsync5xxAlarm.addAlarmAction(snsAction);
        // ─── CloudFront Metrics ──────────────────────────────────────────
        const cfMetric = (metricName, stat = "Sum") => new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: "AWS/CloudFront",
            metricName,
            dimensionsMap: {
                DistributionId: cloudFrontDistributionId,
                Region: "Global",
            },
            statistic: stat,
            period: aws_cdk_lib_1.Duration.minutes(5),
        });
        const cfRequests = cfMetric("Requests");
        const cfBytesDownloaded = cfMetric("BytesDownloaded");
        const cf5xxRate = cfMetric("5xxErrorRate", "Average");
        const cf4xxRate = cfMetric("4xxErrorRate", "Average");
        const cf5xxAlarm = new aws_cdk_lib_1.aws_cloudwatch.Alarm(this, "CloudFront-5xxAlarm", {
            metric: cf5xxRate,
            threshold: 5,
            evaluationPeriods: 3,
            comparisonOperator: aws_cdk_lib_1.aws_cloudwatch.ComparisonOperator
                .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: aws_cdk_lib_1.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
            alarmDescription: "CloudFront 5xx error rate > 5% for 15 minutes",
        });
        cf5xxAlarm.addAlarmAction(snsAction);
        // ─── WAF Metrics ─────────────────────────────────────────────────
        const wafMetric = (metricName) => new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: "AWS/WAFV2",
            metricName,
            dimensionsMap: {
                WebACL: wafWebAclName,
                Region: "us-east-1",
                Rule: "ALL",
            },
            statistic: "Sum",
            period: aws_cdk_lib_1.Duration.minutes(5),
        });
        const wafAllowed = wafMetric("AllowedRequests");
        const wafBlocked = wafMetric("BlockedRequests");
        // ─── Cognito Metrics ─────────────────────────────────────────────
        const cognitoMetric = (metricName) => new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: "AWS/Cognito",
            metricName,
            dimensionsMap: { UserPool: userPoolId },
            statistic: "Sum",
            period: aws_cdk_lib_1.Duration.minutes(5),
        });
        const cognitoSignIn = cognitoMetric("SignInSuccesses");
        const cognitoThrottles = cognitoMetric("SignInThrottles");
        const cognitoTokenRefresh = cognitoMetric("TokenRefreshSuccesses");
        // ─── CloudWatch Dashboard ────────────────────────────────────────
        const dashboard = new aws_cdk_lib_1.aws_cloudwatch.Dashboard(this, "AppDashboard", {
            dashboardName: `${appName}-Observability`,
        });
        // Header
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "# socialActiveApp Observability Dashboard\nReal-time metrics for all application services",
            width: 24,
            height: 1,
        }));
        // Lambda row header
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## Lambda Functions",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(...lambdaWidgets);
        // Neptune row
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## Amazon Neptune",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "Neptune — CPU & Serverless Capacity",
            left: [neptuneCpu],
            right: [neptuneCapacity],
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "Neptune — Memory & Queue",
            left: [neptuneMemory],
            right: [neptuneQueue],
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "Neptune — Gremlin Requests/sec",
            left: [neptuneGremlin],
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "Neptune — Transactions (Open / Committed)",
            left: [neptuneTxOpen],
            right: [neptuneTxCommit],
            width: 12,
        }));
        // AppSync row
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## AWS AppSync",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "AppSync — Requests & Latency (p99)",
            left: [appsyncRequests],
            right: [appsyncLatency],
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "AppSync — 4XX & 5XX Errors",
            left: [appsync4xx],
            right: [appsync5xx],
            width: 12,
        }));
        // CloudFront row
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## Amazon CloudFront",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "CloudFront — Requests & Bytes Downloaded",
            left: [cfRequests],
            right: [cfBytesDownloaded],
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "CloudFront — 4XX & 5XX Error Rate (%)",
            left: [cf4xxRate],
            right: [cf5xxRate],
            width: 12,
        }));
        // WAF row
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## AWS WAF",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "WAF — Allowed vs Blocked Requests",
            left: [wafAllowed],
            right: [wafBlocked],
            width: 12,
        }));
        // Cognito row
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## Amazon Cognito",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: "Cognito — Sign-In & Token Refresh",
            left: [cognitoSignIn, cognitoTokenRefresh],
            right: [cognitoThrottles],
            width: 12,
        }));
        // Alarm status widget
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: "## Alarm Status",
            width: 24,
            height: 1,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.AlarmStatusWidget({
            title: "All Alarms",
            alarms: [
                neptuneCpuAlarm,
                neptuneCapacityAlarm,
                neptuneQueueAlarm,
                appsync5xxAlarm,
                cf5xxAlarm,
            ],
            width: 24,
        }));
        // ─── cdk-nag suppressions ────────────────────────────────────────
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
            {
                id: "AwsSolutions-IAM4",
                reason: "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access - CDK managed resource",
                appliesTo: [
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                ],
            },
            {
                id: "AwsSolutions-IAM5",
                reason: "Wildcard permissions required for CDK managed resources",
                appliesTo: ["Resource::*"],
            },
            {
                id: "AwsSolutions-L1",
                reason: "NODEJS_22_X is the latest supported runtime at deploy time - CDK managed resource",
            },
        ]);
    }
}
exports.ObservabilityStack = ObservabilityStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9ic2VydmFiaWxpdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBU3FCO0FBRXJCLHFDQUEwQztBQUMxQyx3RkFBbUY7QUFtQm5GLE1BQWEsa0JBQW1CLFNBQVEsbUJBQUs7SUFDM0MsWUFDRSxLQUFnQixFQUNoQixFQUFVLEVBQ1YsS0FBOEI7UUFFOUIsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUNKLE9BQU8sRUFDUCxnQkFBZ0IsRUFDaEIsd0JBQXdCLEVBQ3hCLGFBQWEsRUFDYixZQUFZLEVBQ1osZUFBZSxFQUNmLFVBQVUsR0FDWCxHQUFHLEtBQUssQ0FBQztRQUVWLG9FQUFvRTtRQUNwRSxNQUFNLFFBQVEsR0FBRyxJQUFJLHFCQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdEQsV0FBVyxFQUFFLDJDQUEyQztZQUN4RCxpQkFBaUIsRUFBRSxJQUFJO1NBQ3hCLENBQUMsQ0FBQztRQUVILE1BQU0sVUFBVSxHQUFHLElBQUkscUJBQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUN2RCxXQUFXLEVBQUUsc0JBQXNCO1lBQ25DLFNBQVMsRUFBRSxRQUFRO1NBQ3BCLENBQUMsQ0FBQztRQUVILFVBQVUsQ0FBQyxtQkFBbUIsQ0FDNUIsSUFBSSxxQkFBTyxDQUFDLGVBQWUsQ0FBQztZQUMxQixHQUFHLEVBQUUsNEJBQTRCO1lBQ2pDLE1BQU0sRUFBRSxxQkFBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJO1lBQzNCLFVBQVUsRUFBRSxDQUFDLElBQUkscUJBQU8sQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN4QyxPQUFPLEVBQUUsQ0FBQyxhQUFhLENBQUM7WUFDeEIsU0FBUyxFQUFFLENBQUMsVUFBVSxDQUFDLFFBQVEsQ0FBQztZ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QkFDZixVQUFVO2FBQ1g7WUFDRCxLQUFLLEVBQUUsRUFBRTtTQUNWLENBQUMsQ0FDSCxDQUFDO1FBRUYsb0VBQW9FO1FBQ3BFLHlCQUFlLENBQUMsb0JBQW9CLENBQUMsSUFBSSxFQUFFO1lBQ3pDO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFDSiwyRkFBMkY7Z0JBQzdGLFNBQVMsRUFBRTtvQkFDVCx1RkFBdUY7aUJBQ3hGO2FBQ0Y7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUseURBQXlEO2dCQUNqRSxTQUFTLEVBQUUsQ0FBQyxhQUFhLENBQUM7YUFDM0I7WUFDRDtnQkFDRSxFQUFFLEVBQUUsaUJBQWlCO2dCQUNyQixNQUFNLEVBQ0osbUZBQW1GO2FBQ3RGO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBeGZELGdEQXdmQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIER1cmF0aW9uLFxuICBTdGFjayxcbiAgU3RhY2tQcm9wcyxcbiAgYXdzX2Nsb3Vkd2F0Y2gsXG4gIGF3c19jbG91ZHdhdGNoX2FjdGlvbnMsXG4gIGF3c19pYW0sXG4gIGF3c19rbXMsXG4gIGF3c19zbnMsXG59IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5pbXBvcnQgeyBQYXJhbWV0ZXJFbWFpbFN1YnNjcmliZXIgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL3BhcmFtZXRlci1lbWFpbC1zdWJzY3JpYmVyXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzZXJ2YWJpbGl0eVN0YWNrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgLyoqIEFwcCBuYW1lIHByZWZpeCB1c2VkIGZvciByZXNvdXJjZSBuYW1pbmcgKGUuZy4gXCJwci1tdWNrZXJcIikgKi9cbiAgYXBwTmFtZTogc3RyaW5nO1xuICAvKiogTmVwdHVuZSBjbHVzdGVyIGlkZW50aWZpZXIgKGUuZy4gXCJuZXB0dW5lZGJjbHVzdGVyLXh4eFwiKSAqL1xuICBuZXB0dW5lQ2x1c3RlcklkOiBzdHJpbmc7XG4gIC8qKiBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBJRCAqL1xuICBjbG91ZEZyb250RGlzdHJpYnV0aW9uSWQ6IHN0cmluZztcbiAgLyoqIFdBRiBXZWJBQ0wgbmFtZSAqL1xuICB3YWZXZWJBY2xOYW1lOiBzdHJpbmc7XG4gIC8qKiBBcHBTeW5jIEdyYXBoUUwgQVBJIElEICovXG4gIGFwcFN5bmNBcGlJZDogc3RyaW5nO1xuICAvKiogTGFtYmRhIGZ1bmN0aW9ucyB0byBtb25pdG9yOiBsYWJlbCDihpIgZnVuY3Rpb24gbmFtZSAqL1xuICBsYW1iZGFGdW5jdGlvbnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIC8qKiBDb2duaXRvIFVzZXIgUG9vbCBJRCAqL1xuICB1c2VyUG9vbElkOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBPYnNlcnZhYmlsaXR5U3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHNjb3BlOiBDb25zdHJ1Y3QsXG4gICAgaWQ6IHN0cmluZyxcbiAgICBwcm9wczogT2JzZXJ2YWJpbGl0eVN0YWNrUHJvcHNcbiAgKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7XG4gICAgICBhcHBOYW1lLFxuICAgICAgbmVwdHVuZUNsdXN0ZXJJZCxcbiAgICAgIGNsb3VkRnJvbnREaXN0cmlidXRpb25JZCxcbiAgICAgIHdhZldlYkFjbE5hbWUsXG4gICAgICBhcHBTeW5jQXBpSWQsXG4gICAgICBsYW1iZGFGdW5jdGlvbnMsXG4gICAgICB1c2VyUG9vbElkLFxuICAgIH0gPSBwcm9wcztcblxuICAgIC8vIOKUgOKUgOKUgCBTTlMgdG9waWMgZm9yIGFsYXJtcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBhbGFybUtleSA9IG5ldyBhd3Nfa21zLktleSh0aGlzLCBcIkFsYXJtVG9waWNLZXlcIiwge1xuICAgICAgZGVzY3JpcHRpb246IFwiS01TIGtleSBmb3Igb2JzZXJ2YWJpbGl0eSBhbGFybSBTTlMgdG9waWNcIixcbiAgICAgIGVuYWJsZUtleVJvdGF0aW9uOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYWxhcm1Ub3BpYyA9IG5ldyBhd3Nfc25zLlRvcGljKHRoaXMsIFwiQWxhcm1Ub3BpY1wiLCB7XG4gICAgICBkaXNwbGF5TmFtZTogXCJPYnNlcnZhYmlsaXR5IEFsYXJtc1wiLFxuICAgICAgbWFzdGVyS2V5OiBhbGFybUtleSxcbiAgICB9KTtcblxuICAgIGFsYXJtVG9waWMuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogXCJBbGxvd1B1Ymxpc2hUaHJvdWdoU1NMT25seVwiLFxuICAgICAgICBlZmZlY3Q6IGF3c19pYW0uRWZmZWN0LkRFTlksXG4gICAgICAgIHByaW5jaXBhbHM6IFtuZXcgYXdzX2lhbS5BbnlQcmluY2lwYWwoKV0sXG4gICAgICAgIGFjdGlvbnM6IFtcInNuczpQdWJsaXNoXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFthbGFybVRvcGljLnRvcGljQXJuXSxcbiAgICAgICAgY29uZGl0aW9uczogeyBCb29sOiB7IFwiYXdzOlNlY3VyZVRyYW5zcG9ydFwiOiBcImZhbHNlXCIgfSB9LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQWxsb3cgQ2xvdWRXYXRjaCBBbGFybXMgdG8gcHVibGlzaFxuICAgIGFsYXJtVG9waWMuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogXCJBbGxvd0Nsb3VkV2F0Y2hBbGFybVB1Ymxpc2hcIixcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW1xuICAgICAgICAgIG5ldyBhd3NfaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJjbG91ZHdhdGNoLmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIF0sXG4gICAgICAgIGFjdGlvbnM6IFtcInNuczpQdWJsaXNoXCJdLFxuICAgICAgICByZXNvdXJjZXM6IFthbGFybVRvcGljLnRvcGljQXJuXSxcbiAgICAgIH0pXG4gICAgKTtcbiAgICBhbGFybUtleS5hZGRUb1Jlc291cmNlUG9saWN5KFxuICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgc2lkOiBcIkFsbG93Q2xvdWRXYXRjaFVzZUtleVwiLFxuICAgICAgICBlZmZlY3Q6IGF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBwcmluY2lwYWxzOiBbXG4gICAgICAgICAgbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcImNsb3Vkd2F0Y2guYW1hem9uYXdzLmNvbVwiKSxcbiAgICAgICAgXSxcbiAgICAgICAgYWN0aW9uczogW1wia21zOkRlY3J5cHRcIiwgXCJrbXM6R2VuZXJhdGVEYXRhS2V5KlwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXCIqXCJdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgbmV3IFBhcmFtZXRlckVtYWlsU3Vic2NyaWJlcih0aGlzLCBcIkFsYXJtRW1haWxTdWJzY3JpYmVyXCIsIHtcbiAgICAgIHRvcGljQXJuOiBhbGFybVRvcGljLnRvcGljQXJuLFxuICAgICAgcGFyYW1ldGVyTmFtZTogXCIvZ2xvYmFsLWFwcC1wYXJhbXMvcmRzbm90aWZpY2F0aW9uZW1haWxzXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBzbnNBY3Rpb24gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYyk7XG5cbiAgICAvLyDilIDilIDilIAgTGFtYmRhIE1ldHJpY3MgJiBBbGFybXMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgbGFtYmRhV2lkZ2V0czogYXdzX2Nsb3Vkd2F0Y2guSVdpZGdldFtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IFtsYWJlbCwgZm5OYW1lXSBvZiBPYmplY3QuZW50cmllcyhsYW1iZGFGdW5jdGlvbnMpKSB7XG4gICAgICBjb25zdCBlcnJvck1ldHJpYyA9IG5ldyBhd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0xhbWJkYVwiLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIkVycm9yc1wiLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm5OYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGR1cmF0aW9uTWV0cmljID0gbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogXCJBV1MvTGFtYmRhXCIsXG4gICAgICAgIG1ldHJpY05hbWU6IFwiRHVyYXRpb25cIixcbiAgICAgICAgZGltZW5zaW9uc01hcDogeyBGdW5jdGlvbk5hbWU6IGZuTmFtZSB9LFxuICAgICAgICBzdGF0aXN0aWM6IFwicDk5XCIsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBpbnZvY2F0aW9uc01ldHJpYyA9IG5ldyBhd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0xhbWJkYVwiLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIkludm9jYXRpb25zXCIsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRnVuY3Rpb25OYW1lOiBmbk5hbWUgfSxcbiAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgdGhyb3R0bGVzTWV0cmljID0gbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogXCJBV1MvTGFtYmRhXCIsXG4gICAgICAgIG1ldHJpY05hbWU6IFwiVGhyb3R0bGVzXCIsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRnVuY3Rpb25OYW1lOiBmbk5hbWUgfSxcbiAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgICAgLy8gQWxhcm1zXG4gICAgICBjb25zdCBlcnJvckFsYXJtID0gbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtKFxuICAgICAgICB0aGlzLFxuICAgICAgICBgJHtsYWJlbH0tRXJyb3JBbGFybWAsXG4gICAgICAgIHtcbiAgICAgICAgICBtZXRyaWM6IGVycm9yTWV0cmljLFxuICAgICAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6XG4gICAgICAgICAgICBhd3NfY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3JcbiAgICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGBMYW1iZGEgJHtsYWJlbH0gZXJyb3JzID49IDEgaW4gNSBtaW51dGVzYCxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICAgIGVycm9yQWxhcm0uYWRkQWxhcm1BY3Rpb24oc25zQWN0aW9uKTtcblxuICAgICAgY29uc3QgdGhyb3R0bGVBbGFybSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYCR7bGFiZWx9LVRocm90dGxlQWxhcm1gLFxuICAgICAgICB7XG4gICAgICAgICAgbWV0cmljOiB0aHJvdHRsZXNNZXRyaWMsXG4gICAgICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjpcbiAgICAgICAgICAgIGF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvclxuICAgICAgICAgICAgICAuR1JFQVRFUl9USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBhd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogYExhbWJkYSAke2xhYmVsfSB0aHJvdHRsZXMgPj0gMSBpbiA1IG1pbnV0ZXNgLFxuICAgICAgICB9XG4gICAgICApO1xuICAgICAgdGhyb3R0bGVBbGFybS5hZGRBbGFybUFjdGlvbihzbnNBY3Rpb24pO1xuXG4gICAgICBsYW1iZGFXaWRnZXRzLnB1c2goXG4gICAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgdGl0bGU6IGAke2xhYmVsfSDigJQgSW52b2NhdGlvbnMgJiBFcnJvcnNgLFxuICAgICAgICAgIGxlZnQ6IFtpbnZvY2F0aW9uc01ldHJpY10sXG4gICAgICAgICAgcmlnaHQ6IFtlcnJvck1ldHJpY10sXG4gICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICB0aXRsZTogYCR7bGFiZWx9IOKAlCBEdXJhdGlvbiAocDk5KSAmIFRocm90dGxlc2AsXG4gICAgICAgICAgbGVmdDogW2R1cmF0aW9uTWV0cmljXSxcbiAgICAgICAgICByaWdodDogW3Rocm90dGxlc01ldHJpY10sXG4gICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICB9KVxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyDilIDilIDilIAgTmVwdHVuZSBNZXRyaWNzICYgQWxhcm1zIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IG5lcHR1bmVNZXRyaWNzID0gKFxuICAgICAgbWV0cmljTmFtZTogc3RyaW5nLFxuICAgICAgc3RhdCA9IFwiQXZlcmFnZVwiXG4gICAgKSA9PlxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogXCJBV1MvTmVwdHVuZVwiLFxuICAgICAgICBtZXRyaWNOYW1lLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IERCQ2x1c3RlcklkZW50aWZpZXI6IG5lcHR1bmVDbHVzdGVySWQgfSxcbiAgICAgICAgc3RhdGlzdGljOiBzdGF0LFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgIGNvbnN0IG5lcHR1bmVDcHUgPSBuZXB0dW5lTWV0cmljcyhcIkNQVVV0aWxpemF0aW9uXCIpO1xuICAgIGNvbnN0IG5lcHR1bmVDYXBhY2l0eSA9IG5lcHR1bmVNZXRyaWNzKFwiU2VydmVybGVzc0RhdGFiYXNlQ2FwYWNpdHlcIik7XG4gICAgY29uc3QgbmVwdHVuZU1lbW9yeSA9IG5lcHR1bmVNZXRyaWNzKFwiRnJlZWFibGVNZW1vcnlcIik7XG4gICAgY29uc3QgbmVwdHVuZUdyZW1saW4gPSBuZXB0dW5lTWV0cmljcyhcIkdyZW1saW5SZXF1ZXN0c1BlclNlY1wiKTtcbiAgICBjb25zdCBuZXB0dW5lUXVldWUgPSBuZXB0dW5lTWV0cmljcyhcIk1haW5SZXF1ZXN0UXVldWVQZW5kaW5nUmVxdWVzdHNcIik7XG4gICAgY29uc3QgbmVwdHVuZVR4T3BlbiA9IG5lcHR1bmVNZXRyaWNzKFwiTnVtVHhPcGVuZWRcIiwgXCJTdW1cIik7XG4gICAgY29uc3QgbmVwdHVuZVR4Q29tbWl0ID0gbmVwdHVuZU1ldHJpY3MoXCJOdW1UeENvbW1pdHRlZFwiLCBcIlN1bVwiKTtcblxuICAgIGNvbnN0IG5lcHR1bmVDcHVBbGFybSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgIHRoaXMsXG4gICAgICBcIk5lcHR1bmUtQ3B1QWxhcm1cIixcbiAgICAgIHtcbiAgICAgICAgbWV0cmljOiBuZXB0dW5lQ3B1LFxuICAgICAgICB0aHJlc2hvbGQ6IDgwLFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOlxuICAgICAgICAgIGF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvclxuICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogXCJOZXB0dW5lIENQVSA+IDgwJSBmb3IgMTUgbWludXRlc1wiLFxuICAgICAgfVxuICAgICk7XG4gICAgbmVwdHVuZUNwdUFsYXJtLmFkZEFsYXJtQWN0aW9uKHNuc0FjdGlvbik7XG5cbiAgICBjb25zdCBuZXB0dW5lQ2FwYWNpdHlBbGFybSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgIHRoaXMsXG4gICAgICBcIk5lcHR1bmUtQ2FwYWNpdHlBbGFybVwiLFxuICAgICAge1xuICAgICAgICBtZXRyaWM6IG5lcHR1bmVDYXBhY2l0eSxcbiAgICAgICAgdGhyZXNob2xkOiA2LFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOlxuICAgICAgICAgIGF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvclxuICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjpcbiAgICAgICAgICBcIk5lcHR1bmUgc2VydmVybGVzcyBjYXBhY2l0eSBhcHByb2FjaGluZyBtYXggKD49IDYgb2YgOCBOQ1UpXCIsXG4gICAgICB9XG4gICAgKTtcbiAgICBuZXB0dW5lQ2FwYWNpdHlBbGFybS5hZGRBbGFybUFjdGlvbihzbnNBY3Rpb24pO1xuXG4gICAgY29uc3QgbmVwdHVuZVF1ZXVlQWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0oXG4gICAgICB0aGlzLFxuICAgICAgXCJOZXB0dW5lLVF1ZXVlQWxhcm1cIixcbiAgICAgIHtcbiAgICAgICAgbWV0cmljOiBuZXB0dW5lUXVldWUsXG4gICAgICAgIHRocmVzaG9sZDogMTAsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6XG4gICAgICAgICAgYXdzX2Nsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yXG4gICAgICAgICAgICAuR1JFQVRFUl9USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBcIk5lcHR1bmUgcGVuZGluZyBxdWV1ZSA+IDEwIGZvciAxMCBtaW51dGVzXCIsXG4gICAgICB9XG4gICAgKTtcbiAgICBuZXB0dW5lUXVldWVBbGFybS5hZGRBbGFybUFjdGlvbihzbnNBY3Rpb24pO1xuXG4gICAgLy8g4pSA4pSA4pSAIEFwcFN5bmMgTWV0cmljcyAmIEFsYXJtcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBhcHBTeW5jTWV0cmljID0gKG1ldHJpY05hbWU6IHN0cmluZywgc3RhdCA9IFwiU3VtXCIpID0+XG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9BcHBTeW5jXCIsXG4gICAgICAgIG1ldHJpY05hbWUsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgR3JhcGhRTEFQSUlkOiBhcHBTeW5jQXBpSWQgfSxcbiAgICAgICAgc3RhdGlzdGljOiBzdGF0LFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgIGNvbnN0IGFwcHN5bmM1eHggPSBhcHBTeW5jTWV0cmljKFwiNVhYRXJyb3JcIik7XG4gICAgY29uc3QgYXBwc3luYzR4eCA9IGFwcFN5bmNNZXRyaWMoXCI0WFhFcnJvclwiKTtcbiAgICBjb25zdCBhcHBzeW5jTGF0ZW5jeSA9IGFwcFN5bmNNZXRyaWMoXCJMYXRlbmN5XCIsIFwicDk5XCIpO1xuICAgIGNvbnN0IGFwcHN5bmNSZXF1ZXN0cyA9IGFwcFN5bmNNZXRyaWMoXCJSZXF1ZXN0c1wiKTtcblxuICAgIGNvbnN0IGFwcHN5bmM1eHhBbGFybSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgIHRoaXMsXG4gICAgICBcIkFwcFN5bmMtNXh4QWxhcm1cIixcbiAgICAgIHtcbiAgICAgICAgbWV0cmljOiBhcHBzeW5jNXh4LFxuICAgICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6XG4gICAgICAgICAgYXdzX2Nsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yXG4gICAgICAgICAgICAuR1JFQVRFUl9USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBcIkFwcFN5bmMgNVhYIGVycm9ycyA+PSAxIGluIDUgbWludXRlc1wiLFxuICAgICAgfVxuICAgICk7XG4gICAgYXBwc3luYzV4eEFsYXJtLmFkZEFsYXJtQWN0aW9uKHNuc0FjdGlvbik7XG5cbiAgICAvLyDilIDilIDilIAgQ2xvdWRGcm9udCBNZXRyaWNzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IGNmTWV0cmljID0gKG1ldHJpY05hbWU6IHN0cmluZywgc3RhdCA9IFwiU3VtXCIpID0+XG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9DbG91ZEZyb250XCIsXG4gICAgICAgIG1ldHJpY05hbWUsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBEaXN0cmlidXRpb25JZDogY2xvdWRGcm9udERpc3RyaWJ1dGlvbklkLFxuICAgICAgICAgIFJlZ2lvbjogXCJHbG9iYWxcIixcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdGlzdGljOiBzdGF0LFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgIGNvbnN0IGNmUmVxdWVzdHMgPSBjZk1ldHJpYyhcIlJlcXVlc3RzXCIpO1xuICAgIGNvbnN0IGNmQnl0ZXNEb3dubG9hZGVkID0gY2ZNZXRyaWMoXCJCeXRlc0Rvd25sb2FkZWRcIik7XG4gICAgY29uc3QgY2Y1eHhSYXRlID0gY2ZNZXRyaWMoXCI1eHhFcnJvclJhdGVcIiwgXCJBdmVyYWdlXCIpO1xuICAgIGNvbnN0IGNmNHh4UmF0ZSA9IGNmTWV0cmljKFwiNHh4RXJyb3JSYXRlXCIsIFwiQXZlcmFnZVwiKTtcblxuICAgIGNvbnN0IGNmNXh4QWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0oXG4gICAgICB0aGlzLFxuICAgICAgXCJDbG91ZEZyb250LTV4eEFsYXJtXCIsXG4gICAgICB7XG4gICAgICAgIG1ldHJpYzogY2Y1eHhSYXRlLFxuICAgICAgICB0aHJlc2hvbGQ6IDUsXG4gICAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAzLFxuICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6XG4gICAgICAgICAgYXdzX2Nsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yXG4gICAgICAgICAgICAuR1JFQVRFUl9USEFOX09SX0VRVUFMX1RPX1RIUkVTSE9MRCxcbiAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBcIkNsb3VkRnJvbnQgNXh4IGVycm9yIHJhdGUgPiA1JSBmb3IgMTUgbWludXRlc1wiLFxuICAgICAgfVxuICAgICk7XG4gICAgY2Y1eHhBbGFybS5hZGRBbGFybUFjdGlvbihzbnNBY3Rpb24pO1xuXG4gICAgLy8g4pSA4pSA4pSAIFdBRiBNZXRyaWNzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IHdhZk1ldHJpYyA9IChtZXRyaWNOYW1lOiBzdHJpbmcpID0+XG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9XQUZWMlwiLFxuICAgICAgICBtZXRyaWNOYW1lLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgV2ViQUNMOiB3YWZXZWJBY2xOYW1lLFxuICAgICAgICAgIFJlZ2lvbjogXCJ1cy1lYXN0LTFcIixcbiAgICAgICAgICBSdWxlOiBcIkFMTFwiLFxuICAgICAgICB9LFxuICAgICAgICBzdGF0aXN0aWM6IFwiU3VtXCIsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pO1xuXG4gICAgY29uc3Qgd2FmQWxsb3dlZCA9IHdhZk1ldHJpYyhcIkFsbG93ZWRSZXF1ZXN0c1wiKTtcbiAgICBjb25zdCB3YWZCbG9ja2VkID0gd2FmTWV0cmljKFwiQmxvY2tlZFJlcXVlc3RzXCIpO1xuXG4gICAgLy8g4pSA4pSA4pSAIENvZ25pdG8gTWV0cmljcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBjb2duaXRvTWV0cmljID0gKG1ldHJpY05hbWU6IHN0cmluZykgPT5cbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0NvZ25pdG9cIixcbiAgICAgICAgbWV0cmljTmFtZSxcbiAgICAgICAgZGltZW5zaW9uc01hcDogeyBVc2VyUG9vbDogdXNlclBvb2xJZCB9LFxuICAgICAgICBzdGF0aXN0aWM6IFwiU3VtXCIsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgY29nbml0b1NpZ25JbiA9IGNvZ25pdG9NZXRyaWMoXCJTaWduSW5TdWNjZXNzZXNcIik7XG4gICAgY29uc3QgY29nbml0b1Rocm90dGxlcyA9IGNvZ25pdG9NZXRyaWMoXCJTaWduSW5UaHJvdHRsZXNcIik7XG4gICAgY29uc3QgY29nbml0b1Rva2VuUmVmcmVzaCA9IGNvZ25pdG9NZXRyaWMoXCJUb2tlblJlZnJlc2hTdWNjZXNzZXNcIik7XG5cbiAgICAvLyDilIDilIDilIAgQ2xvdWRXYXRjaCBEYXNoYm9hcmQg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGF3c19jbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCBcIkFwcERhc2hib2FyZFwiLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgJHthcHBOYW1lfS1PYnNlcnZhYmlsaXR5YCxcbiAgICB9KTtcblxuICAgIC8vIEhlYWRlclxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogXCIjIHNvY2lhbEFjdGl2ZUFwcCBPYnNlcnZhYmlsaXR5IERhc2hib2FyZFxcblJlYWwtdGltZSBtZXRyaWNzIGZvciBhbGwgYXBwbGljYXRpb24gc2VydmljZXNcIixcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBMYW1iZGEgcm93IGhlYWRlclxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogXCIjIyBMYW1iZGEgRnVuY3Rpb25zXCIsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSlcbiAgICApO1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKC4uLmxhbWJkYVdpZGdldHMpO1xuXG4gICAgLy8gTmVwdHVuZSByb3dcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IFwiIyMgQW1hem9uIE5lcHR1bmVcIixcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KVxuICAgICk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJOZXB0dW5lIOKAlCBDUFUgJiBTZXJ2ZXJsZXNzIENhcGFjaXR5XCIsXG4gICAgICAgIGxlZnQ6IFtuZXB0dW5lQ3B1XSxcbiAgICAgICAgcmlnaHQ6IFtuZXB0dW5lQ2FwYWNpdHldLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KSxcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIk5lcHR1bmUg4oCUIE1lbW9yeSAmIFF1ZXVlXCIsXG4gICAgICAgIGxlZnQ6IFtuZXB0dW5lTWVtb3J5XSxcbiAgICAgICAgcmlnaHQ6IFtuZXB0dW5lUXVldWVdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KSxcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIk5lcHR1bmUg4oCUIEdyZW1saW4gUmVxdWVzdHMvc2VjXCIsXG4gICAgICAgIGxlZnQ6IFtuZXB0dW5lR3JlbWxpbl0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiTmVwdHVuZSDigJQgVHJhbnNhY3Rpb25zIChPcGVuIC8gQ29tbWl0dGVkKVwiLFxuICAgICAgICBsZWZ0OiBbbmVwdHVuZVR4T3Blbl0sXG4gICAgICAgIHJpZ2h0OiBbbmVwdHVuZVR4Q29tbWl0XSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQXBwU3luYyByb3dcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IFwiIyMgQVdTIEFwcFN5bmNcIixcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KVxuICAgICk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJBcHBTeW5jIOKAlCBSZXF1ZXN0cyAmIExhdGVuY3kgKHA5OSlcIixcbiAgICAgICAgbGVmdDogW2FwcHN5bmNSZXF1ZXN0c10sXG4gICAgICAgIHJpZ2h0OiBbYXBwc3luY0xhdGVuY3ldLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KSxcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkFwcFN5bmMg4oCUIDRYWCAmIDVYWCBFcnJvcnNcIixcbiAgICAgICAgbGVmdDogW2FwcHN5bmM0eHhdLFxuICAgICAgICByaWdodDogW2FwcHN5bmM1eHhdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBDbG91ZEZyb250IHJvd1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogXCIjIyBBbWF6b24gQ2xvdWRGcm9udFwiLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkNsb3VkRnJvbnQg4oCUIFJlcXVlc3RzICYgQnl0ZXMgRG93bmxvYWRlZFwiLFxuICAgICAgICBsZWZ0OiBbY2ZSZXF1ZXN0c10sXG4gICAgICAgIHJpZ2h0OiBbY2ZCeXRlc0Rvd25sb2FkZWRdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KSxcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkNsb3VkRnJvbnQg4oCUIDRYWCAmIDVYWCBFcnJvciBSYXRlICglKVwiLFxuICAgICAgICBsZWZ0OiBbY2Y0eHhSYXRlXSxcbiAgICAgICAgcmlnaHQ6IFtjZjV4eFJhdGVdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBXQUYgcm93XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiBcIiMjIEFXUyBXQUZcIixcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KVxuICAgICk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJXQUYg4oCUIEFsbG93ZWQgdnMgQmxvY2tlZCBSZXF1ZXN0c1wiLFxuICAgICAgICBsZWZ0OiBbd2FmQWxsb3dlZF0sXG4gICAgICAgIHJpZ2h0OiBbd2FmQmxvY2tlZF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIENvZ25pdG8gcm93XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiBcIiMjIEFtYXpvbiBDb2duaXRvXCIsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSlcbiAgICApO1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiQ29nbml0byDigJQgU2lnbi1JbiAmIFRva2VuIFJlZnJlc2hcIixcbiAgICAgICAgbGVmdDogW2NvZ25pdG9TaWduSW4sIGNvZ25pdG9Ub2tlblJlZnJlc2hdLFxuICAgICAgICByaWdodDogW2NvZ25pdG9UaHJvdHRsZXNdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBBbGFybSBzdGF0dXMgd2lkZ2V0XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiBcIiMjIEFsYXJtIFN0YXR1c1wiLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybVN0YXR1c1dpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkFsbCBBbGFybXNcIixcbiAgICAgICAgYWxhcm1zOiBbXG4gICAgICAgICAgbmVwdHVuZUNwdUFsYXJtLFxuICAgICAgICAgIG5lcHR1bmVDYXBhY2l0eUFsYXJtLFxuICAgICAgICAgIG5lcHR1bmVRdWV1ZUFsYXJtLFxuICAgICAgICAgIGFwcHN5bmM1eHhBbGFybSxcbiAgICAgICAgICBjZjV4eEFsYXJtLFxuICAgICAgICBdLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyDilIDilIDilIAgY2RrLW5hZyBzdXBwcmVzc2lvbnMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKHRoaXMsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTRcIixcbiAgICAgICAgcmVhc29uOlxuICAgICAgICAgIFwiQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIGlzIHJlcXVpcmVkIGZvciBDbG91ZFdhdGNoIExvZ3MgYWNjZXNzIC0gQ0RLIG1hbmFnZWQgcmVzb3VyY2VcIixcbiAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgXCJQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCIsXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICByZWFzb246IFwiV2lsZGNhcmQgcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIENESyBtYW5hZ2VkIHJlc291cmNlc1wiLFxuICAgICAgICBhcHBsaWVzVG86IFtcIlJlc291cmNlOjoqXCJdLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUwxXCIsXG4gICAgICAgIHJlYXNvbjpcbiAgICAgICAgICBcIk5PREVKU18yMl9YIGlzIHRoZSBsYXRlc3Qgc3VwcG9ydGVkIHJ1bnRpbWUgYXQgZGVwbG95IHRpbWUgLSBDREsgbWFuYWdlZCByZXNvdXJjZVwiLFxuICAgICAgfSxcbiAgICBdKTtcbiAgfVxufVxuIl19