import { Handler } from "aws-lambda";

// See queryGraph.ts — force gremlin to use ws npm package, not Node 22 built-in WebSocket.
delete (globalThis as any).WebSocket;

import * as gremlin from "gremlin";
import { getUrlAndHeaders } from "gremlin-aws-sigv4/lib/utils";

const Client = gremlin.driver.Client;

const BEDROCK_REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL_ID = process.env.MODEL_ID || "amazon.nova-lite-v1:0";

const GRAPH_SCHEMA = `
Graph Schema:

VERTEX LABELS AND PROPERTIES:

1. Entity (~label: "Entity")
   - entityTypes:String — one of: "Company", "Customer", "Estimator", "Jobber", or "Jobber;Company"
   - companyType:String — e.g. "CollisionShop", "PPFInstaller" (only for Company/Jobber;Company)
   - name:String — person name (for Customer, Estimator)
   - companyName:String — company/business name (for Company, Jobber, Jobber;Company)
   - address:String, country:String, phone:String, email:String, website:String

2. Asset (~label: "Asset")
   - assetType:String — one of: "Vehicle", "Boat", "JetSki", "Camper", "RV", "Phone", "Equipment", "Home"
   - For Vehicle/Camper/RV: vin:String, year:Int, make:String, model:String
   - For Boat/JetSki: hullId:String, year:Int, make:String, model:String
   - For Boat: lengthFt:Double, boatType:String
   - For Phone: imei:String, brand:String, model:String, carrier:String, phoneNumber:String
   - For Equipment: serialNumber:String, brand:String, model:String, equipmentType:String
   - For Home: address:String, squareFeet:Int, yearBuilt:Int
   - For RV: rvClass:String, lengthFt:Double
   - For Camper: lengthFt:Double

3. Job (~label: "Job")
   - roNumber:String — repair order number (e.g. "RO-102938")
   - jobName:String — description (e.g. "Front Bumper PPF Replacement")
   - jobCategory:String — e.g. "PPF"
   - payerType:String — "Insurance" or "Customer"
   - createdDate:String, status:String ("Draft","Approved","Scheduled"), statusDate:String

4. Part (~label: "Part")
   - partId:String — part identifier (e.g. "jb1_front_bumper")
   - partName:String — display name (e.g. "Front Bumper")
   - retailCost:Double — retail price

5. Project_Data (~label: "Project_Data")
   - projectName:String — name of the business service or IT project (e.g. "Cloud Migration Phase 2", "Zero Trust Network Rollout")
   - DepartmentNumber:String — department code (e.g. "D-1001", "D-3010", "D-5005")
   - DataClassification:String — one of: "Public", "Internal", "Confidential", "Restricted"
   - Team:String — team responsible (e.g. "Platform Engineering", "Data Science", "Security Engineering")
   - OwnerGroup:String — owning organizational group (e.g. "IT Operations", "Analytics Group", "Security", "Cloud Infrastructure")
   - Recovery:String — recovery priority (e.g. "Best Effort", "Standard", "Priority", "Critical")
   - Tier:String — service tier level (e.g. "1", "2", "3", "4")

EDGE LABELS AND PROPERTIES:

1. WORKS_FOR: Entity(Estimator) -> Entity(Company)
   - role:String (e.g. "estimator")

2. REQUESTS_WORK: Entity(Customer) -> Entity(Company), or Entity(Company) -> Entity(Jobber)
   - role:String (e.g. "collision_repair", "ppf_install")

3. DOES_WORK_FOR: Entity(Jobber) -> Entity(Company), or Entity(Company) -> Entity(Customer)
   - role:String (e.g. "ppf_supplier", "collision_repair")
   - discountPercent:Int (optional, on Jobber->Company edges)

4. OWNS_ASSET: Entity(Customer) -> Asset
   - No extra properties

5. MANAGES_JOB: Entity(Estimator) -> Job
   - role:String (e.g. "estimator")

6. SERVICE_ON: Job -> Asset
   - No extra properties

7. PAYS_FOR: Entity(Customer) -> Job
   - payerType:String ("Insurance" or "Customer")

8. OFFERS_PART: Entity(Jobber) -> Part
   - No extra properties

9. HAS_LINE_ITEM: Job -> Part
   - partPosition:String (e.g. "Front", "FrontLeft", "FrontRight", "Left", "Right", "AllDoors", "Rear", "Hull")
   - finalPrice:Double
   - retailCostAtTime:Int
   - discountPercentAtTime:Int
   - isOverridden:Bool

10. JOBBER_FOR_JOB: Entity(Jobber) -> Job
    - No extra properties

VERTEX ID PATTERNS:
- Companies: entity_co_1..entity_co_10
- Customers: entity_cu_1..entity_cu_12
- Estimators: entity_es_1..entity_es_10
- Jobbers: entity_jb_1..entity_jb_5, entity_mr_1
- Vehicles: asset_v_1..asset_v_12
- Boats: asset_b_1..asset_b_2
- JetSkis: asset_js_1..asset_js_2
- Camper: asset_cm_1, RV: asset_rv_1, Phone: asset_ph_1, Equipment: asset_eq_1, Home: asset_hm_1
- Jobs: job_1..job_15
- Parts: part_1..part_20
- Project_Data: project_data_1..project_data_25

Example Gremlin queries:
- List all collision shops: g.V().hasLabel('Entity').has('entityTypes','Company').values('companyName').toList()
- List all customers: g.V().hasLabel('Entity').has('entityTypes','Customer').values('name').toList()
- Get vehicles owned by a customer: g.V().has('Entity','name','David Ramirez').out('OWNS_ASSET').has('assetType','Vehicle').valueMap(true).toList()
- Find which company an estimator works for: g.V().has('Entity','name','Sarah Mitchell').out('WORKS_FOR').values('companyName').toList()
- Get all jobs for a vehicle: g.V('asset_v_1').in('SERVICE_ON').valueMap(true).toList()
- Get line items on a job: g.V('job_1').out('HAS_LINE_ITEM').valueMap(true).toList()
- Get total cost of a job: g.V('job_1').outE('HAS_LINE_ITEM').values('finalPrice').sum().next()
- Find which jobber supplied a job: g.V('job_1').in('JOBBER_FOR_JOB').values('companyName').toList()
- List all jobs managed by an estimator: g.V().has('Entity','name','Sarah Mitchell').out('MANAGES_JOB').valueMap(true).toList()
- Find customers of a collision shop: g.V().has('Entity','companyName','Elite Collision Center').in('REQUESTS_WORK').has('entityTypes','Customer').values('name').toList()
- Get parts offered by a jobber: g.V().has('Entity','companyName','Northwest PPF Solutions').out('OFFERS_PART').valueMap(true).toList()
- Count vertices by label: g.V().groupCount().by(label).next()
- Count edges by label: g.E().groupCount().by(label).next()
- Get all vertex labels: g.V().label().dedup().toList()
- Get all edge labels: g.E().label().dedup().toList()
- List all business services/projects: g.V().hasLabel('Project_Data').values('projectName').toList()
- Find all Tier 1 critical services: g.V().hasLabel('Project_Data').has('Tier','1').valueMap(true).toList()
- Find projects owned by a group: g.V().hasLabel('Project_Data').has('OwnerGroup','Security').valueMap('projectName','Team','Recovery','Tier').toList()
- Find projects by data classification: g.V().hasLabel('Project_Data').has('DataClassification','Restricted').valueMap('projectName','Team','OwnerGroup').toList()
- Find projects in a department: g.V().hasLabel('Project_Data').has('DepartmentNumber','D-3010').valueMap('projectName','Team','Recovery').toList()
- Count projects by owner group: g.V().hasLabel('Project_Data').groupCount().by('OwnerGroup').next()
- Count projects by tier: g.V().hasLabel('Project_Data').groupCount().by('Tier').next()
- Find projects by team: g.V().hasLabel('Project_Data').has('Team','Data Science').valueMap('projectName','DataClassification','Recovery','Tier').toList()
`;

const SYSTEM_PROMPT = `You are a graph database assistant for an Amazon Neptune graph database that models a collision repair and PPF (Paint Protection Film) business network.

The business domain includes:
- **Collision Shops** (Companies) that repair vehicles
- **Customers** who bring vehicles and other assets for service
- **Estimators** who work for collision shops and manage repair jobs
- **Jobbers** (PPF film suppliers/installers) who supply parts to collision shops
- **Assets** owned by customers (Vehicles, Boats, JetSkis, Campers, RVs, Phones, Equipment, Homes)
- **Jobs** (repair orders) that track PPF installation work
- **Parts** (PPF film pieces like bumpers, fenders, hoods) offered by jobbers
- **Business Services / Projects** (Project_Data) representing IT projects and business services with department ownership, data classification, team assignments, recovery priorities, and tier levels

${GRAPH_SCHEMA}

When a user asks a question about the graph data:
1. Determine if you need to query the graph to answer
2. If yes, generate a Gremlin query
3. Return your response as JSON

IMPORTANT RULES:
- Only generate READ queries (no mutations/drops)
- Use the Gremlin traversal language
- Edge labels are UPPERCASE (e.g. WORKS_FOR, OWNS_ASSET, HAS_LINE_ITEM)
- Use 'name' for people (Customers, Estimators) and 'companyName' for businesses (Companies, Jobbers)
- Always return valid JSON in this exact format:

If a query is needed:
{"needsQuery": true, "gremlinQuery": "<the gremlin traversal after g.>", "explanation": "<brief explanation of what the query does>"}

If no query is needed (general question about the schema, greetings, etc.):
{"needsQuery": false, "answer": "<your answer>", "explanation": ""}

Examples:
User: "What collision shops are in the system?"
{"needsQuery": true, "gremlinQuery": "V().hasLabel('Entity').has('entityTypes','Company').values('companyName').toList()", "explanation": "Lists all company names"}

User: "What vehicles does David Ramirez own?"
{"needsQuery": true, "gremlinQuery": "V().has('Entity','name','David Ramirez').out('OWNS_ASSET').has('assetType','Vehicle').valueMap('make','model','year','vin').toList()", "explanation": "Finds vehicles owned by David Ramirez"}

User: "How much does job RO-102938 cost?"
{"needsQuery": true, "gremlinQuery": "V().hasLabel('Job').has('roNumber','RO-102938').outE('HAS_LINE_ITEM').values('finalPrice').sum().next()", "explanation": "Sums the final prices of all line items on the job"}

User: "Who is the estimator for job 1?"
{"needsQuery": true, "gremlinQuery": "V('job_1').in('MANAGES_JOB').values('name').toList()", "explanation": "Finds the estimator managing job_1"}

User: "What types of data are in this graph?"
{"needsQuery": false, "answer": "The graph models a collision repair and PPF business network with: Entity vertices (Companies, Customers, Estimators, Jobbers), Asset vertices (Vehicles, Boats, JetSkis, Campers, RVs, etc.), Job vertices (repair orders), and Part vertices (PPF film pieces). Relationships include WORKS_FOR, REQUESTS_WORK, DOES_WORK_FOR, OWNS_ASSET, MANAGES_JOB, SERVICE_ON, PAYS_FOR, OFFERS_PART, HAS_LINE_ITEM, and JOBBER_FOR_JOB.", "explanation": ""}

User: "What discount does Northwest PPF Solutions give Elite Collision Center?"
{"needsQuery": true, "gremlinQuery": "V().has('Entity','companyName','Northwest PPF Solutions').outE('DOES_WORK_FOR').where(inV().has('companyName','Elite Collision Center')).values('discountPercent').toList()", "explanation": "Gets the discount percentage on the jobber-to-company relationship"}

User: "What business services are there?"
{"needsQuery": true, "gremlinQuery": "V().hasLabel('Project_Data').valueMap('projectName','OwnerGroup','Tier','Recovery').toList()", "explanation": "Lists all business services with their owner group, tier, and recovery priority"}

User: "Which projects are critical recovery?"
{"needsQuery": true, "gremlinQuery": "V().hasLabel('Project_Data').has('Recovery','Critical').valueMap('projectName','Team','OwnerGroup','Tier').toList()", "explanation": "Finds all projects with Critical recovery priority"}

User: "Show me all restricted data projects"
{"needsQuery": true, "gremlinQuery": "V().hasLabel('Project_Data').has('DataClassification','Restricted').valueMap('projectName','Team','OwnerGroup','Recovery','Tier').toList()", "explanation": "Finds projects with Restricted data classification"}

User: "What projects does the Security team own?"
{"needsQuery": true, "gremlinQuery": "V().hasLabel('Project_Data').has('OwnerGroup','Security').valueMap('projectName','Team','DataClassification','Recovery','Tier').toList()", "explanation": "Lists all projects owned by the Security group"}
`;

interface BedrockMessage {
  role: string;
  content: string;
}

interface ConversationEntry {
  role: string;
  content: string;
}

async function invokeBedrock(messages: BedrockMessage[]): Promise<string> {
  // Use AWS SDK v3 - dynamically import to work with Lambda bundling
  const { BedrockRuntimeClient, ConverseCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const client = new BedrockRuntimeClient({ region: BEDROCK_REGION });

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: [{ text: m.content }],
    })),
    inferenceConfig: {
      maxTokens: 1024,
    },
  });

  const response = await client.send(command);
  const output = response.output?.message?.content;
  if (!output || output.length === 0 || !output[0].text) {
    throw new Error("Empty response from Bedrock");
  }
  return output[0].text;
}

// Gremlin steps that mutate the graph — these are not allowed in read-only mode
const MUTATION_PATTERN =
  /\b(addV|addE|addVertex|addEdge|drop|property|iterate|sideEffect|inject)\s*\(/i;

function validateGremlinQuery(queryString: string): void {
  if (MUTATION_PATTERN.test(queryString)) {
    throw new Error(
      "Query contains mutation operations which are not allowed"
    );
  }
}

async function executeGremlin(queryString: string): Promise<unknown> {
  validateGremlinQuery(queryString);

  const { url, headers } = getUrlAndHeaders(
    process.env.NEPTUNE_ENDPOINT,
    process.env.NEPTUNE_PORT,
    {},
    "/gremlin",
    "wss"
  );

  const client = new Client(url, {
    mimeType: "application/vnd.gremlin-v2.0+json",
    headers: headers,
  });

  try {
    // Submit the query string to the Gremlin server for server-side execution.
    // This avoids local JavaScript evaluation (no Function constructor / eval).
    const result = await client.submit(`g.${queryString}`);
    return result.toArray ? result.toArray() : result;
  } finally {
    try {
      await client.close();
    } catch (e) {
      console.warn("Error closing connection:", e);
    }
  }
}

export const handler: Handler = async (event) => {
  console.log("AI Query event:", JSON.stringify(event));

  const question = event.arguments?.question;
  const conversationHistory: ConversationEntry[] = event.arguments?.history
    ? JSON.parse(event.arguments.history)
    : [];

  if (!question) {
    return {
      answer:
        "Please ask a question about the graph data. For example: 'What collision shops are in the system?', 'What vehicles does David Ramirez own?', or 'How much does job RO-102938 cost?'",
      query: null,
      data: null,
    };
  }

  try {
    // Build messages for Bedrock including conversation history
    const messages: BedrockMessage[] = [];

    for (const entry of conversationHistory) {
      messages.push({
        role: entry.role === "user" ? "user" : "assistant",
        content: entry.content,
      });
    }

    messages.push({
      role: "user",
      content: question,
    });

    // Converse API requires first message to be from "user" — strip leading assistant messages
    while (messages.length > 0 && messages[0].role !== "user") {
      messages.shift();
    }

    console.log("Sending messages to Bedrock:", JSON.stringify(messages.map(m => ({ role: m.role, len: m.content.length }))));

    // Call Bedrock to interpret the question
    const bedrockResponse = await invokeBedrock(messages);
    console.log("Bedrock response:", bedrockResponse);

    // Parse Bedrock's response - extract JSON from the text
    let parsed;
    try {
      // Try to extract JSON from the response
      const jsonMatch = bedrockResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(bedrockResponse);
      }
    } catch (parseError) {
      console.error("Failed to parse Bedrock response:", parseError);
      return {
        answer: bedrockResponse,
        query: null,
        data: null,
      };
    }

    if (!parsed.needsQuery) {
      return {
        answer: parsed.answer || bedrockResponse,
        query: null,
        data: null,
      };
    }

    // Execute the Gremlin query
    const gremlinQuery = parsed.gremlinQuery;
    console.log("Executing Gremlin query:", gremlinQuery);

    let queryResult;
    try {
      queryResult = await executeGremlin(gremlinQuery);
    } catch (queryError: unknown) {
      console.error("Gremlin query error:", queryError);
      const errorMessage =
        queryError instanceof Error ? queryError.message : String(queryError);
      return {
        answer: `I tried to query the graph but encountered an error. The query was: g.${gremlinQuery}. Error: ${errorMessage}`,
        query: `g.${gremlinQuery}`,
        data: null,
      };
    }

    // Format the result
    const resultStr = JSON.stringify(queryResult, null, 2);
    console.log("Query result:", resultStr);

    // Ask Bedrock to summarize the results
    const summaryMessages: BedrockMessage[] = [
      ...messages,
      {
        role: "assistant",
        content: `I executed the Gremlin query: g.${gremlinQuery}`,
      },
      {
        role: "user",
        content: `The query returned these results: ${resultStr}\n\nPlease provide a clear, concise natural language summary of these results to answer my original question. Do not return JSON, just a plain text answer.`,
      },
    ];

    const summary = await invokeBedrock(summaryMessages);

    return {
      answer: summary,
      query: `g.${gremlinQuery}`,
      data: resultStr,
    };
  } catch (error: unknown) {
    console.error("AI Query error:", error);
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      answer: `Sorry, I encountered an error processing your question: ${errorMessage}`,
      query: null,
      data: null,
    };
  }
};
