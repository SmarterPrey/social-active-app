import { INagLogger, NagLoggerComplianceData, NagLoggerErrorData, NagLoggerNotApplicableData, NagLoggerSuppressedData, NagLoggerSuppressedErrorData } from "cdk-nag";
export declare class NagLogger implements INagLogger {
    onCompliance(data: NagLoggerComplianceData): void;
    onNonCompliance(data: NagLoggerComplianceData): void;
    onSuppressed(data: NagLoggerSuppressedData): void;
    onError(data: NagLoggerErrorData): void;
    onSuppressedError(data: NagLoggerSuppressedErrorData): void;
    onNotApplicable(data: NagLoggerNotApplicableData): void;
}
