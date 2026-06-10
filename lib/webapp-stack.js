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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViYXBwLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2ViYXBwLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQywwQ0FBdUM7QUFDdkMsNkNBQW1EO0FBT25ELE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBdUI7UUFDL0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxTQUFHLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNsQyxVQUFVLEVBQUUsV0FBVztZQUN2QixnQkFBZ0IsRUFBRSxNQUFNO1lBQ3hCLFlBQVksRUFBRSxLQUFLLENBQUMsWUFBWTtZQUNoQyxNQUFNLEVBQUUsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTTtZQUM3QixjQUFjLEVBQUU7Z0JBQ2QsYUFBYSxFQUFFLEtBQUssQ0FBQyx1QkFBdUI7b0JBQzFDLENBQUMsQ0FBQyxLQUFLLENBQUMsdUJBQXVCO29CQUMvQixDQUFDLENBQUMsMkJBQWEsQ0FBQyxNQUFNO2dCQUN4QixpQkFBaUIsRUFDZixLQUFLLENBQUMsdUJBQXVCLEtBQUssMkJBQWEsQ0FBQyxPQUFPO29CQUNyRCxDQUFDLENBQUMsSUFBSTtvQkFDTixDQUFDLENBQUMsS0FBSzthQUNaO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBcEJELGtDQW9CQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQgeyBXZWIgfSBmcm9tIFwiLi9jb25zdHJ1Y3RzL3dlYlwiO1xuaW1wb3J0IHsgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW50ZXJmYWNlIFdlYmFwcFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHdhZlBhcmFtTmFtZTogc3RyaW5nO1xuICB3ZWJCdWNrZXRzUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJhcHBTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBXZWJhcHBTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB3ZWIgPSBuZXcgV2ViKHRoaXMsIFwid2ViYXBwXCIsIHtcbiAgICAgIHdlYmFwcFBhdGg6IFwiLi9hcHAvd2ViXCIsXG4gICAgICB3ZWJhcHBEaXN0Rm9sZGVyOiBcImRpc3RcIixcbiAgICAgIHdhZlBhcmFtTmFtZTogcHJvcHMud2FmUGFyYW1OYW1lLFxuICAgICAgcmVnaW9uOiBTdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICB3ZWJCdWNrZXRQcm9wczoge1xuICAgICAgICByZW1vdmFsUG9saWN5OiBwcm9wcy53ZWJCdWNrZXRzUmVtb3ZhbFBvbGljeVxuICAgICAgICAgID8gcHJvcHMud2ViQnVja2V0c1JlbW92YWxQb2xpY3lcbiAgICAgICAgICA6IFJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgICBhdXRvRGVsZXRlT2JqZWN0czpcbiAgICAgICAgICBwcm9wcy53ZWJCdWNrZXRzUmVtb3ZhbFBvbGljeSA9PT0gUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgICAgICAgICA/IHRydWVcbiAgICAgICAgICAgIDogZmFsc2UsXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG59XG4iXX0=