"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NeptuneScheduler = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const constructs_1 = require("constructs");
const path = require("path");
class NeptuneScheduler extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { cluster, timezone = "America/Los_Angeles", stopHour = 0, } = props;
        // The L2 cluster doesn't expose clusterIdentifier directly on the type,
        // but the underlying CFN resource has it. Use clusterResourceIdentifier
        // via the cluster endpoint address to derive it, or use Fn::Select.
        const clusterIdentifier = cluster.clusterIdentifier;
        // Construct the cluster ARN (not exposed by the L2 construct)
        const clusterArn = aws_cdk_lib_1.Arn.format({
            service: "rds",
            resource: "cluster",
            resourceName: clusterIdentifier,
            arnFormat: aws_cdk_lib_1.ArnFormat.COLON_RESOURCE_NAME,
        }, aws_cdk_lib_1.Stack.of(this));
        // -----------------------------------------------------------------------
        // Lambda that stops / starts the Neptune cluster
        // -----------------------------------------------------------------------
        const schedulerFn = new aws_cdk_lib_1.aws_lambda_nodejs.NodejsFunction(this, "neptune-scheduler-fn", {
            runtime: aws_cdk_lib_1.aws_lambda.Runtime.NODEJS_22_X,
            tracing: aws_cdk_lib_1.aws_lambda.Tracing.ACTIVE,
            entry: path.join(__dirname, "..", "..", "api", "lambda", "neptuneScheduler", "index.ts"),
            handler: "handler",
            timeout: aws_cdk_lib_1.Duration.seconds(30),
            environment: {
                NEPTUNE_CLUSTER_ID: clusterIdentifier,
            },
            bundling: {
                externalModules: ["@aws-sdk/*"], // use SDK v3 from Lambda runtime
                minify: true,
                sourceMap: true,
            },
        });
        // Grant the Lambda permission to stop/start the Neptune cluster
        schedulerFn.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            actions: [
                "rds:StopDBCluster",
                "rds:StartDBCluster",
                "rds:DescribeDBClusters",
            ],
            resources: [clusterArn],
        }));
        // -----------------------------------------------------------------------
        // EventBridge Scheduler role
        // -----------------------------------------------------------------------
        const schedulerRole = new aws_cdk_lib_1.aws_iam.Role(this, "scheduler-role", {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal("scheduler.amazonaws.com"),
        });
        schedulerFn.grantInvoke(schedulerRole);
        // -----------------------------------------------------------------------
        // cdk-nag suppressions
        // -----------------------------------------------------------------------
        cdk_nag_1.NagSuppressions.addResourceSuppressions(schedulerFn, [
            {
                id: "AwsSolutions-IAM4",
                reason: "AWSLambdaBasicExecutionRole is required for CloudWatch Logs access",
                appliesTo: [
                    "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
                ],
            },
            {
                id: "AwsSolutions-L1",
                reason: "NODEJS_22_X is the latest supported runtime at deploy time",
            },
        ], true);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(schedulerRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Wildcard on Lambda ARN version is required by grantInvoke for EventBridge Scheduler",
            },
        ], true);
        // -----------------------------------------------------------------------
        // Schedules (timezone-aware via EventBridge Scheduler)
        // -----------------------------------------------------------------------
        // Stop Neptune at the configured hour (default: midnight Pacific)
        new aws_cdk_lib_1.aws_scheduler.CfnSchedule(this, "stop-schedule", {
            name: "neptune-stop-schedule",
            description: `Stop Neptune cluster at ${stopHour}:00 ${timezone}`,
            scheduleExpressionTimezone: timezone,
            scheduleExpression: `cron(0 ${stopHour} * * ? *)`,
            flexibleTimeWindow: { mode: "OFF" },
            target: {
                arn: schedulerFn.functionArn,
                roleArn: schedulerRole.roleArn,
                input: JSON.stringify({ action: "stop" }),
            },
            state: "ENABLED",
        });
    }
}
exports.NeptuneScheduler = NeptuneScheduler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmVwdHVuZS1zY2hlZHVsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJuZXB0dW5lLXNjaGVkdWxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FVcUI7QUFFckIscUNBQTBDO0FBQzFDLDJDQUF1QztBQUN2Qyw2QkFBNkI7QUFVN0IsTUFBYSxnQkFBaUIsU0FBUSxzQkFBUztJQUM3QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTRCO1FBQ3BFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxFQUNKLE9BQU8sRUFDUCxRQUFRLEdBQUcscUJBQXFCLEVBQ2hDLFFBQVEsR0FBRyxDQUFDLEdBQ2IsR0FBRyxLQUFLLENBQUM7UUFFVix3RUFBd0U7UUFDeEUsd0VBQXdFO1FBQ3hFLG9FQUFvRTtRQUNwRSxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztRQUVwRCw4REFBOEQ7UUFDOUQsTUFBTSxVQUFVLEdBQUcsaUJBQUcsQ0FBQyxNQUFNLENBQzNCO1lBQ0UsT0FBTyxFQUFFLEtBQUs7WUFDZCxRQUFRLEVBQUUsU0FBUztZQUNuQixZQUFZLEVBQUUsaUJBQWlCO1lBQy9CLFNBQVMsRUFBRSx1QkFBUyxDQUFDLG1CQUFtQjtTQUN6QyxFQUNELG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUNmLENBQUM7UUFFRiwwRUFBMEU7UUFDMUUsaURBQWlEO1FBQ2pELDBFQUEwRTtRQUMxRSxNQUFNLFdBQVcsR0FBRyxJQUFJLCtCQUFpQixDQUFDLGNBQWMsQ0FDdEQsSUFBSSxFQUNKLHNCQUFzQixFQUN0QjtZQUNFLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ3ZDLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNO1lBQ2xDLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUNkLFNBQVMsRUFDVCxJQUFJLEVBQ0osSUFBSSxFQUNKLEtBQUssRUFDTCxRQUFRLEVBQ1Isa0JBQWtCLEVBQ2xCLFVBQVUsQ0FDWDtZQUNELE9BQU8sRUFBRSxTQUFTO1lBQ2xCLE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDN0IsV0FBVyxFQUFFO2dCQUNYLGtCQUFrQixFQUFFLGlCQUFpQjthQUN0QztZQUNELFFBQVEsRUFBRTtnQkFDUixlQUFlLEVBQUUsQ0FBQyxZQUFZLENBQUMsRUFBRyxpQ0FBaUM7Z0JBQ25FLE1BQU0sRUFBRSxJQUFJO2dCQUNaLFNBQVMsRUFBRSxJQUFJO2FBQ2hCO1NBQ0YsQ0FDRixDQUFDO1FBRUYsZ0VBQWdFO1FBQ2hFLFdBQVcsQ0FBQyxlQUFlLENBQ3pCLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsTUFBTSxFQUFFLHFCQUFPLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDNUIsT0FBTyxFQUFFO2dCQUNQLG1CQUFtQjtnQkFDbkIsb0JBQW9CO2dCQUNwQix3QkFBd0I7YUFDekI7WUFDRCxTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUM7U0FDeEIsQ0FBQyxDQUNILENBQUM7UUFFRiwwRUFBMEU7UUFDMUUsNkJBQTZCO1FBQzdCLDBFQUEwRTtRQUMxRSxNQUFNLGFBQWEsR0FBRyxJQUFJLHFCQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUM3RCxTQUFTLEVBQUUsSUFBSSxxQkFBTyxDQUFDLGdCQUFnQixDQUFDLHlCQUF5QixDQUFDO1NBQ25FLENBQUMsQ0FBQztRQUNILFdBQVcsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFdkMsMEVBQTBFO1FBQzFFLHVCQUF1QjtRQUN2QiwwRUFBMEU7UUFDMUUseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsV0FBVyxFQUNYO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLG9FQUFvRTtnQkFDdEUsU0FBUyxFQUFFO29CQUNULHVGQUF1RjtpQkFDeEY7YUFDRjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7U0FDRixFQUNELElBQUksQ0FDTCxDQUFDO1FBRUYseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsYUFBYSxFQUNiO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLHFGQUFxRjthQUN4RjtTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7UUFFRiwwRUFBMEU7UUFDMUUsdURBQXVEO1FBQ3ZELDBFQUEwRTtRQUUxRSxrRUFBa0U7UUFDbEUsSUFBSSwyQkFBYSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ25ELElBQUksRUFBRSx1QkFBdUI7WUFDN0IsV0FBVyxFQUFFLDJCQUEyQixRQUFRLE9BQU8sUUFBUSxFQUFFO1lBQ2pFLDBCQUEwQixFQUFFLFFBQVE7WUFDcEMsa0JBQWtCLEVBQUUsVUFBVSxRQUFRLFdBQVc7WUFDakQsa0JBQWtCLEVBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFO1lBQ25DLE1BQU0sRUFBRTtnQkFDTixHQUFHLEVBQUUsV0FBVyxDQUFDLFdBQVc7Z0JBQzVCLE9BQU8sRUFBRSxhQUFhLENBQUMsT0FBTztnQkFDOUIsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLENBQUM7YUFDMUM7WUFDRCxLQUFLLEVBQUUsU0FBUztTQUNqQixDQUFDLENBQUM7SUFHTCxDQUFDO0NBQ0Y7QUFySUQsNENBcUlDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgQXJuLFxuICBBcm5Gb3JtYXQsXG4gIER1cmF0aW9uLFxuICBTdGFjayxcbiAgU3RhY2tQcm9wcyxcbiAgYXdzX2lhbSxcbiAgYXdzX2xhbWJkYSxcbiAgYXdzX2xhbWJkYV9ub2RlanMsXG4gIGF3c19zY2hlZHVsZXIsXG59IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0ICogYXMgbmVwdHVuZSBmcm9tIFwiQGF3cy1jZGsvYXdzLW5lcHR1bmUtYWxwaGFcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuXG5pbnRlcmZhY2UgTmVwdHVuZVNjaGVkdWxlclByb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIGNsdXN0ZXI6IG5lcHR1bmUuRGF0YWJhc2VDbHVzdGVyO1xuICAvKiogSUFOQSB0aW1lem9uZSBmb3IgdGhlIHNjaGVkdWxlIChkZWZhdWx0OiBBbWVyaWNhL0xvc19BbmdlbGVzKSAqL1xuICB0aW1lem9uZT86IHN0cmluZztcbiAgLyoqIENyb24gaG91ciAoMC0yMykgdG8gc3RvcCB0aGUgY2x1c3RlciBpbiB0aGUgZ2l2ZW4gdGltZXpvbmUgKGRlZmF1bHQ6IDAgPSBtaWRuaWdodCkgKi9cbiAgc3RvcEhvdXI/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBOZXB0dW5lU2NoZWR1bGVyIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE5lcHR1bmVTY2hlZHVsZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgdGltZXpvbmUgPSBcIkFtZXJpY2EvTG9zX0FuZ2VsZXNcIixcbiAgICAgIHN0b3BIb3VyID0gMCxcbiAgICB9ID0gcHJvcHM7XG5cbiAgICAvLyBUaGUgTDIgY2x1c3RlciBkb2Vzbid0IGV4cG9zZSBjbHVzdGVySWRlbnRpZmllciBkaXJlY3RseSBvbiB0aGUgdHlwZSxcbiAgICAvLyBidXQgdGhlIHVuZGVybHlpbmcgQ0ZOIHJlc291cmNlIGhhcyBpdC4gVXNlIGNsdXN0ZXJSZXNvdXJjZUlkZW50aWZpZXJcbiAgICAvLyB2aWEgdGhlIGNsdXN0ZXIgZW5kcG9pbnQgYWRkcmVzcyB0byBkZXJpdmUgaXQsIG9yIHVzZSBGbjo6U2VsZWN0LlxuICAgIGNvbnN0IGNsdXN0ZXJJZGVudGlmaWVyID0gY2x1c3Rlci5jbHVzdGVySWRlbnRpZmllcjtcblxuICAgIC8vIENvbnN0cnVjdCB0aGUgY2x1c3RlciBBUk4gKG5vdCBleHBvc2VkIGJ5IHRoZSBMMiBjb25zdHJ1Y3QpXG4gICAgY29uc3QgY2x1c3RlckFybiA9IEFybi5mb3JtYXQoXG4gICAgICB7XG4gICAgICAgIHNlcnZpY2U6IFwicmRzXCIsXG4gICAgICAgIHJlc291cmNlOiBcImNsdXN0ZXJcIixcbiAgICAgICAgcmVzb3VyY2VOYW1lOiBjbHVzdGVySWRlbnRpZmllcixcbiAgICAgICAgYXJuRm9ybWF0OiBBcm5Gb3JtYXQuQ09MT05fUkVTT1VSQ0VfTkFNRSxcbiAgICAgIH0sXG4gICAgICBTdGFjay5vZih0aGlzKVxuICAgICk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIExhbWJkYSB0aGF0IHN0b3BzIC8gc3RhcnRzIHRoZSBOZXB0dW5lIGNsdXN0ZXJcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHNjaGVkdWxlckZuID0gbmV3IGF3c19sYW1iZGFfbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgIFwibmVwdHVuZS1zY2hlZHVsZXItZm5cIixcbiAgICAgIHtcbiAgICAgICAgcnVudGltZTogYXdzX2xhbWJkYS5SdW50aW1lLk5PREVKU18yMl9YLFxuICAgICAgICB0cmFjaW5nOiBhd3NfbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgICBlbnRyeTogcGF0aC5qb2luKFxuICAgICAgICAgIF9fZGlybmFtZSxcbiAgICAgICAgICBcIi4uXCIsXG4gICAgICAgICAgXCIuLlwiLFxuICAgICAgICAgIFwiYXBpXCIsXG4gICAgICAgICAgXCJsYW1iZGFcIixcbiAgICAgICAgICBcIm5lcHR1bmVTY2hlZHVsZXJcIixcbiAgICAgICAgICBcImluZGV4LnRzXCJcbiAgICAgICAgKSxcbiAgICAgICAgaGFuZGxlcjogXCJoYW5kbGVyXCIsXG4gICAgICAgIHRpbWVvdXQ6IER1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIE5FUFRVTkVfQ0xVU1RFUl9JRDogY2x1c3RlcklkZW50aWZpZXIsXG4gICAgICAgIH0sXG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXCJAYXdzLXNkay8qXCJdLCAgLy8gdXNlIFNESyB2MyBmcm9tIExhbWJkYSBydW50aW1lXG4gICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH1cbiAgICApO1xuXG4gICAgLy8gR3JhbnQgdGhlIExhbWJkYSBwZXJtaXNzaW9uIHRvIHN0b3Avc3RhcnQgdGhlIE5lcHR1bmUgY2x1c3RlclxuICAgIHNjaGVkdWxlckZuLmFkZFRvUm9sZVBvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICBcInJkczpTdG9wREJDbHVzdGVyXCIsXG4gICAgICAgICAgXCJyZHM6U3RhcnREQkNsdXN0ZXJcIixcbiAgICAgICAgICBcInJkczpEZXNjcmliZURCQ2x1c3RlcnNcIixcbiAgICAgICAgXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbY2x1c3RlckFybl0sXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIEV2ZW50QnJpZGdlIFNjaGVkdWxlciByb2xlXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBzY2hlZHVsZXJSb2xlID0gbmV3IGF3c19pYW0uUm9sZSh0aGlzLCBcInNjaGVkdWxlci1yb2xlXCIsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGF3c19pYW0uU2VydmljZVByaW5jaXBhbChcInNjaGVkdWxlci5hbWF6b25hd3MuY29tXCIpLFxuICAgIH0pO1xuICAgIHNjaGVkdWxlckZuLmdyYW50SW52b2tlKHNjaGVkdWxlclJvbGUpO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBjZGstbmFnIHN1cHByZXNzaW9uc1xuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgc2NoZWR1bGVyRm4sXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNFwiLFxuICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgIFwiQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIGlzIHJlcXVpcmVkIGZvciBDbG91ZFdhdGNoIExvZ3MgYWNjZXNzXCIsXG4gICAgICAgICAgYXBwbGllc1RvOiBbXG4gICAgICAgICAgICBcIlBvbGljeTo6YXJuOjxBV1M6OlBhcnRpdGlvbj46aWFtOjphd3M6cG9saWN5L3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGVcIixcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUwxXCIsXG4gICAgICAgICAgcmVhc29uOiBcIk5PREVKU18yMl9YIGlzIHRoZSBsYXRlc3Qgc3VwcG9ydGVkIHJ1bnRpbWUgYXQgZGVwbG95IHRpbWVcIixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0cnVlXG4gICAgKTtcblxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHNjaGVkdWxlclJvbGUsXG4gICAgICBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtSUFNNVwiLFxuICAgICAgICAgIHJlYXNvbjpcbiAgICAgICAgICAgIFwiV2lsZGNhcmQgb24gTGFtYmRhIEFSTiB2ZXJzaW9uIGlzIHJlcXVpcmVkIGJ5IGdyYW50SW52b2tlIGZvciBFdmVudEJyaWRnZSBTY2hlZHVsZXJcIixcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0cnVlXG4gICAgKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gU2NoZWR1bGVzICh0aW1lem9uZS1hd2FyZSB2aWEgRXZlbnRCcmlkZ2UgU2NoZWR1bGVyKVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgICAvLyBTdG9wIE5lcHR1bmUgYXQgdGhlIGNvbmZpZ3VyZWQgaG91ciAoZGVmYXVsdDogbWlkbmlnaHQgUGFjaWZpYylcbiAgICBuZXcgYXdzX3NjaGVkdWxlci5DZm5TY2hlZHVsZSh0aGlzLCBcInN0b3Atc2NoZWR1bGVcIiwge1xuICAgICAgbmFtZTogXCJuZXB0dW5lLXN0b3Atc2NoZWR1bGVcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBgU3RvcCBOZXB0dW5lIGNsdXN0ZXIgYXQgJHtzdG9wSG91cn06MDAgJHt0aW1lem9uZX1gLFxuICAgICAgc2NoZWR1bGVFeHByZXNzaW9uVGltZXpvbmU6IHRpbWV6b25lLFxuICAgICAgc2NoZWR1bGVFeHByZXNzaW9uOiBgY3JvbigwICR7c3RvcEhvdXJ9ICogKiA/ICopYCxcbiAgICAgIGZsZXhpYmxlVGltZVdpbmRvdzogeyBtb2RlOiBcIk9GRlwiIH0sXG4gICAgICB0YXJnZXQ6IHtcbiAgICAgICAgYXJuOiBzY2hlZHVsZXJGbi5mdW5jdGlvbkFybixcbiAgICAgICAgcm9sZUFybjogc2NoZWR1bGVyUm9sZS5yb2xlQXJuLFxuICAgICAgICBpbnB1dDogSlNPTi5zdHJpbmdpZnkoeyBhY3Rpb246IFwic3RvcFwiIH0pLFxuICAgICAgfSxcbiAgICAgIHN0YXRlOiBcIkVOQUJMRURcIixcbiAgICB9KTtcblxuXG4gIH1cbn1cbiJdfQ==