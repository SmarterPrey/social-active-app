"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservabilityStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const parameter_email_subscriber_1 = require("./constructs/parameter-email-subscriber");
class ObservabilityStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { neptuneClusterId, cloudFrontDistributionId, wafWebAclName, appSyncApiId, lambdaFunctions, userPoolId, } = props;
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
            dashboardName: "socialActiveApp-Observability",
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2JzZXJ2YWJpbGl0eS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm9ic2VydmFiaWxpdHktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBU3FCO0FBRXJCLHFDQUEwQztBQUMxQyx3RkFBbUY7QUFpQm5GLE1BQWEsa0JBQW1CLFNBQVEsbUJBQUs7SUFDM0MsWUFDRSxLQUFnQixFQUNoQixFQUFVLEVBQ1YsS0FBOEI7UUFFOUIsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUNKLGdCQUFnQixFQUNoQix3QkFBd0IsRUFDeEIsYUFBYSxFQUNiLFlBQVksRUFDWixlQUFlLEVBQ2YsVUFBVSxHQUNYLEdBQUcsS0FBSyxDQUFDO1FBRVYsb0VBQW9FO1FBQ3BFLE1BQU0sUUFBUSxHQUFHLElBQUkscUJBQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN0RCxXQUFXLEVBQUUsMkNBQTJDO1lBQ3hELGlCQUFpQixFQUFFLElBQUk7U0FDeEIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxVQUFVLEdBQUcsSUFBSSxxQkFBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3ZELFdBQVcsRUFBRSxzQkFBc0I7WUFDbkMsU0FBUyxFQUFFLFFBQVE7U0FDcEIsQ0FBQyxDQUFDO1FBRUgsVUFBVSxDQUFDLG1CQUFtQixDQUM1QixJQUFJLHFCQUFPLENBQUMsZUFBZSxDQUFDO1lBQzFCLEdBQUcsRUFBRSw0QkFBNEI7WUFDakMsTUFBTSxFQUFFLHFCQUFPLENBQUMsTUFBTSxDQUFDLElBQUk7WUFDM0IsVUFBVSxFQUFFLENBQUMsSUFBSSxxQkFBTyxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3hDLE9BQU8sRUFBRSxDQUFDLGFBQWEsQ0FBQztZQUN4QixTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDO1lBQ2hDLFVBQVUs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S0FBSyxFQUFFLEVBQUU7U0FDVixDQUFDLENBQ0gsQ0FBQztRQUVGLG9FQUFvRTtRQUNwRSx5QkFBZSxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRTtZQUN6QztnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQ0osMkZBQTJGO2dCQUM3RixTQUFTLEVBQUU7b0JBQ1QsdUZBQXVGO2lCQUN4RjthQUNGO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHlEQUF5RDtnQkFDakUsU0FBUyxFQUFFLENBQUMsYUFBYSxDQUFDO2FBQzNCO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUNKLG1GQUFtRjthQUN0RjtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXZmRCxnREF1ZkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBEdXJhdGlvbixcbiAgU3RhY2ssXG4gIFN0YWNrUHJvcHMsXG4gIGF3c19jbG91ZHdhdGNoLFxuICBhd3NfY2xvdWR3YXRjaF9hY3Rpb25zLFxuICBhd3NfaWFtLFxuICBhd3Nfa21zLFxuICBhd3Nfc25zLFxufSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuaW1wb3J0IHsgUGFyYW1ldGVyRW1haWxTdWJzY3JpYmVyIH0gZnJvbSBcIi4vY29uc3RydWN0cy9wYXJhbWV0ZXItZW1haWwtc3Vic2NyaWJlclwiO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2VydmFiaWxpdHlTdGFja1Byb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIC8qKiBOZXB0dW5lIGNsdXN0ZXIgaWRlbnRpZmllciAoZS5nLiBcIm5lcHR1bmVkYmNsdXN0ZXIteHh4XCIpICovXG4gIG5lcHR1bmVDbHVzdGVySWQ6IHN0cmluZztcbiAgLyoqIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIElEICovXG4gIGNsb3VkRnJvbnREaXN0cmlidXRpb25JZDogc3RyaW5nO1xuICAvKiogV0FGIFdlYkFDTCBuYW1lICovXG4gIHdhZldlYkFjbE5hbWU6IHN0cmluZztcbiAgLyoqIEFwcFN5bmMgR3JhcGhRTCBBUEkgSUQgKi9cbiAgYXBwU3luY0FwaUlkOiBzdHJpbmc7XG4gIC8qKiBMYW1iZGEgZnVuY3Rpb25zIHRvIG1vbml0b3I6IGxhYmVsIOKGkiBmdW5jdGlvbiBuYW1lICovXG4gIGxhbWJkYUZ1bmN0aW9uczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgLyoqIENvZ25pdG8gVXNlciBQb29sIElEICovXG4gIHVzZXJQb29sSWQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2VydmFiaWxpdHlTdGFjayBleHRlbmRzIFN0YWNrIHtcbiAgY29uc3RydWN0b3IoXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICBpZDogc3RyaW5nLFxuICAgIHByb3BzOiBPYnNlcnZhYmlsaXR5U3RhY2tQcm9wc1xuICApIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHtcbiAgICAgIG5lcHR1bmVDbHVzdGVySWQsXG4gICAgICBjbG91ZEZyb250RGlzdHJpYnV0aW9uSWQsXG4gICAgICB3YWZXZWJBY2xOYW1lLFxuICAgICAgYXBwU3luY0FwaUlkLFxuICAgICAgbGFtYmRhRnVuY3Rpb25zLFxuICAgICAgdXNlclBvb2xJZCxcbiAgICB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIDilIAgU05TIHRvcGljIGZvciBhbGFybXMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgYWxhcm1LZXkgPSBuZXcgYXdzX2ttcy5LZXkodGhpcywgXCJBbGFybVRvcGljS2V5XCIsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBcIktNUyBrZXkgZm9yIG9ic2VydmFiaWxpdHkgYWxhcm0gU05TIHRvcGljXCIsXG4gICAgICBlbmFibGVLZXlSb3RhdGlvbjogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGFsYXJtVG9waWMgPSBuZXcgYXdzX3Nucy5Ub3BpYyh0aGlzLCBcIkFsYXJtVG9waWNcIiwge1xuICAgICAgZGlzcGxheU5hbWU6IFwiT2JzZXJ2YWJpbGl0eSBBbGFybXNcIixcbiAgICAgIG1hc3RlcktleTogYWxhcm1LZXksXG4gICAgfSk7XG5cbiAgICBhbGFybVRvcGljLmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6IFwiQWxsb3dQdWJsaXNoVGhyb3VnaFNTTE9ubHlcIixcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgICBwcmluY2lwYWxzOiBbbmV3IGF3c19pYW0uQW55UHJpbmNpcGFsKCldLFxuICAgICAgICBhY3Rpb25zOiBbXCJzbnM6UHVibGlzaFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYWxhcm1Ub3BpYy50b3BpY0Fybl0sXG4gICAgICAgIGNvbmRpdGlvbnM6IHsgQm9vbDogeyBcImF3czpTZWN1cmVUcmFuc3BvcnRcIjogXCJmYWxzZVwiIH0gfSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFsbG93IENsb3VkV2F0Y2ggQWxhcm1zIHRvIHB1Ymxpc2hcbiAgICBhbGFybVRvcGljLmFkZFRvUmVzb3VyY2VQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBzaWQ6IFwiQWxsb3dDbG91ZFdhdGNoQWxhcm1QdWJsaXNoXCIsXG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIHByaW5jaXBhbHM6IFtcbiAgICAgICAgICBuZXcgYXdzX2lhbS5TZXJ2aWNlUHJpbmNpcGFsKFwiY2xvdWR3YXRjaC5hbWF6b25hd3MuY29tXCIpLFxuICAgICAgICBdLFxuICAgICAgICBhY3Rpb25zOiBbXCJzbnM6UHVibGlzaFwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYWxhcm1Ub3BpYy50b3BpY0Fybl0sXG4gICAgICB9KVxuICAgICk7XG4gICAgYWxhcm1LZXkuYWRkVG9SZXNvdXJjZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIHNpZDogXCJBbGxvd0Nsb3VkV2F0Y2hVc2VLZXlcIixcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgcHJpbmNpcGFsczogW1xuICAgICAgICAgIG5ldyBhd3NfaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJjbG91ZHdhdGNoLmFtYXpvbmF3cy5jb21cIiksXG4gICAgICAgIF0sXG4gICAgICAgIGFjdGlvbnM6IFtcImttczpEZWNyeXB0XCIsIFwia21zOkdlbmVyYXRlRGF0YUtleSpcIl0sXG4gICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIG5ldyBQYXJhbWV0ZXJFbWFpbFN1YnNjcmliZXIodGhpcywgXCJBbGFybUVtYWlsU3Vic2NyaWJlclwiLCB7XG4gICAgICB0b3BpY0FybjogYWxhcm1Ub3BpYy50b3BpY0FybixcbiAgICAgIHBhcmFtZXRlck5hbWU6IFwiL2dsb2JhbC1hcHAtcGFyYW1zL3Jkc25vdGlmaWNhdGlvbmVtYWlsc1wiLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc25zQWN0aW9uID0gbmV3IGF3c19jbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpO1xuXG4gICAgLy8g4pSA4pSA4pSAIExhbWJkYSBNZXRyaWNzICYgQWxhcm1zIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IGxhbWJkYVdpZGdldHM6IGF3c19jbG91ZHdhdGNoLklXaWRnZXRbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCBbbGFiZWwsIGZuTmFtZV0gb2YgT2JqZWN0LmVudHJpZXMobGFtYmRhRnVuY3Rpb25zKSkge1xuICAgICAgY29uc3QgZXJyb3JNZXRyaWMgPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9MYW1iZGFcIixcbiAgICAgICAgbWV0cmljTmFtZTogXCJFcnJvcnNcIixcbiAgICAgICAgZGltZW5zaW9uc01hcDogeyBGdW5jdGlvbk5hbWU6IGZuTmFtZSB9LFxuICAgICAgICBzdGF0aXN0aWM6IFwiU3VtXCIsXG4gICAgICAgIHBlcmlvZDogRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBkdXJhdGlvbk1ldHJpYyA9IG5ldyBhd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0xhbWJkYVwiLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIkR1cmF0aW9uXCIsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgRnVuY3Rpb25OYW1lOiBmbk5hbWUgfSxcbiAgICAgICAgc3RhdGlzdGljOiBcInA5OVwiLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgaW52b2NhdGlvbnNNZXRyaWMgPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9MYW1iZGFcIixcbiAgICAgICAgbWV0cmljTmFtZTogXCJJbnZvY2F0aW9uc1wiLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm5OYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IHRocm90dGxlc01ldHJpYyA9IG5ldyBhd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL0xhbWJkYVwiLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIlRocm90dGxlc1wiLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEZ1bmN0aW9uTmFtZTogZm5OYW1lIH0sXG4gICAgICAgIHN0YXRpc3RpYzogXCJTdW1cIixcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFsYXJtc1xuICAgICAgY29uc3QgZXJyb3JBbGFybSA9IG5ldyBhd3NfY2xvdWR3YXRjaC5BbGFybShcbiAgICAgICAgdGhpcyxcbiAgICAgICAgYCR7bGFiZWx9LUVycm9yQWxhcm1gLFxuICAgICAgICB7XG4gICAgICAgICAgbWV0cmljOiBlcnJvck1ldHJpYyxcbiAgICAgICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOlxuICAgICAgICAgICAgYXdzX2Nsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yXG4gICAgICAgICAgICAgIC5HUkVBVEVSX1RIQU5fT1JfRVFVQUxfVE9fVEhSRVNIT0xELFxuICAgICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgICBhbGFybURlc2NyaXB0aW9uOiBgTGFtYmRhICR7bGFiZWx9IGVycm9ycyA+PSAxIGluIDUgbWludXRlc2AsXG4gICAgICAgIH1cbiAgICAgICk7XG4gICAgICBlcnJvckFsYXJtLmFkZEFsYXJtQWN0aW9uKHNuc0FjdGlvbik7XG5cbiAgICAgIGNvbnN0IHRocm90dGxlQWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0oXG4gICAgICAgIHRoaXMsXG4gICAgICAgIGAke2xhYmVsfS1UaHJvdHRsZUFsYXJtYCxcbiAgICAgICAge1xuICAgICAgICAgIG1ldHJpYzogdGhyb3R0bGVzTWV0cmljLFxuICAgICAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgICBjb21wYXJpc29uT3BlcmF0b3I6XG4gICAgICAgICAgICBhd3NfY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3JcbiAgICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgICAgdHJlYXRNaXNzaW5nRGF0YTogYXdzX2Nsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgICAgICAgIGFsYXJtRGVzY3JpcHRpb246IGBMYW1iZGEgJHtsYWJlbH0gdGhyb3R0bGVzID49IDEgaW4gNSBtaW51dGVzYCxcbiAgICAgICAgfVxuICAgICAgKTtcbiAgICAgIHRocm90dGxlQWxhcm0uYWRkQWxhcm1BY3Rpb24oc25zQWN0aW9uKTtcblxuICAgICAgbGFtYmRhV2lkZ2V0cy5wdXNoKFxuICAgICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgIHRpdGxlOiBgJHtsYWJlbH0g4oCUIEludm9jYXRpb25zICYgRXJyb3JzYCxcbiAgICAgICAgICBsZWZ0OiBbaW52b2NhdGlvbnNNZXRyaWNdLFxuICAgICAgICAgIHJpZ2h0OiBbZXJyb3JNZXRyaWNdLFxuICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgdGl0bGU6IGAke2xhYmVsfSDigJQgRHVyYXRpb24gKHA5OSkgJiBUaHJvdHRsZXNgLFxuICAgICAgICAgIGxlZnQ6IFtkdXJhdGlvbk1ldHJpY10sXG4gICAgICAgICAgcmlnaHQ6IFt0aHJvdHRsZXNNZXRyaWNdLFxuICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgfSlcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8g4pSA4pSA4pSAIE5lcHR1bmUgTWV0cmljcyAmIEFsYXJtcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBuZXB0dW5lTWV0cmljcyA9IChcbiAgICAgIG1ldHJpY05hbWU6IHN0cmluZyxcbiAgICAgIHN0YXQgPSBcIkF2ZXJhZ2VcIlxuICAgICkgPT5cbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6IFwiQVdTL05lcHR1bmVcIixcbiAgICAgICAgbWV0cmljTmFtZSxcbiAgICAgICAgZGltZW5zaW9uc01hcDogeyBEQkNsdXN0ZXJJZGVudGlmaWVyOiBuZXB0dW5lQ2x1c3RlcklkIH0sXG4gICAgICAgIHN0YXRpc3RpYzogc3RhdCxcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSk7XG5cbiAgICBjb25zdCBuZXB0dW5lQ3B1ID0gbmVwdHVuZU1ldHJpY3MoXCJDUFVVdGlsaXphdGlvblwiKTtcbiAgICBjb25zdCBuZXB0dW5lQ2FwYWNpdHkgPSBuZXB0dW5lTWV0cmljcyhcIlNlcnZlcmxlc3NEYXRhYmFzZUNhcGFjaXR5XCIpO1xuICAgIGNvbnN0IG5lcHR1bmVNZW1vcnkgPSBuZXB0dW5lTWV0cmljcyhcIkZyZWVhYmxlTWVtb3J5XCIpO1xuICAgIGNvbnN0IG5lcHR1bmVHcmVtbGluID0gbmVwdHVuZU1ldHJpY3MoXCJHcmVtbGluUmVxdWVzdHNQZXJTZWNcIik7XG4gICAgY29uc3QgbmVwdHVuZVF1ZXVlID0gbmVwdHVuZU1ldHJpY3MoXCJNYWluUmVxdWVzdFF1ZXVlUGVuZGluZ1JlcXVlc3RzXCIpO1xuICAgIGNvbnN0IG5lcHR1bmVUeE9wZW4gPSBuZXB0dW5lTWV0cmljcyhcIk51bVR4T3BlbmVkXCIsIFwiU3VtXCIpO1xuICAgIGNvbnN0IG5lcHR1bmVUeENvbW1pdCA9IG5lcHR1bmVNZXRyaWNzKFwiTnVtVHhDb21taXR0ZWRcIiwgXCJTdW1cIik7XG5cbiAgICBjb25zdCBuZXB0dW5lQ3B1QWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0oXG4gICAgICB0aGlzLFxuICAgICAgXCJOZXB0dW5lLUNwdUFsYXJtXCIsXG4gICAgICB7XG4gICAgICAgIG1ldHJpYzogbmVwdHVuZUNwdSxcbiAgICAgICAgdGhyZXNob2xkOiA4MCxcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDMsXG4gICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjpcbiAgICAgICAgICBhd3NfY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3JcbiAgICAgICAgICAgIC5HUkVBVEVSX1RIQU5fT1JfRVFVQUxfVE9fVEhSRVNIT0xELFxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBhd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246IFwiTmVwdHVuZSBDUFUgPiA4MCUgZm9yIDE1IG1pbnV0ZXNcIixcbiAgICAgIH1cbiAgICApO1xuICAgIG5lcHR1bmVDcHVBbGFybS5hZGRBbGFybUFjdGlvbihzbnNBY3Rpb24pO1xuXG4gICAgY29uc3QgbmVwdHVuZUNhcGFjaXR5QWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0oXG4gICAgICB0aGlzLFxuICAgICAgXCJOZXB0dW5lLUNhcGFjaXR5QWxhcm1cIixcbiAgICAgIHtcbiAgICAgICAgbWV0cmljOiBuZXB0dW5lQ2FwYWNpdHksXG4gICAgICAgIHRocmVzaG9sZDogNixcbiAgICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDMsXG4gICAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjpcbiAgICAgICAgICBhd3NfY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3JcbiAgICAgICAgICAgIC5HUkVBVEVSX1RIQU5fT1JfRVFVQUxfVE9fVEhSRVNIT0xELFxuICAgICAgICB0cmVhdE1pc3NpbmdEYXRhOiBhd3NfY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgICAgIGFsYXJtRGVzY3JpcHRpb246XG4gICAgICAgICAgXCJOZXB0dW5lIHNlcnZlcmxlc3MgY2FwYWNpdHkgYXBwcm9hY2hpbmcgbWF4ICg+PSA2IG9mIDggTkNVKVwiLFxuICAgICAgfVxuICAgICk7XG4gICAgbmVwdHVuZUNhcGFjaXR5QWxhcm0uYWRkQWxhcm1BY3Rpb24oc25zQWN0aW9uKTtcblxuICAgIGNvbnN0IG5lcHR1bmVRdWV1ZUFsYXJtID0gbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtKFxuICAgICAgdGhpcyxcbiAgICAgIFwiTmVwdHVuZS1RdWV1ZUFsYXJtXCIsXG4gICAgICB7XG4gICAgICAgIG1ldHJpYzogbmVwdHVuZVF1ZXVlLFxuICAgICAgICB0aHJlc2hvbGQ6IDEwLFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOlxuICAgICAgICAgIGF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvclxuICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogXCJOZXB0dW5lIHBlbmRpbmcgcXVldWUgPiAxMCBmb3IgMTAgbWludXRlc1wiLFxuICAgICAgfVxuICAgICk7XG4gICAgbmVwdHVuZVF1ZXVlQWxhcm0uYWRkQWxhcm1BY3Rpb24oc25zQWN0aW9uKTtcblxuICAgIC8vIOKUgOKUgOKUgCBBcHBTeW5jIE1ldHJpY3MgJiBBbGFybXMg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgYXBwU3luY01ldHJpYyA9IChtZXRyaWNOYW1lOiBzdHJpbmcsIHN0YXQgPSBcIlN1bVwiKSA9PlxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogXCJBV1MvQXBwU3luY1wiLFxuICAgICAgICBtZXRyaWNOYW1lLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7IEdyYXBoUUxBUElJZDogYXBwU3luY0FwaUlkIH0sXG4gICAgICAgIHN0YXRpc3RpYzogc3RhdCxcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSk7XG5cbiAgICBjb25zdCBhcHBzeW5jNXh4ID0gYXBwU3luY01ldHJpYyhcIjVYWEVycm9yXCIpO1xuICAgIGNvbnN0IGFwcHN5bmM0eHggPSBhcHBTeW5jTWV0cmljKFwiNFhYRXJyb3JcIik7XG4gICAgY29uc3QgYXBwc3luY0xhdGVuY3kgPSBhcHBTeW5jTWV0cmljKFwiTGF0ZW5jeVwiLCBcInA5OVwiKTtcbiAgICBjb25zdCBhcHBzeW5jUmVxdWVzdHMgPSBhcHBTeW5jTWV0cmljKFwiUmVxdWVzdHNcIik7XG5cbiAgICBjb25zdCBhcHBzeW5jNXh4QWxhcm0gPSBuZXcgYXdzX2Nsb3Vkd2F0Y2guQWxhcm0oXG4gICAgICB0aGlzLFxuICAgICAgXCJBcHBTeW5jLTV4eEFsYXJtXCIsXG4gICAgICB7XG4gICAgICAgIG1ldHJpYzogYXBwc3luYzV4eCxcbiAgICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOlxuICAgICAgICAgIGF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvclxuICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogXCJBcHBTeW5jIDVYWCBlcnJvcnMgPj0gMSBpbiA1IG1pbnV0ZXNcIixcbiAgICAgIH1cbiAgICApO1xuICAgIGFwcHN5bmM1eHhBbGFybS5hZGRBbGFybUFjdGlvbihzbnNBY3Rpb24pO1xuXG4gICAgLy8g4pSA4pSA4pSAIENsb3VkRnJvbnQgTWV0cmljcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBjZk1ldHJpYyA9IChtZXRyaWNOYW1lOiBzdHJpbmcsIHN0YXQgPSBcIlN1bVwiKSA9PlxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogXCJBV1MvQ2xvdWRGcm9udFwiLFxuICAgICAgICBtZXRyaWNOYW1lLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgRGlzdHJpYnV0aW9uSWQ6IGNsb3VkRnJvbnREaXN0cmlidXRpb25JZCxcbiAgICAgICAgICBSZWdpb246IFwiR2xvYmFsXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHN0YXRpc3RpYzogc3RhdCxcbiAgICAgICAgcGVyaW9kOiBEdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSk7XG5cbiAgICBjb25zdCBjZlJlcXVlc3RzID0gY2ZNZXRyaWMoXCJSZXF1ZXN0c1wiKTtcbiAgICBjb25zdCBjZkJ5dGVzRG93bmxvYWRlZCA9IGNmTWV0cmljKFwiQnl0ZXNEb3dubG9hZGVkXCIpO1xuICAgIGNvbnN0IGNmNXh4UmF0ZSA9IGNmTWV0cmljKFwiNXh4RXJyb3JSYXRlXCIsIFwiQXZlcmFnZVwiKTtcbiAgICBjb25zdCBjZjR4eFJhdGUgPSBjZk1ldHJpYyhcIjR4eEVycm9yUmF0ZVwiLCBcIkF2ZXJhZ2VcIik7XG5cbiAgICBjb25zdCBjZjV4eEFsYXJtID0gbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtKFxuICAgICAgdGhpcyxcbiAgICAgIFwiQ2xvdWRGcm9udC01eHhBbGFybVwiLFxuICAgICAge1xuICAgICAgICBtZXRyaWM6IGNmNXh4UmF0ZSxcbiAgICAgICAgdGhyZXNob2xkOiA1LFxuICAgICAgICBldmFsdWF0aW9uUGVyaW9kczogMyxcbiAgICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOlxuICAgICAgICAgIGF3c19jbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvclxuICAgICAgICAgICAgLkdSRUFURVJfVEhBTl9PUl9FUVVBTF9UT19USFJFU0hPTEQsXG4gICAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGF3c19jbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICAgICAgYWxhcm1EZXNjcmlwdGlvbjogXCJDbG91ZEZyb250IDV4eCBlcnJvciByYXRlID4gNSUgZm9yIDE1IG1pbnV0ZXNcIixcbiAgICAgIH1cbiAgICApO1xuICAgIGNmNXh4QWxhcm0uYWRkQWxhcm1BY3Rpb24oc25zQWN0aW9uKTtcblxuICAgIC8vIOKUgOKUgOKUgCBXQUYgTWV0cmljcyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCB3YWZNZXRyaWMgPSAobWV0cmljTmFtZTogc3RyaW5nKSA9PlxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogXCJBV1MvV0FGVjJcIixcbiAgICAgICAgbWV0cmljTmFtZSxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIFdlYkFDTDogd2FmV2ViQWNsTmFtZSxcbiAgICAgICAgICBSZWdpb246IFwidXMtZWFzdC0xXCIsXG4gICAgICAgICAgUnVsZTogXCJBTExcIixcbiAgICAgICAgfSxcbiAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgIGNvbnN0IHdhZkFsbG93ZWQgPSB3YWZNZXRyaWMoXCJBbGxvd2VkUmVxdWVzdHNcIik7XG4gICAgY29uc3Qgd2FmQmxvY2tlZCA9IHdhZk1ldHJpYyhcIkJsb2NrZWRSZXF1ZXN0c1wiKTtcblxuICAgIC8vIOKUgOKUgOKUgCBDb2duaXRvIE1ldHJpY3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgY29nbml0b01ldHJpYyA9IChtZXRyaWNOYW1lOiBzdHJpbmcpID0+XG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiBcIkFXUy9Db2duaXRvXCIsXG4gICAgICAgIG1ldHJpY05hbWUsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgVXNlclBvb2w6IHVzZXJQb29sSWQgfSxcbiAgICAgICAgc3RhdGlzdGljOiBcIlN1bVwiLFxuICAgICAgICBwZXJpb2Q6IER1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KTtcblxuICAgIGNvbnN0IGNvZ25pdG9TaWduSW4gPSBjb2duaXRvTWV0cmljKFwiU2lnbkluU3VjY2Vzc2VzXCIpO1xuICAgIGNvbnN0IGNvZ25pdG9UaHJvdHRsZXMgPSBjb2duaXRvTWV0cmljKFwiU2lnbkluVGhyb3R0bGVzXCIpO1xuICAgIGNvbnN0IGNvZ25pdG9Ub2tlblJlZnJlc2ggPSBjb2duaXRvTWV0cmljKFwiVG9rZW5SZWZyZXNoU3VjY2Vzc2VzXCIpO1xuXG4gICAgLy8g4pSA4pSA4pSAIENsb3VkV2F0Y2ggRGFzaGJvYXJkIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IGRhc2hib2FyZCA9IG5ldyBhd3NfY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgXCJBcHBEYXNoYm9hcmRcIiwge1xuICAgICAgZGFzaGJvYXJkTmFtZTogXCJzb2NpYWxBY3RpdmVBcHAtT2JzZXJ2YWJpbGl0eVwiLFxuICAgIH0pO1xuXG4gICAgLy8gSGVhZGVyXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiBcIiMgc29jaWFsQWN0aXZlQXBwIE9ic2VydmFiaWxpdHkgRGFzaGJvYXJkXFxuUmVhbC10aW1lIG1ldHJpY3MgZm9yIGFsbCBhcHBsaWNhdGlvbiBzZXJ2aWNlc1wiLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIExhbWJkYSByb3cgaGVhZGVyXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiBcIiMjIExhbWJkYSBGdW5jdGlvbnNcIixcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KVxuICAgICk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoLi4ubGFtYmRhV2lkZ2V0cyk7XG5cbiAgICAvLyBOZXB0dW5lIHJvd1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogXCIjIyBBbWF6b24gTmVwdHVuZVwiLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIk5lcHR1bmUg4oCUIENQVSAmIFNlcnZlcmxlc3MgQ2FwYWNpdHlcIixcbiAgICAgICAgbGVmdDogW25lcHR1bmVDcHVdLFxuICAgICAgICByaWdodDogW25lcHR1bmVDYXBhY2l0eV0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiTmVwdHVuZSDigJQgTWVtb3J5ICYgUXVldWVcIixcbiAgICAgICAgbGVmdDogW25lcHR1bmVNZW1vcnldLFxuICAgICAgICByaWdodDogW25lcHR1bmVRdWV1ZV0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiTmVwdHVuZSDigJQgR3JlbWxpbiBSZXF1ZXN0cy9zZWNcIixcbiAgICAgICAgbGVmdDogW25lcHR1bmVHcmVtbGluXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgfSksXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJOZXB0dW5lIOKAlCBUcmFuc2FjdGlvbnMgKE9wZW4gLyBDb21taXR0ZWQpXCIsXG4gICAgICAgIGxlZnQ6IFtuZXB0dW5lVHhPcGVuXSxcbiAgICAgICAgcmlnaHQ6IFtuZXB0dW5lVHhDb21taXRdLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBBcHBTeW5jIHJvd1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLlRleHRXaWRnZXQoe1xuICAgICAgICBtYXJrZG93bjogXCIjIyBBV1MgQXBwU3luY1wiLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIkFwcFN5bmMg4oCUIFJlcXVlc3RzICYgTGF0ZW5jeSAocDk5KVwiLFxuICAgICAgICBsZWZ0OiBbYXBwc3luY1JlcXVlc3RzXSxcbiAgICAgICAgcmlnaHQ6IFthcHBzeW5jTGF0ZW5jeV0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiQXBwU3luYyDigJQgNFhYICYgNVhYIEVycm9yc1wiLFxuICAgICAgICBsZWZ0OiBbYXBwc3luYzR4eF0sXG4gICAgICAgIHJpZ2h0OiBbYXBwc3luYzV4eF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIENsb3VkRnJvbnQgcm93XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guVGV4dFdpZGdldCh7XG4gICAgICAgIG1hcmtkb3duOiBcIiMjIEFtYXpvbiBDbG91ZEZyb250XCIsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSlcbiAgICApO1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiQ2xvdWRGcm9udCDigJQgUmVxdWVzdHMgJiBCeXRlcyBEb3dubG9hZGVkXCIsXG4gICAgICAgIGxlZnQ6IFtjZlJlcXVlc3RzXSxcbiAgICAgICAgcmlnaHQ6IFtjZkJ5dGVzRG93bmxvYWRlZF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiQ2xvdWRGcm9udCDigJQgNFhYICYgNVhYIEVycm9yIFJhdGUgKCUpXCIsXG4gICAgICAgIGxlZnQ6IFtjZjR4eFJhdGVdLFxuICAgICAgICByaWdodDogW2NmNXh4UmF0ZV0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIFdBRiByb3dcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IFwiIyMgQVdTIFdBRlwiLFxuICAgICAgICB3aWR0aDogMjQsXG4gICAgICAgIGhlaWdodDogMSxcbiAgICAgIH0pXG4gICAgKTtcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiBcIldBRiDigJQgQWxsb3dlZCB2cyBCbG9ja2VkIFJlcXVlc3RzXCIsXG4gICAgICAgIGxlZnQ6IFt3YWZBbGxvd2VkXSxcbiAgICAgICAgcmlnaHQ6IFt3YWZCbG9ja2VkXSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQ29nbml0byByb3dcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IFwiIyMgQW1hem9uIENvZ25pdG9cIixcbiAgICAgICAgd2lkdGg6IDI0LFxuICAgICAgICBoZWlnaHQ6IDEsXG4gICAgICB9KVxuICAgICk7XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgYXdzX2Nsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogXCJDb2duaXRvIOKAlCBTaWduLUluICYgVG9rZW4gUmVmcmVzaFwiLFxuICAgICAgICBsZWZ0OiBbY29nbml0b1NpZ25JbiwgY29nbml0b1Rva2VuUmVmcmVzaF0sXG4gICAgICAgIHJpZ2h0OiBbY29nbml0b1Rocm90dGxlc10sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFsYXJtIHN0YXR1cyB3aWRnZXRcbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBhd3NfY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgICAgbWFya2Rvd246IFwiIyMgQWxhcm0gU3RhdHVzXCIsXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgICAgaGVpZ2h0OiAxLFxuICAgICAgfSlcbiAgICApO1xuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGF3c19jbG91ZHdhdGNoLkFsYXJtU3RhdHVzV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6IFwiQWxsIEFsYXJtc1wiLFxuICAgICAgICBhbGFybXM6IFtcbiAgICAgICAgICBuZXB0dW5lQ3B1QWxhcm0sXG4gICAgICAgICAgbmVwdHVuZUNhcGFjaXR5QWxhcm0sXG4gICAgICAgICAgbmVwdHVuZVF1ZXVlQWxhcm0sXG4gICAgICAgICAgYXBwc3luYzV4eEFsYXJtLFxuICAgICAgICAgIGNmNXh4QWxhcm0sXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAyNCxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIOKUgOKUgOKUgCBjZGstbmFnIHN1cHByZXNzaW9ucyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNFwiLFxuICAgICAgICByZWFzb246XG4gICAgICAgICAgXCJBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgcmVxdWlyZWQgZm9yIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3MgLSBDREsgbWFuYWdlZCByZXNvdXJjZVwiLFxuICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICBcIlBvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIixcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgIHJlYXNvbjogXCJXaWxkY2FyZCBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgQ0RLIG1hbmFnZWQgcmVzb3VyY2VzXCIsXG4gICAgICAgIGFwcGxpZXNUbzogW1wiUmVzb3VyY2U6OipcIl0sXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtTDFcIixcbiAgICAgICAgcmVhc29uOlxuICAgICAgICAgIFwiTk9ERUpTXzIyX1ggaXMgdGhlIGxhdGVzdCBzdXBwb3J0ZWQgcnVudGltZSBhdCBkZXBsb3kgdGltZSAtIENESyBtYW5hZ2VkIHJlc291cmNlXCIsXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG59XG4iXX0=