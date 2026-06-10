"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebACLAssociation = exports.WAF = exports.Waf = void 0;
const lodash_1 = require("lodash");
const cdk = require("aws-cdk-lib");
const wafv2 = require("aws-cdk-lib/aws-wafv2");
const constructs_1 = require("constructs");
class Waf extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        let ipset = null;
        const distScope = props.useCloudFront ? "CLOUDFRONT" : "REGIONAL";
        if (!(0, lodash_1.isEmpty)(props.allowedIps)) {
            ipset = new wafv2.CfnIPSet(this, `${id}-ipset`, {
                addresses: props.allowedIps,
                ipAddressVersion: "IPV4",
                scope: distScope,
                description: "Webapp allowed IPV4",
                name: `${id}-webapp-ip-list`,
            });
        }
        // AWS WAF
        this.waf = new WAF(this, `${id}-WAFv2`, ipset, distScope);
        if (!props.useCloudFront && props.webACLResourceArn) {
            // Create an association, not needed for cloudfront
            new WebACLAssociation(this, `${id}-acl-Association`, {
                resourceArn: props.webACLResourceArn,
                webAclArn: this.waf.attrArn,
            });
        }
        // Store the WAF Arn
        new cdk.aws_ssm.StringParameter(this, "WafARN", {
            parameterName: props.wafParamName,
            description: "WAF ARN to be used with Cloudfront",
            stringValue: this.waf.attrArn,
        });
    }
}
exports.Waf = Waf;
// AWS WAF rules
let wafRules = [
    // Rate Filter
    {
        name: "web-rate-filter",
        rule: {
            name: "web-rate-filter",
            priority: 100,
            statement: {
                rateBasedStatement: {
                    limit: 3000,
                    aggregateKeyType: "IP",
                },
            },
            action: {
                block: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "web-rate-filter",
            },
        },
    },
    // AWS IP Reputation list includes known malicious actors/bots and is regularly updated
    {
        name: "AWS-AWSManagedRulesAmazonIpReputationList",
        rule: {
            name: "AWS-AWSManagedRulesAmazonIpReputationList",
            priority: 200,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesAmazonIpReputationList",
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWSManagedRulesAmazonIpReputationList",
            },
        },
    },
    // Common Rule Set aligns with major portions of OWASP Core Rule Set
    {
        name: "AWS-AWSManagedRulesCommonRuleSet",
        rule: {
            name: "AWS-AWSManagedRulesCommonRuleSet",
            priority: 300,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesCommonRuleSet",
                    // Excluding generic RFI body rule for sns notifications
                    // https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-list.html
                    excludedRules: [{ name: "GenericRFI_BODY" }],
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesCommonRuleSet",
            },
        },
    },
    {
        name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
        rule: {
            name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
            priority: 400,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesKnownBadInputsRuleSet",
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
            },
        },
    },
    {
        name: "AWS-AWSManagedRulesSQLiRuleSet",
        rule: {
            name: "AWS-AWSManagedRulesSQLiRuleSet",
            priority: 500,
            statement: {
                managedRuleGroupStatement: {
                    vendorName: "AWS",
                    name: "AWSManagedRulesSQLiRuleSet",
                },
            },
            overrideAction: {
                none: {},
            },
            visibilityConfig: {
                sampledRequestsEnabled: true,
                cloudWatchMetricsEnabled: true,
                metricName: "AWS-AWSManagedRulesSQLiRuleSet",
            },
        },
    },
];
class WAF extends wafv2.CfnWebACL {
    constructor(scope, id, ipset, distScope, extraRules) {
        if (extraRules && !(0, lodash_1.isEmpty)(extraRules)) {
            wafRules = (0, lodash_1.uniqBy)((0, lodash_1.concat)(wafRules, extraRules), "name");
        }
        if (ipset) {
            wafRules.push({
                name: "custom-web-ipfilter",
                rule: {
                    name: "custom-web-ipfilter",
                    priority: 600,
                    statement: {
                        notStatement: {
                            statement: {
                                ipSetReferenceStatement: {
                                    arn: ipset.attrArn,
                                },
                            },
                        },
                    },
                    action: {
                        block: {
                            customResponse: {
                                responseCode: 403,
                                customResponseBodyKey: "response",
                            },
                        },
                    },
                    visibilityConfig: {
                        sampledRequestsEnabled: true,
                        cloudWatchMetricsEnabled: true,
                        metricName: "custom-web-ipfilter",
                    },
                },
            });
        }
        super(scope, id, {
            defaultAction: { allow: {} },
            visibilityConfig: {
                cloudWatchMetricsEnabled: true,
                metricName: `${id}-metric`,
                sampledRequestsEnabled: false,
            },
            customResponseBodies: {
                response: {
                    contentType: "TEXT_HTML",
                    content: "<div> Access denied </div>",
                },
            },
            scope: distScope,
            name: `${id}-waf`,
            rules: wafRules.map((wafRule) => wafRule.rule),
        });
    }
}
exports.WAF = WAF;
class WebACLAssociation extends wafv2.CfnWebACLAssociation {
    constructor(scope, id, props) {
        super(scope, id, {
            resourceArn: props.resourceArn,
            webAclArn: props.webAclArn,
        });
    }
}
exports.WebACLAssociation = WebACLAssociation;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2FmLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsid2FmLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFpRDtBQUVqRCxtQ0FBbUM7QUFDbkMsK0NBQStDO0FBRS9DLDJDQUF1QztBQU92QyxNQUFhLEdBQUksU0FBUSxzQkFBUztJQUVoQyxZQUNFLEtBQWdCLEVBQ2hCLEVBQVUsRUFDVixLQUtDO1FBRUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixJQUFJLEtBQUssR0FBRyxJQUFJLENBQUM7UUFDakIsTUFBTSxTQUFTLEdBQUcsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUM7UUFFbEUsSUFBSSxDQUFDLElBQUEsZ0JBQU8sRUFBQyxLQUFLLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMvQixLQUFLLEdBQUcsSUFBSSxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFO2dCQUM5QyxTQUFTLEVBQUUsS0FBSyxDQUFDLFVBQVU7Z0JBQzNCLGdCQUFnQixFQUFFLE1BQU07Z0JBQ3hCLEtBQUssRUFBRSxTQUFTO2dCQUNoQixXQUFXLEVBQUUscUJBQXFCO2dCQUNsQyxJQUFJLEVBQUUsR0FBRyxFQUFFLGlCQUFpQjthQUM3QixDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsVUFBVTtRQUNWLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRTFELElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQ3BELG1EQUFtRDtZQUNuRCxJQUFJLGlCQUFpQixDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQ25ELFdB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RjtxQkFDRjtvQkFDRCxnQkFBZ0IsRUFBRTt3QkFDaEIsc0JBQXNCLEVBQUUsSUFBSTt3QkFDNUIsd0JBQXdCLEVBQUUsSUFBSTt3QkFDOUIsVUFBVSxFQUFFLHFCQUFxQjtxQkFDbEM7aUJBQ0Y7YUFDRixDQUFDLENBQUM7UUFDTCxDQUFDO1FBQ0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDZixhQUFhLEVBQUUsRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQzVCLGdCQUFnQixFQUFFO2dCQUNoQix3QkFBd0IsRUFBRSxJQUFJO2dCQUM5QixVQUFVLEVBQUUsR0FBRyxFQUFFLFNBQVM7Z0JBQzFCLHNCQUFzQixFQUFFLEtBQUs7YUFDOUI7WUFDRCxvQkFBb0IsRUFBRTtnQkFDcEIsUUFBUSxFQUFFO29CQUNSLFdBQVcsRUFBRSxXQUFXO29CQUN4QixPQUFPLEVBQUUsNEJBQTRCO2lCQUN0QzthQUNGO1lBQ0QsS0FBSyxFQUFFLFNBQVM7WUFDaEIsSUFBSSxFQUFFLEdBQUcsRUFBRSxNQUFNO1lBQ2pCLEtBQUssRUFBRSxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDO1NBQy9DLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTVERCxrQkE0REM7QUFFRCxNQUFhLGlCQUFrQixTQUFRLEtBQUssQ0FBQyxvQkFBb0I7SUFDL0QsWUFDRSxLQUFnQixFQUNoQixFQUFVLEVBQ1YsS0FBc0M7UUFFdEMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDZixXQUFXLEVBQUUsS0FBSyxDQUFDLFdBQVc7WUFDOUIsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO1NBQzNCLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQVhELDhDQVdDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY29uY2F0LCBpc0VtcHR5LCB1bmlxQnkgfSBmcm9tIFwibG9kYXNoXCI7XG5cbmltcG9ydCAqIGFzIGNkayBmcm9tIFwiYXdzLWNkay1saWJcIjtcbmltcG9ydCAqIGFzIHdhZnYyIGZyb20gXCJhd3MtY2RrLWxpYi9hd3Mtd2FmdjJcIjtcblxuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBXYWZSdWxlIHtcbiAgbmFtZTogc3RyaW5nO1xuICBydWxlOiB3YWZ2Mi5DZm5XZWJBQ0wuUnVsZVByb3BlcnR5O1xufVxuXG5leHBvcnQgY2xhc3MgV2FmIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHdhZjogd2FmdjIuQ2ZuV2ViQUNMO1xuICBjb25zdHJ1Y3RvcihcbiAgICBzY29wZTogQ29uc3RydWN0LFxuICAgIGlkOiBzdHJpbmcsXG4gICAgcHJvcHM6IHtcbiAgICAgIHVzZUNsb3VkRnJvbnQ/OiBib29sZWFuO1xuICAgICAgd2FmUGFyYW1OYW1lOiBzdHJpbmc7XG4gICAgICB3ZWJBQ0xSZXNvdXJjZUFybj86IHN0cmluZztcbiAgICAgIGFsbG93ZWRJcHM6IEFycmF5PHN0cmluZz47XG4gICAgfVxuICApIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgbGV0IGlwc2V0ID0gbnVsbDtcbiAgICBjb25zdCBkaXN0U2NvcGUgPSBwcm9wcy51c2VDbG91ZEZyb250ID8gXCJDTE9VREZST05UXCIgOiBcIlJFR0lPTkFMXCI7XG5cbiAgICBpZiAoIWlzRW1wdHkocHJvcHMuYWxsb3dlZElwcykpIHtcbiAgICAgIGlwc2V0ID0gbmV3IHdhZnYyLkNmbklQU2V0KHRoaXMsIGAke2lkfS1pcHNldGAsIHtcbiAgICAgICAgYWRkcmVzc2VzOiBwcm9wcy5hbGxvd2VkSXBzLFxuICAgICAgICBpcEFkZHJlc3NWZXJzaW9uOiBcIklQVjRcIixcbiAgICAgICAgc2NvcGU6IGRpc3RTY29wZSxcbiAgICAgICAgZGVzY3JpcHRpb246IFwiV2ViYXBwIGFsbG93ZWQgSVBWNFwiLFxuICAgICAgICBuYW1lOiBgJHtpZH0td2ViYXBwLWlwLWxpc3RgLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQVdTIFdBRlxuICAgIHRoaXMud2FmID0gbmV3IFdBRih0aGlzLCBgJHtpZH0tV0FGdjJgLCBpcHNldCwgZGlzdFNjb3BlKTtcblxuICAgIGlmICghcHJvcHMudXNlQ2xvdWRGcm9udCAmJiBwcm9wcy53ZWJBQ0xSZXNvdXJjZUFybikge1xuICAgICAgLy8gQ3JlYXRlIGFuIGFzc29jaWF0aW9uLCBub3QgbmVlZGVkIGZvciBjbG91ZGZyb250XG4gICAgICBuZXcgV2ViQUNMQXNzb2NpYXRpb24odGhpcywgYCR7aWR9LWFjbC1Bc3NvY2lhdGlvbmAsIHtcbiAgICAgICAgcmVzb3VyY2VBcm46IHByb3BzLndlYkFDTFJlc291cmNlQXJuLFxuICAgICAgICB3ZWJBY2xBcm46IHRoaXMud2FmLmF0dHJBcm4sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBTdG9yZSB0aGUgV0FGIEFyblxuICAgIG5ldyBjZGsuYXdzX3NzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgXCJXYWZBUk5cIiwge1xuICAgICAgcGFyYW1ldGVyTmFtZTogcHJvcHMud2FmUGFyYW1OYW1lLFxuICAgICAgZGVzY3JpcHRpb246IFwiV0FGIEFSTiB0byBiZSB1c2VkIHdpdGggQ2xvdWRmcm9udFwiLFxuICAgICAgc3RyaW5nVmFsdWU6IHRoaXMud2FmLmF0dHJBcm4sXG4gICAgfSk7XG4gIH1cbn1cblxuLy8gQVdTIFdBRiBydWxlc1xubGV0IHdhZlJ1bGVzOiBXYWZSdWxlW10gPSBbXG4gIC8vIFJhdGUgRmlsdGVyXG4gIHtcbiAgICBuYW1lOiBcIndlYi1yYXRlLWZpbHRlclwiLFxuICAgIHJ1bGU6IHtcbiAgICAgIG5hbWU6IFwid2ViLXJhdGUtZmlsdGVyXCIsXG4gICAgICBwcmlvcml0eTogMTAwLFxuICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgIHJhdGVCYXNlZFN0YXRlbWVudDoge1xuICAgICAgICAgIGxpbWl0OiAzMDAwLFxuICAgICAgICAgIGFnZ3JlZ2F0ZUtleVR5cGU6IFwiSVBcIixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBhY3Rpb246IHtcbiAgICAgICAgYmxvY2s6IHt9LFxuICAgICAgfSxcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIndlYi1yYXRlLWZpbHRlclwiLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICAvLyBBV1MgSVAgUmVwdXRhdGlvbiBsaXN0IGluY2x1ZGVzIGtub3duIG1hbGljaW91cyBhY3RvcnMvYm90cyBhbmQgaXMgcmVndWxhcmx5IHVwZGF0ZWRcbiAge1xuICAgIG5hbWU6IFwiQVdTLUFXU01hbmFnZWRSdWxlc0FtYXpvbklwUmVwdXRhdGlvbkxpc3RcIixcbiAgICBydWxlOiB7XG4gICAgICBuYW1lOiBcIkFXUy1BV1NNYW5hZ2VkUnVsZXNBbWF6b25JcFJlcHV0YXRpb25MaXN0XCIsXG4gICAgICBwcmlvcml0eTogMjAwLFxuICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICB2ZW5kb3JOYW1lOiBcIkFXU1wiLFxuICAgICAgICAgIG5hbWU6IFwiQVdTTWFuYWdlZFJ1bGVzQW1hem9uSXBSZXB1dGF0aW9uTGlzdFwiLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIG92ZXJyaWRlQWN0aW9uOiB7XG4gICAgICAgIG5vbmU6IHt9LFxuICAgICAgfSxcbiAgICAgIHZpc2liaWxpdHlDb25maWc6IHtcbiAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgY2xvdWRXYXRjaE1ldHJpY3NFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNOYW1lOiBcIkFXU01hbmFnZWRSdWxlc0FtYXpvbklwUmVwdXRhdGlvbkxpc3RcIixcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgLy8gQ29tbW9uIFJ1bGUgU2V0IGFsaWducyB3aXRoIG1ham9yIHBvcnRpb25zIG9mIE9XQVNQIENvcmUgUnVsZSBTZXRcbiAge1xuICAgIG5hbWU6IFwiQVdTLUFXU01hbmFnZWRSdWxlc0NvbW1vblJ1bGVTZXRcIixcbiAgICBydWxlOiB7XG4gICAgICBuYW1lOiBcIkFXUy1BV1NNYW5hZ2VkUnVsZXNDb21tb25SdWxlU2V0XCIsXG4gICAgICBwcmlvcml0eTogMzAwLFxuICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICB2ZW5kb3JOYW1lOiBcIkFXU1wiLFxuICAgICAgICAgIG5hbWU6IFwiQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldFwiLFxuICAgICAgICAgIC8vIEV4Y2x1ZGluZyBnZW5lcmljIFJGSSBib2R5IHJ1bGUgZm9yIHNucyBub3RpZmljYXRpb25zXG4gICAgICAgICAgLy8gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL3dhZi9sYXRlc3QvZGV2ZWxvcGVyZ3VpZGUvYXdzLW1hbmFnZWQtcnVsZS1ncm91cHMtbGlzdC5odG1sXG4gICAgICAgICAgZXhjbHVkZWRSdWxlczogW3sgbmFtZTogXCJHZW5lcmljUkZJX0JPRFlcIiB9XSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBvdmVycmlkZUFjdGlvbjoge1xuICAgICAgICBub25lOiB7fSxcbiAgICAgIH0sXG4gICAgICB2aXNpYmlsaXR5Q29uZmlnOiB7XG4gICAgICAgIHNhbXBsZWRSZXF1ZXN0c0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbWV0cmljTmFtZTogXCJBV1MtQVdTTWFuYWdlZFJ1bGVzQ29tbW9uUnVsZVNldFwiLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICB7XG4gICAgbmFtZTogXCJBV1MtQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0XCIsXG4gICAgcnVsZToge1xuICAgICAgbmFtZTogXCJBV1MtQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0XCIsXG4gICAgICBwcmlvcml0eTogNDAwLFxuICAgICAgc3RhdGVtZW50OiB7XG4gICAgICAgIG1hbmFnZWRSdWxlR3JvdXBTdGF0ZW1lbnQ6IHtcbiAgICAgICAgICB2ZW5kb3JOYW1lOiBcIkFXU1wiLFxuICAgICAgICAgIG5hbWU6IFwiQVdTTWFuYWdlZFJ1bGVzS25vd25CYWRJbnB1dHNSdWxlU2V0XCIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgb3ZlcnJpZGVBY3Rpb246IHtcbiAgICAgICAgbm9uZToge30sXG4gICAgICB9LFxuICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1ldHJpY05hbWU6IFwiQVdTLUFXU01hbmFnZWRSdWxlc0tub3duQmFkSW5wdXRzUnVsZVNldFwiLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICB7XG4gICAgbmFtZTogXCJBV1MtQVdTTWFuYWdlZFJ1bGVzU1FMaVJ1bGVTZXRcIixcbiAgICBydWxlOiB7XG4gICAgICBuYW1lOiBcIkFXUy1BV1NNYW5hZ2VkUnVsZXNTUUxpUnVsZVNldFwiLFxuICAgICAgcHJpb3JpdHk6IDUwMCxcbiAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICBtYW5hZ2VkUnVsZUdyb3VwU3RhdGVtZW50OiB7XG4gICAgICAgICAgdmVuZG9yTmFtZTogXCJBV1NcIixcbiAgICAgICAgICBuYW1lOiBcIkFXU01hbmFnZWRSdWxlc1NRTGlSdWxlU2V0XCIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgb3ZlcnJpZGVBY3Rpb246IHtcbiAgICAgICAgbm9uZToge30sXG4gICAgICB9LFxuICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiB0cnVlLFxuICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1ldHJpY05hbWU6IFwiQVdTLUFXU01hbmFnZWRSdWxlc1NRTGlSdWxlU2V0XCIsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG5dO1xuXG5leHBvcnQgY2xhc3MgV0FGIGV4dGVuZHMgd2FmdjIuQ2ZuV2ViQUNMIHtcbiAgY29uc3RydWN0b3IoXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICBpZDogc3RyaW5nLFxuICAgIGlwc2V0OiBjZGsuYXdzX3dhZnYyLkNmbklQU2V0IHwgbnVsbCxcbiAgICBkaXN0U2NvcGU6IHN0cmluZyxcbiAgICBleHRyYVJ1bGVzPzogQXJyYXk8V2FmUnVsZT5cbiAgKSB7XG4gICAgaWYgKGV4dHJhUnVsZXMgJiYgIWlzRW1wdHkoZXh0cmFSdWxlcykpIHtcbiAgICAgIHdhZlJ1bGVzID0gdW5pcUJ5KGNvbmNhdCh3YWZSdWxlcywgZXh0cmFSdWxlcyksIFwibmFtZVwiKTtcbiAgICB9XG4gICAgaWYgKGlwc2V0KSB7XG4gICAgICB3YWZSdWxlcy5wdXNoKHtcbiAgICAgICAgbmFtZTogXCJjdXN0b20td2ViLWlwZmlsdGVyXCIsXG4gICAgICAgIHJ1bGU6IHtcbiAgICAgICAgICBuYW1lOiBcImN1c3RvbS13ZWItaXBmaWx0ZXJcIixcbiAgICAgICAgICBwcmlvcml0eTogNjAwLFxuICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgbm90U3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgIHN0YXRlbWVudDoge1xuICAgICAgICAgICAgICAgIGlwU2V0UmVmZXJlbmNlU3RhdGVtZW50OiB7XG4gICAgICAgICAgICAgICAgICBhcm46IGlwc2V0LmF0dHJBcm4sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBhY3Rpb246IHtcbiAgICAgICAgICAgIGJsb2NrOiB7XG4gICAgICAgICAgICAgIGN1c3RvbVJlc3BvbnNlOiB7XG4gICAgICAgICAgICAgICAgcmVzcG9uc2VDb2RlOiA0MDMsXG4gICAgICAgICAgICAgICAgY3VzdG9tUmVzcG9uc2VCb2R5S2V5OiBcInJlc3BvbnNlXCIsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICAgICAgc2FtcGxlZFJlcXVlc3RzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIGNsb3VkV2F0Y2hNZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6IFwiY3VzdG9tLXdlYi1pcGZpbHRlclwiLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9XG4gICAgc3VwZXIoc2NvcGUsIGlkLCB7XG4gICAgICBkZWZhdWx0QWN0aW9uOiB7IGFsbG93OiB7fSB9LFxuICAgICAgdmlzaWJpbGl0eUNvbmZpZzoge1xuICAgICAgICBjbG91ZFdhdGNoTWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1ldHJpY05hbWU6IGAke2lkfS1tZXRyaWNgLFxuICAgICAgICBzYW1wbGVkUmVxdWVzdHNFbmFibGVkOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBjdXN0b21SZXNwb25zZUJvZGllczoge1xuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIGNvbnRlbnRUeXBlOiBcIlRFWFRfSFRNTFwiLFxuICAgICAgICAgIGNvbnRlbnQ6IFwiPGRpdj4gQWNjZXNzIGRlbmllZCA8L2Rpdj5cIixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBzY29wZTogZGlzdFNjb3BlLFxuICAgICAgbmFtZTogYCR7aWR9LXdhZmAsXG4gICAgICBydWxlczogd2FmUnVsZXMubWFwKCh3YWZSdWxlKSA9PiB3YWZSdWxlLnJ1bGUpLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJBQ0xBc3NvY2lhdGlvbiBleHRlbmRzIHdhZnYyLkNmbldlYkFDTEFzc29jaWF0aW9uIHtcbiAgY29uc3RydWN0b3IoXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICBpZDogc3RyaW5nLFxuICAgIHByb3BzOiB3YWZ2Mi5DZm5XZWJBQ0xBc3NvY2lhdGlvblByb3BzXG4gICkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwge1xuICAgICAgcmVzb3VyY2VBcm46IHByb3BzLnJlc291cmNlQXJuLFxuICAgICAgd2ViQWNsQXJuOiBwcm9wcy53ZWJBY2xBcm4sXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==