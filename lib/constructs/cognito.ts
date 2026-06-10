import { Construct } from "constructs";
import {
  Duration,
  RemovalPolicy,
  aws_cognito,
  aws_iam,
  CfnOutput,
} from "aws-cdk-lib";

import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from "aws-cdk-lib/aws-cognito-identitypool";
import { NagSuppressions } from "cdk-nag";

export interface CognitoProps {
  adminEmail: string;
  userName?: string;
  refreshTokenValidity?: Duration;
  /**
   * Absolute URL of the web app's sign-in page.
   * Used in the invitation email link (e.g. https://app.mucker.io/signin).
   */
  appSignInUrl?: string;
  /**
   * When set, Cognito sends email via SES using this verified identity
   * (DEVELOPER mode). Without this, Cognito falls back to the default
   * AWS-managed sender which is sandbox-limited.
   */
  ses?: {
    /** ARN of a verified SES identity (domain or email). */
    sourceArn: string;
    /** From address Cognito emails are sent from (must match the identity). */
    fromAddress: string;
    /** Optional display name ("Social Active App") to show next to the address. */
    fromName?: string;
    /** Optional reply-to address surfaced in the email headers. */
    replyToEmailAddress?: string;
  };
}

export interface CognitoParams {
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
}

export class Cognito extends Construct {
  public readonly cognitoParams: CognitoParams;
  public readonly userPool: aws_cognito.UserPool;
  public readonly authenticatedRole: aws_iam.IRole;
  constructor(scope: Construct, id: string, props: CognitoProps) {
    super(scope, id);

    if (!props.userName) props.userName = props.adminEmail.split("@")[0];

    // Fallback sign-in URL. Callers should override via `appSignInUrl`.
    const signInUrl = props.appSignInUrl ?? "https://app.mucker.io/signin";
    const inviteHtml = renderInviteEmailHtml(signInUrl);
    const inviteSubject = "You're invited to Social Active App";

    // EmailConfiguration: default is Cognito-managed (sandboxy). If caller
    // passed a verified SES identity, switch to DEVELOPER mode so mail goes
    // out through SES with our branded From address.
    const emailConfiguration: Record<string, unknown> = props.ses
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

    this.userPool = new aws_cognito.UserPool(this, "userpool", {
      userPoolName: `${id}-app-userpool`,
      signInAliases: {
        username: true,
        email: true,
      },
      accountRecovery: aws_cognito.AccountRecovery.EMAIL_ONLY, // overridden by addOverride below to include admin_only
      removalPolicy: RemovalPolicy.DESTROY,
      selfSignUpEnabled: true,
      // advancedSecurityMode is deprecated. Use StandardThreatProtectionMode and CustomThreatProtectionMode instead.
      standardThreatProtectionMode: aws_cognito.StandardThreatProtectionMode.FULL_FUNCTION,
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
    (this.userPool.node.defaultChild as aws_cognito.CfnUserPool).addOverride("Properties", {
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
      readAttributes: new aws_cognito.ClientAttributes()
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
      writeAttributes: new aws_cognito.ClientAttributes()
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

    const identityPool = new IdentityPool(this, "identityPool", {
      allowUnauthenticatedIdentities: false,
      authenticationProviders: {
        userPools: [
          new UserPoolAuthenticationProvider({
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

    new CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
    });
    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, "IdentityPoolId", {
      value: identityPool.identityPoolId,
    });

    // Suppressions
    NagSuppressions.addResourceSuppressions(this.userPool, [
      {
        id: "AwsSolutions-COG2",
        reason: "No need MFA for sample",
      },
    ]);

    // ─── Cognito Groups (roles) ──────────────────────────────────────
    const adminGroup = new aws_cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Admin",
      description: "Full access — can mutate data, manage users, and view monitoring",
      precedence: 0,
    });

    // Membership Admin — can invite new members and manage the members
    // directory but does not get system-administration privileges.
    new aws_cognito.CfnUserPoolGroup(this, "MembershipAdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "MembershipAdmin",
      description:
        "Can invite and manage members (no system-admin privileges)",
      precedence: 5,
    });

    new aws_cognito.CfnUserPoolGroup(this, "EditorGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Editor",
      description: "Can add and modify graph data",
      precedence: 10,
    });

    new aws_cognito.CfnUserPoolGroup(this, "ViewerGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Viewer",
      description: "Read-only access to dashboards and graph visualization",
      precedence: 20,
    });

    // Member group — security executives using the networking features.
    // Default group for PostConfirmation-assigned users.
    new aws_cognito.CfnUserPoolGroup(this, "MemberGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "Member",
      description: "Social Active App member — feed, events, vendors, members directory",
      precedence: 30,
    });

    // Add the initial admin user to the Admin group
    const adminGroupMembership = new AwsCustomResource(this, "AdminGroupMembership", {
      onCreate: {
        service: "CognitoIdentityServiceProvider",
        action: "adminAddUserToGroup",
        parameters: {
          UserPoolId: this.userPool.userPoolId,
          Username: props.userName,
          GroupName: "Admin",
        },
        physicalResourceId: PhysicalResourceId.of(
          `AdminGroupMembership-${props.userName}`
        ),
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
      policy: AwsCustomResourcePolicy.fromStatements([
        new aws_iam.PolicyStatement({
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

class CreatePoolUser extends Construct {
  public readonly username: string | undefined;
  constructor(
    scope: Construct,
    id: string,
    props: {
      userPool: aws_cognito.IUserPool;
      username: string;
      email: string | undefined;
    }
  ) {
    super(scope, id);

    const statement = new aws_iam.PolicyStatement({
      actions: ["cognito-idp:AdminDeleteUser", "cognito-idp:AdminCreateUser"],
      resources: [props.userPool.userPoolArn],
    });

    new AwsCustomResource(this, `CreateUser-${id}`, {
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
        physicalResourceId: PhysicalResourceId.of(
          `CreateUser-${id}-${props.username}`
        ),
      },
      onDelete: {
        service: "CognitoIdentityServiceProvider",
        action: "adminDeleteUser",
        parameters: {
          UserPoolId: props.userPool.userPoolId,
          Username: props.username,
        },
      },
      policy: AwsCustomResourcePolicy.fromStatements([statement]),
    });
  }
}

/**
 * Render the HTML body of the Cognito admin-created-user invitation email.
 * `{username}` and `{####}` are Cognito-provided placeholders that are
 * substituted by the service before the message is sent.
 */
function renderInviteEmailHtml(signInUrl: string): string {
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
