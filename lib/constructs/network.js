"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Network = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk_nag_1 = require("cdk-nag");
const constructs_1 = require("constructs");
class Network extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const { natSubnet, maxAz } = props;
        const cwLogs = new aws_cdk_lib_1.aws_logs.LogGroup(this, "vpc-logs", {
            logGroupName: `/${aws_cdk_lib_1.Stack.of(this).stackName}/${id}/vpc-logs/`,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            retention: aws_cdk_lib_1.aws_logs.RetentionDays.TWO_MONTHS,
        });
        const subnetConfiguration = [
            {
                subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PUBLIC,
                name: "public-subnet",
            },
            {
                subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_ISOLATED,
                name: "neptune-isolated-subnet",
            },
        ];
        if (natSubnet) {
            subnetConfiguration.push({
                subnetType: aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
                name: "nat-subnet",
            });
        }
        const vpcBaseProps = {
            maxAzs: maxAz,
            subnetConfiguration,
            flowLogs: {
                s3: {
                    destination: aws_cdk_lib_1.aws_ec2.FlowLogDestination.toCloudWatchLogs(cwLogs),
                    trafficType: aws_cdk_lib_1.aws_ec2.FlowLogTrafficType.ALL,
                },
            },
            gatewayEndpoints: {
                S3: {
                    service: aws_cdk_lib_1.aws_ec2.GatewayVpcEndpointAwsService.S3,
                },
            },
        };
        if (props.natSubnet) {
            const eipAllocationForNat = [];
            const eipAllocationIds = [];
            for (let i = 0; i < maxAz; i++) {
                const eip = new aws_cdk_lib_1.aws_ec2.CfnEIP(this, `${id}-nat-eip${i}`, {});
                eipAllocationForNat.push(eip.attrPublicIp);
                eipAllocationIds.push(eip.attrAllocationId);
            }
            vpcBaseProps.natGatewayProvider = aws_cdk_lib_1.aws_ec2.NatProvider.gateway({
                eipAllocationIds,
            });
        }
        const vpcProps = vpcBaseProps;
        this.vpc = new aws_cdk_lib_1.aws_ec2.Vpc(this, "vpc", vpcProps);
        // Create endpoint
        const CWEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(this, "cw-vep", {
            service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING,
            vpc: this.vpc,
            privateDnsEnabled: true,
        });
        const CWLEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(this, "cwl-vep", {
            service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
            vpc: this.vpc,
            privateDnsEnabled: true,
        });
        const bedrockEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(this, "bedrock-vep", {
            service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
            vpc: this.vpc,
            privateDnsEnabled: true,
        });
        // Nag supressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions([CWEndpoint, CWLEndpoint, bedrockEndpoint], [
            {
                id: "CdkNagValidationFailure",
                reason: "Suppressed: Managed by privatelink construct",
            },
        ], true);
    }
}
exports.Network = Network;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibmV0d29yay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm5ldHdvcmsudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsNkNBQWtGO0FBQ2xGLHFDQUEwQztBQUUxQywyQ0FBdUM7QUFNdkMsTUFBYSxPQUFRLFNBQVEsc0JBQVM7SUFFcEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFtQjtRQUMzRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBQ2pCLE1BQU0sRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRW5DLE1BQU0sTUFBTSxHQUFHLElBQUksc0JBQVEsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUNyRCxZQUFZLEVBQUUsSUFBSSxtQkFBSyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxTQUFTLElBQUksRUFBRSxZQUFZO1lBQzVELGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87WUFDcEMsU0FBUyxFQUFFLHNCQUFRLENBQUMsYUFBYSxDQUFDLFVBQVU7U0FDN0MsQ0FBQyxDQUFDO1FBRUgsTUFBTSxtQkFBbUIsR0FBa0M7WUFDekQ7Z0JBQ0UsVUFBVSxFQUFFLHFCQUFPLENBQUMsVUFBVSxDQUFDLE1BQU07Z0JBQ3JDLElBQUksRUFBRSxlQUFlO2FBQ3RCO1lBQ0Q7Z0JBQ0UsVUFBVSxFQUFFLHFCQUFPLENBQUMsVUFBVSxDQUFDLGdCQUFnQjtnQkFDL0MsSUFBSSxFQUFFLHlCQUF5QjthQUNoQztTQUNGLENBQUM7UUFFRixJQUFJLFNBQVMsRUFBRSxDQUFDO1lBQ2QsbUJBQW1CLENBQUMsSUFBSSxDQUFDO2dCQUN2QixVQUFVLEVBQUUscUJBQU8sQ0FBQyxVQUFVLENBQUMsbUJBQW1CO2dCQUNsRCxJQUFJLEVBQUUsWUFBWTthQUNuQixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsTUFBTSxZQUFZLEdBQVE7WUFDeEIsTUFBTSxFQUFFLEtBQUs7WUFDYixtQkFBbUI7WUFDbkIsUUFBUSxFQUFFO2dCQUNSLEVBQUUsRUFBRTtvQkFDRixXQUFXLEVBQUUscUJBQU8sQ0FBQyxrQkFBa0IsQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUM7b0JBQ2hFLFdBQVcsRUFBRSxxQkFBTyxDQUFDLGtCQUFrQixDQUFDLEdBQUc7aUJBQzVDO2FBQ0Y7WUFDRCxnQkFBZ0IsRUFBRTtnQkFDaEIsRUFBRSxFQUFFO29CQUNGLE9BQU8sRUFBRSxxQkFBTyxDQUFDLDRCQUE0QixDQUFDLEVBQUU7aUJBQ2pEO2FBQ0Y7U0FDRixDQUFDO1FBQ0YsSUFBSSxLQUFLLENBQUMsU0FBUyxFQUFFLENBQUM7WUFDcEIsTUFBTSxtQkFBbUIsR0FBRyxFQUFFLENBQUM7WUFDL0IsTUFBTSxnQkFBZ0IsR0FBYSxFQUFFLENBQUM7WUFFdEMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO2dCQUMvQixNQUFNLEdBQUcsR0FBRyxJQUFJLHFCQUFPLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsV0FBVyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDOUQsbUJBQW1CLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQztnQkFDM0MsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1lBQzlDLENBQUM7WUFFRCxZQUFZLENBQUMsa0JBQWtCLEdBQUcscUJBQU8sQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDO2dCQUM1RCxnQkFBZ0I7YUFDakIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELE1BQU0sUUFBUSxHQUFxQixZQUFZLENBQUM7UUFDaEQsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLHFCQUFPLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFbEQsa0JBQWtCO1FBQ2xCLE1BQU0sVUFBVSxHQUFHLElBQUkscUJBQU8sQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFO1lBQ2xFLE9BQU8sRUFBRSxxQkFBTyxDQUFDLDhCQUE4QixDQUFDLHFCQUFxQjtZQUNyRSxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUc7WUFDYixpQkFBaUIsRUFBRSxJQUFJO1NBQ3hCLENBQUMsQ0FBQztRQUVILE1BQU0sV0FBVyxHQUFHLElBQUkscUJBQU8sQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsU0FBUyxFQUFFO1lBQ3BFLE9BQU8sRUFBRSxxQkFBTyxDQUFDLDhCQUE4QixDQUFDLGVBQWU7WUFDL0QsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHO1lBQ2IsaUJBQWlCLEVBQUUsSUFBSTtTQUN4QixDQUFDLENBQUM7UUFFSCxNQUFNLGVBQWUsR0FBRyxJQUFJLHFCQUFPLENBQUMsb0JBQW9CLENBQ3RELElBQUksRUFDSixhQUFhLEVBQ2I7WUFDRSxPQUFPLEVBQUUscUJBQU8sQ0FBQyw4QkFBOEIsQ0FBQyxlQUFlO1lBQy9ELEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRztZQUNiLGlCQUFpQixFQUFFLElBQUk7U0FDeEIsQ0FDRixDQUFDO1FBRUYsa0JBQWtCO1FBQ2xCLHlCQUFlLENBQUMsdUJBQXVCLENBQ3JDLENBQUMsVUFBVSxFQUFFLFdBQVcsRUFBRSxlQUFlLENBQUMsRUFDMUM7WUFDRTtnQkFDRSxFQUFFLEVBQUUseUJBQXlCO2dCQUM3QixNQUFNLEVBQUUsOENBQThDO2FBQ3ZEO1NBQ0YsRUFDRCxJQUFJLENBQ0wsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQWxHRCwwQkFrR0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBSZW1vdmFsUG9saWN5LCBTdGFjaywgU3RhY2tQcm9wcywgYXdzX2VjMiwgYXdzX2xvZ3MgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5cbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5cbmludGVyZmFjZSBOZXR3b3JrUHJvcHMgZXh0ZW5kcyBTdGFja1Byb3BzIHtcbiAgbmF0U3VibmV0PzogYm9vbGVhbjtcbiAgbWF4QXo6IG51bWJlcjtcbn1cbmV4cG9ydCBjbGFzcyBOZXR3b3JrIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHZwYzogYXdzX2VjMi5WcGM7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBOZXR3b3JrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgIGNvbnN0IHsgbmF0U3VibmV0LCBtYXhBeiB9ID0gcHJvcHM7XG5cbiAgICBjb25zdCBjd0xvZ3MgPSBuZXcgYXdzX2xvZ3MuTG9nR3JvdXAodGhpcywgXCJ2cGMtbG9nc1wiLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvJHtTdGFjay5vZih0aGlzKS5zdGFja05hbWV9LyR7aWR9L3ZwYy1sb2dzL2AsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICByZXRlbnRpb246IGF3c19sb2dzLlJldGVudGlvbkRheXMuVFdPX01PTlRIUyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHN1Ym5ldENvbmZpZ3VyYXRpb246IGF3c19lYzIuU3VibmV0Q29uZmlndXJhdGlvbltdID0gW1xuICAgICAge1xuICAgICAgICBzdWJuZXRUeXBlOiBhd3NfZWMyLlN1Ym5ldFR5cGUuUFVCTElDLFxuICAgICAgICBuYW1lOiBcInB1YmxpYy1zdWJuZXRcIixcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGF3c19lYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVELFxuICAgICAgICBuYW1lOiBcIm5lcHR1bmUtaXNvbGF0ZWQtc3VibmV0XCIsXG4gICAgICB9LFxuICAgIF07XG5cbiAgICBpZiAobmF0U3VibmV0KSB7XG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uLnB1c2goe1xuICAgICAgICBzdWJuZXRUeXBlOiBhd3NfZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgICAgbmFtZTogXCJuYXQtc3VibmV0XCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCB2cGNCYXNlUHJvcHM6IGFueSA9IHtcbiAgICAgIG1heEF6czogbWF4QXosXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uLFxuICAgICAgZmxvd0xvZ3M6IHtcbiAgICAgICAgczM6IHtcbiAgICAgICAgICBkZXN0aW5hdGlvbjogYXdzX2VjMi5GbG93TG9nRGVzdGluYXRpb24udG9DbG91ZFdhdGNoTG9ncyhjd0xvZ3MpLFxuICAgICAgICAgIHRyYWZmaWNUeXBlOiBhd3NfZWMyLkZsb3dMb2dUcmFmZmljVHlwZS5BTEwsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgZ2F0ZXdheUVuZHBvaW50czoge1xuICAgICAgICBTMzoge1xuICAgICAgICAgIHNlcnZpY2U6IGF3c19lYzIuR2F0ZXdheVZwY0VuZHBvaW50QXdzU2VydmljZS5TMyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcbiAgICBpZiAocHJvcHMubmF0U3VibmV0KSB7XG4gICAgICBjb25zdCBlaXBBbGxvY2F0aW9uRm9yTmF0ID0gW107XG4gICAgICBjb25zdCBlaXBBbGxvY2F0aW9uSWRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IG1heEF6OyBpKyspIHtcbiAgICAgICAgY29uc3QgZWlwID0gbmV3IGF3c19lYzIuQ2ZuRUlQKHRoaXMsIGAke2lkfS1uYXQtZWlwJHtpfWAsIHt9KTtcbiAgICAgICAgZWlwQWxsb2NhdGlvbkZvck5hdC5wdXNoKGVpcC5hdHRyUHVibGljSXApO1xuICAgICAgICBlaXBBbGxvY2F0aW9uSWRzLnB1c2goZWlwLmF0dHJBbGxvY2F0aW9uSWQpO1xuICAgICAgfVxuXG4gICAgICB2cGNCYXNlUHJvcHMubmF0R2F0ZXdheVByb3ZpZGVyID0gYXdzX2VjMi5OYXRQcm92aWRlci5nYXRld2F5KHtcbiAgICAgICAgZWlwQWxsb2NhdGlvbklkcyxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHZwY1Byb3BzOiBhd3NfZWMyLlZwY1Byb3BzID0gdnBjQmFzZVByb3BzO1xuICAgIHRoaXMudnBjID0gbmV3IGF3c19lYzIuVnBjKHRoaXMsIFwidnBjXCIsIHZwY1Byb3BzKTtcblxuICAgIC8vIENyZWF0ZSBlbmRwb2ludFxuICAgIGNvbnN0IENXRW5kcG9pbnQgPSBuZXcgYXdzX2VjMi5JbnRlcmZhY2VWcGNFbmRwb2ludCh0aGlzLCBcImN3LXZlcFwiLCB7XG4gICAgICBzZXJ2aWNlOiBhd3NfZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5DTE9VRFdBVENIX01PTklUT1JJTkcsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgcHJpdmF0ZURuc0VuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBDV0xFbmRwb2ludCA9IG5ldyBhd3NfZWMyLkludGVyZmFjZVZwY0VuZHBvaW50KHRoaXMsIFwiY3dsLXZlcFwiLCB7XG4gICAgICBzZXJ2aWNlOiBhd3NfZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5DTE9VRFdBVENIX0xPR1MsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgcHJpdmF0ZURuc0VuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBiZWRyb2NrRW5kcG9pbnQgPSBuZXcgYXdzX2VjMi5JbnRlcmZhY2VWcGNFbmRwb2ludChcbiAgICAgIHRoaXMsXG4gICAgICBcImJlZHJvY2stdmVwXCIsXG4gICAgICB7XG4gICAgICAgIHNlcnZpY2U6IGF3c19lYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkJFRFJPQ0tfUlVOVElNRSxcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgcHJpdmF0ZURuc0VuYWJsZWQ6IHRydWUsXG4gICAgICB9XG4gICAgKTtcblxuICAgIC8vIE5hZyBzdXByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyhcbiAgICAgIFtDV0VuZHBvaW50LCBDV0xFbmRwb2ludCwgYmVkcm9ja0VuZHBvaW50XSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiBcIkNka05hZ1ZhbGlkYXRpb25GYWlsdXJlXCIsXG4gICAgICAgICAgcmVhc29uOiBcIlN1cHByZXNzZWQ6IE1hbmFnZWQgYnkgcHJpdmF0ZWxpbmsgY29uc3RydWN0XCIsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdHJ1ZVxuICAgICk7XG4gIH1cbn1cbiJdfQ==