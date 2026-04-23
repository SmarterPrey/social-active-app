/**
 * AWS SDK client factory — uses Cognito Identity Pool credentials from
 * the current Amplify session so the browser can call CloudWatch, EC2,
 * and Neptune APIs directly (read-only).
 */
import { fetchAuthSession } from "aws-amplify/auth";
import {
  CloudWatchClient,
  GetMetricDataCommand,
  DescribeAlarmsCommand,
  type GetMetricDataCommandInput,
  type MetricDataQuery,
  type MetricDataResult,
  type CompositeAlarm,
  type MetricAlarm,
} from "@aws-sdk/client-cloudwatch";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeInstanceStatusCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  RunInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  SSMClient,
  GetParameterCommand,
  PutParameterCommand,
} from "@aws-sdk/client-ssm";
import {
  NeptuneClient,
  DescribeDBClustersCommand,
  StartDBClusterCommand,
  StopDBClusterCommand,
} from "@aws-sdk/client-neptune";

export type {
  MetricDataQuery,
  MetricDataResult,
  CompositeAlarm,
  MetricAlarm,
};

const REGION = import.meta.env.VITE_COGNITO_REGION || "us-east-1";

/** Fetch fresh AWS credentials from Amplify / Cognito Identity Pool */
async function getCredentials() {
  const session = await fetchAuthSession();
  if (!session.credentials) {
    throw new Error("No AWS credentials available — user may not be signed in.");
  }
  return session.credentials;
}

/** Re-usable client constructor that injects fresh credentials */
async function makeClient<T>(
  ClientClass: new (config: { region: string; credentials: any }) => T
): Promise<T> {
  const credentials = await getCredentials();
  return new ClientClass({ region: REGION, credentials });
}

// ─── CloudWatch helpers ────────────────────────────────────────────────

export async function getMetricData(
  queries: MetricDataQuery[],
  startTime: Date,
  endTime: Date
): Promise<MetricDataResult[]> {
  const cw = await makeClient(CloudWatchClient);
  const input: GetMetricDataCommandInput = {
    MetricDataQueries: queries,
    StartTime: startTime,
    EndTime: endTime,
    ScanBy: "TimestampAscending",
  };
  const resp = await cw.send(new GetMetricDataCommand(input));
  return resp.MetricDataResults ?? [];
}

export async function describeAlarms(): Promise<MetricAlarm[]> {
  const cw = await makeClient(CloudWatchClient);
  const resp = await cw.send(new DescribeAlarmsCommand({}));
  return resp.MetricAlarms ?? [];
}

// ─── EC2 helpers ───────────────────────────────────────────────────────

export interface EC2InstanceInfo {
  instanceId: string;
  name: string;
  state: string;
  instanceType: string;
  launchTime?: Date;
}

export async function describeInstances(
  instanceIds?: string[]
): Promise<EC2InstanceInfo[]> {
  const ec2 = await makeClient(EC2Client);
  const cmd = new DescribeInstancesCommand(
    instanceIds ? { InstanceIds: instanceIds } : {}
  );
  const resp = await ec2.send(cmd);
  const instances: EC2InstanceInfo[] = [];
  for (const reservation of resp.Reservations ?? []) {
    for (const inst of reservation.Instances ?? []) {
      instances.push({
        instanceId: inst.InstanceId ?? "unknown",
        name:
          inst.Tags?.find((t) => t.Key === "Name")?.Value ?? inst.InstanceId ?? "",
        state: inst.State?.Name ?? "unknown",
        instanceType: inst.InstanceType ?? "unknown",
        launchTime: inst.LaunchTime,
      });
    }
  }
  return instances;
}

export async function describeInstanceStatus(instanceIds: string[]) {
  const ec2 = await makeClient(EC2Client);
  const resp = await ec2.send(
    new DescribeInstanceStatusCommand({
      InstanceIds: instanceIds,
      IncludeAllInstances: true,
    })
  );
  return resp.InstanceStatuses ?? [];
}

export async function startInstance(instanceId: string): Promise<void> {
  const ec2 = await makeClient(EC2Client);
  await ec2.send(new StartInstancesCommand({ InstanceIds: [instanceId] }));
}

export async function stopInstance(instanceId: string): Promise<void> {
  const ec2 = await makeClient(EC2Client);
  await ec2.send(new StopInstancesCommand({ InstanceIds: [instanceId] }));
}

// ─── Neptune (via RDS) helpers ─────────────────────────────────────────

export interface NeptuneClusterInfo {
  clusterId: string;
  status: string;
  engine: string;
  engineVersion: string;
  endpoint: string;
  readerEndpoint: string;
  serverlessV2ScalingMin?: number;
  serverlessV2ScalingMax?: number;
}

export async function startNeptuneCluster(clusterId: string): Promise<void> {
  const neptune = await makeClient(NeptuneClient);
  await neptune.send(new StartDBClusterCommand({ DBClusterIdentifier: clusterId }));
}

export async function stopNeptuneCluster(clusterId: string): Promise<void> {
  const neptune = await makeClient(NeptuneClient);
  await neptune.send(new StopDBClusterCommand({ DBClusterIdentifier: clusterId }));
}

export async function describeNeptuneClusters(
  clusterIds?: string[]
): Promise<NeptuneClusterInfo[]> {
  const neptune = await makeClient(NeptuneClient);
  const cmd = new DescribeDBClustersCommand(
    clusterIds?.length ? { DBClusterIdentifier: clusterIds[0] } : {}
  );
  const resp = await neptune.send(cmd);
  return (resp.DBClusters ?? []).map((c) => ({
    clusterId: c.DBClusterIdentifier ?? "unknown",
    status: c.Status ?? "unknown",
    engine: c.Engine ?? "",
    engineVersion: c.EngineVersion ?? "",
    endpoint: c.Endpoint ?? "",
    readerEndpoint: c.ReaderEndpoint ?? "",
    serverlessV2ScalingMin:
      c.ServerlessV2ScalingConfiguration?.MinCapacity,
    serverlessV2ScalingMax:
      c.ServerlessV2ScalingConfiguration?.MaxCapacity,
  }));
}

// ─── SSM Parameter Store helpers ───────────────────────────────────────

export async function getSsmParameter(name: string): Promise<string | null> {
  const ssm = await makeClient(SSMClient);
  try {
    const resp = await ssm.send(new GetParameterCommand({ Name: name }));
    return resp.Parameter?.Value ?? null;
  } catch (e: any) {
    if (e.name === "ParameterNotFound") return null;
    throw e;
  }
}

export async function putSsmParameter(name: string, value: string): Promise<void> {
  const ssm = await makeClient(SSMClient);
  await ssm.send(
    new PutParameterCommand({ Name: name, Value: value, Type: "String", Overwrite: true })
  );
}

// ─── Bastion instance creation ─────────────────────────────────────────

const BASTION_PARAM_PREFIX = "/socialActiveApp/bastion";

/**
 * Reads the launch config from SSM, creates a new t3.nano bastion host,
 * stores the new instance ID back to SSM, and returns the new instance ID.
 */
export async function createBastionInstance(): Promise<string> {
  const [subnetId, securityGroupId, instanceProfileName, amiId] = await Promise.all([
    getSsmParameter(`${BASTION_PARAM_PREFIX}/subnet-id`),
    getSsmParameter(`${BASTION_PARAM_PREFIX}/security-group-id`),
    getSsmParameter(`${BASTION_PARAM_PREFIX}/instance-profile-name`),
    // Use the latest Amazon Linux 2023 AMI from the public SSM parameter
    getSsmParameter("/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"),
  ]);

  if (!subnetId || !securityGroupId || !instanceProfileName || !amiId) {
    throw new Error(
      "Missing bastion launch configuration in SSM Parameter Store. " +
      "Ensure the CDK stack has been deployed with bastion.enabled = true."
    );
  }

  const ec2 = await makeClient(EC2Client);
  const resp = await ec2.send(
    new RunInstancesCommand({
      ImageId: amiId,
      InstanceType: "t3.nano",
      MinCount: 1,
      MaxCount: 1,
      SubnetId: subnetId,
      SecurityGroupIds: [securityGroupId],
      IamInstanceProfile: { Name: instanceProfileName },
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: [{ Key: "Name", Value: "socialActiveApp-BastionHost" }],
        },
      ],
    })
  );

  const instanceId = resp.Instances?.[0]?.InstanceId;
  if (!instanceId) throw new Error("RunInstances did not return an instance ID.");

  await putSsmParameter(`${BASTION_PARAM_PREFIX}/instance-id`, instanceId);
  return instanceId;
}
