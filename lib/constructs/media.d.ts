import { RemovalPolicy, aws_s3, aws_kms, aws_cloudfront } from "aws-cdk-lib";
import { Construct } from "constructs";
export interface MediaProps {
    /** Remove bucket + KMS key on stack destroy? (dev only) */
    removalPolicy?: RemovalPolicy;
    autoDeleteObjects?: boolean;
}
/**
 * KMS-encrypted S3 bucket for member/event media (event videos, vendor logos,
 * profile photos) fronted by CloudFront with Origin Access Control.
 *
 * The backend Lambda writes directly via presigned PUT URLs; members read via
 * the CloudFront domain.
 */
export declare class Media extends Construct {
    readonly bucket: aws_s3.Bucket;
    readonly key: aws_kms.Key;
    readonly distribution: aws_cloudfront.Distribution;
    constructor(scope: Construct, id: string, props?: MediaProps);
}
