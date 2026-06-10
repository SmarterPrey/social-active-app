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
        this.userPool.node.defaultChild.addOverride("Properties", {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvZ25pdG8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXVDO0FBQ3ZDLDZDQU1xQjtBQUVyQixtRUFJc0M7QUFFdEMsbUZBRzhDO0FBQzlDLHFDQUEwQztBQWtDMUMsTUFBYSxPQUFRLFNBQVEsc0JBQVM7SUFJcEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFtQjtRQUMzRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUFFLEtBQUssQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFckUsb0VBQW9FO1FBQ3BFLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksOEJBQThCLENBQUM7UUFDdkUsTUFBTSxVQUFVLEdBQUcscUJBQXFCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDcEQsTUFBTSxhQUFhLEdBQUcscUNBQXFDLENBQUM7UUFFNUQsdUVBQXVFO1FBQ3ZFLHdFQUF3RTtRQUN4RSxpREFBaUQ7UUFDakQsTUFBTSxrQkFBa0IsR0FBNEIsS0FBSyxDQUFDLEdBQUc7WUFDM0QsQ0FBQyxDQUFDO2dCQUNFLG1CQUFtQixFQUFFLFdBQVc7Z0JBQ2hDLFNBQVMsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFNBQVM7Z0JBQzlCLElBQUksRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVE7b0JBQ3RCLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxLQUFLLEtBQUssQ0FBQyxHQUFHLENBQUMsV0FBVyxHQUFHO29CQUNwRCxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxXQUFXO2dCQUN6QixHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxtQkFB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QUFjLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQztTQUM1RCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxTQUFpQjtJQUM5QyxPQUFPOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OzZCQTRCb0IsU0FBUzs7OzJGQUdxRCxTQUFTLGlEQUFpRCxTQUFTOzs7Ozs7Ozs7Ozs7OztRQWN0SixDQUFDO0FBQ1QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gXCJjb25zdHJ1Y3RzXCI7XG5pbXBvcnQge1xuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbiAgYXdzX2NvZ25pdG8sXG4gIGF3c19pYW0sXG4gIENmbk91dHB1dCxcbn0gZnJvbSBcImF3cy1jZGstbGliXCI7XG5cbmltcG9ydCB7XG4gIEF3c0N1c3RvbVJlc291cmNlLFxuICBBd3NDdXN0b21SZXNvdXJjZVBvbGljeSxcbiAgUGh5c2ljYWxSZXNvdXJjZUlkLFxufSBmcm9tIFwiYXdzLWNkay1saWIvY3VzdG9tLXJlc291cmNlc1wiO1xuXG5pbXBvcnQge1xuICBJZGVudGl0eVBvb2wsXG4gIFVzZXJQb29sQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcImF3cy1jZGstbGliL2F3cy1jb2duaXRvLWlkZW50aXR5cG9vbFwiO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSBcImNkay1uYWdcIjtcblxuZXhwb3J0IGludGVyZmFjZSBDb2duaXRvUHJvcHMge1xuICBhZG1pbkVtYWlsOiBzdHJpbmc7XG4gIHVzZXJOYW1lPzogc3RyaW5nO1xuICByZWZyZXNoVG9rZW5WYWxpZGl0eT86IER1cmF0aW9uO1xuICAvKipcbiAgICogQWJzb2x1dGUgVVJMIG9mIHRoZSB3ZWIgYXBwJ3Mgc2lnbi1pbiBwYWdlLlxuICAgKiBVc2VkIGluIHRoZSBpbnZpdGF0aW9uIGVtYWlsIGxpbmsgKGUuZy4gaHR0cHM6Ly9hcHAubXVja2VyLmlvL3NpZ25pbikuXG4gICAqL1xuICBhcHBTaWduSW5Vcmw/OiBzdHJpbmc7XG4gIC8qKlxuICAgKiBXaGVuIHNldCwgQ29nbml0byBzZW5kcyBlbWFpbCB2aWEgU0VTIHVzaW5nIHRoaXMgdmVyaWZpZWQgaWRlbnRpdHlcbiAgICogKERFVkVMT1BFUiBtb2RlKS4gV2l0aG91dCB0aGlzLCBDb2duaXRvIGZhbGxzIGJhY2sgdG8gdGhlIGRlZmF1bHRcbiAgICogQVdTLW1hbmFnZWQgc2VuZGVyIHdoaWNoIGlzIHNhbmRib3gtbGltaXRlZC5cbiAgICovXG4gIHNlcz86IHtcbiAgICAvKiogQVJOIG9mIGEgdmVyaWZpZWQgU0VTIGlkZW50aXR5IChkb21haW4gb3IgZW1haWwpLiAqL1xuICAgIHNvdXJjZUFybjogc3RyaW5nO1xuICAgIC8qKiBGcm9tIGFkZHJlc3MgQ29nbml0byBlbWFpbHMgYXJlIHNlbnQgZnJvbSAobXVzdCBtYXRjaCB0aGUgaWRlbnRpdHkpLiAqL1xuICAgIGZyb21BZGRyZXNzOiBzdHJpbmc7XG4gICAgLyoqIE9wdGlvbmFsIGRpc3BsYXkgbmFtZSAoXCJTb2NpYWwgQWN0aXZlIEFwcFwiKSB0byBzaG93IG5leHQgdG8gdGhlIGFkZHJlc3MuICovXG4gICAgZnJvbU5hbWU/OiBzdHJpbmc7XG4gICAgLyoqIE9wdGlvbmFsIHJlcGx5LXRvIGFkZHJlc3Mgc3VyZmFjZWQgaW4gdGhlIGVtYWlsIGhlYWRlcnMuICovXG4gICAgcmVwbHlUb0VtYWlsQWRkcmVzcz86IHN0cmluZztcbiAgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBDb2duaXRvUGFyYW1zIHtcbiAgdXNlclBvb2xJZDogc3RyaW5nO1xuICB1c2VyUG9vbENsaWVudElkOiBzdHJpbmc7XG4gIGlkZW50aXR5UG9vbElkOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBDb2duaXRvIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IGNvZ25pdG9QYXJhbXM6IENvZ25pdG9QYXJhbXM7XG4gIHB1YmxpYyByZWFkb25seSB1c2VyUG9vbDogYXdzX2NvZ25pdG8uVXNlclBvb2w7XG4gIHB1YmxpYyByZWFkb25seSBhdXRoZW50aWNhdGVkUm9sZTogYXdzX2lhbS5JUm9sZTtcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IENvZ25pdG9Qcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBpZiAoIXByb3BzLnVzZXJOYW1lKSBwcm9wcy51c2VyTmFtZSA9IHByb3BzLmFkbWluRW1haWwuc3BsaXQoXCJAXCIpWzBdO1xuXG4gICAgLy8gRmFsbGJhY2sgc2lnbi1pbiBVUkwuIENhbGxlcnMgc2hvdWxkIG92ZXJyaWRlIHZpYSBgYXBwU2lnbkluVXJsYC5cbiAgICBjb25zdCBzaWduSW5VcmwgPSBwcm9wcy5hcHBTaWduSW5VcmwgPz8gXCJodHRwczovL2FwcC5tdWNrZXIuaW8vc2lnbmluXCI7XG4gICAgY29uc3QgaW52aXRlSHRtbCA9IHJlbmRlckludml0ZUVtYWlsSHRtbChzaWduSW5VcmwpO1xuICAgIGNvbnN0IGludml0ZVN1YmplY3QgPSBcIllvdSdyZSBpbnZpdGVkIHRvIFNvY2lhbCBBY3RpdmUgQXBwXCI7XG5cbiAgICAvLyBFbWFpbENvbmZpZ3VyYXRpb246IGRlZmF1bHQgaXMgQ29nbml0by1tYW5hZ2VkIChzYW5kYm94eSkuIElmIGNhbGxlclxuICAgIC8vIHBhc3NlZCBhIHZlcmlmaWVkIFNFUyBpZGVudGl0eSwgc3dpdGNoIHRvIERFVkVMT1BFUiBtb2RlIHNvIG1haWwgZ29lc1xuICAgIC8vIG91dCB0aHJvdWdoIFNFUyB3aXRoIG91ciBicmFuZGVkIEZyb20gYWRkcmVzcy5cbiAgICBjb25zdCBlbWFpbENvbmZpZ3VyYXRpb246IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0gcHJvcHMuc2VzXG4gICAgICA/IHtcbiAgICAgICAgICBFbWFpbFNlbmRpbmdBY2NvdW50OiBcIkRFVkVMT1BFUlwiLFxuICAgICAgICAgIFNvdXJjZUFybjogcHJvcHMuc2VzLnNvdXJjZUFybixcbiAgICAgICAgICBGcm9tOiBwcm9wcy5zZXMuZnJvbU5hbWVcbiAgICAgICAgICAgID8gYCR7cHJvcHMuc2VzLmZyb21OYW1lfSA8JHtwcm9wcy5zZXMuZnJvbUFkZHJlc3N9PmBcbiAgICAgICAgICAgIDogcHJvcHMuc2VzLmZyb21BZGRyZXNzLFxuICAgICAgICAgIC4uLihwcm9wcy5zZXMucmVwbHlUb0VtYWlsQWRkcmVzc1xuICAgICAgICAgICAgPyB7IFJlcGx5VG9FbWFpbEFkZHJlc3M6IHByb3BzLnNlcy5yZXBseVRvRW1haWxBZGRyZXNzIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICB9XG4gICAgICA6IHsgRW1haWxTZW5kaW5nQWNjb3VudDogXCJDT0dOSVRPX0RFRkFVTFRcIiB9O1xuXG4gICAgdGhpcy51c2VyUG9vbCA9IG5ldyBhd3NfY29nbml0by5Vc2VyUG9vbCh0aGlzLCBcInVzZXJwb29sXCIsIHtcbiAgICAgIHVzZXJQb29sTmFtZTogYCR7aWR9LWFwcC11c2VycG9vbGAsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XG4gICAgICAgIHVzZXJuYW1lOiB0cnVlLFxuICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGF3c19jb2duaXRvLkFjY291bnRSZWNvdmVyeS5FTUFJTF9PTkxZLCAvLyBvdmVycmlkZGVuIGJ5IGFkZE92ZXJyaWRlIGJlbG93IHRvIGluY2x1ZGUgYWRtaW5fb25seVxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICAvLyBhZHZhbmNlZFNlY3VyaXR5TW9kZSBpcyBkZXByZWNhdGVkLiBVc2UgU3RhbmRhcmRUaHJlYXRQcm90ZWN0aW9uTW9kZSBhbmQgQ3VzdG9tVGhyZWF0UHJvdGVjdGlvbk1vZGUgaW5zdGVhZC5cbiAgICAgIHN0YW5kYXJkVGhyZWF0UHJvdGVjdGlvbk1vZGU6IGF3c19jb2duaXRvLlN0YW5kYXJkVGhyZWF0UHJvdGVjdGlvbk1vZGUuRlVMTF9GVU5DVElPTixcbiAgICAgIC8vIGN1c3RvbVRocmVhdFByb3RlY3Rpb25Nb2RlOiBhd3NfY29nbml0by5DdXN0b21UaHJlYXRQcm90ZWN0aW9uTW9kZS5FTkFCTEVELCAvLyBVbmNvbW1lbnQgYW5kIGNvbmZpZ3VyZSBhcyBuZWVkZWRcbiAgICAgIGF1dG9WZXJpZnk6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBQaW4gQUxMIFVzZXJQb29sIENsb3VkRm9ybWF0aW9uIHByb3BlcnRpZXMgdG8gZXhhY3RseSBtYXRjaCB0aGUgZGVwbG95ZWQgdGVtcGxhdGUuXG4gICAgLy8gQ29nbml0byByZWplY3RzIEFOWSBzY2hlbWEgZmllbGQgaW4gVXBkYXRlVXNlclBvb2wsIHNvIHdlIHByZXZlbnQgQ2xvdWRGb3JtYXRpb25cbiAgICAvLyBmcm9tIGV2ZXIgY2FsbGluZyBVcGRhdGVVc2VyUG9vbCBieSBlbnN1cmluZyB6ZXJvLWRpZmYgYmV0d2VlbiB0ZW1wbGF0ZXMsIHJlZ2FyZGxlc3NcbiAgICAvLyBvZiBDREsgdmVyc2lvbiBjaGFuZ2VzIHRoYXQgbWlnaHQgb3RoZXJ3aXNlIGFkZCBuZXcgZGVmYXVsdCBwcm9wZXJ0aWVzLlxuICAgICh0aGlzLnVzZXJQb29sLm5vZGUuZGVmYXVsdENoaWxkIGFzIGF3c19jb2duaXRvLkNmblVzZXJQb29sKS5hZGRPdmVycmlkZShcIlByb3BlcnRpZXNcIiwge1xuICAgICAgQWNjb3VudFJlY292ZXJ5U2V0dGluZzoge1xuICAgICAgICBSZWNvdmVyeU1lY2hhbmlzbXM6IFtcbiAgICAgICAgICB7IE5hbWU6IFwidmVyaWZpZWRfZW1haWxcIiwgUHJpb3JpdHk6IDEgfSxcbiAgICAgICAgICAvLyBDb2duaXRvIHJlcXVpcmVzIGEgc2Vjb25kIHJlY292ZXJ5IG1lY2hhbmlzbSB3aGVuIEVNQUlMX09UUCBNRkEgaXNcbiAgICAgICAgICAvLyBlbmFibGVkIOKAlCBhZG1pbl9vbmx5IGNhbm5vdCBiZSBjb21iaW5lZCB3aXRoIG90aGVycywgc28gd2UgYWRkXG4gICAgICAgICAgLy8gdmVyaWZpZWRfcGhvbmVfbnVtYmVyIGFzIFByaW9yaXR5IDIuIFVzZXJzIHdobyBoYXZlbid0IHNldCBhIHBob25lXG4gICAgICAgICAgLy8gbnVtYmVyIHNpbXBseSB3b24ndCBzZWUgdGhhdCByZWNvdmVyeSBvcHRpb24uXG4gICAgICAgICAgeyBOYW1lOiBcInZlcmlmaWVkX3Bob25lX251bWJlclwiLCBQcmlvcml0eTogMiB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIEFkbWluQ3JlYXRlVXNlckNvbmZpZzoge1xuICAgICAgICBBbGxvd0FkbWluQ3JlYXRlVXNlck9ubHk6IGZhbHNlLFxuICAgICAgICBJbnZpdGVNZXNzYWdlVGVtcGxhdGU6IHtcbiAgICAgICAgICBFbWFpbFN1YmplY3Q6IGludml0ZVN1YmplY3QsXG4gICAgICAgICAgRW1haWxNZXNzYWdlOiBpbnZpdGVIdG1sLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIEFsaWFzQXR0cmlidXRlczogW1wiZW1haWxcIl0sXG4gICAgICBBdXRvVmVyaWZpZWRBdHRyaWJ1dGVzOiBbXCJlbWFpbFwiXSxcbiAgICAgIEVtYWlsQ29uZmlndXJhdGlvbjogZW1haWxDb25maWd1cmF0aW9uLFxuICAgICAgLy8gTUZBOiBvcHRpb25hbCwgdXNlciBjYW4gZW5yb2xsIGVtYWlsIE9UUC4gU01TX01GQSByZW1vdmVkIOKAlCBpdCByZXF1aXJlc1xuICAgICAgLy8gYW4gU21zQ29uZmlndXJhdGlvbiBJQU0gcm9sZS9leHRlcm5hbCBJRCB3aGljaCBhZGRzIG9wZXJhdGlvbmFsIG92ZXJoZWFkXG4gICAgICAvLyBhbmQgRU1BSUxfT1RQIGNvdmVycyB0aGUgc2FtZSB1c2UgY2FzZS5cbiAgICAgIE1mYUNvbmZpZ3VyYXRpb246IFwiT1BUSU9OQUxcIixcbiAgICAgIEVuYWJsZWRNZmFzOiBbXCJFTUFJTF9PVFBcIl0sXG4gICAgICBEZXZpY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIENoYWxsZW5nZVJlcXVpcmVkT25OZXdEZXZpY2U6IHRydWUsXG4gICAgICAgIERldmljZU9ubHlSZW1lbWJlcmVkT25Vc2VyUHJvbXB0OiB0cnVlLFxuICAgICAgfSxcbiAgICAgIEVtYWlsVmVyaWZpY2F0aW9uTWVzc2FnZTogXCJUaGUgdmVyaWZpY2F0aW9uIGNvZGUgdG8geW91ciBuZXcgYWNjb3VudCBpcyB7IyMjI31cIixcbiAgICAgIEVtYWlsVmVyaWZpY2F0aW9uU3ViamVjdDogXCJWZXJpZnkgeW91ciBuZXcgYWNjb3VudFwiLFxuICAgICAgUG9saWNpZXM6IHsgUGFzc3dvcmRQb2xpY3k6IHsgTWluaW11bUxlbmd0aDogOCwgUmVxdWlyZU51bWJlcnM6IHRydWUsIFJlcXVpcmVTeW1ib2xzOiB0cnVlLCBSZXF1aXJlVXBwZXJjYXNlOiB0cnVlIH0gfSxcbiAgICAgIFNjaGVtYTogW1xuICAgICAgICB7IEF0dHJpYnV0ZURhdGFUeXBlOiBcIlN0cmluZ1wiLCBNdXRhYmxlOiB0cnVlLCBOYW1lOiBcIm9yZ2FuaXphdGlvblwiIH0sXG4gICAgICAgIHsgQXR0cmlidXRlRGF0YVR5cGU6IFwiU3RyaW5nXCIsIE11dGFibGU6IHRydWUsIE5hbWU6IFwidGhlbWVcIiB9LFxuICAgICAgXSxcbiAgICAgIFVzZXJQb29sQWRkT25zOiB7IEFkdmFuY2VkU2VjdXJpdHlNb2RlOiBcIkVORk9SQ0VEXCIgfSxcbiAgICAgIFVzZXJQb29sTmFtZTogXCJjb2duaXRvLWFwcC11c2VycG9vbFwiLFxuICAgICAgVmVyaWZpY2F0aW9uTWVzc2FnZVRlbXBsYXRlOiB7XG4gICAgICAgIERlZmF1bHRFbWFpbE9wdGlvbjogXCJDT05GSVJNX1dJVEhfQ09ERVwiLFxuICAgICAgICBFbWFpbE1lc3NhZ2U6IFwiVGhlIHZlcmlmaWNhdGlvbiBjb2RlIHRvIHlvdXIgbmV3IGFjY291bnQgaXMgeyMjIyN9XCIsXG4gICAgICAgIEVtYWlsU3ViamVjdDogXCJWZXJpZnkgeW91ciBuZXcgYWNjb3VudFwiLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gdGhpcy51c2VyUG9vbC5hZGRDbGllbnQoXCJ3ZWJhcHBDbGllbnRcIiwge1xuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJTcnA6IHRydWUsXG4gICAgICAgIGFkbWluVXNlclBhc3N3b3JkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHByZXZlbnRVc2VyRXhpc3RlbmNlRXJyb3JzOiB0cnVlLFxuICAgICAgcmVmcmVzaFRva2VuVmFsaWRpdHk6IHByb3BzLnJlZnJlc2hUb2tlblZhbGlkaXR5LFxuICAgICAgcmVhZEF0dHJpYnV0ZXM6IG5ldyBhd3NfY29nbml0by5DbGllbnRBdHRyaWJ1dGVzKClcbiAgICAgICAgLndpdGhTdGFuZGFyZEF0dHJpYnV0ZXMoe1xuICAgICAgICAgIGFkZHJlc3M6IHRydWUsXG4gICAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICAgICAgZmFtaWx5TmFtZTogdHJ1ZSxcbiAgICAgICAgICBnZW5kZXI6IHRydWUsXG4gICAgICAgICAgZ2l2ZW5OYW1lOiB0cnVlLFxuICAgICAgICAgIGxvY2FsZTogdHJ1ZSxcbiAgICAgICAgICBuaWNrbmFtZTogdHJ1ZSxcbiAgICAgICAgICBwaG9uZU51bWJlcjogdHJ1ZSxcbiAgICAgICAgICB3ZWJzaXRlOiB0cnVlLFxuICAgICAgICB9KVxuICAgICAgICAud2l0aEN1c3RvbUF0dHJpYnV0ZXMoXCJvcmdhbml6YXRpb25cIiwgXCJ0aGVtZVwiKSxcbiAgICAgIHdyaXRlQXR0cmlidXRlczogbmV3IGF3c19jb2duaXRvLkNsaWVudEF0dHJpYnV0ZXMoKVxuICAgICAgICAud2l0aFN0YW5kYXJkQXR0cmlidXRlcyh7XG4gICAgICAgICAgYWRkcmVzczogdHJ1ZSxcbiAgICAgICAgICBmYW1pbHlOYW1lOiB0cnVlLFxuICAgICAgICAgIGdlbmRlcjogdHJ1ZSxcbiAgICAgICAgICBnaXZlbk5hbWU6IHRydWUsXG4gICAgICAgICAgbG9jYWxlOiB0cnVlLFxuICAgICAgICAgIG5pY2tuYW1lOiB0cnVlLFxuICAgICAgICAgIHBob25lTnVtYmVyOiB0cnVlLFxuICAgICAgICAgIHdlYnNpdGU6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC53aXRoQ3VzdG9tQXR0cmlidXRlcyhcIm9yZ2FuaXphdGlvblwiLCBcInRoZW1lXCIpLFxuICAgIH0pO1xuXG4gICAgY29uc3QgaWRlbnRpdHlQb29sID0gbmV3IElkZW50aXR5UG9vbCh0aGlzLCBcImlkZW50aXR5UG9vbFwiLCB7XG4gICAgICBhbGxvd1VuYXV0aGVudGljYXRlZElkZW50aXRpZXM6IGZhbHNlLFxuICAgICAgYXV0aGVudGljYXRpb25Qcm92aWRlcnM6IHtcbiAgICAgICAgdXNlclBvb2xzOiBbXG4gICAgICAgICAgbmV3IFVzZXJQb29sQXV0aGVudGljYXRpb25Qcm92aWRlcih7XG4gICAgICAgICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcbiAgICAgICAgICAgIHVzZXJQb29sQ2xpZW50LFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXV0aGVudGljYXRlZFJvbGUgPSBpZGVudGl0eVBvb2wuYXV0aGVudGljYXRlZFJvbGU7XG5cbiAgICBuZXcgQ3JlYXRlUG9vbFVzZXIodGhpcywgXCJhZG1pbi11c2VyXCIsIHtcbiAgICAgIGVtYWlsOiBwcm9wcy5hZG1pbkVtYWlsLFxuICAgICAgdXNlcm5hbWU6IHByb3BzLnVzZXJOYW1lLFxuICAgICAgdXNlclBvb2w6IHRoaXMudXNlclBvb2wsXG4gICAgfSk7XG5cbiAgICB0aGlzLmNvZ25pdG9QYXJhbXMgPSB7XG4gICAgICB1c2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICB1c2VyUG9vbENsaWVudElkOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgaWRlbnRpdHlQb29sSWQ6IGlkZW50aXR5UG9vbC5pZGVudGl0eVBvb2xJZCxcbiAgICB9O1xuXG4gICAgbmV3IENmbk91dHB1dCh0aGlzLCBcIlVzZXJQb29sSWRcIiwge1xuICAgICAgdmFsdWU6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICB9KTtcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xDbGllbnRJZFwiLCB7XG4gICAgICB2YWx1ZTogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICB9KTtcbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiSWRlbnRpdHlQb29sSWRcIiwge1xuICAgICAgdmFsdWU6IGlkZW50aXR5UG9vbC5pZGVudGl0eVBvb2xJZCxcbiAgICB9KTtcblxuICAgIC8vIFN1cHByZXNzaW9uc1xuICAgIE5hZ1N1cHByZXNzaW9ucy5hZGRSZXNvdXJjZVN1cHByZXNzaW9ucyh0aGlzLnVzZXJQb29sLCBbXG4gICAgICB7XG4gICAgICAgIGlkOiBcIkF3c1NvbHV0aW9ucy1DT0cyXCIsXG4gICAgICAgIHJlYXNvbjogXCJObyBuZWVkIE1GQSBmb3Igc2FtcGxlXCIsXG4gICAgICB9LFxuICAgIF0pO1xuXG4gICAgLy8g4pSA4pSA4pSAIENvZ25pdG8gR3JvdXBzIChyb2xlcykg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgYWRtaW5Hcm91cCA9IG5ldyBhd3NfY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsIFwiQWRtaW5Hcm91cFwiLCB7XG4gICAgICB1c2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBncm91cE5hbWU6IFwiQWRtaW5cIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIkZ1bGwgYWNjZXNzIOKAlCBjYW4gbXV0YXRlIGRhdGEsIG1hbmFnZSB1c2VycywgYW5kIHZpZXcgbW9uaXRvcmluZ1wiLFxuICAgICAgcHJlY2VkZW5jZTogMCxcbiAgICB9KTtcblxuICAgIC8vIE1lbWJlcnNoaXAgQWRtaW4g4oCUIGNhbiBpbnZpdGUgbmV3IG1lbWJlcnMgYW5kIG1hbmFnZSB0aGUgbWVtYmVyc1xuICAgIC8vIGRpcmVjdG9yeSBidXQgZG9lcyBub3QgZ2V0IHN5c3RlbS1hZG1pbmlzdHJhdGlvbiBwcml2aWxlZ2VzLlxuICAgIG5ldyBhd3NfY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsIFwiTWVtYmVyc2hpcEFkbWluR3JvdXBcIiwge1xuICAgICAgdXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZ3JvdXBOYW1lOiBcIk1lbWJlcnNoaXBBZG1pblwiLFxuICAgICAgZGVzY3JpcHRpb246XG4gICAgICAgIFwiQ2FuIGludml0ZSBhbmQgbWFuYWdlIG1lbWJlcnMgKG5vIHN5c3RlbS1hZG1pbiBwcml2aWxlZ2VzKVwiLFxuICAgICAgcHJlY2VkZW5jZTogNSxcbiAgICB9KTtcblxuICAgIG5ldyBhd3NfY29nbml0by5DZm5Vc2VyUG9vbEdyb3VwKHRoaXMsIFwiRWRpdG9yR3JvdXBcIiwge1xuICAgICAgdXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZ3JvdXBOYW1lOiBcIkVkaXRvclwiLFxuICAgICAgZGVzY3JpcHRpb246IFwiQ2FuIGFkZCBhbmQgbW9kaWZ5IGdyYXBoIGRhdGFcIixcbiAgICAgIHByZWNlZGVuY2U6IDEwLFxuICAgIH0pO1xuXG4gICAgbmV3IGF3c19jb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgXCJWaWV3ZXJHcm91cFwiLCB7XG4gICAgICB1c2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBncm91cE5hbWU6IFwiVmlld2VyXCIsXG4gICAgICBkZXNjcmlwdGlvbjogXCJSZWFkLW9ubHkgYWNjZXNzIHRvIGRhc2hib2FyZHMgYW5kIGdyYXBoIHZpc3VhbGl6YXRpb25cIixcbiAgICAgIHByZWNlZGVuY2U6IDIwLFxuICAgIH0pO1xuXG4gICAgLy8gTWVtYmVyIGdyb3VwIOKAlCBzZWN1cml0eSBleGVjdXRpdmVzIHVzaW5nIHRoZSBuZXR3b3JraW5nIGZlYXR1cmVzLlxuICAgIC8vIERlZmF1bHQgZ3JvdXAgZm9yIFBvc3RDb25maXJtYXRpb24tYXNzaWduZWQgdXNlcnMuXG4gICAgbmV3IGF3c19jb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgXCJNZW1iZXJHcm91cFwiLCB7XG4gICAgICB1c2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBncm91cE5hbWU6IFwiTWVtYmVyXCIsXG4gICAgICBkZXNjcmlwdGlvbjogXCJTb2NpYWwgQWN0aXZlIEFwcCBtZW1iZXIg4oCUIGZlZWQsIGV2ZW50cywgdmVuZG9ycywgbWVtYmVycyBkaXJlY3RvcnlcIixcbiAgICAgIHByZWNlZGVuY2U6IDMwLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIHRoZSBpbml0aWFsIGFkbWluIHVzZXIgdG8gdGhlIEFkbWluIGdyb3VwXG4gICAgY29uc3QgYWRtaW5Hcm91cE1lbWJlcnNoaXAgPSBuZXcgQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgXCJBZG1pbkdyb3VwTWVtYmVyc2hpcFwiLCB7XG4gICAgICBvbkNyZWF0ZToge1xuICAgICAgICBzZXJ2aWNlOiBcIkNvZ25pdG9JZGVudGl0eVNlcnZpY2VQcm92aWRlclwiLFxuICAgICAgICBhY3Rpb246IFwiYWRtaW5BZGRVc2VyVG9Hcm91cFwiLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgVXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgIFVzZXJuYW1lOiBwcm9wcy51c2VyTmFtZSxcbiAgICAgICAgICBHcm91cE5hbWU6IFwiQWRtaW5cIixcbiAgICAgICAgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBQaHlzaWNhbFJlc291cmNlSWQub2YoXG4gICAgICAgICAgYEFkbWluR3JvdXBNZW1iZXJzaGlwLSR7cHJvcHMudXNlck5hbWV9YFxuICAgICAgICApLFxuICAgICAgfSxcbiAgICAgIG9uRGVsZXRlOiB7XG4gICAgICAgIHNlcnZpY2U6IFwiQ29nbml0b0lkZW50aXR5U2VydmljZVByb3ZpZGVyXCIsXG4gICAgICAgIGFjdGlvbjogXCJhZG1pblJlbW92ZVVzZXJGcm9tR3JvdXBcIixcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIFVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgICAgICBVc2VybmFtZTogcHJvcHMudXNlck5hbWUsXG4gICAgICAgICAgR3JvdXBOYW1lOiBcIkFkbWluXCIsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBBd3NDdXN0b21SZXNvdXJjZVBvbGljeS5mcm9tU3RhdGVtZW50cyhbXG4gICAgICAgIG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgXCJjb2duaXRvLWlkcDpBZG1pbkFkZFVzZXJUb0dyb3VwXCIsXG4gICAgICAgICAgICBcImNvZ25pdG8taWRwOkFkbWluUmVtb3ZlVXNlckZyb21Hcm91cFwiLFxuICAgICAgICAgIF0sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy51c2VyUG9vbC51c2VyUG9vbEFybl0sXG4gICAgICAgIH0pLFxuICAgICAgXSksXG4gICAgfSk7XG4gICAgYWRtaW5Hcm91cE1lbWJlcnNoaXAubm9kZS5hZGREZXBlbmRlbmN5KGFkbWluR3JvdXApO1xuICB9XG59XG5cbmNsYXNzIENyZWF0ZVBvb2xVc2VyIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJuYW1lOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHNjb3BlOiBDb25zdHJ1Y3QsXG4gICAgaWQ6IHN0cmluZyxcbiAgICBwcm9wczoge1xuICAgICAgdXNlclBvb2w6IGF3c19jb2duaXRvLklVc2VyUG9vbDtcbiAgICAgIHVzZXJuYW1lOiBzdHJpbmc7XG4gICAgICBlbWFpbDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgIH1cbiAgKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGNvbnN0IHN0YXRlbWVudCA9IG5ldyBhd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbXCJjb2duaXRvLWlkcDpBZG1pbkRlbGV0ZVVzZXJcIiwgXCJjb2duaXRvLWlkcDpBZG1pbkNyZWF0ZVVzZXJcIl0sXG4gICAgICByZXNvdXJjZXM6IFtwcm9wcy51c2VyUG9vbC51c2VyUG9vbEFybl0sXG4gICAgfSk7XG5cbiAgICBuZXcgQXdzQ3VzdG9tUmVzb3VyY2UodGhpcywgYENyZWF0ZVVzZXItJHtpZH1gLCB7XG4gICAgICBvbkNyZWF0ZToge1xuICAgICAgICBzZXJ2aWNlOiBcIkNvZ25pdG9JZGVudGl0eVNlcnZpY2VQcm92aWRlclwiLFxuICAgICAgICBhY3Rpb246IFwiYWRtaW5DcmVhdGVVc2VyXCIsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBVc2VyUG9vbElkOiBwcm9wcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgIFVzZXJuYW1lOiBwcm9wcy51c2VybmFtZSxcbiAgICAgICAgICBVc2VyQXR0cmlidXRlczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBOYW1lOiBcImVtYWlsXCIsXG4gICAgICAgICAgICAgIFZhbHVlOiBwcm9wcy5lbWFpbCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIE5hbWU6IFwiZW1haWxfdmVyaWZpZWRcIixcbiAgICAgICAgICAgICAgVmFsdWU6IFwidHJ1ZVwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IFBoeXNpY2FsUmVzb3VyY2VJZC5vZihcbiAgICAgICAgICBgQ3JlYXRlVXNlci0ke2lkfS0ke3Byb3BzLnVzZXJuYW1lfWBcbiAgICAgICAgKSxcbiAgICAgIH0sXG4gICAgICBvbkRlbGV0ZToge1xuICAgICAgICBzZXJ2aWNlOiBcIkNvZ25pdG9JZGVudGl0eVNlcnZpY2VQcm92aWRlclwiLFxuICAgICAgICBhY3Rpb246IFwiYWRtaW5EZWxldGVVc2VyXCIsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBVc2VyUG9vbElkOiBwcm9wcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgIFVzZXJuYW1lOiBwcm9wcy51c2VybmFtZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwb2xpY3k6IEF3c0N1c3RvbVJlc291cmNlUG9saWN5LmZyb21TdGF0ZW1lbnRzKFtzdGF0ZW1lbnRdKSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIFJlbmRlciB0aGUgSFRNTCBib2R5IG9mIHRoZSBDb2duaXRvIGFkbWluLWNyZWF0ZWQtdXNlciBpbnZpdGF0aW9uIGVtYWlsLlxuICogYHt1c2VybmFtZX1gIGFuZCBgeyMjIyN9YCBhcmUgQ29nbml0by1wcm92aWRlZCBwbGFjZWhvbGRlcnMgdGhhdCBhcmVcbiAqIHN1YnN0aXR1dGVkIGJ5IHRoZSBzZXJ2aWNlIGJlZm9yZSB0aGUgbWVzc2FnZSBpcyBzZW50LlxuICovXG5mdW5jdGlvbiByZW5kZXJJbnZpdGVFbWFpbEh0bWwoc2lnbkluVXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYDwhZG9jdHlwZSBodG1sPlxuPGh0bWw+XG4gIDxib2R5IHN0eWxlPVwibWFyZ2luOjA7cGFkZGluZzowO2JhY2tncm91bmQ6I2Y0ZjJlZTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwnU2Vnb2UgVUknLEludGVyLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmO2NvbG9yOiMxZjI5Mzc7XCI+XG4gICAgPHRhYmxlIHJvbGU9XCJwcmVzZW50YXRpb25cIiB3aWR0aD1cIjEwMCVcIiBjZWxsc3BhY2luZz1cIjBcIiBjZWxscGFkZGluZz1cIjBcIiBzdHlsZT1cInBhZGRpbmc6MzJweCAxNnB4O2JhY2tncm91bmQ6I2Y0ZjJlZTtcIj5cbiAgICAgIDx0cj5cbiAgICAgICAgPHRkIGFsaWduPVwiY2VudGVyXCI+XG4gICAgICAgICAgPHRhYmxlIHJvbGU9XCJwcmVzZW50YXRpb25cIiB3aWR0aD1cIjU2MFwiIGNlbGxzcGFjaW5nPVwiMFwiIGNlbGxwYWRkaW5nPVwiMFwiIHN0eWxlPVwibWF4LXdpZHRoOjU2MHB4O2JhY2tncm91bmQ6I2ZmZmZmZjtib3JkZXI6MXB4IHNvbGlkICNlNWU3ZWI7Ym9yZGVyLXJhZGl1czoxMnB4O292ZXJmbG93OmhpZGRlbjtcIj5cbiAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzozMnB4IDMycHggMjRweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZjNmNGY2O1wiPlxuICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJmb250LXNpemU6MTJweDtsZXR0ZXItc3BhY2luZzowLjE0ZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO2NvbG9yOiM2YjcyODA7XCI+U29jaWFsIEFjdGl2ZSBBcHA8L2Rpdj5cbiAgICAgICAgICAgICAgICA8aDEgc3R5bGU9XCJtYXJnaW46OHB4IDAgMDtmb250LXNpemU6MjJweDtmb250LXdlaWdodDo2MDA7Y29sb3I6IzExMTgyNztsaW5lLWhlaWdodDoxLjM7XCI+V2VsY29tZSB0byBTb2NpYWwgQWN0aXZlIEFwcDwvaDE+XG4gICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICA8dGQgc3R5bGU9XCJwYWRkaW5nOjI4cHggMzJweDtmb250LXNpemU6MTVweDtsaW5lLWhlaWdodDoxLjY7Y29sb3I6IzFmMjkzNztcIj5cbiAgICAgICAgICAgICAgICA8cCBzdHlsZT1cIm1hcmdpbjowIDAgMTZweDtcIj5Zb3UndmUgYmVlbiBpbnZpdGVkIHRvIGpvaW4gU29jaWFsIEFjdGl2ZSBBcHAgJm1kYXNoOyBhIGN1cmF0ZWQgY29tbXVuaXR5IG9mIG91dGRvb3IgYWR2ZW50dXJlcnMuPC9wPlxuICAgICAgICAgICAgICAgIDxwIHN0eWxlPVwibWFyZ2luOjAgMCAxNnB4O1wiPlVzZSB0aGUgY3JlZGVudGlhbHMgYmVsb3cgdG8gc2lnbiBpbi4gWW91J2xsIGJlIHByb21wdGVkIHRvIGNob29zZSB5b3VyIG93biBwYXNzd29yZCBvbiBmaXJzdCBsb2dpbi48L3A+XG4gICAgICAgICAgICAgICAgPHRhYmxlIHJvbGU9XCJwcmVzZW50YXRpb25cIiB3aWR0aD1cIjEwMCVcIiBjZWxsc3BhY2luZz1cIjBcIiBjZWxscGFkZGluZz1cIjBcIiBzdHlsZT1cImJhY2tncm91bmQ6I2Y5ZmFmYjtib3JkZXI6MXB4IHNvbGlkICNlNWU3ZWI7Ym9yZGVyLXJhZGl1czo4cHg7bWFyZ2luOjRweCAwIDI0cHg7XCI+XG4gICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInBhZGRpbmc6MTZweCAyMHB4O2ZvbnQtZmFtaWx5OnVpLW1vbm9zcGFjZSxTRk1vbm8tUmVndWxhcixNZW5sbyxDb25zb2xhcyxtb25vc3BhY2U7Zm9udC1zaXplOjE0cHg7Y29sb3I6IzExMTgyNztcIj5cbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPVwiY29sb3I6IzZiNzI4MDtmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzowLjA4ZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO1wiPlVzZXJuYW1lPC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgPGRpdiBzdHlsZT1cIm1hcmdpbi10b3A6NHB4O1wiPnt1c2VybmFtZX08L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDoxNHB4O2NvbG9yOiM2YjcyODA7Zm9udC1zaXplOjExcHg7bGV0dGVyLXNwYWNpbmc6MC4wOGVtO3RleHQtdHJhbnNmb3JtOnVwcGVyY2FzZTtcIj5UZW1wb3JhcnkgcGFzc3dvcmQ8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo0cHg7XCI+eyMjIyN9PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgIDwvdGFibGU+XG4gICAgICAgICAgICAgICAgPHAgc3R5bGU9XCJtYXJnaW46MCAwIDI0cHg7dGV4dC1hbGlnbjpjZW50ZXI7XCI+XG4gICAgICAgICAgICAgICAgICA8YSBocmVmPVwiJHtzaWduSW5Vcmx9XCIgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOiMwYTY2YzI7Y29sb3I6I2ZmZmZmZjt0ZXh0LWRlY29yYXRpb246bm9uZTtwYWRkaW5nOjEycHggMjRweDtib3JkZXItcmFkaXVzOjhweDtmb250LXdlaWdodDo2MDA7Zm9udC1zaXplOjE0cHg7XCI+U2lnbiBpbiBhbmQgc2V0IHlvdXIgcGFzc3dvcmQ8L2E+XG4gICAgICAgICAgICAgICAgPC9wPlxuICAgICAgICAgICAgICAgIDxwIHN0eWxlPVwibWFyZ2luOjAgMCA4cHg7Zm9udC1zaXplOjEzcHg7Y29sb3I6IzZiNzI4MDtcIj5IYXZpbmcgdHJvdWJsZSB3aXRoIHRoZSBidXR0b24/IE9wZW4gdGhpcyBsaW5rIGluIHlvdXIgYnJvd3Nlcjo8L3A+XG4gICAgICAgICAgICAgICAgPHAgc3R5bGU9XCJtYXJnaW46MCAwIDI0cHg7Zm9udC1zaXplOjEzcHg7d29yZC1icmVhazpicmVhay1hbGw7XCI+PGEgaHJlZj1cIiR7c2lnbkluVXJsfVwiIHN0eWxlPVwiY29sb3I6IzBhNjZjMjt0ZXh0LWRlY29yYXRpb246bm9uZTtcIj4ke3NpZ25JblVybH08L2E+PC9wPlxuICAgICAgICAgICAgICAgIDxwIHN0eWxlPVwibWFyZ2luOjA7Zm9udC1zaXplOjEzcHg7Y29sb3I6IzZiNzI4MDtcIj5UaGlzIGludml0YXRpb24gaXMgcGVyc29uYWwgJm1kYXNoOyBwbGVhc2UgZG9uJ3QgZm9yd2FyZCBpdC4gSWYgeW91IHdlcmVuJ3QgZXhwZWN0aW5nIGl0LCB5b3UgY2FuIHNhZmVseSBpZ25vcmUgdGhpcyBtZXNzYWdlLjwvcD5cbiAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInBhZGRpbmc6MjBweCAzMnB4O2JhY2tncm91bmQ6I2Y5ZmFmYjtib3JkZXItdG9wOjFweCBzb2xpZCAjZjNmNGY2O2ZvbnQtc2l6ZToxMnB4O2NvbG9yOiM5Y2EzYWY7XCI+XG4gICAgICAgICAgICAgICAgU29jaWFsIEFjdGl2ZSBBcHBcbiAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgPC90YWJsZT5cbiAgICAgICAgPC90ZD5cbiAgICAgIDwvdHI+XG4gICAgPC90YWJsZT5cbiAgPC9ib2R5PlxuPC9odG1sPmA7XG59XG4iXX0=