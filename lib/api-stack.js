"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiStack = void 0;
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cognito_1 = require("./constructs/cognito");
const api_1 = require("./constructs/api");
const media_1 = require("./constructs/media");
const rsvp_1 = require("./constructs/rsvp");
const path = require("path");
class ApiStack extends aws_cdk_lib_1.Stack {
    constructor(scope, id, props) {
        const { cognito, vpc, cluster, clusterRole, graphqlFieldName, s3Uri } = props;
        super(scope, id, props);
        this.cognito = new cognito_1.Cognito(this, "cognito", {
            adminEmail: cognito.adminEmail,
            userName: cognito.userName,
            appSignInUrl: cognito.appSignInUrl,
            ses: cognito.ses,
            refreshTokenValidity: aws_cdk_lib_1.Duration.days(1),
        });
        this.media = new media_1.Media(this, "media");
        if (props.rsvp) {
            this.rsvp = new rsvp_1.Rsvp(this, "rsvp", {
                fromAddress: props.rsvp.fromAddress,
                rsvpBaseUrl: props.rsvp.rsvpBaseUrl,
            });
        }
        const api = new api_1.Api(this, "api", {
            schema: path.join(__dirname, "../api/graphql/schema.graphql"),
            vpc,
            cluster,
            clusterRole,
            cognito: this.cognito,
            graphqlFieldName,
            s3Uri,
            mediaBucket: this.media.bucket,
            rsvpQueue: this.rsvp?.queue,
            rsvpSigningSecret: this.rsvp?.signingSecret,
        });
        this.graphqlUrl = api.graphqlUrl;
        this.graphqlApiId = api.graphqlApiId;
        this.lambdaFunctionNames = api.lambdaFunctionNames;
        // Surface deployment account/region/stage so generateEnv can write them
        // into the frontend .env (handles per-stage cross-account deployments).
        new aws_cdk_lib_1.CfnOutput(this, "deployAccount", { value: this.account });
        new aws_cdk_lib_1.CfnOutput(this, "deployRegion", { value: this.region });
        new aws_cdk_lib_1.CfnOutput(this, "deployStage", {
            value: this.node.tryGetContext("stage") ?? "dev",
        });
    }
}
exports.ApiStack = ApiStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZDQUF1RjtBQUd2RixrREFBK0M7QUFFL0MsMENBQThDO0FBQzlDLDhDQUEyQztBQUMzQyw0Q0FBeUM7QUFDekMsNkJBQTZCO0FBNEI3QixNQUFhLFFBQVMsU0FBUSxtQkFBSztJQU9qQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxFQUFFLE9BQU8sRUFBRSxXQUFXLEVBQUUsZ0JBQWdCLEVBQUUsS0FBSyxFQUFFLEdBQ25FLEtBQUssQ0FBQztRQUNSLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3hCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxpQkFBTyxDQUFDLElBQUksRUFBRSxTQUFTLEVBQUU7WUFDMUMsVUFBVSxFQUFFLE9BQU8sQ0FBQyxVQUFVO1lBQzlCLFFBQVEsRUFBRSxPQUFPLENBQUMsUUFBUTtZQUMxQixZQUFZLEVBQUUsT0FBTyxDQUFDLFlBQVk7WUFDbEMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxHQUFHO1lBQ2hCLG9CQUFvQixFQUFFLHNCQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztTQUN2QyxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksYUFBSyxDQUFDLElBQUksRUFBRSxPQUFPLENBQUMsQ0FBQztRQUN0QyxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxXQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtnQkFDakMsV0FBVyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVztnQkFDbkMsV0FBVyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVzthQUNwQyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBQ0QsTUFBTSxHQUFHLEdBQUcsSUFBSSxTQUFHLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRTtZQUMvQixNQUFNLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsK0JBQStCLENBQUM7WUFDN0QsR0FBRztZQUNILE9BQU87WUFDUCxXQUFXO1lBQ1gsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLGdCQUFnQjtZQUNoQixLQUFLO1lBQ0wsV0FBVyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTTtZQUM5QixTQUFTLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLO1lBQzNCLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUUsYUFBYTtTQUM1QyxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxVQUFVLENBQUM7UUFDakMsSUFBSSxDQUFDLFlBQVksR0FBRyxHQUFHLENBQUMsWUFBWSxDQUFDO1FBQ3JDLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxHQUFHLENBQUMsbUJBQW1CLENBQUM7UUFFbkQsd0VBQXdFO1FBQ3hFLHdFQUF3RTtRQUN4RSxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUM5RCxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUM1RCxJQUFJLHVCQUFTLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNqQyxLQUFLLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLElBQUksS0FBSztTQUNqRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFqREQsNEJBaURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU3RhY2ssIFN0YWNrUHJvcHMsIER1cmF0aW9uLCBDZm5PdXRwdXQsIGF3c19lYzIsIGF3c19pYW0gfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5cbmltcG9ydCB7IENvZ25pdG8gfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL2NvZ25pdG9cIjtcbmltcG9ydCAqIGFzIG5lcHR1bmUgZnJvbSBcIkBhd3MtY2RrL2F3cy1uZXB0dW5lLWFscGhhXCI7XG5pbXBvcnQgeyBBcGksIFMzVXJpIH0gZnJvbSBcIi4vY29uc3RydWN0cy9hcGlcIjtcbmltcG9ydCB7IE1lZGlhIH0gZnJvbSBcIi4vY29uc3RydWN0cy9tZWRpYVwiO1xuaW1wb3J0IHsgUnN2cCB9IGZyb20gXCIuL2NvbnN0cnVjdHMvcnN2cFwiO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tIFwicGF0aFwiO1xuXG5pbnRlcmZhY2UgQXBpU3RhY2tQcm9wcyBleHRlbmRzIFN0YWNrUHJvcHMge1xuICBjb2duaXRvOiB7XG4gICAgYWRtaW5FbWFpbDogc3RyaW5nO1xuICAgIHVzZXJOYW1lPzogc3RyaW5nO1xuICAgIC8qKiBQdWJsaWMgc2lnbi1pbiBVUkwgdXNlZCBpbiB0aGUgaW52aXRhdGlvbiBlbWFpbC4gKi9cbiAgICBhcHBTaWduSW5Vcmw/OiBzdHJpbmc7XG4gICAgLyoqIFZlcmlmaWVkIFNFUyBzZW5kZXIgY29uZmlnIOKAlCBsaWZ0cyBDb2duaXRvJ3Mgc2FuZGJveCBsaW1pdHMuICovXG4gICAgc2VzPzoge1xuICAgICAgc291cmNlQXJuOiBzdHJpbmc7XG4gICAgICBmcm9tQWRkcmVzczogc3RyaW5nO1xuICAgICAgZnJvbU5hbWU/OiBzdHJpbmc7XG4gICAgICByZXBseVRvRW1haWxBZGRyZXNzPzogc3RyaW5nO1xuICAgIH07XG4gIH07XG4gIHZwYzogYXdzX2VjMi5WcGM7XG4gIGNsdXN0ZXI6IG5lcHR1bmUuRGF0YWJhc2VDbHVzdGVyO1xuICBjbHVzdGVyUm9sZTogYXdzX2lhbS5Sb2xlO1xuICBncmFwaHFsRmllbGROYW1lOiBzdHJpbmdbXTtcbiAgczNVcmk6IFMzVXJpO1xuICAvKiogT3B0aW9uYWw6IGVuYWJsZSB0aGUgUlNWUCBpbnZpdGUgcGlwZWxpbmUgKFNFUyArIFNRUykuICovXG4gIHJzdnA/OiB7XG4gICAgZnJvbUFkZHJlc3M6IHN0cmluZztcbiAgICByc3ZwQmFzZVVybDogc3RyaW5nO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgQXBpU3RhY2sgZXh0ZW5kcyBTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBjb2duaXRvOiBDb2duaXRvO1xuICBwdWJsaWMgcmVhZG9ubHkgZ3JhcGhxbFVybDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgZ3JhcGhxbEFwaUlkOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBsYW1iZGFGdW5jdGlvbk5hbWVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBwdWJsaWMgcmVhZG9ubHkgbWVkaWE6IE1lZGlhO1xuICBwdWJsaWMgcmVhZG9ubHkgcnN2cD86IFJzdnA7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBBcGlTdGFja1Byb3BzKSB7XG4gICAgY29uc3QgeyBjb2duaXRvLCB2cGMsIGNsdXN0ZXIsIGNsdXN0ZXJSb2xlLCBncmFwaHFsRmllbGROYW1lLCBzM1VyaSB9ID1cbiAgICAgIHByb3BzO1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuICAgIHRoaXMuY29nbml0byA9IG5ldyBDb2duaXRvKHRoaXMsIFwiY29nbml0b1wiLCB7XG4gICAgICBhZG1pbkVtYWlsOiBjb2duaXRvLmFkbWluRW1haWwsXG4gICAgICB1c2VyTmFtZTogY29nbml0by51c2VyTmFtZSxcbiAgICAgIGFwcFNpZ25JblVybDogY29nbml0by5hcHBTaWduSW5VcmwsXG4gICAgICBzZXM6IGNvZ25pdG8uc2VzLFxuICAgICAgcmVmcmVzaFRva2VuVmFsaWRpdHk6IER1cmF0aW9uLmRheXMoMSksXG4gICAgfSk7XG4gICAgdGhpcy5tZWRpYSA9IG5ldyBNZWRpYSh0aGlzLCBcIm1lZGlhXCIpO1xuICAgIGlmIChwcm9wcy5yc3ZwKSB7XG4gICAgICB0aGlzLnJzdnAgPSBuZXcgUnN2cCh0aGlzLCBcInJzdnBcIiwge1xuICAgICAgICBmcm9tQWRkcmVzczogcHJvcHMucnN2cC5mcm9tQWRkcmVzcyxcbiAgICAgICAgcnN2cEJhc2VVcmw6IHByb3BzLnJzdnAucnN2cEJhc2VVcmwsXG4gICAgICB9KTtcbiAgICB9XG4gICAgY29uc3QgYXBpID0gbmV3IEFwaSh0aGlzLCBcImFwaVwiLCB7XG4gICAgICBzY2hlbWE6IHBhdGguam9pbihfX2Rpcm5hbWUsIFwiLi4vYXBpL2dyYXBocWwvc2NoZW1hLmdyYXBocWxcIiksXG4gICAgICB2cGMsXG4gICAgICBjbHVzdGVyLFxuICAgICAgY2x1c3RlclJvbGUsXG4gICAgICBjb2duaXRvOiB0aGlzLmNvZ25pdG8sXG4gICAgICBncmFwaHFsRmllbGROYW1lLFxuICAgICAgczNVcmksXG4gICAgICBtZWRpYUJ1Y2tldDogdGhpcy5tZWRpYS5idWNrZXQsXG4gICAgICByc3ZwUXVldWU6IHRoaXMucnN2cD8ucXVldWUsXG4gICAgICByc3ZwU2lnbmluZ1NlY3JldDogdGhpcy5yc3ZwPy5zaWduaW5nU2VjcmV0LFxuICAgIH0pO1xuICAgIHRoaXMuZ3JhcGhxbFVybCA9IGFwaS5ncmFwaHFsVXJsO1xuICAgIHRoaXMuZ3JhcGhxbEFwaUlkID0gYXBpLmdyYXBocWxBcGlJZDtcbiAgICB0aGlzLmxhbWJkYUZ1bmN0aW9uTmFtZXMgPSBhcGkubGFtYmRhRnVuY3Rpb25OYW1lcztcblxuICAgIC8vIFN1cmZhY2UgZGVwbG95bWVudCBhY2NvdW50L3JlZ2lvbi9zdGFnZSBzbyBnZW5lcmF0ZUVudiBjYW4gd3JpdGUgdGhlbVxuICAgIC8vIGludG8gdGhlIGZyb250ZW5kIC5lbnYgKGhhbmRsZXMgcGVyLXN0YWdlIGNyb3NzLWFjY291bnQgZGVwbG95bWVudHMpLlxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJkZXBsb3lBY2NvdW50XCIsIHsgdmFsdWU6IHRoaXMuYWNjb3VudCB9KTtcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiZGVwbG95UmVnaW9uXCIsIHsgdmFsdWU6IHRoaXMucmVnaW9uIH0pO1xuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJkZXBsb3lTdGFnZVwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoXCJzdGFnZVwiKSA/PyBcImRldlwiLFxuICAgIH0pO1xuICB9XG59XG4iXX0=