import {
  Duration,
  RemovalPolicy,
  Stack,
  aws_iam,
  aws_lambda,
  aws_lambda_nodejs,
  aws_lambda_event_sources,
  aws_sqs,
  aws_ses,
  aws_secretsmanager,
  CfnOutput,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface RsvpProps {
  /** Verified SES "from" address used for invites. */
  fromAddress: string;
  /** Public base URL (e.g. https://app.mucker.io) — RSVP links are built off this. */
  rsvpBaseUrl: string;
  removalPolicy?: RemovalPolicy;
}

/**
 * RSVP workflow:
 *  - social Lambda (mutation) signs a per-(member,event) HMAC token and pushes
 *    a message to an SQS queue.
 *  - `rsvpEmailerFn` consumes the queue and sends an SES email containing a
 *    one-click RSVP URL.
 *  - When the invitee clicks the URL, the webapp calls the public (API-key)
 *    `submitRsvp(token, response)` mutation; the mutation verifies the HMAC
 *    signature using the same secret and writes the Rsvp vertex.
 */
export class Rsvp extends Construct {
  public readonly queue: aws_sqs.Queue;
  public readonly signingSecret: aws_secretsmanager.Secret;
  public readonly emailerFn: aws_lambda_nodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: RsvpProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.RETAIN;

    // HMAC secret for signing / verifying RSVP tokens.
    this.signingSecret = new aws_secretsmanager.Secret(this, "signingSecret", {
      description: "HMAC secret for Social Active App RSVP token signing",
      generateSecretString: {
        passwordLength: 48,
        excludePunctuation: true,
      },
      removalPolicy,
    });

    // Dead-letter for the invite queue.
    const dlq = new aws_sqs.Queue(this, "dlq", {
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });

    this.queue = new aws_sqs.Queue(this, "queue", {
      enforceSSL: true,
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
    });

    // SES configuration set (so we can track bounces/complaints later).
    const configSet = new aws_ses.ConfigurationSet(this, "configSet", {
      sendingEnabled: true,
    });

    const role = new aws_iam.Role(this, "emailerRole", {
      assumedBy: new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole",
        ),
      ],
    });
    role.addToPolicy(
      new aws_iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      }),
    );

    this.emailerFn = new aws_lambda_nodejs.NodejsFunction(this, "emailerFn", {
      runtime: aws_lambda.Runtime.NODEJS_22_X,
      architecture: aws_lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      role,
      entry: "./api/lambda/rsvpEmailer.ts",
      depsLockFilePath: "./api/lambda/package-lock.json",
      environment: {
        RSVP_BASE_URL: props.rsvpBaseUrl,
        RSVP_FROM_ADDRESS: props.fromAddress,
        RSVP_CONFIG_SET: configSet.configurationSetName,
      },
      bundling: {
        nodeModules: ["@aws-sdk/client-sesv2"],
      },
    });

    this.emailerFn.addEventSource(
      new aws_lambda_event_sources.SqsEventSource(this.queue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );

    new CfnOutput(this, "RsvpQueueUrl", { value: this.queue.queueUrl });
    new CfnOutput(this, "RsvpSigningSecretArn", {
      value: this.signingSecret.secretArn,
    });

    NagSuppressions.addResourceSuppressions(
      role,
      [
        {
          id: "AwsSolutions-IAM4",
          reason: "Basic Lambda execution managed policy is sufficient.",
        },
        {
          id: "AwsSolutions-IAM5",
          reason:
            "SES SendEmail requires resource '*' — the from-address is validated on the API side.",
        },
      ],
      true,
    );
  }
}
