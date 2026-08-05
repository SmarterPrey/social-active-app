"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebappStack = void 0;
const cdk = require("aws-cdk-lib");
const web_1 = require("./constructs/web");
const aws_cdk_lib_1 = require("aws-cdk-lib");
class WebappStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const web = new web_1.Web(this, "webapp", {
            webappPath: "./app/web",
            webappDistFolder: "dist",
            wafParamName: props.wafParamName,
            region: aws_cdk_lib_1.Stack.of(this).region,
            domainNames: props.webDomainNames,
            hostedZoneName: props.hostedZoneName,
            webBucketProps: {
                removalPolicy: props.webBucketsRemovalPolicy
                    ? props.webBucketsRemovalPolicy
                    : aws_cdk_lib_1.RemovalPolicy.RETAIN,
                autoDeleteObjects: props.webBucketsRemovalPolicy === aws_cdk_lib_1.RemovalPolicy.DESTROY
                    ? true
                    : false,
            },
        });
    }
}
exports.WebappStack = WebappStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViYXBwLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2ViYXBwLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQywwQ0FBdUM7QUFDdkMsNkNBQW1EO0FBV25ELE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBdUI7UUFDL0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxTQUFHLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNsQyxVQUFVLEVBQUUsV0FBVztZQUN2QixnQkFBZ0IsRUFBRSxNQUFNO1lBQ3hCLFlBQVksRUFBRSxLQUFLLENBQUMsWUFBWTtZQUNoQyxNQUFNLEVBQUUsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTTtZQUM3QixXQUFXLEVBQUUsS0FBSyxDQUFDLGNBQWM7WUFDakMsY0FBYyxFQUFFLEtBQUssQ0FBQyxjQUFjO1lBQ3BDLGNBQWMsRUFBRTtnQkFDZCxhQUFhLEVBQUUsS0FBSyxDQUFDLHVCQUF1QjtvQkFDMUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyx1QkFBdUI7b0JBQy9CLENBQUMsQ0FBQywyQkFBYSxDQUFDLE1BQU07Z0JBQ3hCLGlCQUFpQixFQUNmLEtBQUssQ0FBQyx1QkFBdUIsS0FBSywyQkFBYSxDQUFDLE9BQU87b0JBQ3JELENBQUMsQ0FBQyxJQUFJO29CQUNOLENBQUMsQ0FBQyxLQUFLO2FBQ1o7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF0QkQsa0NBc0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7IFdlYiB9IGZyb20gXCIuL2NvbnN0cnVjdHMvd2ViXCI7XG5pbXBvcnQgeyBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuXG5pbnRlcmZhY2UgV2ViYXBwU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgd2FmUGFyYW1OYW1lOiBzdHJpbmc7XG4gIHdlYkJ1Y2tldHNSZW1vdmFsUG9saWN5PzogUmVtb3ZhbFBvbGljeTtcbiAgLyoqIEN1c3RvbSBkb21haW4gbmFtZXMgdG8gYXR0YWNoIHRvIHRoZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvbi4gKi9cbiAgd2ViRG9tYWluTmFtZXM/OiBzdHJpbmdbXTtcbiAgLyoqIFJvdXRlIDUzIGhvc3RlZCB6b25lIG5hbWUgKGUuZy4gXCJtdWNrZXIuaW9cIikuIFJlcXVpcmVkIGlmIHdlYkRvbWFpbk5hbWVzIGlzIG5vbi1lbXB0eS4gKi9cbiAgaG9zdGVkWm9uZU5hbWU/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJhcHBTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBXZWJhcHBTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB3ZWIgPSBuZXcgV2ViKHRoaXMsIFwid2ViYXBwXCIsIHtcbiAgICAgIHdlYmFwcFBhdGg6IFwiLi9hcHAvd2ViXCIsXG4gICAgICB3ZWJhcHBEaXN0Rm9sZGVyOiBcImRpc3RcIixcbiAgICAgIHdhZlBhcmFtTmFtZTogcHJvcHMud2FmUGFyYW1OYW1lLFxuICAgICAgcmVnaW9uOiBTdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICBkb21haW5OYW1lczogcHJvcHMud2ViRG9tYWluTmFtZXMsXG4gICAgICBob3N0ZWRab25lTmFtZTogcHJvcHMuaG9zdGVkWm9uZU5hbWUsXG4gICAgICB3ZWJCdWNrZXRQcm9wczoge1xuICAgICAgICByZW1vdmFsUG9saWN5OiBwcm9wcy53ZWJCdWNrZXRzUmVtb3ZhbFBvbGljeVxuICAgICAgICAgID8gcHJvcHMud2ViQnVja2V0c1JlbW92YWxQb2xpY3lcbiAgICAgICAgICA6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czpcbiAgICAgICAgICBwcm9wcy53ZWJCdWNrZXRzUmVtb3ZhbFBvbGljeSA9PT0gUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgICAgICA/IHRydWVcbiAgICAgICAgICAgIDogZmFsc2UsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG59XG4iXX0=