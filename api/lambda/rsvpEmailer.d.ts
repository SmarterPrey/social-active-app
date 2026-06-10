import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
export declare function handler(event: SQSEvent): Promise<SQSBatchResponse>;
