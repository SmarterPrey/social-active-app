"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WafCloudFrontStack = void 0;
const cdk = require("aws-cdk-lib");
const waf_1 = require("./constructs/waf");
class WafCloudFrontStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { allowedIps, wafParamName } = props;
        //  AWS WAF
        const wafv2 = new waf_1.Waf(this, "cloudfront-waf", {
            allowedIps,
            useCloudFront: true,
            wafParamName,
        });
        this.webAcl = wafv2.waf;
    }
}
exports.WafCloudFrontStack = WafCloudFrontStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2FmLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2FmLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUVuQywwQ0FBdUM7QUFPdkMsTUFBYSxrQkFBbUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUUvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXdCO1FBQ2hFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTNDLFdBQVc7UUFDWCxNQUFNLEtBQUssR0FBRyxJQUFJLFNBQUcsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDNUMsVUFBVTtZQUNWLGFBQWEsRUFBRSxJQUFJO1lBQ25CLFlBQVk7U0FDYixDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUM7SUFDMUIsQ0FBQztDQUNGO0FBZkQsZ0RBZUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSBcImF3cy1jZGstbGliXCI7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHsgV2FmIH0gZnJvbSBcIi4vY29uc3RydWN0cy93YWZcIjtcblxuaW50ZXJmYWNlIFdhZlN0YWNrdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBhbGxvd2VkSXBzOiBzdHJpbmdbXTtcbiAgd2FmUGFyYW1OYW1lOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBXYWZDbG91ZEZyb250U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICByZWFkb25seSB3ZWJBY2w6IGNkay5hd3Nfd2FmdjIuQ2ZuV2ViQUNMO1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogV2FmU3RhY2t0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgYWxsb3dlZElwcywgd2FmUGFyYW1OYW1lIH0gPSBwcm9wcztcblxuICAgIC8vICBBV1MgV0FGXG4gICAgY29uc3Qgd2FmdjIgPSBuZXcgV2FmKHRoaXMsIFwiY2xvdWRmcm9udC13YWZcIiwge1xuICAgICAgYWxsb3dlZElwcyxcbiAgICAgIHVzZUNsb3VkRnJvbnQ6IHRydWUsXG4gICAgICB3YWZQYXJhbU5hbWUsXG4gICAgfSk7XG4gICAgdGhpcy53ZWJBY2wgPSB3YWZ2Mi53YWY7XG4gIH1cbn1cbiJdfQ==