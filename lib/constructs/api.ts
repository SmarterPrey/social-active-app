import {
  Stack,
  Duration,
  Expiration,
  aws_ec2,
  aws_lambda_nodejs,
  aws_lambda,
  aws_iam,
  aws_s3,
  aws_sqs,
  aws_secretsmanager,
  CfnOutput,
} from "aws-cdk-lib";
import {
  ApiKeyConfig,
  AuthorizationType,
  Definition,
  FieldLogLevel,
  GraphqlApi,
  MappingTemplate,
  UserPoolDefaultAction,
} from "aws-cdk-lib/aws-appsync";
import { Construct } from "constructs";

import * as neptune from "@aws-cdk/aws-neptune-alpha";

import { NagSuppressions } from "cdk-nag";
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

export class Api extends Construct {
  readonly graphqlUrl: string;
  readonly graphqlApiId: string;
  readonly lambdaFunctionNames: Record<string, string>;

  constructor(scope: Construct, id: string, props: BackendApiProps) {
    super(scope, id);

    const { schema, vpc, cluster, clusterRole, graphqlFieldName, s3Uri } =
      props;

    // AWS AppSync
    const graphql = new GraphqlApi(this, "graphql", {
      name: id,
      definition: Definition.fromFile(schema),
      logConfig: {
        fieldLogLevel: FieldLogLevel.ERROR,
        role: new aws_iam.Role(this, "appsync-log-role", {
          assumedBy: new aws_iam.ServicePrincipal("appsync.amazonaws.com"),
          inlinePolicies: {
            logs: new aws_iam.PolicyDocument({
              statements: [
                new aws_iam.PolicyStatement({
                  actions: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                  ],
                  resources: [
                    `arn:aws:logs:${Stack.of(this).region}:${
                      Stack.of(this).account
                    }`,
                  ],
                }),
              ],
            }),
          },
        }),
      },
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: props.cognito.userPool,
            appIdClientRegex: props.cognito.cognitoParams.userPoolClientId,
            defaultAction: UserPoolDefaultAction.ALLOW,
          },
        },
        additionalAuthorizationModes: [
          {
            authorizationType: AuthorizationType.API_KEY,
            apiKeyConfig: {
              name: "public-rsvp",
              description:
                "Public API key for RSVP token lookup + submission (rate-limited at client).",
              expires: Expiration.after(Duration.days(365)),
            } as ApiKeyConfig,
          },
        ],
      },
      xrayEnabled: true,
    });

    this.graphqlUrl = graphql.graphqlUrl;
    this.graphqlApiId = graphql.apiId;
    this.lambdaFunctionNames = {};

    const lambdaRole = new aws_iam.Role(this, "lambdaRole", {
      assumedBy: new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    lambdaRole.addToPrincipalPolicy(
      new aws_iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeSubnets",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses",
        ],
      })
    );
    cluster.grantConnect(lambdaRole);

    // AWS Lambda for graph application
    const NodejsFunctionBaseProps: aws_lambda_nodejs.NodejsFunctionProps = {
      runtime: aws_lambda.Runtime.NODEJS_22_X,

      // entry: `./api/lambda/${lambdaName}.ts`,
      depsLockFilePath: "./api/lambda/package-lock.json",
      architecture: aws_lambda.Architecture.ARM_64,
      timeout: Duration.minutes(1),
      tracing: aws_lambda.Tracing.ACTIVE,
      role: lambdaRole,
      vpc: vpc,
      vpcSubnets: {
        subnets: vpc.isolatedSubnets,
      },
      bundling: {
        nodeModules: ["gremlin", "gremlin-aws-sigv4"],
      },
    };
    const queryFn = new aws_lambda_nodejs.NodejsFunction(this, "queryFn", {
      ...NodejsFunctionBaseProps,
      entry: "./api/lambda/queryGraph.ts",
      environment: {
        NEPTUNE_ENDPOINT: cluster.clusterReadEndpoint.hostname,
        NEPTUNE_PORT: cluster.clusterReadEndpoint.port.toString(),
      },
    });
    this.lambdaFunctionNames["queryFn"] = queryFn.functionName;
    graphql.grantQuery(queryFn);
    queryFn.connections.allowTo(cluster, aws_ec2.Port.tcp(8182));

    // AI Query Lambda (Bedrock + Neptune)
    const aiQueryRole = new aws_iam.Role(this, "aiQueryRole", {
      assumedBy: new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
    });
    aiQueryRole.addToPrincipalPolicy(
      new aws_iam.PolicyStatement({
        resources: ["*"],
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeSubnets",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses",
        ],
      })
    );
    aiQueryRole.addToPrincipalPolicy(
      new aws_iam.PolicyStatement({
        resources: [
          `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/*`,
        ],
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
      })
    );
    cluster.grantConnect(aiQueryRole);

    const aiQueryFn = new aws_lambda_nodejs.NodejsFunction(
      this,
      "aiQueryFn",
      {
        ...NodejsFunctionBaseProps,
        entry: "./api/lambda/aiQuery.ts",
        role: aiQueryRole,
        timeout: Duration.minutes(2),
        environment: {
          NEPTUNE_ENDPOINT: cluster.clusterReadEndpoint.hostname,
          NEPTUNE_PORT: cluster.clusterReadEndpoint.port.toString(),
          BEDROCK_REGION: Stack.of(this).region,
          MODEL_ID: "amazon.nova-lite-v1:0",
        },
        bundling: {
          nodeModules: [
            "gremlin",
            "gremlin-aws-sigv4",
            "@aws-sdk/client-bedrock-runtime",
          ],
        },
        vpcSubnets: {
          subnets: vpc.isolatedSubnets,
        },
      }
    );
    this.lambdaFunctionNames["aiQueryFn"] = aiQueryFn.functionName;
    graphql.grantQuery(aiQueryFn);
    aiQueryFn.connections.allowTo(cluster, aws_ec2.Port.tcp(8182));

    const mutationFn = new aws_lambda_nodejs.NodejsFunction(
      this,
      "mutationFn",
      {
        ...NodejsFunctionBaseProps,
        entry: "./api/lambda/mutationGraph.ts",
        environment: {
          NEPTUNE_ENDPOINT: cluster.clusterEndpoint.hostname,
          NEPTUNE_PORT: cluster.clusterEndpoint.port.toString(),
          USER_POOL_ID: props.cognito.cognitoParams.userPoolId,
          ...(props.mediaBucket ? { MEDIA_BUCKET: props.mediaBucket.bucketName } : {}),
          ...(props.rsvpQueue ? { RSVP_QUEUE_URL: props.rsvpQueue.queueUrl } : {}),
          ...(props.rsvpSigningSecret
            ? { RSVP_SIGNING_SECRET_ARN: props.rsvpSigningSecret.secretArn }
            : {}),
        },
        bundling: {
          nodeModules: [
            "gremlin",
            "gremlin-aws-sigv4",
            "@aws-sdk/client-s3",
            "@aws-sdk/client-sqs",
            "@aws-sdk/s3-request-presigner",
            "@aws-sdk/client-secrets-manager",
            "@aws-sdk/client-cognito-identity-provider",
          ],
        },
      }
    );
    this.lambdaFunctionNames["mutationFn"] = mutationFn.functionName;
    graphql.grantMutation(mutationFn);
    mutationFn.connections.allowTo(cluster, aws_ec2.Port.tcp(8182));
    // Allow the mutation Lambda to invite new members (triggers the
    // Cognito-native invitation email with the branded template) and add
    // them to the Member group.
    mutationFn.addToRolePolicy(
      new aws_iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminAddUserToGroup",
        ],
        resources: [props.cognito.userPool.userPoolArn],
      }),
    );
    if (props.mediaBucket) {
      props.mediaBucket.grantPut(mutationFn);
      props.mediaBucket.grantRead(mutationFn);
    }
    if (props.rsvpQueue) {
      props.rsvpQueue.grantSendMessages(mutationFn);
    }
    if (props.rsvpSigningSecret) {
      props.rsvpSigningSecret.grantRead(mutationFn);
      props.rsvpSigningSecret.grantRead(queryFn);
      queryFn.addEnvironment(
        "RSVP_SIGNING_SECRET_ARN",
        props.rsvpSigningSecret.secretArn,
      );
    }

    // Function URL

    const bulkLoadFn = new aws_lambda_nodejs.NodejsFunction(
      this,
      "bulkLoadFn",
      {
        ...NodejsFunctionBaseProps,
        entry: "./api/lambda/functionUrl/index.ts",
        depsLockFilePath: "./api/lambda/functionUrl/package-lock.json",
        environment: {
          NEPTUNE_ENDPOINT: cluster.clusterEndpoint.hostname,
          NEPTUNE_PORT: cluster.clusterEndpoint.port.toString(),
          VERTEX: s3Uri.vertex,
          EDGE: s3Uri.edge,
          ROLE_ARN: clusterRole.roleArn,
        },
        vpcSubnets: {
          subnets: vpc.publicSubnets,
        },
        bundling: {
          nodeModules: [
            "@smithy/signature-v4",
            "@aws-sdk/credential-provider-node",
            "@aws-crypto/sha256-js",
            "@smithy/protocol-http",
          ],
        },
        allowPublicSubnet: true,
      }
    );
    this.lambdaFunctionNames["bulkLoadFn"] = bulkLoadFn.functionName;
    bulkLoadFn.connections.allowTo(cluster, aws_ec2.Port.tcp(8182));

    const functionUrl = bulkLoadFn.addFunctionUrl({
      authType: aws_lambda.FunctionUrlAuthType.AWS_IAM,
      cors: {
        allowedMethods: [aws_lambda.HttpMethod.GET],
        allowedOrigins: ["*"],
        allowedHeaders: ["*"],
      },

      invokeMode: aws_lambda.InvokeMode.RESPONSE_STREAM,
    });

    graphqlFieldName.map((filedName: string) => {
      // Data sources
      let targetFn;
      if (filedName === "askGraph") {
        targetFn = aiQueryFn;
      } else if (filedName.startsWith("get") || filedName.startsWith("search")) {
        targetFn = queryFn;
      } else {
        targetFn = mutationFn;
      }
      const datasource = graphql.addLambdaDataSource(
        `${filedName}DS`,
        targetFn
      );
      queryFn.addEnvironment("GRAPHQL_ENDPOINT", this.graphqlUrl);
      // Resolver
      datasource.createResolver(`${filedName}Resolver`, {
        fieldName: `${filedName}`,
        typeName: filedName.startsWith("get") || filedName.startsWith("ask") || filedName.startsWith("search")
          ? "Query"
          : "Mutation",
        requestMappingTemplate: MappingTemplate.fromFile(
          `./api/graphql/resolvers/requests/${filedName}.vtl`
        ),
        responseMappingTemplate: MappingTemplate.fromFile(
          "./api/graphql/resolvers/responses/default.vtl"
        ),
      });
    });

    // Outputs
    new CfnOutput(this, "GraphqlUrl", {
      value: this.graphqlUrl,
    });
    new CfnOutput(this, "FunctionUrl", {
      value: functionUrl.url,
    });

    // Suppressions
    NagSuppressions.addResourceSuppressions(
      graphql,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Datasorce role",
        },
      ],
      true
    );

    NagSuppressions.addResourceSuppressions(
      lambdaRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Need the permission for accessing database in Vpc",
        },
      ],
      true
    );
    NagSuppressions.addResourceSuppressions(
      aiQueryRole,
      [
        {
          id: "AwsSolutions-IAM5",
          reason: "Need the permission for Bedrock and VPC access",
        },
      ],
      true
    );
    NagSuppressions.addStackSuppressions(Stack.of(this), [
      {
        id: "AwsSolutions-IAM4",
        reason: "CDK managed resource",
        appliesTo: [
          "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
        ],
      },
      {
        id: "AwsSolutions-L1",
        reason: "CDK managed resource",
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "CDK managed resource",
        appliesTo: ["Resource::*"],
      },
      {
        id: "AwsSolutions-IAM5",
        reason: "SSM parameter path scoped to /socialActiveApp/bastion/*",
        appliesTo: [{ regex: "/^Resource::arn:aws:ssm:.*:parameter\\/socialActiveApp\\/bastion\\/\\*$/" }],
      },
    ]);
  }
}
