"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Neptune = void 0;
const neptune = require("@aws-cdk/aws-neptune-alpha");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const constructs_1 = require("constructs");
class Neptune extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { vpc, neptuneServerlss, neptuneServerlssCapacity } = props;
        this.neptuneRole = new aws_cdk_lib_1.aws_iam.Role(this, "neptune-role", {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal("rds.amazonaws.com"),
        });
        this.neptuneRole.addToPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            effect: aws_cdk_lib_1.aws_iam.Effect.ALLOW,
            actions: ["s3:Get*", "s3:List*"],
            resources: ["*"],
        }));
        let neptuneBaseClusterConfiguration = {
            iamAuthentication: true,
            cloudwatchLogsRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            engineVersion: neptune.EngineVersion.V1_3_0_0,
            autoMinorVersionUpgrade: true,
            backupRetention: aws_cdk_lib_1.Duration.days(14),
            associatedRoles: [this.neptuneRole],
        };
        if (neptuneServerlss) {
            let serverlessScalingConfiguration = {
                minCapacity: 1,
                maxCapacity: 8,
            };
            if (neptuneServerlssCapacity) {
                (serverlessScalingConfiguration.minCapacity =
                    neptuneServerlssCapacity.minCapacity),
                    (serverlessScalingConfiguration.maxCapacity =
                        neptuneServerlssCapacity.maxCapacity);
            }
            neptuneBaseClusterConfiguration = {
                ...neptuneBaseClusterConfiguration,
                serverlessScalingConfiguration,
            };
        }
        // if (neptuneServerlss) {
        this.cluster = new neptune.DatabaseCluster(this, "cluster", {
            vpc: vpc,
            instanceType: neptuneServerlss
                ? neptune.InstanceType.SERVERLESS
                : neptune.InstanceType.R5_XLARGE,
            ...neptuneBaseClusterConfiguration,
            vpcSubnets: {
                subnets: vpc.isolatedSubnets,
            },
        });
        this.cluster.grantConnect(this.neptuneRole);
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.neptuneRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Need the permission for bulk load",
            },
        ], true);
    }
}
exports.Neptune = Neptune;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmVwdHVuZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm5lcHR1bmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsc0RBQXNEO0FBQ3RELDZDQU9xQjtBQUNyQixxQ0FBMEM7QUFFMUMsMkNBQXVDO0FBUXZDLE1BQWEsT0FBUSxTQUFRLHNCQUFTO0lBR3BDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBbUI7UUFDM0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixNQUFNLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFLHdCQUF3QixFQUFFLEdBQUcsS0FBSyxDQUFDO1FBQ2xFLElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxxQkFBTyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3hELFNBQVMsRUFBRSxJQUFJLHFCQUFPLENBQUMsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUM7U0FDN0QsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQzFCLElBQUkscUJBQU8sQ0FBQyxlQUFlLENBQUM7WUFDMUIsTUFBTSxFQUFFLHFCQUFPLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDNUIsT0FBTyxFQUFFLENBQUMsU0FBUyxFQUFFLFVBQVUsQ0FBQztZQUNoQyxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUNILENBQUM7UUFFRixJQUFJLCtCQUErQixHQUFRO1lBQ3pDLGlCQUFpQixFQUFFLElBQUk7WUFDdkIsdUJBQXVCLEVBQUUsc0JBQVEsQ0FBQyxhQUFhLENBQUMsU0FBUztZQUN6RCxhQUFhLEVBQUUsMkJBQWEsQ0FBQyxPQUFPO1lBQ3BDLGFBQWEsRUFBRSxPQUFPLENBQUMsYUFBYSxDQUFDLFFBQVE7WUFDN0MsdUJBQXVCLEVBQUUsSUFBSTtZQUM3QixlQUFlLEVBQUUsc0JBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ2xDLGVBQWUsRUFBRSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7U0FDcEMsQ0FBQztRQUVGLElBQUksZ0JBQWdCLEVBQUUsQ0FBQztZQUNyQixJQUFJLDhCQUE4QixHQUFHO2dCQUNuQyxXQUFXLEVBQUUsQ0FBQztnQkFDZCxXQUFXLEVBQUUsQ0FBQzthQUNmLENBQUM7WUFDRixJQUFJLHdCQUF3QixFQUFFLENBQUM7Z0JBQzdCLENBQUMsOEJBQThCLENBQUMsV0FBVztvQkFDekMsd0JBQXdCLENBQUMsV0FBVyxDQUFDO29CQUNyQyxDQUFDLDhCQUE4QixDQUFDLFdBQVc7d0JBQ3pDLHdCQUF3QixDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQzVDLENBQUM7WUFDRCwrQkFBK0IsR0FBRztnQkFDaEMsR0FBRywrQkFBK0I7Z0JBQ2xDLDhCQUE4QjthQUMvQixDQUFDO1FBQ0osQ0FBQztRQUVELDBCQUEwQjtRQUMxQixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksT0FBTyxDQUFDLGVBQWUsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFO1lBQzFELEdBQUcsRUFBRSxHQUFHO1lBQ1IsWUFBWSxFQUFFLGdCQUFnQjtnQkFDNUIsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsVUFBVTtnQkFDakMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsU0FBUztZQUNsQyxHQUFHLCtCQUErQjtZQUVsQyxVQUFVLEVBQUU7Z0JBQ1YsT0FBTyxFQUFFLEdBQUcsQ0FBQyxlQUFlO2FBQzdCO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRTVDLHlCQUFlLENBQUMsdUJBQXVCLENBQ3JDLElBQUksQ0FBQyxXQUFXLEVBQ2hCO1lBQ0U7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLG1DQUFtQzthQUM1QztTQUNGLEVBQ0QsSUFBSSxDQUNMLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUF0RUQsMEJBc0VDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgbmVwdHVuZSBmcm9tIFwiQGF3cy1jZGsvYXdzLW5lcHR1bmUtYWxwaGFcIjtcbmltcG9ydCB7XG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxuICBTdGFja1Byb3BzLFxuICBhd3NfZWMyLFxuICBhd3NfaWFtLFxuICBhd3NfbG9ncyxcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuXG5pbnRlcmZhY2UgTmVwdHVuZVByb3BzIGV4dGVuZHMgU3RhY2tQcm9wcyB7XG4gIHZwYzogYXdzX2VjMi5WcGM7XG4gIG5lcHR1bmVTZXJ2ZXJsc3M6IGJvb2xlYW47XG4gIG5lcHR1bmVTZXJ2ZXJsc3NDYXBhY2l0eT86IG5lcHR1bmUuU2VydmVybGVzc1NjYWxpbmdDb25maWd1cmF0aW9uO1xufVxuXG5leHBvcnQgY2xhc3MgTmVwdHVuZSBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBjbHVzdGVyOiBuZXB0dW5lLkRhdGFiYXNlQ2x1c3RlcjtcbiAgcmVhZG9ubHkgbmVwdHVuZVJvbGU6IGF3c19pYW0uUm9sZTtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IE5lcHR1bmVQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgY29uc3QgeyB2cGMsIG5lcHR1bmVTZXJ2ZXJsc3MsIG5lcHR1bmVTZXJ2ZXJsc3NDYXBhY2l0eSB9ID0gcHJvcHM7XG4gICAgdGhpcy5uZXB0dW5lUm9sZSA9IG5ldyBhd3NfaWFtLlJvbGUodGhpcywgXCJuZXB0dW5lLXJvbGVcIiwge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgYXdzX2lhbS5TZXJ2aWNlUHJpbmNpcGFsKFwicmRzLmFtYXpvbmF3cy5jb21cIiksXG4gICAgfSk7XG4gICAgdGhpcy5uZXB0dW5lUm9sZS5hZGRUb1BvbGljeShcbiAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcInMzOkdldCpcIiwgXCJzMzpMaXN0KlwiXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbXCIqXCJdLFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgbGV0IG5lcHR1bmVCYXNlQ2x1c3RlckNvbmZpZ3VyYXRpb246IGFueSA9IHtcbiAgICAgIGlhbUF1dGhlbnRpY2F0aW9uOiB0cnVlLFxuICAgICAgY2xvdWR3YXRjaExvZ3NSZXRlbnRpb246IGF3c19sb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW5naW5lVmVyc2lvbjogbmVwdHVuZS5FbmdpbmVWZXJzaW9uLlYxXzNfMF8wLFxuICAgICAgYXV0b01pbm9yVmVyc2lvblVwZ3JhZGU6IHRydWUsXG4gICAgICBiYWNrdXBSZXRlbnRpb246IER1cmF0aW9uLmRheXMoMTQpLFxuICAgICAgYXNzb2NpYXRlZFJvbGVzOiBbdGhpcy5uZXB0dW5lUm9sZV0sXG4gICAgfTtcblxuICAgIGlmIChuZXB0dW5lU2VydmVybHNzKSB7XG4gICAgICBsZXQgc2VydmVybGVzc1NjYWxpbmdDb25maWd1cmF0aW9uID0ge1xuICAgICAgICBtaW5DYXBhY2l0eTogMSxcbiAgICAgICAgbWF4Q2FwYWNpdHk6IDgsXG4gICAgICB9O1xuICAgICAgaWYgKG5lcHR1bmVTZXJ2ZXJsc3NDYXBhY2l0eSkge1xuICAgICAgICAoc2VydmVybGVzc1NjYWxpbmdDb25maWd1cmF0aW9uLm1pbkNhcGFjaXR5ID1cbiAgICAgICAgICBuZXB0dW5lU2VydmVybHNzQ2FwYWNpdHkubWluQ2FwYWNpdHkpLFxuICAgICAgICAgIChzZXJ2ZXJsZXNzU2NhbGluZ0NvbmZpZ3VyYXRpb24ubWF4Q2FwYWNpdHkgPVxuICAgICAgICAgICAgbmVwdHVuZVNlcnZlcmxzc0NhcGFjaXR5Lm1heENhcGFjaXR5KTtcbiAgICAgIH1cbiAgICAgIG5lcHR1bmVCYXNlQ2x1c3RlckNvbmZpZ3VyYXRpb24gPSB7XG4gICAgICAgIC4uLm5lcHR1bmVCYXNlQ2x1c3RlckNvbmZpZ3VyYXRpb24sXG4gICAgICAgIHNlcnZlcmxlc3NTY2FsaW5nQ29uZmlndXJhdGlvbixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gaWYgKG5lcHR1bmVTZXJ2ZXJsc3MpIHtcbiAgICB0aGlzLmNsdXN0ZXIgPSBuZXcgbmVwdHVuZS5EYXRhYmFzZUNsdXN0ZXIodGhpcywgXCJjbHVzdGVyXCIsIHtcbiAgICAgIHZwYzogdnBjLFxuICAgICAgaW5zdGFuY2VUeXBlOiBuZXB0dW5lU2VydmVybHNzXG4gICAgICAgID8gbmVwdHVuZS5JbnN0YW5jZVR5cGUuU0VSVkVSTEVTU1xuICAgICAgICA6IG5lcHR1bmUuSW5zdGFuY2VUeXBlLlI1X1hMQVJHRSxcbiAgICAgIC4uLm5lcHR1bmVCYXNlQ2x1c3RlckNvbmZpZ3VyYXRpb24sXG5cbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0czogdnBjLmlzb2xhdGVkU3VibmV0cyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmNsdXN0ZXIuZ3JhbnRDb25uZWN0KHRoaXMubmVwdHVuZVJvbGUpO1xuXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKFxuICAgICAgdGhpcy5uZXB0dW5lUm9sZSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1JQU01XCIsXG4gICAgICAgICAgcmVhc29uOiBcIk5lZWQgdGhlIHBlcm1pc3Npb24gZm9yIGJ1bGsgbG9hZFwiLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHRydWVcbiAgICApO1xuICB9XG59XG4iXX0=