import { Stack, StackProps, Duration, CfnOutput, aws_ec2, aws_iam } from "aws-cdk-lib";
import { Construct } from "constructs";

import { Cognito } from "./constructs/cognito";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { Api, S3Uri } from "./constructs/api";
import { Media } from "./constructs/media";
import { Rsvp } from "./constructs/rsvp";
import * as path from "path";

interface ApiStackProps extends StackProps {
  cognito: {
    adminEmail: string;
    userName?: string;
    /** Public sign-in URL used in the invitation email. */
    appSignInUrl?: string;
    /** Verified SES sender config — lifts Cognito's sandbox limits. */
    ses?: {
      sourceArn: string;
      fromAddress: string;
      fromName?: string;
      replyToEmailAddress?: string;
    };
  };
  vpc: aws_ec2.Vpc;
  cluster: neptune.DatabaseCluster;
  clusterRole: aws_iam.Role;
  graphqlFieldName: string[];
  s3Uri: S3Uri;
  /** Optional: enable the RSVP invite pipeline (SES + SQS). */
  rsvp?: {
    fromAddress: string;
    rsvpBaseUrl: string;
  };
}

export class ApiStack extends Stack {
  public readonly cognito: Cognito;
  public readonly graphqlUrl: string;
  public readonly graphqlApiId: string;
  public readonly lambdaFunctionNames: Record<string, string>;
  public readonly media: Media;
  public readonly rsvp?: Rsvp;
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    const { cognito, vpc, cluster, clusterRole, graphqlFieldName, s3Uri } =
      props;
    super(scope, id, props);
    this.cognito = new Cognito(this, "cognito", {
      adminEmail: cognito.adminEmail,
      userName: cognito.userName,
      appSignInUrl: cognito.appSignInUrl,
      ses: cognito.ses,
      refreshTokenValidity: Duration.days(1),
    });
    this.media = new Media(this, "media");
    if (props.rsvp) {
      this.rsvp = new Rsvp(this, "rsvp", {
        fromAddress: props.rsvp.fromAddress,
        rsvpBaseUrl: props.rsvp.rsvpBaseUrl,
      });
    }
    const api = new Api(this, "api", {
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
    new CfnOutput(this, "deployAccount", { value: this.account });
    new CfnOutput(this, "deployRegion", { value: this.region });
    new CfnOutput(this, "deployStage", {
      value: this.node.tryGetContext("stage") ?? "dev",
    });
  }
}
