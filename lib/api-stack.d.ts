import { Stack, StackProps, aws_ec2, aws_iam } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Cognito } from "./constructs/cognito";
import * as neptune from "@aws-cdk/aws-neptune-alpha";
import { S3Uri } from "./constructs/api";
import { Media } from "./constructs/media";
import { Rsvp } from "./constructs/rsvp";
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
export declare class ApiStack extends Stack {
    readonly cognito: Cognito;
    readonly graphqlUrl: string;
    readonly graphqlApiId: string;
    readonly lambdaFunctionNames: Record<string, string>;
    readonly media: Media;
    readonly rsvp?: Rsvp;
    constructor(scope: Construct, id: string, props: ApiStackProps);
}
export {};
