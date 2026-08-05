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
        const { cluster, appName, timezone = "America/Los_Angeles", stopHour = 0, } = props;
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
            depsLockFilePath: path.join(__dirname, "..", "..", "api", "lambda", "package-lock.json"),
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
            name: `${appName}-neptune-stop-schedule`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmVwdHVuZS1zY2hlZHVsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJuZXB0dW5lLXNjaGVkdWxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FVcUI7QUFFckIscUNBQTBDO0FBQzFDLDJDQUF1QztBQUN2Qyw2QkFBNkI7QUFZN0IsTUFBYSxnQkFBaUIsU0FBUSxzQkFBUztJQUM3QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTRCO1FBQ3BFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxFQUNKLE9BQU8sRUFDUCxPQUFPLEVBQ1AsUUFBUSxHQUFHLHFCQUFxQixFQUNoQyxRQUFRLEdBQUcsQ0FBQyxHQUNiLEdBQUcsS0FBSyxDQUFDO1FBRVYsd0VBQXdFO1FBQ3hFLHdFQUF3RTtRQUN4RSxvRUFBb0U7UUFDcEUsTUFBTSxpQkFBaUIsR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUM7UUFFcEQsOERBQThEO1FBQzlELE1BQU0sVUFBVSxHQUFHLGlCQUFHLENBQUMsTUFBTSxDQUMzQjtZQUNFLE9BQU8sRUFBRSxLQUFLO1lBQ2QsUUFBUSxFQUFFLFNBQVM7WUFDbkIsWUFBWSxFQUFFLGlCQUFpQjtZQUMvQixTQUFTLEVBQUUsdUJBQVMsQ0FBQyxtQkFBbUI7U0FDekMsRUFDRCxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FDZixDQUFDO1FBRUYsMEVBQTBFO1FBQzFFLGlEQUFpRDtRQUNqRCwwRUFBMEU7UUFDMUUsTUFBTSxXQUFXLEdBQUcsSUFBSSwrQkFBaUIsQ0FBQyxjQUFjLENBQ3RELElBQUksRUFDSixzQkFBc0IsRUFDdEI7WUFDRSxPQUFPLEVBQUUsd0JBQVUsQ0FBQyxPQUFPLENBQUMsV0FBVztZQUN2QyxPQUFPLEVBQUUsd0JBQVUsQ0FBQyxPQUFPLENBQUMsTUFBTTtZQUNsQyxLQUFLLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FDZCxTQUFTLEVBQ1QsSUFBSSxFQUNKLElBQUksRUFDSixLQUFLLEVBQ0wsUUFBUSxFQUNSLGtCQUFrQixFQUNsQixVQUFVLENBQ1g7WUFDRCxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUN6QixTQUFTLEVBQ1QsSUFBSSxFQUNKLElBQUksRUFDSixLQUFLLEVBQ0wsUUFBUSxFQUNSLG1CQUFtQixDQUNwQjtZQUNELE9BQU8sRUFBRSxTQUFTO1lBQ2xCLE9BQU8sRUFBRSxzQkFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDN0IsV0FBVyxFQUFFO2dCQUNYLGtCQUFrQixFQUFFLGlCQUFpQjthQUN0QztZQUNELFFBQVEsRUFBRTtnQkFDUixlQUFlLEVBQUUsQ0FBQyxZQUFZLENBQUMsRUFBRyxpQ0FBaUM7Z0JBQ25FLE1BQU0sRUFBRSxJQUFJO2dCQUNaLFNBQVMsRUFBRSxJQUFJO2FBQ2hCO1NBQ0YsQ0FDRixDQUFDO1FBRUYsZ0VBQWdFO1FBQ2hFLFdBQVcsQ0FBQyxlQUFlLENBQ3pCLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsTUFBTSxFQUFFLHFCQUFPLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDNUIsT0FBTyxFQUFFO2dCQUNQLG1CQUFtQjtnQkFDbkIsb0JBQW9CO2dCQUNwQix3QkFBd0I7YUFDekI7WUFDRCxTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUM7U0FDeEIsQ0FBQyxDQUNILENBQUM7UUFFRiwwRUFBMEU7UUFDMUUsNkJBQTZCO1FBQzdCLDBFQUEwRTtRQUMxRSxNQUFNLGFBQWEsR0FBRyxJQUFJLHFCQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUM3RCxTQUFTLEVBQUUsSUFBSSxxQkFBTyxDQUFDLGdCQUFnQixDQUFDLHlCQUF5QixDQUFDO1NBQ25FLENBQUMsQ0FBQztRQUNILFdBQVcsQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFdkMsMEVBQTBFO1FBQzFFLHVCQUF1QjtRQUN2QiwwRUFBMEU7UUFDMUUseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsV0FBVyxFQUNYO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLG9FQUFvRTtnQkFDdEUsU0FBUyxFQUFFO29CQUNULHVGQUF1RjtpQkFDeEY7YUFDRjtZQUNEO2dCQUNFLEVBQUUsRUFBRSxpQkFBaUI7Z0JBQ3JCLE1BQU0sRUFBRSw0REFBNEQ7YUFDckU7U0FDRixFQUNELElBQUksQ0FDTCxDQUFDO1FBRUYseUJBQWUsQ0FBQyx1QkFBdUIsQ0FDckMsYUFBYSxFQUNiO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUNKLHFGQUFxRjthQUN4RjtTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7UUFFRiwwRUFBMEU7UUFDMUUsdURBQXVEO1FBQ3ZELDBFQUEwRTtRQUUxRSxrRUFBa0U7UUFDbEUsSUFBSSwyQkFBYSxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ25ELElBQUksRUFBRSxHQUFHLE9BQU8sd0JBQXdCO1lBQ3hDLFdBQVcsRUFBRSwyQkFBMkIsUUFBUSxPQUFPLFFBQVEsRUFBRTtZQUNqRSwwQkFBMEIsRUFBRSxRQUFRO1lBQ3BDLGtCQUFrQixFQUFFLFVBQVUsUUFBUSxXQUFXO1lBQ2pELGtCQUFrQixFQUFFLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUNuQyxNQUFNLEVBQUU7Z0JBQ04sR0FBRyxFQUFFLFdBQVcsQ0FBQyxXQUFXO2dCQUM1QixPQUFPLEVBQUUsYUFBYSxDQUFDLE9BQU87Z0JBQzlCLEtBQUssRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxDQUFDO2FBQzFDO1lBQ0QsS0FBSyxFQUFFLFNBQVM7U0FDakIsQ0FBQyxDQUFDO0lBR0wsQ0FBQztDQUNGO0FBOUlELDRDQThJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEFybixcbiAgQXJuRm9ybWF0LFxuICBEdXJhdGlvbixcbiAgU3RhY2ssXG4gIFN0YWNrUHJvcHMsXG4gIGF3c19pYW0sXG4gIGF3c19sYW1iZGEsXG4gIGF3c19sYW1iZGFfbm9kZWpzLFxuICBhd3Nfc2NoZWR1bGVyLFxufSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIG5lcHR1bmUgZnJvbSBcIkBhd3MtY2RrL2F3cy1uZXB0dW5lLWFscGhhXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCAqIGFzIHBhdGggZnJvbSBcInBhdGhcIjtcblxuaW50ZXJmYWNlIE5lcHR1bmVTY2hlZHVsZXJQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICBjbHVzdGVyOiBuZXB0dW5lLkRhdGFiYXNlQ2x1c3RlcjtcbiAgLyoqIEFwcCBuYW1lIHByZWZpeCB1c2VkIGZvciBzY2hlZHVsZXIgbmFtZXMgKGUuZy4gXCJwci1tdWNrZXJcIikgKi9cbiAgYXBwTmFtZTogc3RyaW5nO1xuICAvKiogSUFOQSB0aW1lem9uZSBmb3IgdGhlIHNjaGVkdWxlIChkZWZhdWx0OiBBbWVyaWNhL0xvc19BbmdlbGVzKSAqL1xuICB0aW1lem9uZT86IHN0cmluZztcbiAgLyoqIENyb24gaG91ciAoMC0yMykgdG8gc3RvcCB0aGUgY2x1c3RlciBpbiB0aGUgZ2l2ZW4gdGltZXpvbmUgKGRlZmF1bHQ6IDAgPSBtaWRuaWdodCkgKi9cbiAgc3RvcEhvdXI/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBOZXB0dW5lU2NoZWR1bGVyIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE5lcHR1bmVTY2hlZHVsZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCB7XG4gICAgICBjbHVzdGVyLFxuICAgICAgYXBwTmFtZSxcbiAgICAgIHRpbWV6b25lID0gXCJBbWVyaWNhL0xvc19BbmdlbGVzXCIsXG4gICAgICBzdG9wSG91ciA9IDAsXG4gICAgfSA9IHByb3BzO1xuXG4gICAgLy8gVGhlIEwyIGNsdXN0ZXIgZG9lc24ndCBleHBvc2UgY2x1c3RlcklkZW50aWZpZXIgZGlyZWN0bHkgb24gdGhlIHR5cGUsXG4gICAgLy8gYnV0IHRoZSB1bmRlcmx5aW5nIENGTiByZXNvdXJjZSBoYXMgaXQuIFVzZSBjbHVzdGVyUmVzb3VyY2VJZGVudGlmaWVyXG4gICAgLy8gdmlhIHRoZSBjbHVzdGVyIGVuZHBvaW50IGFkZHJlc3MgdG8gZGVyaXZlIGl0LCBvciB1c2UgRm46OlNlbGVjdC5cbiAgICBjb25zdCBjbHVzdGVySWRlbnRpZmllciA9IGNsdXN0ZXIuY2x1c3RlcklkZW50aWZpZXI7XG5cbiAgICAvLyBDb25zdHJ1Y3QgdGhlIGNsdXN0ZXIgQVJOIChub3QgZXhwb3NlZCBieSB0aGUgTDIgY29uc3RydWN0KVxuICAgIGNvbnN0IGNsdXN0ZXJBcm4gPSBBcm4uZm9ybWF0KFxuICAgICAge1xuICAgICAgICBzZXJ2aWNlOiBcInJkc1wiLFxuICAgICAgICByZXNvdXJjZTogXCJjbHVzdGVyXCIsXG4gICAgICAgIHJlc291cmNlTmFtZTogY2x1c3RlcklkZW50aWZpZXIsXG4gICAgICAgIGFybkZvcm1hdDogQXJuRm9ybWF0LkNPTE9OX1JFU09VUkNFX05BTUUsXG4gICAgICB9LFxuICAgICAgU3RhY2sub2YodGhpcylcbiAgICApO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBMYW1iZGEgdGhhdCBzdG9wcyAvIHN0YXJ0cyB0aGUgTmVwdHVuZSBjbHVzdGVyXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBzY2hlZHVsZXJGbiA9IG5ldyBhd3NfbGFtYmRhX25vZGVqcy5Ob2RlanNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICBcIm5lcHR1bmUtc2NoZWR1bGVyLWZuXCIsXG4gICAgICB7XG4gICAgICAgIHJ1bnRpbWU6IGF3c19sYW1iZGEuUnVudGltZS5OT0RFSlNfMjJfWCxcbiAgICAgICAgdHJhY2luZzogYXdzX2xhbWJkYS5UcmFjaW5nLkFDVElWRSxcbiAgICAgICAgZW50cnk6IHBhdGguam9pbihcbiAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgXCIuLlwiLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcImFwaVwiLFxuICAgICAgICAgIFwibGFtYmRhXCIsXG4gICAgICAgICAgXCJuZXB0dW5lU2NoZWR1bGVyXCIsXG4gICAgICAgICAgXCJpbmRleC50c1wiXG4gICAgICAgICksXG4gICAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihcbiAgICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgICAgXCIuLlwiLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcImFwaVwiLFxuICAgICAgICAgIFwibGFtYmRhXCIsXG4gICAgICAgICAgXCJwYWNrYWdlLWxvY2suanNvblwiXG4gICAgICAgICksXG4gICAgICAgIGhhbmRsZXI6IFwiaGFuZGxlclwiLFxuICAgICAgICB0aW1lb3V0OiBEdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBORVBUVU5FX0NMVVNURVJfSUQ6IGNsdXN0ZXJJZGVudGlmaWVyLFxuICAgICAgICB9LFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1wiQGF3cy1zZGsvKlwiXSwgIC8vIHVzZSBTREsgdjMgZnJvbSBMYW1iZGEgcnVudGltZVxuICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIEdyYW50IHRoZSBMYW1iZGEgcGVybWlzc2lvbiB0byBzdG9wL3N0YXJ0IHRoZSBOZXB0dW5lIGNsdXN0ZXJcbiAgICBzY2hlZHVsZXJGbi5hZGRUb1JvbGVQb2xpY3koXG4gICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgXCJyZHM6U3RvcERCQ2x1c3RlclwiLFxuICAgICAgICAgIFwicmRzOlN0YXJ0REJDbHVzdGVyXCIsXG4gICAgICAgICAgXCJyZHM6RGVzY3JpYmVEQkNsdXN0ZXJzXCIsXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW2NsdXN0ZXJBcm5dLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBFdmVudEJyaWRnZSBTY2hlZHVsZXIgcm9sZVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3Qgc2NoZWR1bGVyUm9sZSA9IG5ldyBhd3NfaWFtLlJvbGUodGhpcywgXCJzY2hlZHVsZXItcm9sZVwiLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBhd3NfaWFtLlNlcnZpY2VQcmluY2lwYWwoXCJzY2hlZHVsZXIuYW1hem9uYXdzLmNvbVwiKSxcbiAgICB9KTtcbiAgICBzY2hlZHVsZXJGbi5ncmFudEludm9rZShzY2hlZHVsZXJSb2xlKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gY2RrLW5hZyBzdXBwcmVzc2lvbnNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIHNjaGVkdWxlckZuLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTRcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIkFXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSBpcyByZXF1aXJlZCBmb3IgQ2xvdWRXYXRjaCBMb2dzIGFjY2Vzc1wiLFxuICAgICAgICAgIGFwcGxpZXNUbzogW1xuICAgICAgICAgICAgXCJQb2xpY3k6OmFybjo8QVdTOjpQYXJ0aXRpb24+OmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlXCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1MMVwiLFxuICAgICAgICAgIHJlYXNvbjogXCJOT0RFSlNfMjJfWCBpcyB0aGUgbGF0ZXN0IHN1cHBvcnRlZCBydW50aW1lIGF0IGRlcGxveSB0aW1lXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBzY2hlZHVsZXJSb2xlLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUlBTTVcIixcbiAgICAgICAgICByZWFzb246XG4gICAgICAgICAgICBcIldpbGRjYXJkIG9uIExhbWJkYSBBUk4gdmVyc2lvbiBpcyByZXF1aXJlZCBieSBncmFudEludm9rZSBmb3IgRXZlbnRCcmlkZ2UgU2NoZWR1bGVyXCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZVxuICAgICk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIFNjaGVkdWxlcyAodGltZXpvbmUtYXdhcmUgdmlhIEV2ZW50QnJpZGdlIFNjaGVkdWxlcilcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gICAgLy8gU3RvcCBOZXB0dW5lIGF0IHRoZSBjb25maWd1cmVkIGhvdXIgKGRlZmF1bHQ6IG1pZG5pZ2h0IFBhY2lmaWMpXG4gICAgbmV3IGF3c19zY2hlZHVsZXIuQ2ZuU2NoZWR1bGUodGhpcywgXCJzdG9wLXNjaGVkdWxlXCIsIHtcbiAgICAgIG5hbWU6IGAke2FwcE5hbWV9LW5lcHR1bmUtc3RvcC1zY2hlZHVsZWAsXG4gICAgICBkZXNjcmlwdGlvbjogYFN0b3AgTmVwdHVuZSBjbHVzdGVyIGF0ICR7c3RvcEhvdXJ9OjAwICR7dGltZXpvbmV9YCxcbiAgICAgIHNjaGVkdWxlRXhwcmVzc2lvblRpbWV6b25lOiB0aW1lem9uZSxcbiAgICAgIHNjaGVkdWxlRXhwcmVzc2lvbjogYGNyb24oMCAke3N0b3BIb3VyfSAqICogPyAqKWAsXG4gICAgICBmbGV4aWJsZVRpbWVXaW5kb3c6IHsgbW9kZTogXCJPRkZcIiB9LFxuICAgICAgdGFyZ2V0OiB7XG4gICAgICAgIGFybjogc2NoZWR1bGVyRm4uZnVuY3Rpb25Bcm4sXG4gICAgICAgIHJvbGVBcm46IHNjaGVkdWxlclJvbGUucm9sZUFybixcbiAgICAgICAgaW5wdXQ6IEpTT04uc3RyaW5naWZ5KHsgYWN0aW9uOiBcInN0b3BcIiB9KSxcbiAgICAgIH0sXG4gICAgICBzdGF0ZTogXCJFTkFCTEVEXCIsXG4gICAgfSk7XG5cblxuICB9XG59XG4iXX0=