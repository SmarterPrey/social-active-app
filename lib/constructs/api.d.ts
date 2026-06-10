import { aws_ec2, aws_iam, aws_s3, aws_sqs, aws_secretsmanager } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { Cognito } from "./cognito";
export interface BackendApiProps {
    schema: string;
    cognito: Cognito;
    vpc: aws_ec2.Vpc;
    cluster: neptune.DatabaseCluster;
    clusterRole: aws_iam.Role;
    graphqlFieldName: string[];
    s3Uri: S3Uri;
    /** Optional: media bucket for event video / profile photo uploads. */
    mediaBucket?: aws_s3.IBucket;
    /** Optional: RSVP invite queue. */
    rsvpQueue?: aws_sqs.IQueue;
    /** Optional: Secrets Manager secret holding the RSVP HMAC signing key. */
    rsvpSigningSecret?: aws_secretsmanager.ISecret;
}
export type S3Uri = {
    vertex: string;
    edge: string;
};
export declare class Api extends Construct {
    readonly graphqlUrl: string;
    readonly graphqlApiId: string;
    readonly lambdaFunctionNames: Record<string, string>;
    constructor(scope: Construct, id: string, props: BackendApiProps);
}
