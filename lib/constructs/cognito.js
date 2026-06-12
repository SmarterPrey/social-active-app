"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cognito = void 0;
const constructs_1 = require("constructs");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const custom_resources_1 = require("aws-cdk-lib/custom-resources");
const aws_cognito_identitypool_1 = require("aws-cdk-lib/aws-cognito-identitypool");
const cdk_nag_1 = require("cdk-nag");
class Cognito extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        if (!props.userName)
            props.userName = props.adminEmail.split("@")[0];
        // Fallback sign-in URL. Callers should override via `appSignInUrl`.
        const signInUrl = props.appSignInUrl ?? "https://app.mucker.io/signin";
        const inviteHtml = renderInviteEmailHtml(signInUrl);
        const inviteSubject = "You're invited to Social Active App";
        // EmailConfiguration: default is Cognito-managed (sandboxy). If caller
        // passed a verified SES identity, switch to DEVELOPER mode so mail goes
        // out through SES with our branded From address.
        const emailConfiguration = props.ses
            ? {
                EmailSendingAccount: "DEVELOPER",
                SourceArn: props.ses.sourceArn,
                From: props.ses.fromName
                    ? `${props.ses.fromName} <${props.ses.fromAddress}>`
                    : props.ses.fromAddress,
                ...(props.ses.replyToEmailAddress
                    ? { ReplyToEmailAddress: props.ses.replyToEmailAddress }
                    : {}),
            }
            : { EmailSendingAccount: "COGNITO_DEFAULT" };
        this.userPool = new aws_cdk_lib_1.aws_cognito.UserPool(this, "userpool", {
            userPoolName: `${id}-app-userpool`,
            signInAliases: {
                username: true,
                email: true,
            },
            accountRecovery: aws_cdk_lib_1.aws_cognito.AccountRecovery.EMAIL_ONLY, // overridden by addOverride below to include admin_only
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            selfSignUpEnabled: true,
            featurePlan: aws_cdk_lib_1.aws_cognito.FeaturePlan.PLUS,
            // advancedSecurityMode is deprecated. Use StandardThreatProtectionMode and CustomThreatProtectionMode instead.
            standardThreatProtectionMode: aws_cdk_lib_1.aws_cognito.StandardThreatProtectionMode.FULL_FUNCTION,
            // customThreatProtectionMode: aws_cognito.CustomThreatProtectionMode.ENABLED, // Uncomment and configure as needed
            autoVerify: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: true,
            },
        });
        // Pin ALL UserPool CloudFormation properties to exactly match the deployed template.
        // Cognito rejects ANY schema field in UpdateUserPool, so we prevent CloudFormation
        // from ever calling UpdateUserPool by ensuring zero-diff between templates, regardless
        // of CDK version changes that might otherwise add new default properties.
        const cfnUserPool = this.userPool.node.defaultChild;
        cfnUserPool.addOverride("Properties", {
            AccountRecoverySetting: {
                RecoveryMechanisms: [
                    { Name: "verified_email", Priority: 1 },
                    // Cognito requires a second recovery mechanism when EMAIL_OTP MFA is
                    // enabled — admin_only cannot be combined with others, so we add
                    // verified_phone_number as Priority 2. Users who haven't set a phone
                    // number simply won't see that recovery option.
                    { Name: "verified_phone_number", Priority: 2 },
                ],
            },
            AdminCreateUserConfig: {
                AllowAdminCreateUserOnly: false,
                InviteMessageTemplate: {
                    EmailSubject: inviteSubject,
                    EmailMessage: inviteHtml,
                },
            },
            AliasAttributes: ["email"],
            AutoVerifiedAttributes: ["email"],
            EmailConfiguration: emailConfiguration,
            // MFA: optional, user can enroll email OTP. SMS_MFA removed — it requires
            // an SmsConfiguration IAM role/external ID which adds operational overhead
            // and EMAIL_OTP covers the same use case.
            MfaConfiguration: "OPTIONAL",
            EnabledMfas: ["EMAIL_OTP"],
            DeviceConfiguration: {
                ChallengeRequiredOnNewDevice: true,
                DeviceOnlyRememberedOnUserPrompt: true,
            },
            EmailVerificationMessage: "The verification code to your new account is {####}",
            EmailVerificationSubject: "Verify your new account",
            Policies: { PasswordPolicy: { MinimumLength: 8, RequireNumbers: true, RequireSymbols: true, RequireUppercase: true } },
            Schema: [
                { AttributeDataType: "String", Mutable: true, Name: "organization" },
                { AttributeDataType: "String", Mutable: true, Name: "theme" },
            ],
            UserPoolAddOns: { AdvancedSecurityMode: "ENFORCED" },
            UserPoolName: "cognito-app-userpool",
            VerificationMessageTemplate: {
                DefaultEmailOption: "CONFIRM_WITH_CODE",
                EmailMessage: "The verification code to your new account is {####}",
                EmailSubject: "Verify your new account",
            },
        });
        // cdk-nag COG8 checks the L1 `userPoolTier` field directly.
        cfnUserPool.userPoolTier = aws_cdk_lib_1.aws_cognito.FeaturePlan.PLUS;
        const userPoolClient = this.userPool.addClient("webappClient", {
            authFlows: {
                userSrp: true,
                adminUserPassword: true,
            },
            preventUserExistenceErrors: true,
            refreshTokenValidity: props.refreshTokenValidity,
            readAttributes: new aws_cdk_lib_1.aws_cognito.ClientAttributes()
                .withStandardAttributes({
                address: true,
                email: true,
                familyName: true,
                gender: true,
                givenName: true,
                locale: true,
                nickname: true,
                phoneNumber: true,
                website: true,
            })
                .withCustomAttributes("organization", "theme"),
            writeAttributes: new aws_cdk_lib_1.aws_cognito.ClientAttributes()
                .withStandardAttributes({
                address: true,
                familyName: true,
                gender: true,
                givenName: true,
                locale: true,
                nickname: true,
                phoneNumber: true,
                website: true,
            })
                .withCustomAttributes("organization", "theme"),
        });
        const identityPool = new aws_cognito_identitypool_1.IdentityPool(this, "identityPool", {
            allowUnauthenticatedIdentities: false,
            authenticationProviders: {
                userPools: [
                    new aws_cognito_identitypool_1.UserPoolAuthenticationProvider({
                        userPool: this.userPool,
                        userPoolClient,
                    }),
                ],
            },
        });
        this.authenticatedRole = identityPool.authenticatedRole;
        new CreatePoolUser(this, "admin-user", {
            email: props.adminEmail,
            username: props.userName,
            userPool: this.userPool,
        });
        this.cognitoParams = {
            userPoolId: this.userPool.userPoolId,
            userPoolClientId: userPoolClient.userPoolClientId,
            identityPoolId: identityPool.identityPoolId,
        };
        new aws_cdk_lib_1.CfnOutput(this, "UserPoolId", {
            value: this.userPool.userPoolId,
        });
        new aws_cdk_lib_1.CfnOutput(this, "UserPoolClientId", {
            value: userPoolClient.userPoolClientId,
        });
        new aws_cdk_lib_1.CfnOutput(this, "IdentityPoolId", {
            value: identityPool.identityPoolId,
        });
        // Suppressions
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.userPool, [
            {
                id: "AwsSolutions-COG2",
                reason: "No need MFA for sample",
            },
        ]);
        // ─── Cognito Groups (roles) ──────────────────────────────────────
        const adminGroup = new aws_cdk_lib_1.aws_cognito.CfnUserPoolGroup(this, "AdminGroup", {
            userPoolId: this.userPool.userPoolId,
            groupName: "Admin",
            description: "Full access — can mutate data, manage users, and view monitoring",
            precedence: 0,
        });
        // Membership Admin — can invite new members and manage the members
        // directory but does not get system-administration privileges.
        new aws_cdk_lib_1.aws_cognito.CfnUserPoolGroup(this, "MembershipAdminGroup", {
            userPoolId: this.userPool.userPoolId,
            groupName: "MembershipAdmin",
            description: "Can invite and manage members (no system-admin privileges)",
            precedence: 5,
        });
        new aws_cdk_lib_1.aws_cognito.CfnUserPoolGroup(this, "EditorGroup", {
            userPoolId: this.userPool.userPoolId,
            groupName: "Editor",
            description: "Can add and modify graph data",
            precedence: 10,
        });
        new aws_cdk_lib_1.aws_cognito.CfnUserPoolGroup(this, "ViewerGroup", {
            userPoolId: this.userPool.userPoolId,
            groupName: "Viewer",
            description: "Read-only access to dashboards and graph visualization",
            precedence: 20,
        });
        // Member group — security executives using the networking features.
        // Default group for PostConfirmation-assigned users.
        new aws_cdk_lib_1.aws_cognito.CfnUserPoolGroup(this, "MemberGroup", {
            userPoolId: this.userPool.userPoolId,
            groupName: "Member",
            description: "Social Active App member — feed, events, vendors, members directory",
            precedence: 30,
        });
        // Add the initial admin user to the Admin group
        const adminGroupMembership = new custom_resources_1.AwsCustomResource(this, "AdminGroupMembership", {
            onCreate: {
                service: "CognitoIdentityServiceProvider",
                action: "adminAddUserToGroup",
                parameters: {
                    UserPoolId: this.userPool.userPoolId,
                    Username: props.userName,
                    GroupName: "Admin",
                },
                physicalResourceId: custom_resources_1.PhysicalResourceId.of(`AdminGroupMembership-${props.userName}`),
            },
            onDelete: {
                service: "CognitoIdentityServiceProvider",
                action: "adminRemoveUserFromGroup",
                parameters: {
                    UserPoolId: this.userPool.userPoolId,
                    Username: props.userName,
                    GroupName: "Admin",
                },
            },
            policy: custom_resources_1.AwsCustomResourcePolicy.fromStatements([
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: [
                        "cognito-idp:AdminAddUserToGroup",
                        "cognito-idp:AdminRemoveUserFromGroup",
                    ],
                    resources: [this.userPool.userPoolArn],
                }),
            ]),
        });
        adminGroupMembership.node.addDependency(adminGroup);
    }
}
exports.Cognito = Cognito;
class CreatePoolUser extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        const statement = new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ["cognito-idp:AdminDeleteUser", "cognito-idp:AdminCreateUser"],
            resources: [props.userPool.userPoolArn],
        });
        new custom_resources_1.AwsCustomResource(this, `CreateUser-${id}`, {
            onCreate: {
                service: "CognitoIdentityServiceProvider",
                action: "adminCreateUser",
                parameters: {
                    UserPoolId: props.userPool.userPoolId,
                    Username: props.username,
                    UserAttributes: [
                        {
                            Name: "email",
                            Value: props.email,
                        },
                        {
                            Name: "email_verified",
                            Value: "true",
                        },
                    ],
                },
                physicalResourceId: custom_resources_1.PhysicalResourceId.of(`CreateUser-${id}-${props.username}`),
            },
            onDelete: {
                service: "CognitoIdentityServiceProvider",
                action: "adminDeleteUser",
                parameters: {
                    UserPoolId: props.userPool.userPoolId,
                    Username: props.username,
                },
            },
            policy: custom_resources_1.AwsCustomResourcePolicy.fromStatements([statement]),
        });
    }
}
/**
 * Render the HTML body of the Cognito admin-created-user invitation email.
 * `{username}` and `{####}` are Cognito-provided placeholders that are
 * substituted by the service before the message is sent.
 */
function renderInviteEmailHtml(signInUrl) {
    return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f4f2ee;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 24px;border-bottom:1px solid #f3f4f6;">
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7280;">Social Active App</div>
                <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#111827;line-height:1.3;">Welcome to Social Active App</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;font-size:15px;line-height:1.6;color:#1f2937;">
                <p style="margin:0 0 16px;">You've been invited to join Social Active App &mdash; a curated community of outdoor adventurers.</p>
                <p style="margin:0 0 16px;">Use the credentials below to sign in. You'll be prompted to choose your own password on first login.</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin:4px 0 24px;">
                  <tr>
                    <td style="padding:16px 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;color:#111827;">
                      <div style="color:#6b7280;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Username</div>
                      <div style="margin-top:4px;">{username}</div>
                      <div style="margin-top:14px;color:#6b7280;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">Temporary password</div>
                      <div style="margin-top:4px;">{####}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 24px;text-align:center;">
                  <a href="${signInUrl}" style="display:inline-block;background:#0a66c2;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Sign in and set your password</a>
                </p>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">Having trouble with the button? Open this link in your browser:</p>
                <p style="margin:0 0 24px;font-size:13px;word-break:break-all;"><a href="${signInUrl}" style="color:#0a66c2;text-decoration:none;">${signInUrl}</a></p>
                <p style="margin:0;font-size:13px;color:#6b7280;">This invitation is personal &mdash; please don't forward it. If you weren't expecting it, you can safely ignore this message.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;">
                Social Active App
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvZ25pdG8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXVDO0FBQ3ZDLDZDQU1xQjtBQUVyQixtRUFJc0M7QUFFdEMsbUZBRzhDO0FBQzlDLHFDQUEwQztBQWtDMUMsTUFBYSxPQUFRLFNBQVEsc0JBQVM7SUFJcEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFtQjtRQUMzRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUFFLEtBQUssQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFckUsb0VBQW9FO1FBQ3BFLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksOEJBQThCLENBQUM7UUFDdkUsTUFBTSxVQUFVLEdBQUcscUJBQXFCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDcEQsTUFBTSxhQUFhLEdBQUcscUNBQXFDLENBQUM7UUFFNUQsdUVBQXVFO1FBQ3ZFLHdFQUF3RTtRQUN4RSxpREFBaUQ7UUFDakQsTUFBTSxrQkFBa0IsR0FBNEIsS0FBSyxDQUFDLEdBQUc7WUFDM0QsQ0FBQyxDQUFDO2dCQUNFLG1CQUFtQixFQUFFLFdBQVc7Z0JBQ2hDLFNBQVMsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFNBQVM7Z0JBQzlCLElBQUksRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVE7b0JBQ3RCLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxLQUFLLEtBQUssQ0FBQyxHQUFHLENBQUMsV0FBVyxHQUFHO29CQUNwRCxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxXQUFXO2dCQUN6QixHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxtQkFB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LEVBQUUsaUJBQWlCO2dCQUN6QixVQUFVLEVBQUU7b0JBQ1YsVUFBVSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsVUFBVTtvQkFDckMsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRO2lCQUN6QjthQUNGO1lBQ0QsTUFBTSxFQUFFLDBDQUF1QixDQUFDLGNBQWMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1NBQzVELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHFCQUFxQixDQUFDLFNBQWlCO0lBQzlDLE9BQU87Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7NkJBNEJvQixTQUFTOzs7MkZBR3FELFNBQVMsaURBQWlELFNBQVM7Ozs7Ozs7Ozs7Ozs7O1FBY3RKLENBQUM7QUFDVCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSBcImNvbnN0cnVjdHNcIjtcbmltcG9ydCB7XG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxuICBhd3NfY29nbml0byxcbiAgYXdzX2lhbSxcbiAgQ2ZuT3V0cHV0LFxufSBmcm9tIFwiYXdzLWNkay1saWJcIjtcblxuaW1wb3J0IHtcbiAgQXdzQ3VzdG9tUmVzb3VyY2UsXG4gIEF3c0N1c3RvbVJlc291cmNlUG9saWN5LFxuICBQaHlzaWNhbFJlc291cmNlSWQsXG59IGZyb20gXCJhd3MtY2RrLWxpYi9jdXN0b20tcmVzb3VyY2VzXCI7XG5cbmltcG9ydCB7XG4gIElkZW50aXR5UG9vbCxcbiAgVXNlclBvb2xBdXRoZW50aWNhdGlvblByb3ZpZGVyLFxufSBmcm9tIFwiYXdzLWNkay1saWIvYXdzLWNvZ25pdG8taWRlbnRpdHlwb29sXCI7XG5pbXBvcnQgeyBOYWdTdXBwcmVzc2lvbnMgfSBmcm9tIFwiY2RrLW5hZ1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIENvZ25pdG9Qcm9wcyB7XG4gIGFkbWluRW1haWw6IHN0cmluZztcbiAgdXNlck5hbWU/OiBzdHJpbmc7XG4gIHJlZnJlc2hUb2tlblZhbGlkaXR5PzogRHVyYXRpb247XG4gIC8qKlxuICAgKiBBYnNvbHV0ZSBVUkwgb2YgdGhlIHdlYiBhcHAncyBzaWduLWluIHBhZ2UuXG4gICAqIFVzZWQgaW4gdGhlIGludml0YXRpb24gZW1haWwgbGluayAoZS5nLiBodHRwczovL2FwcC5tdWNrZXIuaW8vc2lnbmluKS5cbiAgICovXG4gIGFwcFNpZ25JblVybD86IHN0cmluZztcbiAgLyoqXG4gICAqIFdoZW4gc2V0LCBDb2duaXRvIHNlbmRzIGVtYWlsIHZpYSBTRVMgdXNpbmcgdGhpcyB2ZXJpZmllZCBpZGVudGl0eVxuICAgKiAoREVWRUxPUEVSIG1vZGUpLiBXaXRob3V0IHRoaXMsIENvZ25pdG8gZmFsbHMgYmFjayB0byB0aGUgZGVmYXVsdFxuICAgKiBBV1MtbWFuYWdlZCBzZW5kZXIgd2hpY2ggaXMgc2FuZGJveC1saW1pdGVkLlxuICAgKi9cbiAgc2VzPzoge1xuICAgIC8qKiBBUk4gb2YgYSB2ZXJpZmllZCBTRVMgaWRlbnRpdHkgKGRvbWFpbiBvciBlbWFpbCkuICovXG4gICAgc291cmNlQXJuOiBzdHJpbmc7XG4gICAgLyoqIEZyb20gYWRkcmVzcyBDb2duaXRvIGVtYWlscyBhcmUgc2VudCBmcm9tIChtdXN0IG1hdGNoIHRoZSBpZGVudGl0eSkuICovXG4gICAgZnJvbUFkZHJlc3M6IHN0cmluZztcbiAgICAvKiogT3B0aW9uYWwgZGlzcGxheSBuYW1lIChcIlNvY2lhbCBBY3RpdmUgQXBwXCIpIHRvIHNob3cgbmV4dCB0byB0aGUgYWRkcmVzcy4gKi9cbiAgICBmcm9tTmFtZT86IHN0cmluZztcbiAgICAvKiogT3B0aW9uYWwgcmVwbHktdG8gYWRkcmVzcyBzdXJmYWNlZCBpbiB0aGUgZW1haWwgaGVhZGVycy4gKi9cbiAgICByZXBseVRvRW1haWxBZGRyZXNzPzogc3RyaW5nO1xuICB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIENvZ25pdG9QYXJhbXMge1xuICB1c2VyUG9vbElkOiBzdHJpbmc7XG4gIHVzZXJQb29sQ2xpZW50SWQ6IHN0cmluZztcbiAgaWRlbnRpdHlQb29sSWQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIENvZ25pdG8gZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgY29nbml0b1BhcmFtczogQ29nbml0b1BhcmFtcztcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJQb29sOiBhd3NfY29nbml0by5Vc2VyUG9vbDtcbiAgcHVibGljIHJlYWRvbmx5IGF1dGhlbnRpY2F0ZWRSb2xlOiBhd3NfaWFtLklSb2xlO1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ29nbml0b1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGlmICghcHJvcHMudXNlck5hbWUpIHByb3BzLnVzZXJOYW1lID0gcHJvcHMuYWRtaW5FbWFpbC5zcGxpdChcIkBcIilbMF07XG5cbiAgICAvLyBGYWxsYmFjayBzaWduLWluIFVSTC4gQ2FsbGVycyBzaG91bGQgb3ZlcnJpZGUgdmlhIGBhcHBTaWduSW5VcmxgLlxuICAgIGNvbnN0IHNpZ25JblVybCA9IHByb3BzLmFwcFNpZ25JblVybCA/PyBcImh0dHBzOi8vYXBwLm11Y2tlci5pby9zaWduaW5cIjtcbiAgICBjb25zdCBpbnZpdGVIdG1sID0gcmVuZGVySW52aXRlRW1haWxIdG1sKHNpZ25JblVybCk7XG4gICAgY29uc3QgaW52aXRlU3ViamVjdCA9IFwiWW91J3JlIGludml0ZWQgdG8gU29jaWFsIEFjdGl2ZSBBcHBcIjtcblxuICAgIC8vIEVtYWlsQ29uZmlndXJhdGlvbjogZGVmYXVsdCBpcyBDb2duaXRvLW1hbmFnZWQgKHNhbmRib3h5KS4gSWYgY2FsbGVyXG4gICAgLy8gcGFzc2VkIGEgdmVyaWZpZWQgU0VTIGlkZW50aXR5LCBzd2l0Y2ggdG8gREVWRUxPUEVSIG1vZGUgc28gbWFpbCBnb2VzXG4gICAgLy8gb3V0IHRocm91Z2ggU0VTIHdpdGggb3VyIGJyYW5kZWQgRnJvbSBhZGRyZXNzLlxuICAgIGNvbnN0IGVtYWlsQ29uZmlndXJhdGlvbjogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gPSBwcm9wcy5zZXNcbiAgICAgID8ge1xuICAgICAgICAgIEVtYWlsU2VuZGluZ0FjY291bnQ6IFwiREVWRUxPUEVSXCIsXG4gICAgICAgICAgU291cmNlQXJuOiBwcm9wcy5zZXMuc291cmNlQXJuLFxuICAgICAgICAgIEZyb206IHByb3BzLnNlcy5mcm9tTmFtZVxuICAgICAgICAgICAgPyBgJHtwcm9wcy5zZXMuZnJvbU5hbWV9IDwke3Byb3BzLnNlcy5mcm9tQWRkcmVzc30+YFxuICAgICAgICAgICAgOiBwcm9wcy5zZXMuZnJvbUFkZHJlc3MsXG4gICAgICAgICAgLi4uKHByb3BzLnNlcy5yZXBseVRvRW1haWxBZGRyZXNzXG4gICAgICAgICAgICA/IHsgUmVwbHlUb0VtYWlsQWRkcmVzczogcHJvcHMuc2VzLnJlcGx5VG9FbWFpbEFkZHJlc3MgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgIH1cbiAgICAgIDogeyBFbWFpbFNlbmRpbmdBY2NvdW50OiBcIkNPR05JVE9fREVGQVVMVFwiIH07XG5cbiAgICB0aGlzLnVzZXJQb29sID0gbmV3IGF3c19jb2duaXRvLlVzZXJQb29sKHRoaXMsIFwidXNlcnBvb2xcIiwge1xuICAgICAgdXNlclBvb2xOYW1lOiBgJHtpZH0tYXBwLXVzZXJwb29sYCxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgdXNlcm5hbWU6IHRydWUsXG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGFjY291bnRSZWNvdmVyeTogYXdzX2NvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksIC8vIG92ZXJyaWRkZW4gYnkgYWRkT3ZlcnJpZGUgYmVsb3cgdG8gaW5jbHVkZSBhZG1pbl9vbmx5XG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIGZlYXR1cmVQbGFuOiBhd3NfY29nbml0by5GZWF0dXJlUGxhbi5QTFVTLFxuICAgICAgLy8gYWR2YW5jZWRTZWN1cml0eU1vZGUgaXMgZGVwcmVjYXRlZC4gVXNlIFN0YW5kYXJkVGhyZWF0UHJvdGVjdGlvbk1vZGUgYW5kIEN1c3RvbVRocmVhdFByb3RlY3Rpb25Nb2RlIGluc3RlYWQuXG4gICAgICBzdGFuZGFyZFRocmVhdFByb3RlY3Rpb25Nb2RlOiBhd3NfY29nbml0by5TdGFuZGFyZFRocmVhdFByb3RlY3Rpb25Nb2RlLkZVTExfRlVOQ1RJT04sXG4gICAgICAvLyBjdXN0b21UaHJlYXRQcm90ZWN0aW9uTW9kZTogYXdzX2NvZ25pdG8uQ3VzdG9tVGhyZWF0UHJvdGVjdGlvbk1vZGUuRU5BQkxFRCwgLy8gVW5jb21tZW50IGFuZCBjb25maWd1cmUgYXMgbmVlZGVkXG4gICAgICBhdXRvVmVyaWZ5OiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHBhc3N3b3JkUG9saWN5OiB7XG4gICAgICAgIG1pbkxlbmd0aDogOCxcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZURpZ2l0czogdHJ1ZSxcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IHRydWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gUGluIEFMTCBVc2VyUG9vbCBDbG91ZEZvcm1hdGlvbiBwcm9wZXJ0aWVzIHRvIGV4YWN0bHkgbWF0Y2ggdGhlIGRlcGxveWVkIHRlbXBsYXRlLlxuICAgIC8vIENvZ25pdG8gcmVqZWN0cyBBTlkgc2NoZW1hIGZpZWxkIGluIFVwZGF0ZVVzZXJQb29sLCBzbyB3ZSBwcmV2ZW50IENsb3VkRm9ybWF0aW9uXG4gICAgLy8gZnJvbSBldmVyIGNhbGxpbmcgVXBkYXRlVXNlclBvb2wgYnkgZW5zdXJpbmcgemVyby1kaWZmIGJldHdlZW4gdGVtcGxhdGVzLCByZWdhcmRsZXNzXG4gICAgLy8gb2YgQ0RLIHZlcnNpb24gY2hhbmdlcyB0aGF0IG1pZ2h0IG90aGVyd2lzZSBhZGQgbmV3IGRlZmF1bHQgcHJvcGVydGllcy5cbiAgICBjb25zdCBjZm5Vc2VyUG9vbCA9IHRoaXMudXNlclBvb2wubm9kZS5kZWZhdWx0Q2hpbGQgYXMgYXdzX2NvZ25pdG8uQ2ZuVXNlclBvb2w7XG5cbiAgICBjZm5Vc2VyUG9vbC5hZGRPdmVycmlkZShcIlByb3BlcnRpZXNcIiwge1xuICAgICAgQWNjb3VudFJlY292ZXJ5U2V0dGluZzoge1xuICAgICAgICBSZWNvdmVyeU1lY2hhbmlzbXM6IFtcbiAgICAgICAgICB7IE5hbWU6IFwidmVyaWZpZWRfZW1haWxcIiwgUHJpb3JpdHk6IDEgfSxcbiAgICAgICAgICAvLyBDb2duaXRvIHJlcXVpcmVzIGEgc2Vjb25kIHJlY292ZXJ5IG1lY2hhbmlzbSB3aGVuIEVNQUlMX09UUCBNRkEgaXNcbiAgICAgICAgICAvLyBlbmFibGVkIOKAlCBhZG1pbl9vbmx5IGNhbm5vdCBiZSBjb21iaW5lZCB3aXRoIG90aGVycywgc28gd2UgYWRkXG4gICAgICAgICAgLy8gdmVyaWZpZWRfcGhvbmVfbnVtYmVyIGFzIFByaW9yaXR5IDIuIFVzZXJzIHdobyBoYXZlbid0IHNldCBhIHBob25lXG4gICAgICAgICAgLy8gbnVtYmVyIHNpbXBseSB3b24ndCBzZWUgdGhhdCByZWNvdmVyeSBvcHRpb24uXG4gICAgICAgICAgeyBOYW1lOiBcInZlcmlmaWVkX3Bob25lX251bWJlclwiLCBQcmlvcml0eTogMiB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIEFkbWluQ3JlYXRlVXNlckNvbmZpZzoge1xuICAgICAgICBBbGxvd0FkbWluQ3JlYXRlVXNlck9ubHk6IGZhbHNlLFxuICAgICAgICBJbnZpdGVNZXNzYWdlVGVtcGxhdGU6IHtcbiAgICAgICAgICBFbWFpbFN1YmplY3Q6IGludml0ZVN1YmplY3QsXG4gICAgICAgICAgRW1haWxNZXNzYWdlOiBpbnZpdGVIdG1sLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIEFsaWFzQXR0cmlidXRlczogW1wiZW1haWxcIl0sXG4gICAgICBBdXRvVmVyaWZpZWRBdHRyaWJ1dGVzOiBbXCJlbWFpbFwiXSxcbiAgICAgIEVtYWlsQ29uZmlndXJhdGlvbjogZW1haWxDb25maWd1cmF0aW9uLFxuICAgICAgLy8gTUZBOiBvcHRpb25hbCwgdXNlciBjYW4gZW5yb2xsIGVtYWlsIE9UUC4gU01TX01GQSByZW1vdmVkIOKAlCBpdCByZXF1aXJlc1xuICAgICAgLy8gYW4gU21zQ29uZmlndXJhdGlvbiBJQU0gcm9sZS9leHRlcm5hbCBJRCB3aGljaCBhZGRzIG9wZXJhdGlvbmFsIG92ZXJoZWFkXG4gICAgICAvLyBhbmQgRU1BSUxfT1RQIGNvdmVycyB0aGUgc2FtZSB1c2UgY2FzZS5cbiAgICAgIE1mYUNvbmZpZ3VyYXRpb246IFwiT1BUSU9OQUxcIixcbiAgICAgIEVuYWJsZWRNZmFzOiBbXCJFTUFJTF9PVFBcIl0sXG4gICAgICBEZXZpY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIENoYWxsZW5nZVJlcXVpcmVkT25OZXdEZXZpY2U6IHRydWUsXG4gICAgICAgIERldmljZU9ubHlSZW1lbWJlcmVkT25Vc2VyUHJvbXB0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIEVtYWlsVmVyaWZpY2F0aW9uTWVzc2FnZTogXCJUaGUgdmVyaWZpY2F0aW9uIGNvZGUgdG8geW91ciBuZXcgYWNjb3VudCBpcyB7IyMjI31cIixcbiAgICAgIEVtYWlsVmVyaWZpY2F0aW9uU3ViamVjdDogXCJWZXJpZnkgeW91ciBuZXcgYWNjb3VudFwiLFxuICAgICAgUG9saWNpZXM6IHsgUGFzc3dvcmRQb2xpY3k6IHsgTWluaW11bUxlbmd0aDogOCwgUmVxdWlyZU51bWJlcnM6IHRydWUsIFJlcXVpcmVTeW1ib2xzOiB0cnVlLCBSZXF1aXJlVXBwZXJjYXNlOiB0cnVlIH0gfSxcbiAgICAgIFNjaGVtYTogW1xuICAgICAgICB7IEF0dHJpYnV0ZURhdGFUeXBlOiBcIlN0cmluZ1wiLCBNdXRhYmxlOiB0cnVlLCBOYW1lOiBcIm9yZ2FuaXphdGlvblwiIH0sXG4gICAgICAgIHsgQXR0cmlidXRlRGF0YVR5cGU6IFwiU3RyaW5nXCIsIE11dGFibGU6IHRydWUsIE5hbWU6IFwidGhlbWVcIiB9LFxuICAgICAgXSxcbiAgICAgIFVzZXJQb29sQWRkT25zOiB7IEFkdmFuY2VkU2VjdXJpdHlNb2RlOiBcIkVORk9SQ0VEXCIgfSxcbiAgICAgIFVzZXJQb29sTmFtZTogXCJjb2duaXRvLWFwcC11c2VycG9vbFwiLFxuICAgICAgVmVyaWZpY2F0aW9uTWVzc2FnZVRlbXBsYXRlOiB7XG4gICAgICAgIERlZmF1bHRFbWFpbE9wdGlvbjogXCJDT05GSVJNX1dJVEhfQ09ERVwiLFxuICAgICAgICBFbWFpbE1lc3NhZ2U6IFwiVGhlIHZlcmlmaWNhdGlvbiBjb2RlIHRvIHlvdXIgbmV3IGFjY291bnQgaXMgeyMjIyN9XCIsXG4gICAgICAgIEVtYWlsU3ViamVjdDogXCJWZXJpZnkgeW91ciBuZXcgYWNjb3VudFwiLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIGNkay1uYWcgQ09HOCBjaGVja3MgdGhlIEwxIGB1c2VyUG9vbFRpZXJgIGZpZWxkIGRpcmVjdGx5LlxuICAgIGNmblVzZXJQb29sLnVzZXJQb29sVGllciA9IGF3c19jb2duaXRvLkZlYXR1cmVQbGFuLlBMVVM7XG5cbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IHRoaXMudXNlclBvb2wuYWRkQ2xpZW50KFwid2ViYXBwQ2xpZW50XCIsIHtcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgICBhZG1pblVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBwcmV2ZW50VXNlckV4aXN0ZW5jZUVycm9yczogdHJ1ZSxcbiAgICAgIHJlZnJlc2hUb2tlblZhbGlkaXR5OiBwcm9wcy5yZWZyZXNoVG9rZW5WYWxpZGl0eSxcbiAgICAgIHJlYWRBdHRyaWJ1dGVzOiBuZXcgYXdzX2NvZ25pdG8uQ2xpZW50QXR0cmlidXRlcygpXG4gICAgICAgIC53aXRoU3RhbmRhcmRBdHRyaWJ1dGVzKHtcbiAgICAgICAgICBhZGRyZXNzOiB0cnVlLFxuICAgICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgICAgIGZhbWlseU5hbWU6IHRydWUsXG4gICAgICAgICAgZ2VuZGVyOiB0cnVlLFxuICAgICAgICAgIGdpdmVuTmFtZTogdHJ1ZSxcbiAgICAgICAgICBsb2NhbGU6IHRydWUsXG4gICAgICAgICAgbmlja25hbWU6IHRydWUsXG4gICAgICAgICAgcGhvbmVOdW1iZXI6IHRydWUsXG4gICAgICAgICAgd2Vic2l0ZTogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLndpdGhDdXN0b21BdHRyaWJ1dGVzKFwib3JnYW5pemF0aW9uXCIsIFwidGhlbWVcIiksXG4gICAgICB3cml0ZUF0dHJpYnV0ZXM6IG5ldyBhd3NfY29nbml0by5DbGllbnRBdHRyaWJ1dGVzKClcbiAgICAgICAgLndpdGhTdGFuZGFyZEF0dHJpYnV0ZXMoe1xuICAgICAgICAgIGFkZHJlc3M6IHRydWUsXG4gICAgICAgICAgZmFtaWx5TmFtZTogdHJ1ZSxcbiAgICAgICAgICBnZW5kZXI6IHRydWUsXG4gICAgICAgICAgZ2l2ZW5OYW1lOiB0cnVlLFxuICAgICAgICAgIGxvY2FsZTogdHJ1ZSxcbiAgICAgICAgICBuaWNrbmFtZTogdHJ1ZSxcbiAgICAgICAgICBwaG9uZU51bWJlcjogdHJ1ZSxcbiAgICAgICAgICB3ZWJzaXRlOiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAud2l0aEN1c3RvbUF0dHJpYnV0ZXMoXCJvcmdhbml6YXRpb25cIiwgXCJ0aGVtZVwiKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGlkZW50aXR5UG9vbCA9IG5ldyBJZGVudGl0eVBvb2wodGhpcywgXCJpZGVudGl0eVBvb2xcIiwge1xuICAgICAgYWxsb3dVbmF1dGhlbnRpY2F0ZWRJZGVudGl0aWVzOiBmYWxzZSxcbiAgICAgIGF1dGhlbnRpY2F0aW9uUHJvdmlkZXJzOiB7XG4gICAgICAgIHVzZXJQb29sczogW1xuICAgICAgICAgIG5ldyBVc2VyUG9vbEF1dGhlbnRpY2F0aW9uUHJvdmlkZXIoe1xuICAgICAgICAgICAgdXNlclBvb2w6IHRoaXMudXNlclBvb2wsXG4gICAgICAgICAgICB1c2VyUG9vbENsaWVudCxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmF1dGhlbnRpY2F0ZWRSb2xlID0gaWRlbnRpdHlQb29sLmF1dGhlbnRpY2F0ZWRSb2xlO1xuXG4gICAgbmV3IENyZWF0ZVBvb2xVc2VyKHRoaXMsIFwiYWRtaW4tdXNlclwiLCB7XG4gICAgICBlbWFpbDogcHJvcHMuYWRtaW5FbWFpbCxcbiAgICAgIHVzZXJuYW1lOiBwcm9wcy51c2VyTmFtZSxcbiAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxuICAgIH0pO1xuXG4gICAgdGhpcy5jb2duaXRvUGFyYW1zID0ge1xuICAgICAgdXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgdXNlclBvb2xDbGllbnRJZDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wuaWRlbnRpdHlQb29sSWQsXG4gICAgfTtcblxuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbElkXCIsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcIlVzZXJQb29sQ2xpZW50SWRcIiwge1xuICAgICAgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgfSk7XG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcIklkZW50aXR5UG9vbElkXCIsIHtcbiAgICAgIHZhbHVlOiBpZGVudGl0eVBvb2wuaWRlbnRpdHlQb29sSWQsXG4gICAgfSk7XG5cbiAgICAvLyBTdXBwcmVzc2lvbnNcbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnModGhpcy51c2VyUG9vbCwgW1xuICAgICAge1xuICAgICAgICBpZDogXCJBd3NTb2x1dGlvbnMtQ09HMlwiLFxuICAgICAgICByZWFzb246IFwiTm8gbmVlZCBNRkEgZm9yIHNhbXBsZVwiLFxuICAgICAgfSxcbiAgICBdKTtcblxuICAgIC8vIOKUgOKUgOKUgCBDb2duaXRvIEdyb3VwcyAocm9sZXMpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIGNvbnN0IGFkbWluR3JvdXAgPSBuZXcgYXdzX2NvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCBcIkFkbWluR3JvdXBcIiwge1xuICAgICAgdXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZ3JvdXBOYW1lOiBcIkFkbWluXCIsXG4gICAgICBkZXNjcmlwdGlvbjogXCJGdWxsIGFjY2VzcyDigJQgY2FuIG11dGF0ZSBkYXRhLCBtYW5hZ2UgdXNlcnMsIGFuZCB2aWV3IG1vbml0b3JpbmdcIixcbiAgICAgIHByZWNlZGVuY2U6IDAsXG4gICAgfSk7XG5cbiAgICAvLyBNZW1iZXJzaGlwIEFkbWluIOKAlCBjYW4gaW52aXRlIG5ldyBtZW1iZXJzIGFuZCBtYW5hZ2UgdGhlIG1lbWJlcnNcbiAgICAvLyBkaXJlY3RvcnkgYnV0IGRvZXMgbm90IGdldCBzeXN0ZW0tYWRtaW5pc3RyYXRpb24gcHJpdmlsZWdlcy5cbiAgICBuZXcgYXdzX2NvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCBcIk1lbWJlcnNoaXBBZG1pbkdyb3VwXCIsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGdyb3VwTmFtZTogXCJNZW1iZXJzaGlwQWRtaW5cIixcbiAgICAgIGRlc2NyaXB0aW9uOlxuICAgICAgICBcIkNhbiBpbnZpdGUgYW5kIG1hbmFnZSBtZW1iZXJzIChubyBzeXN0ZW0tYWRtaW4gcHJpdmlsZWdlcylcIixcbiAgICAgIHByZWNlZGVuY2U6IDUsXG4gICAgfSk7XG5cbiAgICBuZXcgYXdzX2NvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCBcIkVkaXRvckdyb3VwXCIsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGdyb3VwTmFtZTogXCJFZGl0b3JcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkNhbiBhZGQgYW5kIG1vZGlmeSBncmFwaCBkYXRhXCIsXG4gICAgICBwcmVjZWRlbmNlOiAxMCxcbiAgICB9KTtcblxuICAgIG5ldyBhd3NfY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsIFwiVmlld2VyR3JvdXBcIiwge1xuICAgICAgdXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZ3JvdXBOYW1lOiBcIlZpZXdlclwiLFxuICAgICAgZGVzY3JpcHRpb246IFwiUmVhZC1vbmx5IGFjY2VzcyB0byBkYXNoYm9hcmRzIGFuZCBncmFwaCB2aXN1YWxpemF0aW9uXCIsXG4gICAgICBwcmVjZWRlbmNlOiAyMCxcbiAgICB9KTtcblxuICAgIC8vIE1lbWJlciBncm91cCDigJQgc2VjdXJpdHkgZXhlY3V0aXZlcyB1c2luZyB0aGUgbmV0d29ya2luZyBmZWF0dXJlcy5cbiAgICAvLyBEZWZhdWx0IGdyb3VwIGZvciBQb3N0Q29uZmlybWF0aW9uLWFzc2lnbmVkIHVzZXJzLlxuICAgIG5ldyBhd3NfY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsIFwiTWVtYmVyR3JvdXBcIiwge1xuICAgICAgdXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZ3JvdXBOYW1lOiBcIk1lbWJlclwiLFxuICAgICAgZGVzY3JpcHRpb246IFwiU29jaWFsIEFjdGl2ZSBBcHAgbWVtYmVyIOKAlCBmZWVkLCBldmVudHMsIHZlbmRvcnMsIG1lbWJlcnMgZGlyZWN0b3J5XCIsXG4gICAgICBwcmVjZWRlbmNlOiAzMCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCB0aGUgaW5pdGlhbCBhZG1pbiB1c2VyIHRvIHRoZSBBZG1pbiBncm91cFxuICAgIGNvbnN0IGFkbWluR3JvdXBNZW1iZXJzaGlwID0gbmV3IEF3c0N1c3RvbVJlc291cmNlKHRoaXMsIFwiQWRtaW5Hcm91cE1lbWJlcnNoaXBcIiwge1xuICAgICAgb25DcmVhdGU6IHtcbiAgICAgICAgc2VydmljZTogXCJDb2duaXRvSWRlbnRpdHlTZXJ2aWNlUHJvdmlkZXJcIixcbiAgICAgICAgYWN0aW9uOiBcImFkbWluQWRkVXNlclRvR3JvdXBcIixcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIFVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgICAgICBVc2VybmFtZTogcHJvcHMudXNlck5hbWUsXG4gICAgICAgICAgR3JvdXBOYW1lOiBcIkFkbWluXCIsXG4gICAgICAgIH0sXG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogUGh5c2ljYWxSZXNvdXJjZUlkLm9mKFxuICAgICAgICAgIGBBZG1pbkdyb3VwTWVtYmVyc2hpcC0ke3Byb3BzLnVzZXJOYW1lfWBcbiAgICAgICAgKSxcbiAgICAgIH0sXG4gICAgICBvbkRlbGV0ZToge1xuICAgICAgICBzZXJ2aWNlOiBcIkNvZ25pdG9JZGVudGl0eVNlcnZpY2VQcm92aWRlclwiLFxuICAgICAgICBhY3Rpb246IFwiYWRtaW5SZW1vdmVVc2VyRnJvbUdyb3VwXCIsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBVc2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgVXNlcm5hbWU6IHByb3BzLnVzZXJOYW1lLFxuICAgICAgICAgIEdyb3VwTmFtZTogXCJBZG1pblwiLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVN0YXRlbWVudHMoW1xuICAgICAgICBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgIFwiY29nbml0by1pZHA6QWRtaW5BZGRVc2VyVG9Hcm91cFwiLFxuICAgICAgICAgICAgXCJjb2duaXRvLWlkcDpBZG1pblJlbW92ZVVzZXJGcm9tR3JvdXBcIixcbiAgICAgICAgICBdLFxuICAgICAgICAgIHJlc291cmNlczogW3RoaXMudXNlclBvb2wudXNlclBvb2xBcm5dLFxuICAgICAgICB9KSxcbiAgICAgIF0pLFxuICAgIH0pO1xuICAgIGFkbWluR3JvdXBNZW1iZXJzaGlwLm5vZGUuYWRkRGVwZW5kZW5jeShhZG1pbkdyb3VwKTtcbiAgfVxufVxuXG5jbGFzcyBDcmVhdGVQb29sVXNlciBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSB1c2VybmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBjb25zdHJ1Y3RvcihcbiAgICBzY29wZTogQ29uc3RydWN0LFxuICAgIGlkOiBzdHJpbmcsXG4gICAgcHJvcHM6IHtcbiAgICAgIHVzZXJQb29sOiBhd3NfY29nbml0by5JVXNlclBvb2w7XG4gICAgICB1c2VybmFtZTogc3RyaW5nO1xuICAgICAgZW1haWw6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICB9XG4gICkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCBzdGF0ZW1lbnQgPSBuZXcgYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogW1wiY29nbml0by1pZHA6QWRtaW5EZWxldGVVc2VyXCIsIFwiY29nbml0by1pZHA6QWRtaW5DcmVhdGVVc2VyXCJdLFxuICAgICAgcmVzb3VyY2VzOiBbcHJvcHMudXNlclBvb2wudXNlclBvb2xBcm5dLFxuICAgIH0pO1xuXG4gICAgbmV3IEF3c0N1c3RvbVJlc291cmNlKHRoaXMsIGBDcmVhdGVVc2VyLSR7aWR9YCwge1xuICAgICAgb25DcmVhdGU6IHtcbiAgICAgICAgc2VydmljZTogXCJDb2duaXRvSWRlbnRpdHlTZXJ2aWNlUHJvdmlkZXJcIixcbiAgICAgICAgYWN0aW9uOiBcImFkbWluQ3JlYXRlVXNlclwiLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgVXNlclBvb2xJZDogcHJvcHMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgICAgICBVc2VybmFtZTogcHJvcHMudXNlcm5hbWUsXG4gICAgICAgICAgVXNlckF0dHJpYnV0ZXM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgTmFtZTogXCJlbWFpbFwiLFxuICAgICAgICAgICAgICBWYWx1ZTogcHJvcHMuZW1haWwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBOYW1lOiBcImVtYWlsX3ZlcmlmaWVkXCIsXG4gICAgICAgICAgICAgIFZhbHVlOiBcInRydWVcIixcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBQaHlzaWNhbFJlc291cmNlSWQub2YoXG4gICAgICAgICAgYENyZWF0ZVVzZXItJHtpZH0tJHtwcm9wcy51c2VybmFtZX1gXG4gICAgICAgICksXG4gICAgICB9LFxuICAgICAgb25EZWxldGU6IHtcbiAgICAgICAgc2VydmljZTogXCJDb2duaXRvSWRlbnRpdHlTZXJ2aWNlUHJvdmlkZXJcIixcbiAgICAgICAgYWN0aW9uOiBcImFkbWluRGVsZXRlVXNlclwiLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgVXNlclBvb2xJZDogcHJvcHMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgICAgICBVc2VybmFtZTogcHJvcHMudXNlcm5hbWUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBBd3NDdXN0b21SZXNvdXJjZVBvbGljeS5mcm9tU3RhdGVtZW50cyhbc3RhdGVtZW50XSksXG4gICAgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBSZW5kZXIgdGhlIEhUTUwgYm9keSBvZiB0aGUgQ29nbml0byBhZG1pbi1jcmVhdGVkLXVzZXIgaW52aXRhdGlvbiBlbWFpbC5cbiAqIGB7dXNlcm5hbWV9YCBhbmQgYHsjIyMjfWAgYXJlIENvZ25pdG8tcHJvdmlkZWQgcGxhY2Vob2xkZXJzIHRoYXQgYXJlXG4gKiBzdWJzdGl0dXRlZCBieSB0aGUgc2VydmljZSBiZWZvcmUgdGhlIG1lc3NhZ2UgaXMgc2VudC5cbiAqL1xuZnVuY3Rpb24gcmVuZGVySW52aXRlRW1haWxIdG1sKHNpZ25JblVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGA8IWRvY3R5cGUgaHRtbD5cbjxodG1sPlxuICA8Ym9keSBzdHlsZT1cIm1hcmdpbjowO3BhZGRpbmc6MDtiYWNrZ3JvdW5kOiNmNGYyZWU7Zm9udC1mYW1pbHk6LWFwcGxlLXN5c3RlbSxCbGlua01hY1N5c3RlbUZvbnQsJ1NlZ29lIFVJJyxJbnRlcixIZWx2ZXRpY2EsQXJpYWwsc2Fucy1zZXJpZjtjb2xvcjojMWYyOTM3O1wiPlxuICAgIDx0YWJsZSByb2xlPVwicHJlc2VudGF0aW9uXCIgd2lkdGg9XCIxMDAlXCIgY2VsbHNwYWNpbmc9XCIwXCIgY2VsbHBhZGRpbmc9XCIwXCIgc3R5bGU9XCJwYWRkaW5nOjMycHggMTZweDtiYWNrZ3JvdW5kOiNmNGYyZWU7XCI+XG4gICAgICA8dHI+XG4gICAgICAgIDx0ZCBhbGlnbj1cImNlbnRlclwiPlxuICAgICAgICAgIDx0YWJsZSByb2xlPVwicHJlc2VudGF0aW9uXCIgd2lkdGg9XCI1NjBcIiBjZWxsc3BhY2luZz1cIjBcIiBjZWxscGFkZGluZz1cIjBcIiBzdHlsZT1cIm1heC13aWR0aDo1NjBweDtiYWNrZ3JvdW5kOiNmZmZmZmY7Ym9yZGVyOjFweCBzb2xpZCAjZTVlN2ViO2JvcmRlci1yYWRpdXM6MTJweDtvdmVyZmxvdzpoaWRkZW47XCI+XG4gICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInBhZGRpbmc6MzJweCAzMnB4IDI0cHg7Ym9yZGVyLWJvdHRvbToxcHggc29saWQgI2YzZjRmNjtcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPVwiZm9udC1zaXplOjEycHg7bGV0dGVyLXNwYWNpbmc6MC4xNGVtO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtjb2xvcjojNmI3MjgwO1wiPlNvY2lhbCBBY3RpdmUgQXBwPC9kaXY+XG4gICAgICAgICAgICAgICAgPGgxIHN0eWxlPVwibWFyZ2luOjhweCAwIDA7Zm9udC1zaXplOjIycHg7Zm9udC13ZWlnaHQ6NjAwO2NvbG9yOiMxMTE4Mjc7bGluZS1oZWlnaHQ6MS4zO1wiPldlbGNvbWUgdG8gU29jaWFsIEFjdGl2ZSBBcHA8L2gxPlxuICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzoyOHB4IDMycHg7Zm9udC1zaXplOjE1cHg7bGluZS1oZWlnaHQ6MS42O2NvbG9yOiMxZjI5Mzc7XCI+XG4gICAgICAgICAgICAgICAgPHAgc3R5bGU9XCJtYXJnaW46MCAwIDE2cHg7XCI+WW91J3ZlIGJlZW4gaW52aXRlZCB0byBqb2luIFNvY2lhbCBBY3RpdmUgQXBwICZtZGFzaDsgYSBjdXJhdGVkIGNvbW11bml0eSBvZiBvdXRkb29yIGFkdmVudHVyZXJzLjwvcD5cbiAgICAgICAgICAgICAgICA8cCBzdHlsZT1cIm1hcmdpbjowIDAgMTZweDtcIj5Vc2UgdGhlIGNyZWRlbnRpYWxzIGJlbG93IHRvIHNpZ24gaW4uIFlvdSdsbCBiZSBwcm9tcHRlZCB0byBjaG9vc2UgeW91ciBvd24gcGFzc3dvcmQgb24gZmlyc3QgbG9naW4uPC9wPlxuICAgICAgICAgICAgICAgIDx0YWJsZSByb2xlPVwicHJlc2VudGF0aW9uXCIgd2lkdGg9XCIxMDAlXCIgY2VsbHNwYWNpbmc9XCIwXCIgY2VsbHBhZGRpbmc9XCIwXCIgc3R5bGU9XCJiYWNrZ3JvdW5kOiNmOWZhZmI7Ym9yZGVyOjFweCBzb2xpZCAjZTVlN2ViO2JvcmRlci1yYWRpdXM6OHB4O21hcmdpbjo0cHggMCAyNHB4O1wiPlxuICAgICAgICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICAgICAgICA8dGQgc3R5bGU9XCJwYWRkaW5nOjE2cHggMjBweDtmb250LWZhbWlseTp1aS1tb25vc3BhY2UsU0ZNb25vLVJlZ3VsYXIsTWVubG8sQ29uc29sYXMsbW9ub3NwYWNlO2ZvbnQtc2l6ZToxNHB4O2NvbG9yOiMxMTE4Mjc7XCI+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdiBzdHlsZT1cImNvbG9yOiM2YjcyODA7Zm9udC1zaXplOjExcHg7bGV0dGVyLXNwYWNpbmc6MC4wOGVtO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtcIj5Vc2VybmFtZTwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjRweDtcIj57dXNlcm5hbWV9PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6MTRweDtjb2xvcjojNmI3MjgwO2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOjAuMDhlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7XCI+VGVtcG9yYXJ5IHBhc3N3b3JkPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6NHB4O1wiPnsjIyMjfTwvZGl2PlxuICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgICAgIDxwIHN0eWxlPVwibWFyZ2luOjAgMCAyNHB4O3RleHQtYWxpZ246Y2VudGVyO1wiPlxuICAgICAgICAgICAgICAgICAgPGEgaHJlZj1cIiR7c2lnbkluVXJsfVwiIHN0eWxlPVwiZGlzcGxheTppbmxpbmUtYmxvY2s7YmFja2dyb3VuZDojMGE2NmMyO2NvbG9yOiNmZmZmZmY7dGV4dC1kZWNvcmF0aW9uOm5vbmU7cGFkZGluZzoxMnB4IDI0cHg7Ym9yZGVyLXJhZGl1czo4cHg7Zm9udC13ZWlnaHQ6NjAwO2ZvbnQtc2l6ZToxNHB4O1wiPlNpZ24gaW4gYW5kIHNldCB5b3VyIHBhc3N3b3JkPC9hPlxuICAgICAgICAgICAgICAgIDwvcD5cbiAgICAgICAgICAgICAgICA8cCBzdHlsZT1cIm1hcmdpbjowIDAgOHB4O2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM2YjcyODA7XCI+SGF2aW5nIHRyb3VibGUgd2l0aCB0aGUgYnV0dG9uPyBPcGVuIHRoaXMgbGluayBpbiB5b3VyIGJyb3dzZXI6PC9wPlxuICAgICAgICAgICAgICAgIDxwIHN0eWxlPVwibWFyZ2luOjAgMCAyNHB4O2ZvbnQtc2l6ZToxM3B4O3dvcmQtYnJlYWs6YnJlYWstYWxsO1wiPjxhIGhyZWY9XCIke3NpZ25JblVybH1cIiBzdHlsZT1cImNvbG9yOiMwYTY2YzI7dGV4dC1kZWNvcmF0aW9uOm5vbmU7XCI+JHtzaWduSW5Vcmx9PC9hPjwvcD5cbiAgICAgICAgICAgICAgICA8cCBzdHlsZT1cIm1hcmdpbjowO2ZvbnQtc2l6ZToxM3B4O2NvbG9yOiM2YjcyODA7XCI+VGhpcyBpbnZpdGF0aW9uIGlzIHBlcnNvbmFsICZtZGFzaDsgcGxlYXNlIGRvbid0IGZvcndhcmQgaXQuIElmIHlvdSB3ZXJlbid0IGV4cGVjdGluZyBpdCwgeW91IGNhbiBzYWZlbHkgaWdub3JlIHRoaXMgbWVzc2FnZS48L3A+XG4gICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICA8dGQgc3R5bGU9XCJwYWRkaW5nOjIwcHggMzJweDtiYWNrZ3JvdW5kOiNmOWZhZmI7Ym9yZGVyLXRvcDoxcHggc29saWQgI2YzZjRmNjtmb250LXNpemU6MTJweDtjb2xvcjojOWNhM2FmO1wiPlxuICAgICAgICAgICAgICAgIFNvY2lhbCBBY3RpdmUgQXBwXG4gICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8L3RyPlxuICAgICAgICAgIDwvdGFibGU+XG4gICAgICAgIDwvdGQ+XG4gICAgICA8L3RyPlxuICAgIDwvdGFibGU+XG4gIDwvYm9keT5cbjwvaHRtbD5gO1xufVxuIl19