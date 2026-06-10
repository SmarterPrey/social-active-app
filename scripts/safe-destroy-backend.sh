#!/usr/bin/env bash
# Safely tear down a stage's backend by ensuring Neptune is running first.
# Neptune instances cannot be deleted while the cluster is in `stopped`
# state, which happens automatically every night per the cost-saving schedule
# (bin/backend.ts -> neptuneSchedule). This script starts the cluster if
# needed, waits for `available`, then runs `cdk destroy --all -c stage=<s>`.
#
# Usage:
#   scripts/safe-destroy-backend.sh <stage> [extra cdk args...]
#
# Examples:
#   scripts/safe-destroy-backend.sh prod --profile my-prod-profile
#   scripts/safe-destroy-backend.sh dev  --profile my-dev-profile

set -eo pipefail
export AWS_PAGER=""

STAGE="${1:-}"
if [ -z "$STAGE" ]; then
  echo "Usage: $0 <stage> [extra cdk args...]" >&2
  echo "  <stage> must be one of: dev, qa, prod" >&2
  exit 1
fi
shift

case "$STAGE" in
  dev)  STACK_PREFIX="dev-mucker" ;;
  qa)   STACK_PREFIX="qa-mucker"  ;;
  prod) STACK_PREFIX="pr-mucker"  ;;
  *) echo "Invalid stage '$STAGE'. Use dev, qa, or prod." >&2; exit 1 ;;
esac

NETWORK_STACK="${STACK_PREFIX}-NeptuneNetworkStack"
echo ">> Looking up Neptune cluster in ${NETWORK_STACK}..."

CLUSTER_ID="$(aws cloudformation list-stack-resources \
  --stack-name "$NETWORK_STACK" "$@" \
  --query "StackResourceSummaries[?ResourceType=='AWS::Neptune::DBCluster'].PhysicalResourceId | [0]" \
  --output text 2>/dev/null || echo "None")"

if [ -z "$CLUSTER_ID" ] || [ "$CLUSTER_ID" = "None" ]; then
  echo "   No Neptune cluster found in ${NETWORK_STACK} (stack may already be gone). Proceeding to cdk destroy."
else
  STATUS="$(aws neptune describe-db-clusters \
    --db-cluster-identifier "$CLUSTER_ID" "$@" \
    --query 'DBClusters[0].Status' --output text)"
  echo "   Cluster: ${CLUSTER_ID}  (status: ${STATUS})"

  if [ "$STATUS" = "stopped" ]; then
    echo ">> Starting cluster so the destroy can proceed..."
    aws neptune start-db-cluster --db-cluster-identifier "$CLUSTER_ID" "$@" \
      --query 'DBCluster.Status' --output text >/dev/null

    echo -n ">> Waiting for cluster to become available "
    while true; do
      STATUS="$(aws neptune describe-db-clusters \
        --db-cluster-identifier "$CLUSTER_ID" "$@" \
        --query 'DBClusters[0].Status' --output text)"
      if [ "$STATUS" = "available" ]; then
        echo " OK"
        break
      fi
      echo -n "."
      sleep 20
    done
  elif [ "$STATUS" != "available" ]; then
    echo "   WARNING: Cluster is in state '${STATUS}' - not starting, but destroy may fail."
  fi
fi

echo ">> Running cdk destroy --all -c stage=${STAGE}..."
exec npx cdk destroy \
  --app "node -e \"require('./bin/backend.js')\"" \
  --all -c "stage=${STAGE}" "$@"
#!/usr/bin/env bash
# Safely tear down a stage's backend by ensuring Neptune is running first.
# Neptune instances cannot be deleted while the cluster is in `stopped`
# state, which happens automatically every night per the cost-saving schedule
# (bin/backend.ts → neptuneSchedule). This script starts the cluster if
# needed, waits for `available`, then runs `cdk destroy --all -c stage=<s>`.
#
# Usage:
#   scripts/safe-destroy-backend.sh <stage> [extra cdk args...]
#
# Examples:
#   scripts/safe-destroy-backend.sh prod --profile my-prod-profile
#   scripts/safe-destroy-backend.sh dev  --profile my-dev-profile
#
# Environment:
#   AWS_PROFILE   — if set, passed through; otherwise include --profile in args
#   AWS_REGION    — optional; defaults to CLI default

set -euo pipefail
export AWS_PAGER=""

STAGE="${1:-}"
if [[ -z "$STAGE" ]]; then
  echo "Usage: $0 <stage> [extra cdk args...]" >&2
  echo "  <stage> must be one of: dev, qa, prod" >&2
  exit 1
fi
shift

case "$STAGE" in
  dev)  STACK_PREFIX="dev-mucker" ;;
  qa)   STACK_PREFIX="qa-mucker"  ;;
  prod) STACK_PREFIX="pr-mucker"  ;;
  *) echo "Invalid stage '$STAGE'. Use dev, qa, or prod." >&2; exit 1 ;;
esac

NETWORK_STACK="${STACK_PREFIX}-NeptuneNetworkStack"
echo "🔎 Looking up Neptune cluster in $NETWORK_STACK…"

# Extract the Neptune cluster physical ID from the CloudFormation stack.
# The logical resource ID is "neptuneclusterF3FE4FEA" style — we match by
# ResourceType to be resilient to hash changes.
CLUSTER_ID="$(aws cloudformation list-stack-resources \
  --stack-name "$NETWORK_STACK" "$@" \
  --query "StackResourceSummaries[?ResourceType=='AWS::Neptune::DBCluster'].PhysicalResourceId | [0]" \
  --output text 2>/dev/null || echo "None")"

if [[ -z "$CLUSTER_ID" || "$CLUSTER_ID" == "None" ]]; then
  echo "ℹ️  No Neptune cluster found in $NETWORK_STACK (stack may already be gone). Proceeding to cdk destroy."
else
  STATUS="$(aws neptune describe-db-clusters \
    --db-cluster-identifier "$CLUSTER_ID" "$@" \
    --query 'DBClusters[0].Status' --output text)"
  echo "   Cluster: $CLUSTER_ID  (status: $STATUS)"

  if [[ "$STATUS" == "stopped" ]]; then
    echo "▶️  Starting cluster so the destroy can proceed…"
    aws neptune start-db-cluster --db-cluster-identifier "$CLUSTER_ID" "$@" \
      --query 'DBCluster.Status' --output text >/dev/null

    echo -n "⏳ Waiting for cluster to become available "
    while true; do
      STATUS="$(aws neptune describe-db-clusters \
        --db-cluster-identifier "$CLUSTER_ID" "$@" \
        --query 'DBClusters[0].Status' --output text)"
      if [[ "$STATUS" == "available" ]]; then
        echo " ✓"
        break
      fi
      echo -n "."
      sleep 20
    done
  elif [[ "$STATUS" != "available" ]]; then
    echo "⚠️  Cluster is in state '$STATUS' — not starting, but destroy may fail."
  fi
fi

echo "💣 Running cdk destroy --all -c stage=$STAGE…"
exec npx cdk destroy \
  --app "node -e \"require('./bin/backend.js')\"" \
  --all -c "stage=$STAGE" "$@"
