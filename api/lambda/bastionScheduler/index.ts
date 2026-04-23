import { EC2Client, StopInstancesCommand } from "@aws-sdk/client-ec2";

const client = new EC2Client({});
const INSTANCE_ID = process.env.INSTANCE_ID!;

export const handler = async (event: { action: "stop" }) => {
  console.log(`Bastion scheduler: stopping instance ${INSTANCE_ID}`);

  try {
    await client.send(
      new StopInstancesCommand({ InstanceIds: [INSTANCE_ID] })
    );
    console.log(`Instance ${INSTANCE_ID} stop initiated`);
    return { statusCode: 200, body: `stop initiated for ${INSTANCE_ID}` };
  } catch (error: any) {
    // If already stopped, treat as success
    if (error.name === "IncorrectInstanceState") {
      console.log("Instance already stopped");
      return { statusCode: 200, body: "Instance already stopped" };
    }
    console.error("Failed to stop bastion:", error);
    throw error;
  }
};
