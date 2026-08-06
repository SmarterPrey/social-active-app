import { readFile, writeFile } from "node:fs/promises";

const cdkInfraFile = "./cdk-infra.json";

// Stage → stack-name prefix map (mirrors config.ts → stagePrefixMap)
const stagePrefixMap = { dev: "dev", qa: "qa", prod: "pr" };

// Parse --stage=<s> from argv (optional)
const stageArg = process.argv
  .find((a) => a.startsWith("--stage="))
  ?.split("=")[1];

if (stageArg && !stagePrefixMap[stageArg]) {
  console.error(
    `Invalid --stage "${stageArg}". Valid stages: ${Object.keys(
      stagePrefixMap
    ).join(", ")}`
  );
  process.exit(1);
}

// When a stage is given, write to app/web/.env.<stage>; otherwise app/web/.env.
// Vite picks up .env.<mode> when built with `vite build --mode <mode>`.
const envFile = stageArg ? `./app/web/.env.${stageArg}` : "./app/web/.env";

// Map CDK output key prefixes → Vite env var names. CDK appends a hash suffix
// (e.g. cognitoUserPoolId6319077E) so we match on startsWith, and order
// cognitoUserPoolClientId before cognitoUserPoolId since it's more specific.
// Optional `transform` lets us shape the value (e.g. prefix https:// on a
// bare CloudFront domain).
const mapping = [
  { match: "cognitoUserPoolClientId", env: "VITE_COGNITO_USERPOLL_CLIENTID" },
  { match: "cognitoUserPoolId", env: "VITE_COGNITO_USERPOOLID" },
  { match: "cognitoIdentityPoolId", env: "VITE_COGNITO_IDENTITYPOOLID" },
  { match: "apiGraphqlUrl", env: "VITE_GRAPHQL_URL" },
  {
    match: "mediaMediaDomain",
    env: "VITE_MEDIA_CLOUDFRONT_URL",
    transform: (v) => `https://${v}`,
  },
  { match: "mediaMediaBucketName", env: "VITE_MEDIA_BUCKET_NAME" },
  // Deployment metadata (CfnOutputs from ApiStack). These let the frontend
  // know which AWS account/region/stage its backend lives in — important
  // when stages target different AWS accounts.
  { match: "deployAccount", env: "VITE_AWS_ACCOUNT_ID" },
  { match: "deployRegion", env: "VITE_COGNITO_REGION" },
  { match: "deployStage", env: "VITE_STAGE" },
];

const raw = await readFile(cdkInfraFile, "utf8");
const cdkOutputs = JSON.parse(raw);

// Find the ApiStack for the requested stage (e.g. dev → dev-mucker-ApiStack)
// or fall back to the first *-ApiStack if no stage was specified.
const wantedPrefix = stageArg ? `${stagePrefixMap[stageArg]}-` : "";
const apiStackKey = Object.keys(cdkOutputs).find(
  (k) => k.startsWith(wantedPrefix) && k.endsWith("-ApiStack")
);
if (!apiStackKey) {
  const hint = stageArg
    ? `for stage "${stageArg}" (expected ${stagePrefixMap[stageArg]}-*-ApiStack)`
    : "";
  console.error(
    `No *-ApiStack entry found in ${cdkInfraFile} ${hint}. Deploy the backend first.`
  );
  process.exit(1);
}

const stackOutputs = cdkOutputs[apiStackKey];
const lines = [];

// Derive the deployment app-name prefix from stack name
// (e.g. pr-mucker-ApiStack -> pr-mucker).
const appNameFromStack = apiStackKey.replace(/-ApiStack$/, "");
lines.push(`VITE_APP_NAME=${appNameFromStack}`);

for (const [outputKey, value] of Object.entries(stackOutputs)) {
  for (const { match, env, transform } of mapping) {
    if (outputKey.startsWith(match)) {
      lines.push(`${env}=${transform ? transform(value) : value}`);
      break;
    }
  }
}

// Safety net: if a pre-existing deploy didn't emit deployRegion yet, fall
// back to the AWS env vars so the .env still has VITE_COGNITO_REGION.
if (!lines.some((l) => l.startsWith("VITE_COGNITO_REGION="))) {
  const region =
    process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";
  lines.push(`VITE_COGNITO_REGION=${region}`);
}

await writeFile(envFile, lines.join("\n") + "\n", "utf8");
console.log(
  `Wrote ${lines.length} env vars to ${envFile} (from ${apiStackKey})`
);
