import {
  Duration,
  Stack,
  StackProps,
  aws_cloudwatch,
  aws_cloudwatch_actions,
  aws_iam,
  aws_kms,
  aws_sns,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";
import { ParameterEmailSubscriber } from "./constructs/parameter-email-subscriber";

export interface ObservabilityStackProps extends StackProps {
  /** Neptune cluster identifier (e.g. "neptunedbcluster-xxx") */
  neptuneClusterId: string;
  /** CloudFront distribution ID */
  cloudFrontDistributionId: string;
  /** WAF WebACL name */
  wafWebAclName: string;
  /** AppSync GraphQL API ID */
  appSyncApiId: string;
  /** Lambda functions to monitor: label → function name */
  lambdaFunctions: Record<string, string>;
  /** Cognito User Pool ID */
  userPoolId: string;
}

export class ObservabilityStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: ObservabilityStackProps
  ) {
    super(scope, id, props);

    const {
      neptuneClusterId,
      cloudFrontDistributionId,
      wafWebAclName,
      appSyncApiId,
      lambdaFunctions,
      userPoolId,
    } = props;

    // ─── SNS topic for alarms ────────────────────────────────────────
    const alarmKey = new aws_kms.Key(this, "AlarmTopicKey", {
      description: "KMS key for observability alarm SNS topic",
      enableKeyRotation: true,
    });

    const alarmTopic = new aws_sns.Topic(this, "AlarmTopic", {
      displayName: "Observability Alarms",
      masterKey: alarmKey,
    });

    alarmTopic.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowPublishThroughSSLOnly",
        effect: aws_iam.Effect.DENY,
        principals: [new aws_iam.AnyPrincipal()],
        actions: ["sns:Publish"],
        resources: [alarmTopic.topicArn],
        conditions: { Bool: { "aws:SecureTransport": "false" } },
      })
    );

    // Allow CloudWatch Alarms to publish
    alarmTopic.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowCloudWatchAlarmPublish",
        effect: aws_iam.Effect.ALLOW,
        principals: [
          new aws_iam.ServicePrincipal("cloudwatch.amazonaws.com"),
        ],
        actions: ["sns:Publish"],
        resources: [alarmTopic.topicArn],
      })
    );
    alarmKey.addToResourcePolicy(
      new aws_iam.PolicyStatement({
        sid: "AllowCloudWatchUseKey",
        effect: aws_iam.Effect.ALLOW,
        principals: [
          new aws_iam.ServicePrincipal("cloudwatch.amazonaws.com"),
        ],
        actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
        resources: ["*"],
      })
    );

    new ParameterEmailSubscriber(this, "AlarmEmailSubscriber", {
      topicArn: alarmTopic.topicArn,
      parameterName: "/global-app-params/rdsnotificationemails",
    });

    const snsAction = new aws_cloudwatch_actions.SnsAction(alarmTopic);

    // ─── Lambda Metrics & Alarms ─────────────────────────────────────
    const lambdaWidgets: aws_cloudwatch.IWidget[] = [];

    for (const [label, fnName] of Object.entries(lambdaFunctions)) {
      const errorMetric = new aws_cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensionsMap: { FunctionName: fnName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      const durationMetric = new aws_cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Duration",
        dimensionsMap: { FunctionName: fnName },
        statistic: "p99",
        period: Duration.minutes(5),
      });

      const invocationsMetric = new aws_cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Invocations",
        dimensionsMap: { FunctionName: fnName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      const throttlesMetric = new aws_cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Throttles",
        dimensionsMap: { FunctionName: fnName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      // Alarms
      const errorAlarm = new aws_cloudwatch.Alarm(
        this,
        `${label}-ErrorAlarm`,
        {
          metric: errorMetric,
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator:
            aws_cloudwatch.ComparisonOperator
              .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `Lambda ${label} errors >= 1 in 5 minutes`,
        }
      );
      errorAlarm.addAlarmAction(snsAction);

      const throttleAlarm = new aws_cloudwatch.Alarm(
        this,
        `${label}-ThrottleAlarm`,
        {
          metric: throttlesMetric,
          threshold: 1,
          evaluationPeriods: 1,
          comparisonOperator:
            aws_cloudwatch.ComparisonOperator
              .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
          alarmDescription: `Lambda ${label} throttles >= 1 in 5 minutes`,
        }
      );
      throttleAlarm.addAlarmAction(snsAction);

      lambdaWidgets.push(
        new aws_cloudwatch.GraphWidget({
          title: `${label} — Invocations & Errors`,
          left: [invocationsMetric],
          right: [errorMetric],
          width: 12,
        }),
        new aws_cloudwatch.GraphWidget({
          title: `${label} — Duration (p99) & Throttles`,
          left: [durationMetric],
          right: [throttlesMetric],
          width: 12,
        })
      );
    }

    // ─── Neptune Metrics & Alarms ────────────────────────────────────
    const neptuneMetrics = (
      metricName: string,
      stat = "Average"
    ) =>
      new aws_cloudwatch.Metric({
        namespace: "AWS/Neptune",
        metricName,
        dimensionsMap: { DBClusterIdentifier: neptuneClusterId },
        statistic: stat,
        period: Duration.minutes(5),
      });

    const neptuneCpu = neptuneMetrics("CPUUtilization");
    const neptuneCapacity = neptuneMetrics("ServerlessDatabaseCapacity");
    const neptuneMemory = neptuneMetrics("FreeableMemory");
    const neptuneGremlin = neptuneMetrics("GremlinRequestsPerSec");
    const neptuneQueue = neptuneMetrics("MainRequestQueuePendingRequests");
    const neptuneTxOpen = neptuneMetrics("NumTxOpened", "Sum");
    const neptuneTxCommit = neptuneMetrics("NumTxCommitted", "Sum");

    const neptuneCpuAlarm = new aws_cloudwatch.Alarm(
      this,
      "Neptune-CpuAlarm",
      {
        metric: neptuneCpu,
        threshold: 80,
        evaluationPeriods: 3,
        comparisonOperator:
          aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "Neptune CPU > 80% for 15 minutes",
      }
    );
    neptuneCpuAlarm.addAlarmAction(snsAction);

    const neptuneCapacityAlarm = new aws_cloudwatch.Alarm(
      this,
      "Neptune-CapacityAlarm",
      {
        metric: neptuneCapacity,
        threshold: 6,
        evaluationPeriods: 3,
        comparisonOperator:
          aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription:
          "Neptune serverless capacity approaching max (>= 6 of 8 NCU)",
      }
    );
    neptuneCapacityAlarm.addAlarmAction(snsAction);

    const neptuneQueueAlarm = new aws_cloudwatch.Alarm(
      this,
      "Neptune-QueueAlarm",
      {
        metric: neptuneQueue,
        threshold: 10,
        evaluationPeriods: 2,
        comparisonOperator:
          aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "Neptune pending queue > 10 for 10 minutes",
      }
    );
    neptuneQueueAlarm.addAlarmAction(snsAction);

    // ─── AppSync Metrics & Alarms ────────────────────────────────────
    const appSyncMetric = (metricName: string, stat = "Sum") =>
      new aws_cloudwatch.Metric({
        namespace: "AWS/AppSync",
        metricName,
        dimensionsMap: { GraphQLAPIId: appSyncApiId },
        statistic: stat,
        period: Duration.minutes(5),
      });

    const appsync5xx = appSyncMetric("5XXError");
    const appsync4xx = appSyncMetric("4XXError");
    const appsyncLatency = appSyncMetric("Latency", "p99");
    const appsyncRequests = appSyncMetric("Requests");

    const appsync5xxAlarm = new aws_cloudwatch.Alarm(
      this,
      "AppSync-5xxAlarm",
      {
        metric: appsync5xx,
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator:
          aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "AppSync 5XX errors >= 1 in 5 minutes",
      }
    );
    appsync5xxAlarm.addAlarmAction(snsAction);

    // ─── CloudFront Metrics ──────────────────────────────────────────
    const cfMetric = (metricName: string, stat = "Sum") =>
      new aws_cloudwatch.Metric({
        namespace: "AWS/CloudFront",
        metricName,
        dimensionsMap: {
          DistributionId: cloudFrontDistributionId,
          Region: "Global",
        },
        statistic: stat,
        period: Duration.minutes(5),
      });

    const cfRequests = cfMetric("Requests");
    const cfBytesDownloaded = cfMetric("BytesDownloaded");
    const cf5xxRate = cfMetric("5xxErrorRate", "Average");
    const cf4xxRate = cfMetric("4xxErrorRate", "Average");

    const cf5xxAlarm = new aws_cloudwatch.Alarm(
      this,
      "CloudFront-5xxAlarm",
      {
        metric: cf5xxRate,
        threshold: 5,
        evaluationPeriods: 3,
        comparisonOperator:
          aws_cloudwatch.ComparisonOperator
            .GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: aws_cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: "CloudFront 5xx error rate > 5% for 15 minutes",
      }
    );
    cf5xxAlarm.addAlarmAction(snsAction);

    // ─── WAF Metrics ─────────────────────────────────────────────────
    const wafMetric = (metricName: string) =>
      new aws_cloudwatch.Metric({
        namespace: "AWS/WAFV2",
        metricName,
        dimensionsMap: {
          WebACL: wafWebAclName,
          Region: "us-east-1",
          Rule: "ALL",
        },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

    const wafAllowed = wafMetric("AllowedRequests");
    const wafBlocked = wafMetric("BlockedRequests");

    // ─── Cognito Metrics ─────────────────────────────────────────────
    const cognitoMetric = (metricName: string) =>
      new aws_cloudwatch.Metric({
        namespace: "AWS/Cognito",
        metricName,
        dimensionsMap: { UserPool: userPoolId },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

    const cognitoSignIn = cognitoMetric("SignInSuccesses");
    const cognitoThrottles = cognitoMetric("SignInThrottles");
    const cognitoTokenRefresh = cognitoMetric("TokenRefreshSuccesses");

    // ─── CloudWatch Dashboard ────────────────────────────────────────
    const dashboard = new aws_cloudwatch.Dashboard(this, "AppDashboard", {
      dashboardName: "socialActiveApp-Observability",
    });

    // Header
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "# socialActiveApp Observability Dashboard\nReal-time metrics for all application services",
        width: 24,
        height: 1,
      })
    );

    // Lambda row header
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## Lambda Functions",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(...lambdaWidgets);

    // Neptune row
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## Amazon Neptune",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(
      new aws_cloudwatch.GraphWidget({
        title: "Neptune — CPU & Serverless Capacity",
        left: [neptuneCpu],
        right: [neptuneCapacity],
        width: 12,
      }),
      new aws_cloudwatch.GraphWidget({
        title: "Neptune — Memory & Queue",
        left: [neptuneMemory],
        right: [neptuneQueue],
        width: 12,
      }),
      new aws_cloudwatch.GraphWidget({
        title: "Neptune — Gremlin Requests/sec",
        left: [neptuneGremlin],
        width: 12,
      }),
      new aws_cloudwatch.GraphWidget({
        title: "Neptune — Transactions (Open / Committed)",
        left: [neptuneTxOpen],
        right: [neptuneTxCommit],
        width: 12,
      })
    );

    // AppSync row
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## AWS AppSync",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(
      new aws_cloudwatch.GraphWidget({
        title: "AppSync — Requests & Latency (p99)",
        left: [appsyncRequests],
        right: [appsyncLatency],
        width: 12,
      }),
      new aws_cloudwatch.GraphWidget({
        title: "AppSync — 4XX & 5XX Errors",
        left: [appsync4xx],
        right: [appsync5xx],
        width: 12,
      })
    );

    // CloudFront row
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## Amazon CloudFront",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(
      new aws_cloudwatch.GraphWidget({
        title: "CloudFront — Requests & Bytes Downloaded",
        left: [cfRequests],
        right: [cfBytesDownloaded],
        width: 12,
      }),
      new aws_cloudwatch.GraphWidget({
        title: "CloudFront — 4XX & 5XX Error Rate (%)",
        left: [cf4xxRate],
        right: [cf5xxRate],
        width: 12,
      })
    );

    // WAF row
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## AWS WAF",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(
      new aws_cloudwatch.GraphWidget({
        title: "WAF — Allowed vs Blocked Requests",
        left: [wafAllowed],
        right: [wafBlocked],
        width: 12,
      })
    );

    // Cognito row
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## Amazon Cognito",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(
      new aws_cloudwatch.GraphWidget({
        title: "Cognito — Sign-In & Token Refresh",
        left: [cognitoSignIn, cognitoTokenRefresh],
        right: [cognitoThrottles],
        width: 12,
      })
    );

    // Alarm status widget
    dashboard.addWidgets(
      new aws_cloudwatch.TextWidget({
        markdown: "## Alarm Status",
        width: 24,
        height: 1,
      })
    );
    dashboard.addWidgets(
      new aws_cloudwatch.AlarmStatusWidget({
        title: "All Alarms",
        alarms: [
          neptuneCpuAlarm,
          neptuneCapacityAlarm,
          neptuneQueueAlarm,
          appsync5xxAlarm,
          cf5xxAlarm,
        ],
        width: 24,
      })
    );

    // ─── cdk-nag suppressions ────────────────────────────────────────
    NagSuppressions.addStackSuppressions(this, [
      {
        id: "AwsSolutions-IAM4",
        reason:
          "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access - CDK managed resource",
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
        reason:
          "NODEJS_22_X is the latest supported runtime at deploy time - CDK managed resource",
      },
    ]);
  }
}
