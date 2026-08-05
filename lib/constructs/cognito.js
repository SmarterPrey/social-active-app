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
            UserPoolName: `${id}-app-userpool`,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29nbml0by5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImNvZ25pdG8udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXVDO0FBQ3ZDLDZDQU1xQjtBQUVyQixtRUFJc0M7QUFFdEMsbUZBRzhDO0FBQzlDLHFDQUEwQztBQWtDMUMsTUFBYSxPQUFRLFNBQVEsc0JBQVM7SUFJcEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFtQjtRQUMzRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUFFLEtBQUssQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFckUsb0VBQW9FO1FBQ3BFLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxZQUFZLElBQUksOEJBQThCLENBQUM7UUFDdkUsTUFBTSxVQUFVLEdBQUcscUJBQXFCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDcEQsTUFBTSxhQUFhLEdBQUcscUNBQXFDLENBQUM7UUFFNUQsdUVBQXVFO1FBQ3ZFLHdFQUF3RTtRQUN4RSxpREFBaUQ7UUFDakQsTUFBTSxrQkFBa0IsR0FBNEIsS0FBSyxDQUFDLEdBQUc7WUFDM0QsQ0FBQyxDQUFDO2dCQUNFLG1CQUFtQixFQUFFLFdBQVc7Z0JBQ2hDLFNBQVMsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFNBQVM7Z0JBQzlCLElBQUksRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLFFBQVE7b0JBQ3RCLENBQUMsQ0FBQyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUMsUUFBUSxLQUFLLEtBQUssQ0FBQyxHQUFHLENBQUMsV0FBVyxHQUFHO29CQUNwRCxDQUFDLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxXQUFXO2dCQUN6QixHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxtQkFB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Q3pDLE1BQU0sRUFBRSxpQkFBaUI7Z0JBQ3pCLFVBQVUsRUFBRTtvQkFDVixVQUFVLEVBQUUsS0FBSyxDQUFDLFFBQVEsQ0FBQyxVQUFVO29CQUNyQyxRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7aUJBQ3pCO2FBQ0Y7WUFDRCxNQUFNLEVBQUUsMENBQXVCLENBQUMsY0FBYyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUM7U0FDNUQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMscUJBQXFCLENBQUMsU0FBaUI7SUFDOUMsT0FBTzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs2QkE0Qm9CLFNBQVM7OzsyRkFHcUQsU0FBUyxpREFBaUQsU0FBUzs7Ozs7Ozs7Ozs7Ozs7UUFjdEosQ0FBQztBQUNULENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tIFwiY29uc3RydWN0c1wiO1xuaW1wb3J0IHtcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG4gIGF3c19jb2duaXRvLFxuICBhd3NfaWFtLFxuICBDZm5PdXRwdXQsXG59IGZyb20gXCJhd3MtY2RrLWxpYlwiO1xuXG5pbXBvcnQge1xuICBBd3NDdXN0b21SZXNvdXJjZSxcbiAgQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3ksXG4gIFBoeXNpY2FsUmVzb3VyY2VJZCxcbn0gZnJvbSBcImF3cy1jZGstbGliL2N1c3RvbS1yZXNvdXJjZXNcIjtcblxuaW1wb3J0IHtcbiAgSWRlbnRpdHlQb29sLFxuICBVc2VyUG9vbEF1dGhlbnRpY2F0aW9uUHJvdmlkZXIsXG59IGZyb20gXCJhd3MtY2RrLWxpYi9hd3MtY29nbml0by1pZGVudGl0eXBvb2xcIjtcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gXCJjZGstbmFnXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29nbml0b1Byb3BzIHtcbiAgYWRtaW5FbWFpbDogc3RyaW5nO1xuICB1c2VyTmFtZT86IHN0cmluZztcbiAgcmVmcmVzaFRva2VuVmFsaWRpdHk/OiBEdXJhdGlvbjtcbiAgLyoqXG4gICAqIEFic29sdXRlIFVSTCBvZiB0aGUgd2ViIGFwcCdzIHNpZ24taW4gcGFnZS5cbiAgICogVXNlZCBpbiB0aGUgaW52aXRhdGlvbiBlbWFpbCBsaW5rIChlLmcuIGh0dHBzOi8vYXBwLm11Y2tlci5pby9zaWduaW4pLlxuICAgKi9cbiAgYXBwU2lnbkluVXJsPzogc3RyaW5nO1xuICAvKipcbiAgICogV2hlbiBzZXQsIENvZ25pdG8gc2VuZHMgZW1haWwgdmlhIFNFUyB1c2luZyB0aGlzIHZlcmlmaWVkIGlkZW50aXR5XG4gICAqIChERVZFTE9QRVIgbW9kZSkuIFdpdGhvdXQgdGhpcywgQ29nbml0byBmYWxscyBiYWNrIHRvIHRoZSBkZWZhdWx0XG4gICAqIEFXUy1tYW5hZ2VkIHNlbmRlciB3aGljaCBpcyBzYW5kYm94LWxpbWl0ZWQuXG4gICAqL1xuICBzZXM/OiB7XG4gICAgLyoqIEFSTiBvZiBhIHZlcmlmaWVkIFNFUyBpZGVudGl0eSAoZG9tYWluIG9yIGVtYWlsKS4gKi9cbiAgICBzb3VyY2VBcm46IHN0cmluZztcbiAgICAvKiogRnJvbSBhZGRyZXNzIENvZ25pdG8gZW1haWxzIGFyZSBzZW50IGZyb20gKG11c3QgbWF0Y2ggdGhlIGlkZW50aXR5KS4gKi9cbiAgICBmcm9tQWRkcmVzczogc3RyaW5nO1xuICAgIC8qKiBPcHRpb25hbCBkaXNwbGF5IG5hbWUgKFwiU29jaWFsIEFjdGl2ZSBBcHBcIikgdG8gc2hvdyBuZXh0IHRvIHRoZSBhZGRyZXNzLiAqL1xuICAgIGZyb21OYW1lPzogc3RyaW5nO1xuICAgIC8qKiBPcHRpb25hbCByZXBseS10byBhZGRyZXNzIHN1cmZhY2VkIGluIHRoZSBlbWFpbCBoZWFkZXJzLiAqL1xuICAgIHJlcGx5VG9FbWFpbEFkZHJlc3M/OiBzdHJpbmc7XG4gIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29nbml0b1BhcmFtcyB7XG4gIHVzZXJQb29sSWQ6IHN0cmluZztcbiAgdXNlclBvb2xDbGllbnRJZDogc3RyaW5nO1xuICBpZGVudGl0eVBvb2xJZDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQ29nbml0byBleHRlbmRzIENvbnN0cnVjdCB7XG4gIHB1YmxpYyByZWFkb25seSBjb2duaXRvUGFyYW1zOiBDb2duaXRvUGFyYW1zO1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlclBvb2w6IGF3c19jb2duaXRvLlVzZXJQb29sO1xuICBwdWJsaWMgcmVhZG9ubHkgYXV0aGVudGljYXRlZFJvbGU6IGF3c19pYW0uSVJvbGU7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb2duaXRvUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgaWYgKCFwcm9wcy51c2VyTmFtZSkgcHJvcHMudXNlck5hbWUgPSBwcm9wcy5hZG1pbkVtYWlsLnNwbGl0KFwiQFwiKVswXTtcblxuICAgIC8vIEZhbGxiYWNrIHNpZ24taW4gVVJMLiBDYWxsZXJzIHNob3VsZCBvdmVycmlkZSB2aWEgYGFwcFNpZ25JblVybGAuXG4gICAgY29uc3Qgc2lnbkluVXJsID0gcHJvcHMuYXBwU2lnbkluVXJsID8/IFwiaHR0cHM6Ly9hcHAubXVja2VyLmlvL3NpZ25pblwiO1xuICAgIGNvbnN0IGludml0ZUh0bWwgPSByZW5kZXJJbnZpdGVFbWFpbEh0bWwoc2lnbkluVXJsKTtcbiAgICBjb25zdCBpbnZpdGVTdWJqZWN0ID0gXCJZb3UncmUgaW52aXRlZCB0byBTb2NpYWwgQWN0aXZlIEFwcFwiO1xuXG4gICAgLy8gRW1haWxDb25maWd1cmF0aW9uOiBkZWZhdWx0IGlzIENvZ25pdG8tbWFuYWdlZCAoc2FuZGJveHkpLiBJZiBjYWxsZXJcbiAgICAvLyBwYXNzZWQgYSB2ZXJpZmllZCBTRVMgaWRlbnRpdHksIHN3aXRjaCB0byBERVZFTE9QRVIgbW9kZSBzbyBtYWlsIGdvZXNcbiAgICAvLyBvdXQgdGhyb3VnaCBTRVMgd2l0aCBvdXIgYnJhbmRlZCBGcm9tIGFkZHJlc3MuXG4gICAgY29uc3QgZW1haWxDb25maWd1cmF0aW9uOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHByb3BzLnNlc1xuICAgICAgPyB7XG4gICAgICAgICAgRW1haWxTZW5kaW5nQWNjb3VudDogXCJERVZFTE9QRVJcIixcbiAgICAgICAgICBTb3VyY2VBcm46IHByb3BzLnNlcy5zb3VyY2VBcm4sXG4gICAgICAgICAgRnJvbTogcHJvcHMuc2VzLmZyb21OYW1lXG4gICAgICAgICAgICA/IGAke3Byb3BzLnNlcy5mcm9tTmFtZX0gPCR7cHJvcHMuc2VzLmZyb21BZGRyZXNzfT5gXG4gICAgICAgICAgICA6IHByb3BzLnNlcy5mcm9tQWRkcmVzcyxcbiAgICAgICAgICAuLi4ocHJvcHMuc2VzLnJlcGx5VG9FbWFpbEFkZHJlc3NcbiAgICAgICAgICAgID8geyBSZXBseVRvRW1haWxBZGRyZXNzOiBwcm9wcy5zZXMucmVwbHlUb0VtYWlsQWRkcmVzcyB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgfVxuICAgICAgOiB7IEVtYWlsU2VuZGluZ0FjY291bnQ6IFwiQ09HTklUT19ERUZBVUxUXCIgfTtcblxuICAgIHRoaXMudXNlclBvb2wgPSBuZXcgYXdzX2NvZ25pdG8uVXNlclBvb2wodGhpcywgXCJ1c2VycG9vbFwiLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6IGAke2lkfS1hcHAtdXNlcnBvb2xgLFxuICAgICAgc2lnbkluQWxpYXNlczoge1xuICAgICAgICB1c2VybmFtZTogdHJ1ZSxcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgYWNjb3VudFJlY292ZXJ5OiBhd3NfY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSwgLy8gb3ZlcnJpZGRlbiBieSBhZGRPdmVycmlkZSBiZWxvdyB0byBpbmNsdWRlIGFkbWluX29ubHlcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxuICAgICAgZmVhdHVyZVBsYW46IGF3c19jb2duaXRvLkZlYXR1cmVQbGFuLlBMVVMsXG4gICAgICAvLyBhZHZhbmNlZFNlY3VyaXR5TW9kZSBpcyBkZXByZWNhdGVkLiBVc2UgU3RhbmRhcmRUaHJlYXRQcm90ZWN0aW9uTW9kZSBhbmQgQ3VzdG9tVGhyZWF0UHJvdGVjdGlvbk1vZGUgaW5zdGVhZC5cbiAgICAgIHN0YW5kYXJkVGhyZWF0UHJvdGVjdGlvbk1vZGU6IGF3c19jb2duaXRvLlN0YW5kYXJkVGhyZWF0UHJvdGVjdGlvbk1vZGUuRlVMTF9GVU5DVElPTixcbiAgICAgIC8vIGN1c3RvbVRocmVhdFByb3RlY3Rpb25Nb2RlOiBhd3NfY29nbml0by5DdXN0b21UaHJlYXRQcm90ZWN0aW9uTW9kZS5FTkFCTEVELCAvLyBVbmNvbW1lbnQgYW5kIGNvbmZpZ3VyZSBhcyBuZWVkZWRcbiAgICAgIGF1dG9WZXJpZnk6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgICByZXF1aXJlU3ltYm9sczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBQaW4gQUxMIFVzZXJQb29sIENsb3VkRm9ybWF0aW9uIHByb3BlcnRpZXMgdG8gZXhhY3RseSBtYXRjaCB0aGUgZGVwbG95ZWQgdGVtcGxhdGUuXG4gICAgLy8gQ29nbml0byByZWplY3RzIEFOWSBzY2hlbWEgZmllbGQgaW4gVXBkYXRlVXNlclBvb2wsIHNvIHdlIHByZXZlbnQgQ2xvdWRGb3JtYXRpb25cbiAgICAvLyBmcm9tIGV2ZXIgY2FsbGluZyBVcGRhdGVVc2VyUG9vbCBieSBlbnN1cmluZyB6ZXJvLWRpZmYgYmV0d2VlbiB0ZW1wbGF0ZXMsIHJlZ2FyZGxlc3NcbiAgICAvLyBvZiBDREsgdmVyc2lvbiBjaGFuZ2VzIHRoYXQgbWlnaHQgb3RoZXJ3aXNlIGFkZCBuZXcgZGVmYXVsdCBwcm9wZXJ0aWVzLlxuICAgIGNvbnN0IGNmblVzZXJQb29sID0gdGhpcy51c2VyUG9vbC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBhd3NfY29nbml0by5DZm5Vc2VyUG9vbDtcblxuICAgIGNmblVzZXJQb29sLmFkZE92ZXJyaWRlKFwiUHJvcGVydGllc1wiLCB7XG4gICAgICBBY2NvdW50UmVjb3ZlcnlTZXR0aW5nOiB7XG4gICAgICAgIFJlY292ZXJ5TWVjaGFuaXNtczogW1xuICAgICAgICAgIHsgTmFtZTogXCJ2ZXJpZmllZF9lbWFpbFwiLCBQcmlvcml0eTogMSB9LFxuICAgICAgICAgIC8vIENvZ25pdG8gcmVxdWlyZXMgYSBzZWNvbmQgcmVjb3ZlcnkgbWVjaGFuaXNtIHdoZW4gRU1BSUxfT1RQIE1GQSBpc1xuICAgICAgICAgIC8vIGVuYWJsZWQg4oCUIGFkbWluX29ubHkgY2Fubm90IGJlIGNvbWJpbmVkIHdpdGggb3RoZXJzLCBzbyB3ZSBhZGRcbiAgICAgICAgICAvLyB2ZXJpZmllZF9waG9uZV9udW1iZXIgYXMgUHJpb3JpdHkgMi4gVXNlcnMgd2hvIGhhdmVuJ3Qgc2V0IGEgcGhvbmVcbiAgICAgICAgICAvLyBudW1iZXIgc2ltcGx5IHdvbid0IHNlZSB0aGF0IHJlY292ZXJ5IG9wdGlvbi5cbiAgICAgICAgICB7IE5hbWU6IFwidmVyaWZpZWRfcGhvbmVfbnVtYmVyXCIsIFByaW9yaXR5OiAyIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgQWRtaW5DcmVhdGVVc2VyQ29uZmlnOiB7XG4gICAgICAgIEFsbG93QWRtaW5DcmVhdGVVc2VyT25seTogZmFsc2UsXG4gICAgICAgIEludml0ZU1lc3NhZ2VUZW1wbGF0ZToge1xuICAgICAgICAgIEVtYWlsU3ViamVjdDogaW52aXRlU3ViamVjdCxcbiAgICAgICAgICBFbWFpbE1lc3NhZ2U6IGludml0ZUh0bWwsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgQWxpYXNBdHRyaWJ1dGVzOiBbXCJlbWFpbFwiXSxcbiAgICAgIEF1dG9WZXJpZmllZEF0dHJpYnV0ZXM6IFtcImVtYWlsXCJdLFxuICAgICAgRW1haWxDb25maWd1cmF0aW9uOiBlbWFpbENvbmZpZ3VyYXRpb24sXG4gICAgICAvLyBNRkE6IG9wdGlvbmFsLCB1c2VyIGNhbiBlbnJvbGwgZW1haWwgT1RQLiBTTVNfTUZBIHJlbW92ZWQg4oCUIGl0IHJlcXVpcmVzXG4gICAgICAvLyBhbiBTbXNDb25maWd1cmF0aW9uIElBTSByb2xlL2V4dGVybmFsIElEIHdoaWNoIGFkZHMgb3BlcmF0aW9uYWwgb3ZlcmhlYWRcbiAgICAgIC8vIGFuZCBFTUFJTF9PVFAgY292ZXJzIHRoZSBzYW1lIHVzZSBjYXNlLlxuICAgICAgTWZhQ29uZmlndXJhdGlvbjogXCJPUFRJT05BTFwiLFxuICAgICAgRW5hYmxlZE1mYXM6IFtcIkVNQUlMX09UUFwiXSxcbiAgICAgIERldmljZUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgQ2hhbGxlbmdlUmVxdWlyZWRPbk5ld0RldmljZTogdHJ1ZSxcbiAgICAgICAgRGV2aWNlT25seVJlbWVtYmVyZWRPblVzZXJQcm9tcHQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgRW1haWxWZXJpZmljYXRpb25NZXNzYWdlOiBcIlRoZSB2ZXJpZmljYXRpb24gY29kZSB0byB5b3VyIG5ldyBhY2NvdW50IGlzIHsjIyMjfVwiLFxuICAgICAgRW1haWxWZXJpZmljYXRpb25TdWJqZWN0OiBcIlZlcmlmeSB5b3VyIG5ldyBhY2NvdW50XCIsXG4gICAgICBQb2xpY2llczogeyBQYXNzd29yZFBvbGljeTogeyBNaW5pbXVtTGVuZ3RoOiA4LCBSZXF1aXJlTnVtYmVyczogdHJ1ZSwgUmVxdWlyZVN5bWJvbHM6IHRydWUsIFJlcXVpcmVVcHBlcmNhc2U6IHRydWUgfSB9LFxuICAgICAgU2NoZW1hOiBbXG4gICAgICAgIHsgQXR0cmlidXRlRGF0YVR5cGU6IFwiU3RyaW5nXCIsIE11dGFibGU6IHRydWUsIE5hbWU6IFwib3JnYW5pemF0aW9uXCIgfSxcbiAgICAgICAgeyBBdHRyaWJ1dGVEYXRhVHlwZTogXCJTdHJpbmdcIiwgTXV0YWJsZTogdHJ1ZSwgTmFtZTogXCJ0aGVtZVwiIH0sXG4gICAgICBdLFxuICAgICAgVXNlclBvb2xBZGRPbnM6IHsgQWR2YW5jZWRTZWN1cml0eU1vZGU6IFwiRU5GT1JDRURcIiB9LFxuICAgICAgVXNlclBvb2xOYW1lOiBgJHtpZH0tYXBwLXVzZXJwb29sYCxcbiAgICAgIFZlcmlmaWNhdGlvbk1lc3NhZ2VUZW1wbGF0ZToge1xuICAgICAgICBEZWZhdWx0RW1haWxPcHRpb246IFwiQ09ORklSTV9XSVRIX0NPREVcIixcbiAgICAgICAgRW1haWxNZXNzYWdlOiBcIlRoZSB2ZXJpZmljYXRpb24gY29kZSB0byB5b3VyIG5ldyBhY2NvdW50IGlzIHsjIyMjfVwiLFxuICAgICAgICBFbWFpbFN1YmplY3Q6IFwiVmVyaWZ5IHlvdXIgbmV3IGFjY291bnRcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBjZGstbmFnIENPRzggY2hlY2tzIHRoZSBMMSBgdXNlclBvb2xUaWVyYCBmaWVsZCBkaXJlY3RseS5cbiAgICBjZm5Vc2VyUG9vbC51c2VyUG9vbFRpZXIgPSBhd3NfY29nbml0by5GZWF0dXJlUGxhbi5QTFVTO1xuXG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSB0aGlzLnVzZXJQb29sLmFkZENsaWVudChcIndlYmFwcENsaWVudFwiLCB7XG4gICAgICBhdXRoRmxvd3M6IHtcbiAgICAgICAgdXNlclNycDogdHJ1ZSxcbiAgICAgICAgYWRtaW5Vc2VyUGFzc3dvcmQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgcHJldmVudFVzZXJFeGlzdGVuY2VFcnJvcnM6IHRydWUsXG4gICAgICByZWZyZXNoVG9rZW5WYWxpZGl0eTogcHJvcHMucmVmcmVzaFRva2VuVmFsaWRpdHksXG4gICAgICByZWFkQXR0cmlidXRlczogbmV3IGF3c19jb2duaXRvLkNsaWVudEF0dHJpYnV0ZXMoKVxuICAgICAgICAud2l0aFN0YW5kYXJkQXR0cmlidXRlcyh7XG4gICAgICAgICAgYWRkcmVzczogdHJ1ZSxcbiAgICAgICAgICBlbWFpbDogdHJ1ZSxcbiAgICAgICAgICBmYW1pbHlOYW1lOiB0cnVlLFxuICAgICAgICAgIGdlbmRlcjogdHJ1ZSxcbiAgICAgICAgICBnaXZlbk5hbWU6IHRydWUsXG4gICAgICAgICAgbG9jYWxlOiB0cnVlLFxuICAgICAgICAgIG5pY2tuYW1lOiB0cnVlLFxuICAgICAgICAgIHBob25lTnVtYmVyOiB0cnVlLFxuICAgICAgICAgIHdlYnNpdGU6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICAgIC53aXRoQ3VzdG9tQXR0cmlidXRlcyhcIm9yZ2FuaXphdGlvblwiLCBcInRoZW1lXCIpLFxuICAgICAgd3JpdGVBdHRyaWJ1dGVzOiBuZXcgYXdzX2NvZ25pdG8uQ2xpZW50QXR0cmlidXRlcygpXG4gICAgICAgIC53aXRoU3RhbmRhcmRBdHRyaWJ1dGVzKHtcbiAgICAgICAgICBhZGRyZXNzOiB0cnVlLFxuICAgICAgICAgIGZhbWlseU5hbWU6IHRydWUsXG4gICAgICAgICAgZ2VuZGVyOiB0cnVlLFxuICAgICAgICAgIGdpdmVuTmFtZTogdHJ1ZSxcbiAgICAgICAgICBsb2NhbGU6IHRydWUsXG4gICAgICAgICAgbmlja25hbWU6IHRydWUsXG4gICAgICAgICAgcGhvbmVOdW1iZXI6IHRydWUsXG4gICAgICAgICAgd2Vic2l0ZTogdHJ1ZSxcbiAgICAgICAgfSlcbiAgICAgICAgLndpdGhDdXN0b21BdHRyaWJ1dGVzKFwib3JnYW5pemF0aW9uXCIsIFwidGhlbWVcIiksXG4gICAgfSk7XG5cbiAgICBjb25zdCBpZGVudGl0eVBvb2wgPSBuZXcgSWRlbnRpdHlQb29sKHRoaXMsIFwiaWRlbnRpdHlQb29sXCIsIHtcbiAgICAgIGFsbG93VW5hdXRoZW50aWNhdGVkSWRlbnRpdGllczogZmFsc2UsXG4gICAgICBhdXRoZW50aWNhdGlvblByb3ZpZGVyczoge1xuICAgICAgICB1c2VyUG9vbHM6IFtcbiAgICAgICAgICBuZXcgVXNlclBvb2xBdXRoZW50aWNhdGlvblByb3ZpZGVyKHtcbiAgICAgICAgICAgIHVzZXJQb29sOiB0aGlzLnVzZXJQb29sLFxuICAgICAgICAgICAgdXNlclBvb2xDbGllbnQsXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hdXRoZW50aWNhdGVkUm9sZSA9IGlkZW50aXR5UG9vbC5hdXRoZW50aWNhdGVkUm9sZTtcblxuICAgIG5ldyBDcmVhdGVQb29sVXNlcih0aGlzLCBcImFkbWluLXVzZXJcIiwge1xuICAgICAgZW1haWw6IHByb3BzLmFkbWluRW1haWwsXG4gICAgICB1c2VybmFtZTogcHJvcHMudXNlck5hbWUsXG4gICAgICB1c2VyUG9vbDogdGhpcy51c2VyUG9vbCxcbiAgICB9KTtcblxuICAgIHRoaXMuY29nbml0b1BhcmFtcyA9IHtcbiAgICAgIHVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIHVzZXJQb29sQ2xpZW50SWQ6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBpZGVudGl0eVBvb2xJZDogaWRlbnRpdHlQb29sLmlkZW50aXR5UG9vbElkLFxuICAgIH07XG5cbiAgICBuZXcgQ2ZuT3V0cHV0KHRoaXMsIFwiVXNlclBvb2xJZFwiLCB7XG4gICAgICB2YWx1ZTogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgIH0pO1xuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJVc2VyUG9vbENsaWVudElkXCIsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgIH0pO1xuICAgIG5ldyBDZm5PdXRwdXQodGhpcywgXCJJZGVudGl0eVBvb2xJZFwiLCB7XG4gICAgICB2YWx1ZTogaWRlbnRpdHlQb29sLmlkZW50aXR5UG9vbElkLFxuICAgIH0pO1xuXG4gICAgLy8gU3VwcHJlc3Npb25zXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFJlc291cmNlU3VwcHJlc3Npb25zKHRoaXMudXNlclBvb2wsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6IFwiQXdzU29sdXRpb25zLUNPRzJcIixcbiAgICAgICAgcmVhc29uOiBcIk5vIG5lZWQgTUZBIGZvciBzYW1wbGVcIixcbiAgICAgIH0sXG4gICAgXSk7XG5cbiAgICAvLyDilIDilIDilIAgQ29nbml0byBHcm91cHMgKHJvbGVzKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICBjb25zdCBhZG1pbkdyb3VwID0gbmV3IGF3c19jb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgXCJBZG1pbkdyb3VwXCIsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGdyb3VwTmFtZTogXCJBZG1pblwiLFxuICAgICAgZGVzY3JpcHRpb246IFwiRnVsbCBhY2Nlc3Mg4oCUIGNhbiBtdXRhdGUgZGF0YSwgbWFuYWdlIHVzZXJzLCBhbmQgdmlldyBtb25pdG9yaW5nXCIsXG4gICAgICBwcmVjZWRlbmNlOiAwLFxuICAgIH0pO1xuXG4gICAgLy8gTWVtYmVyc2hpcCBBZG1pbiDigJQgY2FuIGludml0ZSBuZXcgbWVtYmVycyBhbmQgbWFuYWdlIHRoZSBtZW1iZXJzXG4gICAgLy8gZGlyZWN0b3J5IGJ1dCBkb2VzIG5vdCBnZXQgc3lzdGVtLWFkbWluaXN0cmF0aW9uIHByaXZpbGVnZXMuXG4gICAgbmV3IGF3c19jb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgXCJNZW1iZXJzaGlwQWRtaW5Hcm91cFwiLCB7XG4gICAgICB1c2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBncm91cE5hbWU6IFwiTWVtYmVyc2hpcEFkbWluXCIsXG4gICAgICBkZXNjcmlwdGlvbjpcbiAgICAgICAgXCJDYW4gaW52aXRlIGFuZCBtYW5hZ2UgbWVtYmVycyAobm8gc3lzdGVtLWFkbWluIHByaXZpbGVnZXMpXCIsXG4gICAgICBwcmVjZWRlbmNlOiA1LFxuICAgIH0pO1xuXG4gICAgbmV3IGF3c19jb2duaXRvLkNmblVzZXJQb29sR3JvdXAodGhpcywgXCJFZGl0b3JHcm91cFwiLCB7XG4gICAgICB1c2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBncm91cE5hbWU6IFwiRWRpdG9yXCIsXG4gICAgICBkZXNjcmlwdGlvbjogXCJDYW4gYWRkIGFuZCBtb2RpZnkgZ3JhcGggZGF0YVwiLFxuICAgICAgcHJlY2VkZW5jZTogMTAsXG4gICAgfSk7XG5cbiAgICBuZXcgYXdzX2NvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCBcIlZpZXdlckdyb3VwXCIsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGdyb3VwTmFtZTogXCJWaWV3ZXJcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlJlYWQtb25seSBhY2Nlc3MgdG8gZGFzaGJvYXJkcyBhbmQgZ3JhcGggdmlzdWFsaXphdGlvblwiLFxuICAgICAgcHJlY2VkZW5jZTogMjAsXG4gICAgfSk7XG5cbiAgICAvLyBNZW1iZXIgZ3JvdXAg4oCUIHNlY3VyaXR5IGV4ZWN1dGl2ZXMgdXNpbmcgdGhlIG5ldHdvcmtpbmcgZmVhdHVyZXMuXG4gICAgLy8gRGVmYXVsdCBncm91cCBmb3IgUG9zdENvbmZpcm1hdGlvbi1hc3NpZ25lZCB1c2Vycy5cbiAgICBuZXcgYXdzX2NvZ25pdG8uQ2ZuVXNlclBvb2xHcm91cCh0aGlzLCBcIk1lbWJlckdyb3VwXCIsIHtcbiAgICAgIHVzZXJQb29sSWQ6IHRoaXMudXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIGdyb3VwTmFtZTogXCJNZW1iZXJcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIlNvY2lhbCBBY3RpdmUgQXBwIG1lbWJlciDigJQgZmVlZCwgZXZlbnRzLCB2ZW5kb3JzLCBtZW1iZXJzIGRpcmVjdG9yeVwiLFxuICAgICAgcHJlY2VkZW5jZTogMzAsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgdGhlIGluaXRpYWwgYWRtaW4gdXNlciB0byB0aGUgQWRtaW4gZ3JvdXBcbiAgICBjb25zdCBhZG1pbkdyb3VwTWVtYmVyc2hpcCA9IG5ldyBBd3NDdXN0b21SZXNvdXJjZSh0aGlzLCBcIkFkbWluR3JvdXBNZW1iZXJzaGlwXCIsIHtcbiAgICAgIG9uQ3JlYXRlOiB7XG4gICAgICAgIHNlcnZpY2U6IFwiQ29nbml0b0lkZW50aXR5U2VydmljZVByb3ZpZGVyXCIsXG4gICAgICAgIGFjdGlvbjogXCJhZG1pbkFkZFVzZXJUb0dyb3VwXCIsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBVc2VyUG9vbElkOiB0aGlzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgVXNlcm5hbWU6IHByb3BzLnVzZXJOYW1lLFxuICAgICAgICAgIEdyb3VwTmFtZTogXCJBZG1pblwiLFxuICAgICAgICB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IFBoeXNpY2FsUmVzb3VyY2VJZC5vZihcbiAgICAgICAgICBgQWRtaW5Hcm91cE1lbWJlcnNoaXAtJHtwcm9wcy51c2VyTmFtZX1gXG4gICAgICAgICksXG4gICAgICB9LFxuICAgICAgb25EZWxldGU6IHtcbiAgICAgICAgc2VydmljZTogXCJDb2duaXRvSWRlbnRpdHlTZXJ2aWNlUHJvdmlkZXJcIixcbiAgICAgICAgYWN0aW9uOiBcImFkbWluUmVtb3ZlVXNlckZyb21Hcm91cFwiLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgVXNlclBvb2xJZDogdGhpcy51c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgICAgIFVzZXJuYW1lOiBwcm9wcy51c2VyTmFtZSxcbiAgICAgICAgICBHcm91cE5hbWU6IFwiQWRtaW5cIixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwb2xpY3k6IEF3c0N1c3RvbVJlc291cmNlUG9saWN5LmZyb21TdGF0ZW1lbnRzKFtcbiAgICAgICAgbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICBcImNvZ25pdG8taWRwOkFkbWluQWRkVXNlclRvR3JvdXBcIixcbiAgICAgICAgICAgIFwiY29nbml0by1pZHA6QWRtaW5SZW1vdmVVc2VyRnJvbUdyb3VwXCIsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnVzZXJQb29sLnVzZXJQb29sQXJuXSxcbiAgICAgICAgfSksXG4gICAgICBdKSxcbiAgICB9KTtcbiAgICBhZG1pbkdyb3VwTWVtYmVyc2hpcC5ub2RlLmFkZERlcGVuZGVuY3koYWRtaW5Hcm91cCk7XG4gIH1cbn1cblxuY2xhc3MgQ3JlYXRlUG9vbFVzZXIgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICBwdWJsaWMgcmVhZG9ubHkgdXNlcm5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgY29uc3RydWN0b3IoXG4gICAgc2NvcGU6IENvbnN0cnVjdCxcbiAgICBpZDogc3RyaW5nLFxuICAgIHByb3BzOiB7XG4gICAgICB1c2VyUG9vbDogYXdzX2NvZ25pdG8uSVVzZXJQb29sO1xuICAgICAgdXNlcm5hbWU6IHN0cmluZztcbiAgICAgIGVtYWlsOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgfVxuICApIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgY29uc3Qgc3RhdGVtZW50ID0gbmV3IGF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFtcImNvZ25pdG8taWRwOkFkbWluRGVsZXRlVXNlclwiLCBcImNvZ25pdG8taWRwOkFkbWluQ3JlYXRlVXNlclwiXSxcbiAgICAgIHJlc291cmNlczogW3Byb3BzLnVzZXJQb29sLnVzZXJQb29sQXJuXSxcbiAgICB9KTtcblxuICAgIG5ldyBBd3NDdXN0b21SZXNvdXJjZSh0aGlzLCBgQ3JlYXRlVXNlci0ke2lkfWAsIHtcbiAgICAgIG9uQ3JlYXRlOiB7XG4gICAgICAgIHNlcnZpY2U6IFwiQ29nbml0b0lkZW50aXR5U2VydmljZVByb3ZpZGVyXCIsXG4gICAgICAgIGFjdGlvbjogXCJhZG1pbkNyZWF0ZVVzZXJcIixcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIFVzZXJQb29sSWQ6IHByb3BzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgVXNlcm5hbWU6IHByb3BzLnVzZXJuYW1lLFxuICAgICAgICAgIFVzZXJBdHRyaWJ1dGVzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIE5hbWU6IFwiZW1haWxcIixcbiAgICAgICAgICAgICAgVmFsdWU6IHByb3BzLmVtYWlsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgTmFtZTogXCJlbWFpbF92ZXJpZmllZFwiLFxuICAgICAgICAgICAgICBWYWx1ZTogXCJ0cnVlXCIsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogUGh5c2ljYWxSZXNvdXJjZUlkLm9mKFxuICAgICAgICAgIGBDcmVhdGVVc2VyLSR7aWR9LSR7cHJvcHMudXNlcm5hbWV9YFxuICAgICAgICApLFxuICAgICAgfSxcbiAgICAgIG9uRGVsZXRlOiB7XG4gICAgICAgIHNlcnZpY2U6IFwiQ29nbml0b0lkZW50aXR5U2VydmljZVByb3ZpZGVyXCIsXG4gICAgICAgIGFjdGlvbjogXCJhZG1pbkRlbGV0ZVVzZXJcIixcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIFVzZXJQb29sSWQ6IHByb3BzLnVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgICAgVXNlcm5hbWU6IHByb3BzLnVzZXJuYW1lLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVN0YXRlbWVudHMoW3N0YXRlbWVudF0pLFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogUmVuZGVyIHRoZSBIVE1MIGJvZHkgb2YgdGhlIENvZ25pdG8gYWRtaW4tY3JlYXRlZC11c2VyIGludml0YXRpb24gZW1haWwuXG4gKiBge3VzZXJuYW1lfWAgYW5kIGB7IyMjI31gIGFyZSBDb2duaXRvLXByb3ZpZGVkIHBsYWNlaG9sZGVycyB0aGF0IGFyZVxuICogc3Vic3RpdHV0ZWQgYnkgdGhlIHNlcnZpY2UgYmVmb3JlIHRoZSBtZXNzYWdlIGlzIHNlbnQuXG4gKi9cbmZ1bmN0aW9uIHJlbmRlckludml0ZUVtYWlsSHRtbChzaWduSW5Vcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBgPCFkb2N0eXBlIGh0bWw+XG48aHRtbD5cbiAgPGJvZHkgc3R5bGU9XCJtYXJnaW46MDtwYWRkaW5nOjA7YmFja2dyb3VuZDojZjRmMmVlO2ZvbnQtZmFtaWx5Oi1hcHBsZS1zeXN0ZW0sQmxpbmtNYWNTeXN0ZW1Gb250LCdTZWdvZSBVSScsSW50ZXIsSGVsdmV0aWNhLEFyaWFsLHNhbnMtc2VyaWY7Y29sb3I6IzFmMjkzNztcIj5cbiAgICA8dGFibGUgcm9sZT1cInByZXNlbnRhdGlvblwiIHdpZHRoPVwiMTAwJVwiIGNlbGxzcGFjaW5nPVwiMFwiIGNlbGxwYWRkaW5nPVwiMFwiIHN0eWxlPVwicGFkZGluZzozMnB4IDE2cHg7YmFja2dyb3VuZDojZjRmMmVlO1wiPlxuICAgICAgPHRyPlxuICAgICAgICA8dGQgYWxpZ249XCJjZW50ZXJcIj5cbiAgICAgICAgICA8dGFibGUgcm9sZT1cInByZXNlbnRhdGlvblwiIHdpZHRoPVwiNTYwXCIgY2VsbHNwYWNpbmc9XCIwXCIgY2VsbHBhZGRpbmc9XCIwXCIgc3R5bGU9XCJtYXgtd2lkdGg6NTYwcHg7YmFja2dyb3VuZDojZmZmZmZmO2JvcmRlcjoxcHggc29saWQgI2U1ZTdlYjtib3JkZXItcmFkaXVzOjEycHg7b3ZlcmZsb3c6aGlkZGVuO1wiPlxuICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICA8dGQgc3R5bGU9XCJwYWRkaW5nOjMycHggMzJweCAyNHB4O2JvcmRlci1ib3R0b206MXB4IHNvbGlkICNmM2Y0ZjY7XCI+XG4gICAgICAgICAgICAgICAgPGRpdiBzdHlsZT1cImZvbnQtc2l6ZToxMnB4O2xldHRlci1zcGFjaW5nOjAuMTRlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7Y29sb3I6IzZiNzI4MDtcIj5Tb2NpYWwgQWN0aXZlIEFwcDwvZGl2PlxuICAgICAgICAgICAgICAgIDxoMSBzdHlsZT1cIm1hcmdpbjo4cHggMCAwO2ZvbnQtc2l6ZToyMnB4O2ZvbnQtd2VpZ2h0OjYwMDtjb2xvcjojMTExODI3O2xpbmUtaGVpZ2h0OjEuMztcIj5XZWxjb21lIHRvIFNvY2lhbCBBY3RpdmUgQXBwPC9oMT5cbiAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInBhZGRpbmc6MjhweCAzMnB4O2ZvbnQtc2l6ZToxNXB4O2xpbmUtaGVpZ2h0OjEuNjtjb2xvcjojMWYyOTM3O1wiPlxuICAgICAgICAgICAgICAgIDxwIHN0eWxlPVwibWFyZ2luOjAgMCAxNnB4O1wiPllvdSd2ZSBiZWVuIGludml0ZWQgdG8gam9pbiBTb2NpYWwgQWN0aXZlIEFwcCAmbWRhc2g7IGEgY3VyYXRlZCBjb21tdW5pdHkgb2Ygb3V0ZG9vciBhZHZlbnR1cmVycy48L3A+XG4gICAgICAgICAgICAgICAgPHAgc3R5bGU9XCJtYXJnaW46MCAwIDE2cHg7XCI+VXNlIHRoZSBjcmVkZW50aWFscyBiZWxvdyB0byBzaWduIGluLiBZb3UnbGwgYmUgcHJvbXB0ZWQgdG8gY2hvb3NlIHlvdXIgb3duIHBhc3N3b3JkIG9uIGZpcnN0IGxvZ2luLjwvcD5cbiAgICAgICAgICAgICAgICA8dGFibGUgcm9sZT1cInByZXNlbnRhdGlvblwiIHdpZHRoPVwiMTAwJVwiIGNlbGxzcGFjaW5nPVwiMFwiIGNlbGxwYWRkaW5nPVwiMFwiIHN0eWxlPVwiYmFja2dyb3VuZDojZjlmYWZiO2JvcmRlcjoxcHggc29saWQgI2U1ZTdlYjtib3JkZXItcmFkaXVzOjhweDttYXJnaW46NHB4IDAgMjRweDtcIj5cbiAgICAgICAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzoxNnB4IDIwcHg7Zm9udC1mYW1pbHk6dWktbW9ub3NwYWNlLFNGTW9uby1SZWd1bGFyLE1lbmxvLENvbnNvbGFzLG1vbm9zcGFjZTtmb250LXNpemU6MTRweDtjb2xvcjojMTExODI3O1wiPlxuICAgICAgICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJjb2xvcjojNmI3MjgwO2ZvbnQtc2l6ZToxMXB4O2xldHRlci1zcGFjaW5nOjAuMDhlbTt0ZXh0LXRyYW5zZm9ybTp1cHBlcmNhc2U7XCI+VXNlcm5hbWU8L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICA8ZGl2IHN0eWxlPVwibWFyZ2luLXRvcDo0cHg7XCI+e3VzZXJuYW1lfTwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjE0cHg7Y29sb3I6IzZiNzI4MDtmb250LXNpemU6MTFweDtsZXR0ZXItc3BhY2luZzowLjA4ZW07dGV4dC10cmFuc2Zvcm06dXBwZXJjYXNlO1wiPlRlbXBvcmFyeSBwYXNzd29yZDwvZGl2PlxuICAgICAgICAgICAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJtYXJnaW4tdG9wOjRweDtcIj57IyMjI308L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgICAgICAgPC90YWJsZT5cbiAgICAgICAgICAgICAgICA8cCBzdHlsZT1cIm1hcmdpbjowIDAgMjRweDt0ZXh0LWFsaWduOmNlbnRlcjtcIj5cbiAgICAgICAgICAgICAgICAgIDxhIGhyZWY9XCIke3NpZ25JblVybH1cIiBzdHlsZT1cImRpc3BsYXk6aW5saW5lLWJsb2NrO2JhY2tncm91bmQ6IzBhNjZjMjtjb2xvcjojZmZmZmZmO3RleHQtZGVjb3JhdGlvbjpub25lO3BhZGRpbmc6MTJweCAyNHB4O2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtd2VpZ2h0OjYwMDtmb250LXNpemU6MTRweDtcIj5TaWduIGluIGFuZCBzZXQgeW91ciBwYXNzd29yZDwvYT5cbiAgICAgICAgICAgICAgICA8L3A+XG4gICAgICAgICAgICAgICAgPHAgc3R5bGU9XCJtYXJnaW46MCAwIDhweDtmb250LXNpemU6MTNweDtjb2xvcjojNmI3MjgwO1wiPkhhdmluZyB0cm91YmxlIHdpdGggdGhlIGJ1dHRvbj8gT3BlbiB0aGlzIGxpbmsgaW4geW91ciBicm93c2VyOjwvcD5cbiAgICAgICAgICAgICAgICA8cCBzdHlsZT1cIm1hcmdpbjowIDAgMjRweDtmb250LXNpemU6MTNweDt3b3JkLWJyZWFrOmJyZWFrLWFsbDtcIj48YSBocmVmPVwiJHtzaWduSW5Vcmx9XCIgc3R5bGU9XCJjb2xvcjojMGE2NmMyO3RleHQtZGVjb3JhdGlvbjpub25lO1wiPiR7c2lnbkluVXJsfTwvYT48L3A+XG4gICAgICAgICAgICAgICAgPHAgc3R5bGU9XCJtYXJnaW46MDtmb250LXNpemU6MTNweDtjb2xvcjojNmI3MjgwO1wiPlRoaXMgaW52aXRhdGlvbiBpcyBwZXJzb25hbCAmbWRhc2g7IHBsZWFzZSBkb24ndCBmb3J3YXJkIGl0LiBJZiB5b3Ugd2VyZW4ndCBleHBlY3RpbmcgaXQsIHlvdSBjYW4gc2FmZWx5IGlnbm9yZSB0aGlzIG1lc3NhZ2UuPC9wPlxuICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzoyMHB4IDMycHg7YmFja2dyb3VuZDojZjlmYWZiO2JvcmRlci10b3A6MXB4IHNvbGlkICNmM2Y0ZjY7Zm9udC1zaXplOjEycHg7Y29sb3I6IzljYTNhZjtcIj5cbiAgICAgICAgICAgICAgICBTb2NpYWwgQWN0aXZlIEFwcFxuICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICA8L3RkPlxuICAgICAgPC90cj5cbiAgICA8L3RhYmxlPlxuICA8L2JvZHk+XG48L2h0bWw+YDtcbn1cbiJdfQ==