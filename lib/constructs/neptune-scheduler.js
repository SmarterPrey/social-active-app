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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmVwdHVuZS1zY2hlZHVsZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJuZXB0dW5lLXNjaGVkdWxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2Q0FVcUI7QUFFckIscUNBQTBDO0FBQzFDLDJDQUF1QztBQUN2Qyw2QkFBNkI7QUFVN0IsTUFBYSxnQkFBaUIsU0FBUSxzQkFBUztJQUM3QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQTRCO1FBQ3BFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsTUFBTSxFQUNKLE9BQU8sRUFDUCxRQUFRLEdBQUcscUJBQXFCLEVBQ2hDLFFBQVEsR0FBRyxDQUFDLEdBQ2IsR0FBRyxLQUFLLENBQUM7UUFFVix3RUFBd0U7UUFDeEUsd0VBQXdFO1FBQ3hFLG9FQUFvRTtRQUNwRSxNQUFNLGlCQUFpQixHQUFHLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQztRQUVwRCw4REFBOEQ7UUFDOUQsTUFBTSxVQUFVLEdBQUcsaUJBQUcsQ0FBQyxNQUFNLENBQzNCO1lBQ0UsT0FBTyxFQUFFLEtBQUs7WUFDZCxRQUFRLEVBQUUsU0FBUztZQUNuQixZQUFZLEVBQUUsaUJBQWlCO1lBQy9CLFNBQVMsRUFBRSx1QkFBUyxDQUFDLG1CQUFtQjtTQUN6QyxFQUNELG1CQUFLLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUNmLENBQUM7UUFFRiwwRUFBMEU7UUFDMUUsaURBQWlEO1FBQ2pELDBFQUEwRTtRQUMxRSxNQUFNLFdBQVcsR0FBRyxJQUFJLCtCQUFpQixDQUFDLGNBQWMsQ0FDdEQsSUFBSSxFQUNKLHNCQUFzQixFQUN0QjtZQUNFLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxXQUFXO1lBQ3ZDLE9BQU8sRUFBRSx3QkFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNO1lBQ2xDLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUNkLFNBQVMsRUFDVCxJQUFJLEVBQ0osSUFBSSxFQUNKLEtBQUssRUFDTCxRQUFRLEVBQ1Isa0JBQWtCLEVBQ2xCLFVBQVUsQ0FDWDtZQUNELGdCQUFnQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQ3pCLFNBQVMsRUFDVCxJQUFJLEVBQ0osSUFBSSxFQUNKLEtBQUssRUFDTCxRQUFRLEVBQ1IsbUJBQW1CLENBQ3BCO1lBQ0QsT0FBTyxFQUFFLFNBQVM7WUFDbEIsT0FBTyxFQUFFLHNCQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUM3QixXQUFXLEVBQUU7Z0JBQ1gsa0JBQWtCLEVBQUUsaUJBQWlCO2FBQ3RDO1lBQ0QsUUFBUSxFQUFFO2dCQUNSLGVBQWUsRUFBRSxDQUFDLFlBQVksQ0FBQyxFQUFHLGlDQUFpQztnQkFDbkUsTUFBTSxFQUFFLElBQUk7Z0JBQ1osU0FBUyxFQUFFLElBQUk7YUFDaEI7U0FDRixDQUNGLENBQUM7UUFFRixnRUFBZ0U7UUFDaEUsV0FBVyxDQUFDLGVBQWUsQ0FDekIsSUFBSSxxQkFBTyxDQUFDLGVBQWUsQ0FBQztZQUMxQixNQUFNLEVBQUUscUJBQU8sQ0FBQyxNQUFNLENBQUMsS0FBSztZQUM1QixPQUFPLEVBQUU7Z0JBQ1AsbUJBQW1CO2dCQUNuQixvQkFBb0I7Z0JBQ3BCLHdCQUF3QjthQUN6QjtZQUNELFNBQVMsRUFBRSxDQUFDLFVBQVUsQ0FBQztTQUN4QixDQUFDLENBQ0gsQ0FBQztRQUVGLDBFQUEwRTtRQUMxRSw2QkFBNkI7UUFDN0IsMEVBQTBFO1FBQzFFLE1BQU0sYUFBYSxHQUFHLElBQUkscUJBQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQzdELFNBQVMsRUFBRSxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMseUJBQXlCLENBQUM7U0FDbkUsQ0FBQyxDQUFDO1FBQ0gsV0FBVyxDQUFDLFdBQVcsQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUV2QywwRUFBMEU7UUFDMUUsdUJBQXVCO1FBQ3ZCLDBFQUEwRTtRQUMxRSx5QkFBZSxDQUFDLHVCQUF1QixDQUNyQyxXQUFXLEVBQ1g7WUFDRTtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQ0osb0VBQW9FO2dCQUN0RSxTQUFTLEVBQUU7b0JBQ1QsdUZBQXVGO2lCQUN4RjthQUNGO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLGlCQUFpQjtnQkFDckIsTUFBTSxFQUFFLDREQUE0RDthQUNyRTtTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7UUFFRix5QkFBZSxDQUFDLHVCQUF1QixDQUNyQyxhQUFhLEVBQ2I7WUFDRTtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQ0oscUZBQXFGO2FBQ3hGO1NBQ0YsRUFDRCxJQUFJLENBQ0wsQ0FBQztRQUVGLDBFQUEwRTtRQUMxRSx1REFBdUQ7UUFDdkQsMEVBQTBFO1FBRTFFLGtFQUFrRTtRQUNsRSxJQUFJLDJCQUFhLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDbkQsSUFBSSxFQUFFLHVCQUF1QjtZQUM3QixXQUFXLEVBQUUsMkJBQTJCLFFBQVEsT0FBTyxRQUFRLEVBQUU7WUFDakUsMEJBQTBCLEVBQUUsUUFBUTtZQUNwQyxrQkFBa0IsRUFBRSxVQUFVLFFBQVEsV0FBVztZQUNqRCxrQkFBa0IsRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUU7WUFDbkMsTUFBTSxFQUFFO2dCQUNOLEdBQUcsRUFBRSxXQUFXLENBQUMsV0FBVztnQkFDNUIsT0FBTyxFQUFFLGFBQWEsQ0FBQyxPQUFPO2dCQUM5QixLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsQ0FBQzthQUMxQztZQUNELEtBQUssRUFBRSxTQUFTO1NBQ2pCLENBQUMsQ0FBQztJQUdMLENBQUM7Q0FDRjtBQTdJRCw0Q0E2SUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBBcm4sXG4gIEFybkZvcm1hdCxcbiAgRHVyYXRpb24sXG4gIFN0YWNrLFxuICBTdGFja1Byb3BzLFxuICBhd3NfaWFtLFxuICBhd3NfbGFtYmRhLFxuICBhd3NfbGFtYmRhX25vZGVqcyxcbiAgYXdzX3NjaGVkdWxlcixcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgKiBhcyBuZXB0dW5lIGZyb20gXCJAYXdzLWNkay9hd3MtbmVwdHVuZS1hbHBoYVwiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbmludGVyZmFjZSBOZXB0dW5lU2NoZWR1bGVyUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgY2x1c3RlcjogbmVwdHVuZS5EYXRhYmFzZUNsdXN0ZXI7XG4gIC8qKiBJQU5BIHRpbWV6b25lIGZvciB0aGUgc2NoZWR1bGUgKGRlZmF1bHQ6IEFtZXJpY2EvTG9zX0FuZ2VsZXMpICovXG4gIHRpbWV6b25lPzogc3RyaW5nO1xuICAvKiogQ3JvbiBob3VyICgwLTIzKSB0byBzdG9wIHRoZSBjbHVzdGVyIGluIHRoZSBnaXZlbiB0aW1lem9uZSAoZGVmYXVsdDogMCA9IG1pZG5pZ2h0KSAqL1xuICBzdG9wSG91cj86IG51bWJlcjtcbn1cblxuZXhwb3J0IGNsYXNzIE5lcHR1bmVTY2hlZHVsZXIgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTmVwdHVuZVNjaGVkdWxlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHtcbiAgICAgIGNsdXN0ZXIsXG4gICAgICB0aW1lem9uZSA9IFwiQW1lcmljYS9Mb3NfQW5nZWxlc1wiLFxuICAgICAgc3RvcEhvdXIgPSAwLFxuICAgIH0gPSBwcm9wcztcblxuICAgIC8vIFRoZSBMMiBjbHVzdGVyIGRvZXNuJ3QgZXhwb3NlIGNsdXN0ZXJJZGVudGlmaWVyIGRpcmVjdGx5IG9uIHRoZSB0eXBlLFxuICAgIC8vIGJ1dCB0aGUgdW5kZXJseWluZyBDRk4gcmVzb3VyY2UgaGFzIGl0LiBVc2UgY2x1c3RlclJlc291cmNlSWRlbnRpZmllclxuICAgIC8vIHZpYSB0aGUgY2x1c3RlciBlbmRwb2ludCBhZGRyZXNzIHRvIGRlcml2ZSBpdCwgb3IgdXNlIEZuOjpTZWxlY3QuXG4gICAgY29uc3QgY2x1c3RlcklkZW50aWZpZXIgPSBjbHVzdGVyLmNsdXN0ZXJJZGVudGlmaWVyO1xuXG4gICAgLy8gQ29uc3RydWN0IHRoZSBjbHVzdGVyIEFSTiAobm90IGV4cG9zZWQgYnkgdGhlIEwyIGNvbnN0cnVjdClcbiAgICBjb25zdCBjbHVzdGVyQXJuID0gQXJuLmZvcm1hdChcbiAgICAgIHtcbiAgICAgICAgc2VydmljZTogXCJyZHNcIixcbiAgICAgICAgcmVzb3VyY2U6IFwiY2x1c3RlclwiLFxuICAgICAgICByZXNvdXJjZU5hbWU6IGNsdXN0ZXJJZGVudGlmaWVyLFxuICAgICAgICBhcm5Gb3JtYXQ6IEFybkZvcm1hdC5DT0xPTl9SRVNPVVJDRV9OQU1FLFxuICAgICAgfSxcbiAgICAgIFN0YWNrLm9mKHRoaXMpXG4gICAgKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gTGFtYmRhIHRoYXQgc3RvcHMgLyBzdGFydHMgdGhlIE5lcHR1bmUgY2x1c3RlclxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3Qgc2NoZWR1bGVyRm4gPSBuZXcgYXdzX2xhbWJkYV9ub2RlanMuTm9kZWpzRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgXCJuZXB0dW5lLXNjaGVkdWxlci1mblwiLFxuICAgICAge1xuICAgICAgICBydW50aW1lOiBhd3NfbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIyX1gsXG4gICAgICAgIHRyYWNpbmc6IGF3c19sYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4oXG4gICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcIi4uXCIsXG4gICAgICAgICAgXCJhcGlcIixcbiAgICAgICAgICBcImxhbWJkYVwiLFxuICAgICAgICAgIFwibmVwdHVuZVNjaGVkdWxlclwiLFxuICAgICAgICAgIFwiaW5kZXgudHNcIlxuICAgICAgICApLFxuICAgICAgICBkZXBzTG9ja0ZpbGVQYXRoOiBwYXRoLmpvaW4oXG4gICAgICAgICAgX19kaXJuYW1lLFxuICAgICAgICAgIFwiLi5cIixcbiAgICAgICAgICBcIi4uXCIsXG4gICAgICAgICAgXCJhcGlcIixcbiAgICAgICAgICBcImxhbWJkYVwiLFxuICAgICAgICAgIFwicGFja2FnZS1sb2NrLmpzb25cIlxuICAgICAgICApLFxuICAgICAgICBoYW5kbGVyOiBcImhhbmRsZXJcIixcbiAgICAgICAgdGltZW91dDogRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgTkVQVFVORV9DTFVTVEVSX0lEOiBjbHVzdGVySWRlbnRpZmllcixcbiAgICAgICAgfSxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFtcIkBhd3Mtc2RrLypcIl0sICAvLyB1c2UgU0RLIHYzIGZyb20gTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfVxuICAgICk7XG5cbiAgICAvLyBHcmFudCB0aGUgTGFtYmRhIHBlcm1pc3Npb24gdG8gc3RvcC9zdGFydCB0aGUgTmVwdHVuZSBjbHVzdGVyXG4gICAgc2NoZWR1bGVyRm4uYWRkVG9Sb2xlUG9saWN5KFxuICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgZWZmZWN0OiBhd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgIFwicmRzOlN0b3BEQkNsdXN0ZXJcIixcbiAgICAgICAgICBcInJkczpTdGFydERCQ2x1c3RlclwiLFxuICAgICAgICAgIFwicmRzOkRlc2NyaWJlREJDbHVzdGVyc1wiLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtjbHVzdGVyQXJuXSxcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gRXZlbnRCcmlkZ2UgU2NoZWR1bGVyIHJvbGVcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IHNjaGVkdWxlclJvbGUgPSBuZXcgYXdzX2lhbS5Sb2xlKHRoaXMsIFwic2NoZWR1bGVyLXJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgYXdzX2lhbS5TZXJ2aWNlUHJpbmNpcGFsKFwic2NoZWR1bGVyLmFtYXpvbmF3cy5jb21cIiksXG4gICAgfSk7XG4gICAgc2NoZWR1bGVyRm4uZ3JhbnRJbnZva2Uoc2NoZWR1bGVyUm9sZSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIGNkay1uYWcgc3VwcHJlc3Npb25zXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICBzY2hlZHVsZXJGbixcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU00XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJBV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUgaXMgcmVxdWlyZWQgZm9yIENsb3VkV2F0Y2ggTG9ncyBhY2Nlc3NcIixcbiAgICAgICAgICBhcHBsaWVzVG86IFtcbiAgICAgICAgICAgIFwiUG9saWN5Ojphcm46PEFXUzo6UGFydGl0aW9uPjppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZVwiLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtTDFcIixcbiAgICAgICAgICByZWFzb246IFwiTk9ERUpTXzIyX1ggaXMgdGhlIGxhdGVzdCBzdXBwb3J0ZWQgcnVudGltZSBhdCBkZXBsb3kgdGltZVwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgc2NoZWR1bGVyUm9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOlxuICAgICAgICAgICAgXCJXaWxkY2FyZCBvbiBMYW1iZGEgQVJOIHZlcnNpb24gaXMgcmVxdWlyZWQgYnkgZ3JhbnRJbnZva2UgZm9yIEV2ZW50QnJpZGdlIFNjaGVkdWxlclwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyBTY2hlZHVsZXMgKHRpbWV6b25lLWF3YXJlIHZpYSBFdmVudEJyaWRnZSBTY2hlZHVsZXIpXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAgIC8vIFN0b3AgTmVwdHVuZSBhdCB0aGUgY29uZmlndXJlZCBob3VyIChkZWZhdWx0OiBtaWRuaWdodCBQYWNpZmljKVxuICAgIG5ldyBhd3Nfc2NoZWR1bGVyLkNmblNjaGVkdWxlKHRoaXMsIFwic3RvcC1zY2hlZHVsZVwiLCB7XG4gICAgICBuYW1lOiBcIm5lcHR1bmUtc3RvcC1zY2hlZHVsZVwiLFxuICAgICAgZGVzY3JpcHRpb246IGBTdG9wIE5lcHR1bmUgY2x1c3RlciBhdCAke3N0b3BIb3VyfTowMCAke3RpbWV6b25lfWAsXG4gICAgICBzY2hlZHVsZUV4cHJlc3Npb25UaW1lem9uZTogdGltZXpvbmUsXG4gICAgICBzY2hlZHVsZUV4cHJlc3Npb246IGBjcm9uKDAgJHtzdG9wSG91cn0gKiAqID8gKilgLFxuICAgICAgZmxleGlibGVUaW1lV2luZG93OiB7IG1vZGU6IFwiT0ZGXCIgfSxcbiAgICAgIHRhcmdldDoge1xuICAgICAgICBhcm46IHNjaGVkdWxlckZuLmZ1bmN0aW9uQXJuLFxuICAgICAgICByb2xlQXJuOiBzY2hlZHVsZXJSb2xlLnJvbGVBcm4sXG4gICAgICAgIGlucHV0OiBKU09OLnN0cmluZ2lmeSh7IGFjdGlvbjogXCJzdG9wXCIgfSksXG4gICAgICB9LFxuICAgICAgc3RhdGU6IFwiRU5BQkxFRFwiLFxuICAgIH0pO1xuXG5cbiAgfVxufVxuIl19