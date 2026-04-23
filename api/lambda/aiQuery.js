"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// See queryGraph.ts — force gremlin to use ws npm package, not Node 22 built-in WebSocket.
delete globalThis.WebSocket;
const gremlin = require("gremlin");
const utils_1 = require("gremlin-aws-sigv4/lib/utils");
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
async function invokeBedrock(messages) {
    // Use AWS SDK v3 - dynamically import to work with Lambda bundling
    const { BedrockRuntimeClient, ConverseCommand } = await Promise.resolve().then(() => require("@aws-sdk/client-bedrock-runtime"));
    const client = new BedrockRuntimeClient({ region: BEDROCK_REGION });
    const command = new ConverseCommand({
        modelId: MODEL_ID,
        system: [{ text: SYSTEM_PROMPT }],
        messages: messages.map((m) => ({
            role: m.role,
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
const MUTATION_PATTERN = /\b(addV|addE|addVertex|addEdge|drop|property|iterate|sideEffect|inject)\s*\(/i;
function validateGremlinQuery(queryString) {
    if (MUTATION_PATTERN.test(queryString)) {
        throw new Error("Query contains mutation operations which are not allowed");
    }
}
async function executeGremlin(queryString) {
    validateGremlinQuery(queryString);
    const { url, headers } = (0, utils_1.getUrlAndHeaders)(process.env.NEPTUNE_ENDPOINT, process.env.NEPTUNE_PORT, {}, "/gremlin", "wss");
    const client = new Client(url, {
        mimeType: "application/vnd.gremlin-v2.0+json",
        headers: headers,
    });
    try {
        // Submit the query string to the Gremlin server for server-side execution.
        // This avoids local JavaScript evaluation (no Function constructor / eval).
        const result = await client.submit(`g.${queryString}`);
        return result.toArray ? result.toArray() : result;
    }
    finally {
        try {
            await client.close();
        }
        catch (e) {
            console.warn("Error closing connection:", e);
        }
    }
}
const handler = async (event) => {
    console.log("AI Query event:", JSON.stringify(event));
    const question = event.arguments?.question;
    const conversationHistory = event.arguments?.history
        ? JSON.parse(event.arguments.history)
        : [];
    if (!question) {
        return {
            answer: "Please ask a question about the graph data. For example: 'What collision shops are in the system?', 'What vehicles does David Ramirez own?', or 'How much does job RO-102938 cost?'",
            query: null,
            data: null,
        };
    }
    try {
        // Build messages for Bedrock including conversation history
        const messages = [];
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
            }
            else {
                parsed = JSON.parse(bedrockResponse);
            }
        }
        catch (parseError) {
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
        }
        catch (queryError) {
            console.error("Gremlin query error:", queryError);
            const errorMessage = queryError instanceof Error ? queryError.message : String(queryError);
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
        const summaryMessages = [
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
    }
    catch (error) {
        console.error("AI Query error:", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            answer: `Sorry, I encountered an error processing your question: ${errorMessage}`,
            query: null,
            data: null,
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWlRdWVyeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFpUXVlcnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsMkZBQTJGO0FBQzNGLE9BQVEsVUFBa0IsQ0FBQyxTQUFTLENBQUM7QUFFckMsbUNBQW1DO0FBQ25DLHVEQUErRDtBQUUvRCxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQztBQUVyQyxNQUFNLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsSUFBSSxXQUFXLENBQUM7QUFDakUsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLElBQUksdUJBQXVCLENBQUM7QUFFakUsTUFBTSxZQUFZLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0FzSHBCLENBQUM7QUFFRixNQUFNLGFBQWEsR0FBRzs7Ozs7Ozs7Ozs7O0VBWXBCLFlBQVk7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBa0RiLENBQUM7QUFZRixLQUFLLFVBQVUsYUFBYSxDQUFDLFFBQTBCO0lBQ3JELG1FQUFtRTtJQUNuRSxNQUFNLEVBQUUsb0JBQW9CLEVBQUUsZUFBZSxFQUFFLEdBQUcsMkNBQ2hELGlDQUFpQyxFQUNsQyxDQUFDO0lBRUYsTUFBTSxNQUFNLEdBQUcsSUFBSSxvQkFBb0IsQ0FBQyxFQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUUsQ0FBQyxDQUFDO0lBRXBFLE1BQU0sT0FBTyxHQUFHLElBQUksZUFBZSxDQUFDO1FBQ2xDLE9BQU8sRUFBRSxRQUFRO1FBQ2pCLE1BQU0sRUFBRSxDQUFDLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxDQUFDO1FBQ2pDLFFBQVEs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TUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ3pELE9BQU87WUFDTCxNQUFNLEVBQUUsMkRBQTJELFlBQVksRUFBRTtZQUNqRixLQUFLLEVBQUUsSUFBSTtZQUNYLElBQUksRUFBRSxJQUFJO1NBQ1gsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUEzSFcsUUFBQSxPQUFPLFdBMkhsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG4vLyBTZWUgcXVlcnlHcmFwaC50cyDigJQgZm9yY2UgZ3JlbWxpbiB0byB1c2Ugd3MgbnBtIHBhY2thZ2UsIG5vdCBOb2RlIDIyIGJ1aWx0LWluIFdlYlNvY2tldC5cbmRlbGV0ZSAoZ2xvYmFsVGhpcyBhcyBhbnkpLldlYlNvY2tldDtcblxuaW1wb3J0ICogYXMgZ3JlbWxpbiBmcm9tIFwiZ3JlbWxpblwiO1xuaW1wb3J0IHsgZ2V0VXJsQW5kSGVhZGVycyB9IGZyb20gXCJncmVtbGluLWF3cy1zaWd2NC9saWIvdXRpbHNcIjtcblxuY29uc3QgQ2xpZW50ID0gZ3JlbWxpbi5kcml2ZXIuQ2xpZW50O1xuXG5jb25zdCBCRURST0NLX1JFR0lPTiA9IHByb2Nlc3MuZW52LkJFRFJPQ0tfUkVHSU9OIHx8IFwidXMtZWFzdC0xXCI7XG5jb25zdCBNT0RFTF9JRCA9IHByb2Nlc3MuZW52Lk1PREVMX0lEIHx8IFwiYW1hem9uLm5vdmEtbGl0ZS12MTowXCI7XG5cbmNvbnN0IEdSQVBIX1NDSEVNQSA9IGBcbkdyYXBoIFNjaGVtYTpcblxuVkVSVEVYIExBQkVMUyBBTkQgUFJPUEVSVElFUzpcblxuMS4gRW50aXR5ICh+bGFiZWw6IFwiRW50aXR5XCIpXG4gICAtIGVudGl0eVR5cGVzOlN0cmluZyDigJQgb25lIG9mOiBcIkNvbXBhbnlcIiwgXCJDdXN0b21lclwiLCBcIkVzdGltYXRvclwiLCBcIkpvYmJlclwiLCBvciBcIkpvYmJlcjtDb21wYW55XCJcbiAgIC0gY29tcGFueVR5cGU6U3RyaW5nIOKAlCBlLmcuIFwiQ29sbGlzaW9uU2hvcFwiLCBcIlBQRkluc3RhbGxlclwiIChvbmx5IGZvciBDb21wYW55L0pvYmJlcjtDb21wYW55KVxuICAgLSBuYW1lOlN0cmluZyDigJQgcGVyc29uIG5hbWUgKGZvciBDdXN0b21lciwgRXN0aW1hdG9yKVxuICAgLSBjb21wYW55TmFtZTpTdHJpbmcg4oCUIGNvbXBhbnkvYnVzaW5lc3MgbmFtZSAoZm9yIENvbXBhbnksIEpvYmJlciwgSm9iYmVyO0NvbXBhbnkpXG4gICAtIGFkZHJlc3M6U3RyaW5nLCBjb3VudHJ5OlN0cmluZywgcGhvbmU6U3RyaW5nLCBlbWFpbDpTdHJpbmcsIHdlYnNpdGU6U3RyaW5nXG5cbjIuIEFzc2V0ICh+bGFiZWw6IFwiQXNzZXRcIilcbiAgIC0gYXNzZXRUeXBlOlN0cmluZyDigJQgb25lIG9mOiBcIlZlaGljbGVcIiwgXCJCb2F0XCIsIFwiSmV0U2tpXCIsIFwiQ2FtcGVyXCIsIFwiUlZcIiwgXCJQaG9uZVwiLCBcIkVxdWlwbWVudFwiLCBcIkhvbWVcIlxuICAgLSBGb3IgVmVoaWNsZS9DYW1wZXIvUlY6IHZpbjpTdHJpbmcsIHllYXI6SW50LCBtYWtlOlN0cmluZywgbW9kZWw6U3RyaW5nXG4gICAtIEZvciBCb2F0L0pldFNraTogaHVsbElkOlN0cmluZywgeWVhcjpJbnQsIG1ha2U6U3RyaW5nLCBtb2RlbDpTdHJpbmdcbiAgIC0gRm9yIEJvYXQ6IGxlbmd0aEZ0OkRvdWJsZSwgYm9hdFR5cGU6U3RyaW5nXG4gICAtIEZvciBQaG9uZTogaW1laTpTdHJpbmcsIGJyYW5kOlN0cmluZywgbW9kZWw6U3RyaW5nLCBjYXJyaWVyOlN0cmluZywgcGhvbmVOdW1iZXI6U3RyaW5nXG4gICAtIEZvciBFcXVpcG1lbnQ6IHNlcmlhbE51bWJlcjpTdHJpbmcsIGJyYW5kOlN0cmluZywgbW9kZWw6U3RyaW5nLCBlcXVpcG1lbnRUeXBlOlN0cmluZ1xuICAgLSBGb3IgSG9tZTogYWRkcmVzczpTdHJpbmcsIHNxdWFyZUZlZXQ6SW50LCB5ZWFyQnVpbHQ6SW50XG4gICAtIEZvciBSVjogcnZDbGFzczpTdHJpbmcsIGxlbmd0aEZ0OkRvdWJsZVxuICAgLSBGb3IgQ2FtcGVyOiBsZW5ndGhGdDpEb3VibGVcblxuMy4gSm9iICh+bGFiZWw6IFwiSm9iXCIpXG4gICAtIHJvTnVtYmVyOlN0cmluZyDigJQgcmVwYWlyIG9yZGVyIG51bWJlciAoZS5nLiBcIlJPLTEwMjkzOFwiKVxuICAgLSBqb2JOYW1lOlN0cmluZyDigJQgZGVzY3JpcHRpb24gKGUuZy4gXCJGcm9udCBCdW1wZXIgUFBGIFJlcGxhY2VtZW50XCIpXG4gICAtIGpvYkNhdGVnb3J5OlN0cmluZyDigJQgZS5nLiBcIlBQRlwiXG4gICAtIHBheWVyVHlwZTpTdHJpbmcg4oCUIFwiSW5zdXJhbmNlXCIgb3IgXCJDdXN0b21lclwiXG4gICAtIGNyZWF0ZWREYXRlOlN0cmluZywgc3RhdHVzOlN0cmluZyAoXCJEcmFmdFwiLFwiQXBwcm92ZWRcIixcIlNjaGVkdWxlZFwiKSwgc3RhdHVzRGF0ZTpTdHJpbmdcblxuNC4gUGFydCAofmxhYmVsOiBcIlBhcnRcIilcbiAgIC0gcGFydElkOlN0cmluZyDigJQgcGFydCBpZGVudGlmaWVyIChlLmcuIFwiamIxX2Zyb250X2J1bXBlclwiKVxuICAgLSBwYXJ0TmFtZTpTdHJpbmcg4oCUIGRpc3BsYXkgbmFtZSAoZS5nLiBcIkZyb250IEJ1bXBlclwiKVxuICAgLSByZXRhaWxDb3N0OkRvdWJsZSDigJQgcmV0YWlsIHByaWNlXG5cbjUuIFByb2plY3RfRGF0YSAofmxhYmVsOiBcIlByb2plY3RfRGF0YVwiKVxuICAgLSBwcm9qZWN0TmFtZTpTdHJpbmcg4oCUIG5hbWUgb2YgdGhlIGJ1c2luZXNzIHNlcnZpY2Ugb3IgSVQgcHJvamVjdCAoZS5nLiBcIkNsb3VkIE1pZ3JhdGlvbiBQaGFzZSAyXCIsIFwiWmVybyBUcnVzdCBOZXR3b3JrIFJvbGxvdXRcIilcbiAgIC0gRGVwYXJ0bWVudE51bWJlcjpTdHJpbmcg4oCUIGRlcGFydG1lbnQgY29kZSAoZS5nLiBcIkQtMTAwMVwiLCBcIkQtMzAxMFwiLCBcIkQtNTAwNVwiKVxuICAgLSBEYXRhQ2xhc3NpZmljYXRpb246U3RyaW5nIOKAlCBvbmUgb2Y6IFwiUHVibGljXCIsIFwiSW50ZXJuYWxcIiwgXCJDb25maWRlbnRpYWxcIiwgXCJSZXN0cmljdGVkXCJcbiAgIC0gVGVhbTpTdHJpbmcg4oCUIHRlYW0gcmVzcG9uc2libGUgKGUuZy4gXCJQbGF0Zm9ybSBFbmdpbmVlcmluZ1wiLCBcIkRhdGEgU2NpZW5jZVwiLCBcIlNlY3VyaXR5IEVuZ2luZWVyaW5nXCIpXG4gICAtIE93bmVyR3JvdXA6U3RyaW5nIOKAlCBvd25pbmcgb3JnYW5pemF0aW9uYWwgZ3JvdXAgKGUuZy4gXCJJVCBPcGVyYXRpb25zXCIsIFwiQW5hbHl0aWNzIEdyb3VwXCIsIFwiU2VjdXJpdHlcIiwgXCJDbG91ZCBJbmZyYXN0cnVjdHVyZVwiKVxuICAgLSBSZWNvdmVyeTpTdHJpbmcg4oCUIHJlY292ZXJ5IHByaW9yaXR5IChlLmcuIFwiQmVzdCBFZmZvcnRcIiwgXCJTdGFuZGFyZFwiLCBcIlByaW9yaXR5XCIsIFwiQ3JpdGljYWxcIilcbiAgIC0gVGllcjpTdHJpbmcg4oCUIHNlcnZpY2UgdGllciBsZXZlbCAoZS5nLiBcIjFcIiwgXCIyXCIsIFwiM1wiLCBcIjRcIilcblxuRURHRSBMQUJFTFMgQU5EIFBST1BFUlRJRVM6XG5cbjEuIFdPUktTX0ZPUjogRW50aXR5KEVzdGltYXRvcikgLT4gRW50aXR5KENvbXBhbnkpXG4gICAtIHJvbGU6U3RyaW5nIChlLmcuIFwiZXN0aW1hdG9yXCIpXG5cbjIuIFJFUVVFU1RTX1dPUks6IEVudGl0eShDdXN0b21lcikgLT4gRW50aXR5KENvbXBhbnkpLCBvciBFbnRpdHkoQ29tcGFueSkgLT4gRW50aXR5KEpvYmJlcilcbiAgIC0gcm9sZTpTdHJpbmcgKGUuZy4gXCJjb2xsaXNpb25fcmVwYWlyXCIsIFwicHBmX2luc3RhbGxcIilcblxuMy4gRE9FU19XT1JLX0ZPUjogRW50aXR5KEpvYmJlcikgLT4gRW50aXR5KENvbXBhbnkpLCBvciBFbnRpdHkoQ29tcGFueSkgLT4gRW50aXR5KEN1c3RvbWVyKVxuICAgLSByb2xlOlN0cmluZyAoZS5nLiBcInBwZl9zdXBwbGllclwiLCBcImNvbGxpc2lvbl9yZXBhaXJcIilcbiAgIC0gZGlzY291bnRQZXJjZW50OkludCAob3B0aW9uYWwsIG9uIEpvYmJlci0+Q29tcGFueSBlZGdlcylcblxuNC4gT1dOU19BU1NFVDogRW50aXR5KEN1c3RvbWVyKSAtPiBBc3NldFxuICAgLSBObyBleHRyYSBwcm9wZXJ0aWVzXG5cbjUuIE1BTkFHRVNfSk9COiBFbnRpdHkoRXN0aW1hdG9yKSAtPiBKb2JcbiAgIC0gcm9sZTpTdHJpbmcgKGUuZy4gXCJlc3RpbWF0b3JcIilcblxuNi4gU0VSVklDRV9PTjogSm9iIC0+IEFzc2V0XG4gICAtIE5vIGV4dHJhIHByb3BlcnRpZXNcblxuNy4gUEFZU19GT1I6IEVudGl0eShDdXN0b21lcikgLT4gSm9iXG4gICAtIHBheWVyVHlwZTpTdHJpbmcgKFwiSW5zdXJhbmNlXCIgb3IgXCJDdXN0b21lclwiKVxuXG44LiBPRkZFUlNfUEFSVDogRW50aXR5KEpvYmJlcikgLT4gUGFydFxuICAgLSBObyBleHRyYSBwcm9wZXJ0aWVzXG5cbjkuIEhBU19MSU5FX0lURU06IEpvYiAtPiBQYXJ0XG4gICAtIHBhcnRQb3NpdGlvbjpTdHJpbmcgKGUuZy4gXCJGcm9udFwiLCBcIkZyb250TGVmdFwiLCBcIkZyb250UmlnaHRcIiwgXCJMZWZ0XCIsIFwiUmlnaHRcIiwgXCJBbGxEb29yc1wiLCBcIlJlYXJcIiwgXCJIdWxsXCIpXG4gICAtIGZpbmFsUHJpY2U6RG91YmxlXG4gICAtIHJldGFpbENvc3RBdFRpbWU6SW50XG4gICAtIGRpc2NvdW50UGVyY2VudEF0VGltZTpJbnRcbiAgIC0gaXNPdmVycmlkZGVuOkJvb2xcblxuMTAuIEpPQkJFUl9GT1JfSk9COiBFbnRpdHkoSm9iYmVyKSAtPiBKb2JcbiAgICAtIE5vIGV4dHJhIHByb3BlcnRpZXNcblxuVkVSVEVYIElEIFBBVFRFUk5TOlxuLSBDb21wYW5pZXM6IGVudGl0eV9jb18xLi5lbnRpdHlfY29fMTBcbi0gQ3VzdG9tZXJzOiBlbnRpdHlfY3VfMS4uZW50aXR5X2N1XzEyXG4tIEVzdGltYXRvcnM6IGVudGl0eV9lc18xLi5lbnRpdHlfZXNfMTBcbi0gSm9iYmVyczogZW50aXR5X2piXzEuLmVudGl0eV9qYl81LCBlbnRpdHlfbXJfMVxuLSBWZWhpY2xlczogYXNzZXRfdl8xLi5hc3NldF92XzEyXG4tIEJvYXRzOiBhc3NldF9iXzEuLmFzc2V0X2JfMlxuLSBKZXRTa2lzOiBhc3NldF9qc18xLi5hc3NldF9qc18yXG4tIENhbXBlcjogYXNzZXRfY21fMSwgUlY6IGFzc2V0X3J2XzEsIFBob25lOiBhc3NldF9waF8xLCBFcXVpcG1lbnQ6IGFzc2V0X2VxXzEsIEhvbWU6IGFzc2V0X2htXzFcbi0gSm9iczogam9iXzEuLmpvYl8xNVxuLSBQYXJ0czogcGFydF8xLi5wYXJ0XzIwXG4tIFByb2plY3RfRGF0YTogcHJvamVjdF9kYXRhXzEuLnByb2plY3RfZGF0YV8yNVxuXG5FeGFtcGxlIEdyZW1saW4gcXVlcmllczpcbi0gTGlzdCBhbGwgY29sbGlzaW9uIHNob3BzOiBnLlYoKS5oYXNMYWJlbCgnRW50aXR5JykuaGFzKCdlbnRpdHlUeXBlcycsJ0NvbXBhbnknKS52YWx1ZXMoJ2NvbXBhbnlOYW1lJykudG9MaXN0KClcbi0gTGlzdCBhbGwgY3VzdG9tZXJzOiBnLlYoKS5oYXNMYWJlbCgnRW50aXR5JykuaGFzKCdlbnRpdHlUeXBlcycsJ0N1c3RvbWVyJykudmFsdWVzKCduYW1lJykudG9MaXN0KClcbi0gR2V0IHZlaGljbGVzIG93bmVkIGJ5IGEgY3VzdG9tZXI6IGcuVigpLmhhcygnRW50aXR5JywnbmFtZScsJ0RhdmlkIFJhbWlyZXonKS5vdXQoJ09XTlNfQVNTRVQnKS5oYXMoJ2Fzc2V0VHlwZScsJ1ZlaGljbGUnKS52YWx1ZU1hcCh0cnVlKS50b0xpc3QoKVxuLSBGaW5kIHdoaWNoIGNvbXBhbnkgYW4gZXN0aW1hdG9yIHdvcmtzIGZvcjogZy5WKCkuaGFzKCdFbnRpdHknLCduYW1lJywnU2FyYWggTWl0Y2hlbGwnKS5vdXQoJ1dPUktTX0ZPUicpLnZhbHVlcygnY29tcGFueU5hbWUnKS50b0xpc3QoKVxuLSBHZXQgYWxsIGpvYnMgZm9yIGEgdmVoaWNsZTogZy5WKCdhc3NldF92XzEnKS5pbignU0VSVklDRV9PTicpLnZhbHVlTWFwKHRydWUpLnRvTGlzdCgpXG4tIEdldCBsaW5lIGl0ZW1zIG9uIGEgam9iOiBnLlYoJ2pvYl8xJykub3V0KCdIQVNfTElORV9JVEVNJykudmFsdWVNYXAodHJ1ZSkudG9MaXN0KClcbi0gR2V0IHRvdGFsIGNvc3Qgb2YgYSBqb2I6IGcuVignam9iXzEnKS5vdXRFKCdIQVNfTElORV9JVEVNJykudmFsdWVzKCdmaW5hbFByaWNlJykuc3VtKCkubmV4dCgpXG4tIEZpbmQgd2hpY2ggam9iYmVyIHN1cHBsaWVkIGEgam9iOiBnLlYoJ2pvYl8xJykuaW4oJ0pPQkJFUl9GT1JfSk9CJykudmFsdWVzKCdjb21wYW55TmFtZScpLnRvTGlzdCgpXG4tIExpc3QgYWxsIGpvYnMgbWFuYWdlZCBieSBhbiBlc3RpbWF0b3I6IGcuVigpLmhhcygnRW50aXR5JywnbmFtZScsJ1NhcmFoIE1pdGNoZWxsJykub3V0KCdNQU5BR0VTX0pPQicpLnZhbHVlTWFwKHRydWUpLnRvTGlzdCgpXG4tIEZpbmQgY3VzdG9tZXJzIG9mIGEgY29sbGlzaW9uIHNob3A6IGcuVigpLmhhcygnRW50aXR5JywnY29tcGFueU5hbWUnLCdFbGl0ZSBDb2xsaXNpb24gQ2VudGVyJykuaW4oJ1JFUVVFU1RTX1dPUksnKS5oYXMoJ2VudGl0eVR5cGVzJywnQ3VzdG9tZXInKS52YWx1ZXMoJ25hbWUnKS50b0xpc3QoKVxuLSBHZXQgcGFydHMgb2ZmZXJlZCBieSBhIGpvYmJlcjogZy5WKCkuaGFzKCdFbnRpdHknLCdjb21wYW55TmFtZScsJ05vcnRod2VzdCBQUEYgU29sdXRpb25zJykub3V0KCdPRkZFUlNfUEFSVCcpLnZhbHVlTWFwKHRydWUpLnRvTGlzdCgpXG4tIENvdW50IHZlcnRpY2VzIGJ5IGxhYmVsOiBnLlYoKS5ncm91cENvdW50KCkuYnkobGFiZWwpLm5leHQoKVxuLSBDb3VudCBlZGdlcyBieSBsYWJlbDogZy5FKCkuZ3JvdXBDb3VudCgpLmJ5KGxhYmVsKS5uZXh0KClcbi0gR2V0IGFsbCB2ZXJ0ZXggbGFiZWxzOiBnLlYoKS5sYWJlbCgpLmRlZHVwKCkudG9MaXN0KClcbi0gR2V0IGFsbCBlZGdlIGxhYmVsczogZy5FKCkubGFiZWwoKS5kZWR1cCgpLnRvTGlzdCgpXG4tIExpc3QgYWxsIGJ1c2luZXNzIHNlcnZpY2VzL3Byb2plY3RzOiBnLlYoKS5oYXNMYWJlbCgnUHJvamVjdF9EYXRhJykudmFsdWVzKCdwcm9qZWN0TmFtZScpLnRvTGlzdCgpXG4tIEZpbmQgYWxsIFRpZXIgMSBjcml0aWNhbCBzZXJ2aWNlczogZy5WKCkuaGFzTGFiZWwoJ1Byb2plY3RfRGF0YScpLmhhcygnVGllcicsJzEnKS52YWx1ZU1hcCh0cnVlKS50b0xpc3QoKVxuLSBGaW5kIHByb2plY3RzIG93bmVkIGJ5IGEgZ3JvdXA6IGcuVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKS5oYXMoJ093bmVyR3JvdXAnLCdTZWN1cml0eScpLnZhbHVlTWFwKCdwcm9qZWN0TmFtZScsJ1RlYW0nLCdSZWNvdmVyeScsJ1RpZXInKS50b0xpc3QoKVxuLSBGaW5kIHByb2plY3RzIGJ5IGRhdGEgY2xhc3NpZmljYXRpb246IGcuVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKS5oYXMoJ0RhdGFDbGFzc2lmaWNhdGlvbicsJ1Jlc3RyaWN0ZWQnKS52YWx1ZU1hcCgncHJvamVjdE5hbWUnLCdUZWFtJywnT3duZXJHcm91cCcpLnRvTGlzdCgpXG4tIEZpbmQgcHJvamVjdHMgaW4gYSBkZXBhcnRtZW50OiBnLlYoKS5oYXNMYWJlbCgnUHJvamVjdF9EYXRhJykuaGFzKCdEZXBhcnRtZW50TnVtYmVyJywnRC0zMDEwJykudmFsdWVNYXAoJ3Byb2plY3ROYW1lJywnVGVhbScsJ1JlY292ZXJ5JykudG9MaXN0KClcbi0gQ291bnQgcHJvamVjdHMgYnkgb3duZXIgZ3JvdXA6IGcuVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKS5ncm91cENvdW50KCkuYnkoJ093bmVyR3JvdXAnKS5uZXh0KClcbi0gQ291bnQgcHJvamVjdHMgYnkgdGllcjogZy5WKCkuaGFzTGFiZWwoJ1Byb2plY3RfRGF0YScpLmdyb3VwQ291bnQoKS5ieSgnVGllcicpLm5leHQoKVxuLSBGaW5kIHByb2plY3RzIGJ5IHRlYW06IGcuVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKS5oYXMoJ1RlYW0nLCdEYXRhIFNjaWVuY2UnKS52YWx1ZU1hcCgncHJvamVjdE5hbWUnLCdEYXRhQ2xhc3NpZmljYXRpb24nLCdSZWNvdmVyeScsJ1RpZXInKS50b0xpc3QoKVxuYDtcblxuY29uc3QgU1lTVEVNX1BST01QVCA9IGBZb3UgYXJlIGEgZ3JhcGggZGF0YWJhc2UgYXNzaXN0YW50IGZvciBhbiBBbWF6b24gTmVwdHVuZSBncmFwaCBkYXRhYmFzZSB0aGF0IG1vZGVscyBhIGNvbGxpc2lvbiByZXBhaXIgYW5kIFBQRiAoUGFpbnQgUHJvdGVjdGlvbiBGaWxtKSBidXNpbmVzcyBuZXR3b3JrLlxuXG5UaGUgYnVzaW5lc3MgZG9tYWluIGluY2x1ZGVzOlxuLSAqKkNvbGxpc2lvbiBTaG9wcyoqIChDb21wYW5pZXMpIHRoYXQgcmVwYWlyIHZlaGljbGVzXG4tICoqQ3VzdG9tZXJzKiogd2hvIGJyaW5nIHZlaGljbGVzIGFuZCBvdGhlciBhc3NldHMgZm9yIHNlcnZpY2Vcbi0gKipFc3RpbWF0b3JzKiogd2hvIHdvcmsgZm9yIGNvbGxpc2lvbiBzaG9wcyBhbmQgbWFuYWdlIHJlcGFpciBqb2JzXG4tICoqSm9iYmVycyoqIChQUEYgZmlsbSBzdXBwbGllcnMvaW5zdGFsbGVycykgd2hvIHN1cHBseSBwYXJ0cyB0byBjb2xsaXNpb24gc2hvcHNcbi0gKipBc3NldHMqKiBvd25lZCBieSBjdXN0b21lcnMgKFZlaGljbGVzLCBCb2F0cywgSmV0U2tpcywgQ2FtcGVycywgUlZzLCBQaG9uZXMsIEVxdWlwbWVudCwgSG9tZXMpXG4tICoqSm9icyoqIChyZXBhaXIgb3JkZXJzKSB0aGF0IHRyYWNrIFBQRiBpbnN0YWxsYXRpb24gd29ya1xuLSAqKlBhcnRzKiogKFBQRiBmaWxtIHBpZWNlcyBsaWtlIGJ1bXBlcnMsIGZlbmRlcnMsIGhvb2RzKSBvZmZlcmVkIGJ5IGpvYmJlcnNcbi0gKipCdXNpbmVzcyBTZXJ2aWNlcyAvIFByb2plY3RzKiogKFByb2plY3RfRGF0YSkgcmVwcmVzZW50aW5nIElUIHByb2plY3RzIGFuZCBidXNpbmVzcyBzZXJ2aWNlcyB3aXRoIGRlcGFydG1lbnQgb3duZXJzaGlwLCBkYXRhIGNsYXNzaWZpY2F0aW9uLCB0ZWFtIGFzc2lnbm1lbnRzLCByZWNvdmVyeSBwcmlvcml0aWVzLCBhbmQgdGllciBsZXZlbHNcblxuJHtHUkFQSF9TQ0hFTUF9XG5cbldoZW4gYSB1c2VyIGFza3MgYSBxdWVzdGlvbiBhYm91dCB0aGUgZ3JhcGggZGF0YTpcbjEuIERldGVybWluZSBpZiB5b3UgbmVlZCB0byBxdWVyeSB0aGUgZ3JhcGggdG8gYW5zd2VyXG4yLiBJZiB5ZXMsIGdlbmVyYXRlIGEgR3JlbWxpbiBxdWVyeVxuMy4gUmV0dXJuIHlvdXIgcmVzcG9uc2UgYXMgSlNPTlxuXG5JTVBPUlRBTlQgUlVMRVM6XG4tIE9ubHkgZ2VuZXJhdGUgUkVBRCBxdWVyaWVzIChubyBtdXRhdGlvbnMvZHJvcHMpXG4tIFVzZSB0aGUgR3JlbWxpbiB0cmF2ZXJzYWwgbGFuZ3VhZ2Vcbi0gRWRnZSBsYWJlbHMgYXJlIFVQUEVSQ0FTRSAoZS5nLiBXT1JLU19GT1IsIE9XTlNfQVNTRVQsIEhBU19MSU5FX0lURU0pXG4tIFVzZSAnbmFtZScgZm9yIHBlb3BsZSAoQ3VzdG9tZXJzLCBFc3RpbWF0b3JzKSBhbmQgJ2NvbXBhbnlOYW1lJyBmb3IgYnVzaW5lc3NlcyAoQ29tcGFuaWVzLCBKb2JiZXJzKVxuLSBBbHdheXMgcmV0dXJuIHZhbGlkIEpTT04gaW4gdGhpcyBleGFjdCBmb3JtYXQ6XG5cbklmIGEgcXVlcnkgaXMgbmVlZGVkOlxue1wibmVlZHNRdWVyeVwiOiB0cnVlLCBcImdyZW1saW5RdWVyeVwiOiBcIjx0aGUgZ3JlbWxpbiB0cmF2ZXJzYWwgYWZ0ZXIgZy4+XCIsIFwiZXhwbGFuYXRpb25cIjogXCI8YnJpZWYgZXhwbGFuYXRpb24gb2Ygd2hhdCB0aGUgcXVlcnkgZG9lcz5cIn1cblxuSWYgbm8gcXVlcnkgaXMgbmVlZGVkIChnZW5lcmFsIHF1ZXN0aW9uIGFib3V0IHRoZSBzY2hlbWEsIGdyZWV0aW5ncywgZXRjLik6XG57XCJuZWVkc1F1ZXJ5XCI6IGZhbHNlLCBcImFuc3dlclwiOiBcIjx5b3VyIGFuc3dlcj5cIiwgXCJleHBsYW5hdGlvblwiOiBcIlwifVxuXG5FeGFtcGxlczpcblVzZXI6IFwiV2hhdCBjb2xsaXNpb24gc2hvcHMgYXJlIGluIHRoZSBzeXN0ZW0/XCJcbntcIm5lZWRzUXVlcnlcIjogdHJ1ZSwgXCJncmVtbGluUXVlcnlcIjogXCJWKCkuaGFzTGFiZWwoJ0VudGl0eScpLmhhcygnZW50aXR5VHlwZXMnLCdDb21wYW55JykudmFsdWVzKCdjb21wYW55TmFtZScpLnRvTGlzdCgpXCIsIFwiZXhwbGFuYXRpb25cIjogXCJMaXN0cyBhbGwgY29tcGFueSBuYW1lc1wifVxuXG5Vc2VyOiBcIldoYXQgdmVoaWNsZXMgZG9lcyBEYXZpZCBSYW1pcmV6IG93bj9cIlxue1wibmVlZHNRdWVyeVwiOiB0cnVlLCBcImdyZW1saW5RdWVyeVwiOiBcIlYoKS5oYXMoJ0VudGl0eScsJ25hbWUnLCdEYXZpZCBSYW1pcmV6Jykub3V0KCdPV05TX0FTU0VUJykuaGFzKCdhc3NldFR5cGUnLCdWZWhpY2xlJykudmFsdWVNYXAoJ21ha2UnLCdtb2RlbCcsJ3llYXInLCd2aW4nKS50b0xpc3QoKVwiLCBcImV4cGxhbmF0aW9uXCI6IFwiRmluZHMgdmVoaWNsZXMgb3duZWQgYnkgRGF2aWQgUmFtaXJlelwifVxuXG5Vc2VyOiBcIkhvdyBtdWNoIGRvZXMgam9iIFJPLTEwMjkzOCBjb3N0P1wiXG57XCJuZWVkc1F1ZXJ5XCI6IHRydWUsIFwiZ3JlbWxpblF1ZXJ5XCI6IFwiVigpLmhhc0xhYmVsKCdKb2InKS5oYXMoJ3JvTnVtYmVyJywnUk8tMTAyOTM4Jykub3V0RSgnSEFTX0xJTkVfSVRFTScpLnZhbHVlcygnZmluYWxQcmljZScpLnN1bSgpLm5leHQoKVwiLCBcImV4cGxhbmF0aW9uXCI6IFwiU3VtcyB0aGUgZmluYWwgcHJpY2VzIG9mIGFsbCBsaW5lIGl0ZW1zIG9uIHRoZSBqb2JcIn1cblxuVXNlcjogXCJXaG8gaXMgdGhlIGVzdGltYXRvciBmb3Igam9iIDE/XCJcbntcIm5lZWRzUXVlcnlcIjogdHJ1ZSwgXCJncmVtbGluUXVlcnlcIjogXCJWKCdqb2JfMScpLmluKCdNQU5BR0VTX0pPQicpLnZhbHVlcygnbmFtZScpLnRvTGlzdCgpXCIsIFwiZXhwbGFuYXRpb25cIjogXCJGaW5kcyB0aGUgZXN0aW1hdG9yIG1hbmFnaW5nIGpvYl8xXCJ9XG5cblVzZXI6IFwiV2hhdCB0eXBlcyBvZiBkYXRhIGFyZSBpbiB0aGlzIGdyYXBoP1wiXG57XCJuZWVkc1F1ZXJ5XCI6IGZhbHNlLCBcImFuc3dlclwiOiBcIlRoZSBncmFwaCBtb2RlbHMgYSBjb2xsaXNpb24gcmVwYWlyIGFuZCBQUEYgYnVzaW5lc3MgbmV0d29yayB3aXRoOiBFbnRpdHkgdmVydGljZXMgKENvbXBhbmllcywgQ3VzdG9tZXJzLCBFc3RpbWF0b3JzLCBKb2JiZXJzKSwgQXNzZXQgdmVydGljZXMgKFZlaGljbGVzLCBCb2F0cywgSmV0U2tpcywgQ2FtcGVycywgUlZzLCBldGMuKSwgSm9iIHZlcnRpY2VzIChyZXBhaXIgb3JkZXJzKSwgYW5kIFBhcnQgdmVydGljZXMgKFBQRiBmaWxtIHBpZWNlcykuIFJlbGF0aW9uc2hpcHMgaW5jbHVkZSBXT1JLU19GT1IsIFJFUVVFU1RTX1dPUkssIERPRVNfV09SS19GT1IsIE9XTlNfQVNTRVQsIE1BTkFHRVNfSk9CLCBTRVJWSUNFX09OLCBQQVlTX0ZPUiwgT0ZGRVJTX1BBUlQsIEhBU19MSU5FX0lURU0sIGFuZCBKT0JCRVJfRk9SX0pPQi5cIiwgXCJleHBsYW5hdGlvblwiOiBcIlwifVxuXG5Vc2VyOiBcIldoYXQgZGlzY291bnQgZG9lcyBOb3J0aHdlc3QgUFBGIFNvbHV0aW9ucyBnaXZlIEVsaXRlIENvbGxpc2lvbiBDZW50ZXI/XCJcbntcIm5lZWRzUXVlcnlcIjogdHJ1ZSwgXCJncmVtbGluUXVlcnlcIjogXCJWKCkuaGFzKCdFbnRpdHknLCdjb21wYW55TmFtZScsJ05vcnRod2VzdCBQUEYgU29sdXRpb25zJykub3V0RSgnRE9FU19XT1JLX0ZPUicpLndoZXJlKGluVigpLmhhcygnY29tcGFueU5hbWUnLCdFbGl0ZSBDb2xsaXNpb24gQ2VudGVyJykpLnZhbHVlcygnZGlzY291bnRQZXJjZW50JykudG9MaXN0KClcIiwgXCJleHBsYW5hdGlvblwiOiBcIkdldHMgdGhlIGRpc2NvdW50IHBlcmNlbnRhZ2Ugb24gdGhlIGpvYmJlci10by1jb21wYW55IHJlbGF0aW9uc2hpcFwifVxuXG5Vc2VyOiBcIldoYXQgYnVzaW5lc3Mgc2VydmljZXMgYXJlIHRoZXJlP1wiXG57XCJuZWVkc1F1ZXJ5XCI6IHRydWUsIFwiZ3JlbWxpblF1ZXJ5XCI6IFwiVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKS52YWx1ZU1hcCgncHJvamVjdE5hbWUnLCdPd25lckdyb3VwJywnVGllcicsJ1JlY292ZXJ5JykudG9MaXN0KClcIiwgXCJleHBsYW5hdGlvblwiOiBcIkxpc3RzIGFsbCBidXNpbmVzcyBzZXJ2aWNlcyB3aXRoIHRoZWlyIG93bmVyIGdyb3VwLCB0aWVyLCBhbmQgcmVjb3ZlcnkgcHJpb3JpdHlcIn1cblxuVXNlcjogXCJXaGljaCBwcm9qZWN0cyBhcmUgY3JpdGljYWwgcmVjb3Zlcnk/XCJcbntcIm5lZWRzUXVlcnlcIjogdHJ1ZSwgXCJncmVtbGluUXVlcnlcIjogXCJWKCkuaGFzTGFiZWwoJ1Byb2plY3RfRGF0YScpLmhhcygnUmVjb3ZlcnknLCdDcml0aWNhbCcpLnZhbHVlTWFwKCdwcm9qZWN0TmFtZScsJ1RlYW0nLCdPd25lckdyb3VwJywnVGllcicpLnRvTGlzdCgpXCIsIFwiZXhwbGFuYXRpb25cIjogXCJGaW5kcyBhbGwgcHJvamVjdHMgd2l0aCBDcml0aWNhbCByZWNvdmVyeSBwcmlvcml0eVwifVxuXG5Vc2VyOiBcIlNob3cgbWUgYWxsIHJlc3RyaWN0ZWQgZGF0YSBwcm9qZWN0c1wiXG57XCJuZWVkc1F1ZXJ5XCI6IHRydWUsIFwiZ3JlbWxpblF1ZXJ5XCI6IFwiVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKS5oYXMoJ0RhdGFDbGFzc2lmaWNhdGlvbicsJ1Jlc3RyaWN0ZWQnKS52YWx1ZU1hcCgncHJvamVjdE5hbWUnLCdUZWFtJywnT3duZXJHcm91cCcsJ1JlY292ZXJ5JywnVGllcicpLnRvTGlzdCgpXCIsIFwiZXhwbGFuYXRpb25cIjogXCJGaW5kcyBwcm9qZWN0cyB3aXRoIFJlc3RyaWN0ZWQgZGF0YSBjbGFzc2lmaWNhdGlvblwifVxuXG5Vc2VyOiBcIldoYXQgcHJvamVjdHMgZG9lcyB0aGUgU2VjdXJpdHkgdGVhbSBvd24/XCJcbntcIm5lZWRzUXVlcnlcIjogdHJ1ZSwgXCJncmVtbGluUXVlcnlcIjogXCJWKCkuaGFzTGFiZWwoJ1Byb2plY3RfRGF0YScpLmhhcygnT3duZXJHcm91cCcsJ1NlY3VyaXR5JykudmFsdWVNYXAoJ3Byb2plY3ROYW1lJywnVGVhbScsJ0RhdGFDbGFzc2lmaWNhdGlvbicsJ1JlY292ZXJ5JywnVGllcicpLnRvTGlzdCgpXCIsIFwiZXhwbGFuYXRpb25cIjogXCJMaXN0cyBhbGwgcHJvamVjdHMgb3duZWQgYnkgdGhlIFNlY3VyaXR5IGdyb3VwXCJ9XG5gO1xuXG5pbnRlcmZhY2UgQmVkcm9ja01lc3NhZ2Uge1xuICByb2xlOiBzdHJpbmc7XG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIENvbnZlcnNhdGlvbkVudHJ5IHtcbiAgcm9sZTogc3RyaW5nO1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGludm9rZUJlZHJvY2sobWVzc2FnZXM6IEJlZHJvY2tNZXNzYWdlW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICAvLyBVc2UgQVdTIFNESyB2MyAtIGR5bmFtaWNhbGx5IGltcG9ydCB0byB3b3JrIHdpdGggTGFtYmRhIGJ1bmRsaW5nXG4gIGNvbnN0IHsgQmVkcm9ja1J1bnRpbWVDbGllbnQsIENvbnZlcnNlQ29tbWFuZCB9ID0gYXdhaXQgaW1wb3J0KFxuICAgIFwiQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZVwiXG4gICk7XG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IEJlZHJvY2tSdW50aW1lQ2xpZW50KHsgcmVnaW9uOiBCRURST0NLX1JFR0lPTiB9KTtcblxuICBjb25zdCBjb21tYW5kID0gbmV3IENvbnZlcnNlQ29tbWFuZCh7XG4gICAgbW9kZWxJZDogTU9ERUxfSUQsXG4gICAgc3lzdGVtOiBbeyB0ZXh0OiBTWVNURU1fUFJPTVBUIH1dLFxuICAgIG1lc3NhZ2VzOiBtZXNzYWdlcy5tYXAoKG0pID0+ICh7XG4gICAgICByb2xlOiBtLnJvbGUgYXMgXCJ1c2VyXCIgfCBcImFzc2lzdGFudFwiLFxuICAgICAgY29udGVudDogW3sgdGV4dDogbS5jb250ZW50IH1dLFxuICAgIH0pKSxcbiAgICBpbmZlcmVuY2VDb25maWc6IHtcbiAgICAgIG1heFRva2VuczogMTAyNCxcbiAgICB9LFxuICB9KTtcblxuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGNsaWVudC5zZW5kKGNvbW1hbmQpO1xuICBjb25zdCBvdXRwdXQgPSByZXNwb25zZS5vdXRwdXQ/Lm1lc3NhZ2U/LmNvbnRlbnQ7XG4gIGlmICghb3V0cHV0IHx8IG91dHB1dC5sZW5ndGggPT09IDAgfHwgIW91dHB1dFswXS50ZXh0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiRW1wdHkgcmVzcG9uc2UgZnJvbSBCZWRyb2NrXCIpO1xuICB9XG4gIHJldHVybiBvdXRwdXRbMF0udGV4dDtcbn1cblxuLy8gR3JlbWxpbiBzdGVwcyB0aGF0IG11dGF0ZSB0aGUgZ3JhcGgg4oCUIHRoZXNlIGFyZSBub3QgYWxsb3dlZCBpbiByZWFkLW9ubHkgbW9kZVxuY29uc3QgTVVUQVRJT05fUEFUVEVSTiA9XG4gIC9cXGIoYWRkVnxhZGRFfGFkZFZlcnRleHxhZGRFZGdlfGRyb3B8cHJvcGVydHl8aXRlcmF0ZXxzaWRlRWZmZWN0fGluamVjdClcXHMqXFwoL2k7XG5cbmZ1bmN0aW9uIHZhbGlkYXRlR3JlbWxpblF1ZXJ5KHF1ZXJ5U3RyaW5nOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKE1VVEFUSU9OX1BBVFRFUk4udGVzdChxdWVyeVN0cmluZykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBcIlF1ZXJ5IGNvbnRhaW5zIG11dGF0aW9uIG9wZXJhdGlvbnMgd2hpY2ggYXJlIG5vdCBhbGxvd2VkXCJcbiAgICApO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGV4ZWN1dGVHcmVtbGluKHF1ZXJ5U3RyaW5nOiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcbiAgdmFsaWRhdGVHcmVtbGluUXVlcnkocXVlcnlTdHJpbmcpO1xuXG4gIGNvbnN0IHsgdXJsLCBoZWFkZXJzIH0gPSBnZXRVcmxBbmRIZWFkZXJzKFxuICAgIHByb2Nlc3MuZW52Lk5FUFRVTkVfRU5EUE9JTlQsXG4gICAgcHJvY2Vzcy5lbnYuTkVQVFVORV9QT1JULFxuICAgIHt9LFxuICAgIFwiL2dyZW1saW5cIixcbiAgICBcIndzc1wiXG4gICk7XG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IENsaWVudCh1cmwsIHtcbiAgICBtaW1lVHlwZTogXCJhcHBsaWNhdGlvbi92bmQuZ3JlbWxpbi12Mi4wK2pzb25cIixcbiAgICBoZWFkZXJzOiBoZWFkZXJzLFxuICB9KTtcblxuICB0cnkge1xuICAgIC8vIFN1Ym1pdCB0aGUgcXVlcnkgc3RyaW5nIHRvIHRoZSBHcmVtbGluIHNlcnZlciBmb3Igc2VydmVyLXNpZGUgZXhlY3V0aW9uLlxuICAgIC8vIFRoaXMgYXZvaWRzIGxvY2FsIEphdmFTY3JpcHQgZXZhbHVhdGlvbiAobm8gRnVuY3Rpb24gY29uc3RydWN0b3IgLyBldmFsKS5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjbGllbnQuc3VibWl0KGBnLiR7cXVlcnlTdHJpbmd9YCk7XG4gICAgcmV0dXJuIHJlc3VsdC50b0FycmF5ID8gcmVzdWx0LnRvQXJyYXkoKSA6IHJlc3VsdDtcbiAgfSBmaW5hbGx5IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xpZW50LmNsb3NlKCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKFwiRXJyb3IgY2xvc2luZyBjb25uZWN0aW9uOlwiLCBlKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcbiAgY29uc29sZS5sb2coXCJBSSBRdWVyeSBldmVudDpcIiwgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcblxuICBjb25zdCBxdWVzdGlvbiA9IGV2ZW50LmFyZ3VtZW50cz8ucXVlc3Rpb247XG4gIGNvbnN0IGNvbnZlcnNhdGlvbkhpc3Rvcnk6IENvbnZlcnNhdGlvbkVudHJ5W10gPSBldmVudC5hcmd1bWVudHM/Lmhpc3RvcnlcbiAgICA/IEpTT04ucGFyc2UoZXZlbnQuYXJndW1lbnRzLmhpc3RvcnkpXG4gICAgOiBbXTtcblxuICBpZiAoIXF1ZXN0aW9uKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFuc3dlcjpcbiAgICAgICAgXCJQbGVhc2UgYXNrIGEgcXVlc3Rpb24gYWJvdXQgdGhlIGdyYXBoIGRhdGEuIEZvciBleGFtcGxlOiAnV2hhdCBjb2xsaXNpb24gc2hvcHMgYXJlIGluIHRoZSBzeXN0ZW0/JywgJ1doYXQgdmVoaWNsZXMgZG9lcyBEYXZpZCBSYW1pcmV6IG93bj8nLCBvciAnSG93IG11Y2ggZG9lcyBqb2IgUk8tMTAyOTM4IGNvc3Q/J1wiLFxuICAgICAgcXVlcnk6IG51bGwsXG4gICAgICBkYXRhOiBudWxsLFxuICAgIH07XG4gIH1cblxuICB0cnkge1xuICAgIC8vIEJ1aWxkIG1lc3NhZ2VzIGZvciBCZWRyb2NrIGluY2x1ZGluZyBjb252ZXJzYXRpb24gaGlzdG9yeVxuICAgIGNvbnN0IG1lc3NhZ2VzOiBCZWRyb2NrTWVzc2FnZVtdID0gW107XG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGNvbnZlcnNhdGlvbkhpc3RvcnkpIHtcbiAgICAgIG1lc3NhZ2VzLnB1c2goe1xuICAgICAgICByb2xlOiBlbnRyeS5yb2xlID09PSBcInVzZXJcIiA/IFwidXNlclwiIDogXCJhc3Npc3RhbnRcIixcbiAgICAgICAgY29udGVudDogZW50cnkuY29udGVudCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIG1lc3NhZ2VzLnB1c2goe1xuICAgICAgcm9sZTogXCJ1c2VyXCIsXG4gICAgICBjb250ZW50OiBxdWVzdGlvbixcbiAgICB9KTtcblxuICAgIC8vIENvbnZlcnNlIEFQSSByZXF1aXJlcyBmaXJzdCBtZXNzYWdlIHRvIGJlIGZyb20gXCJ1c2VyXCIg4oCUIHN0cmlwIGxlYWRpbmcgYXNzaXN0YW50IG1lc3NhZ2VzXG4gICAgd2hpbGUgKG1lc3NhZ2VzLmxlbmd0aCA+IDAgJiYgbWVzc2FnZXNbMF0ucm9sZSAhPT0gXCJ1c2VyXCIpIHtcbiAgICAgIG1lc3NhZ2VzLnNoaWZ0KCk7XG4gICAgfVxuXG4gICAgY29uc29sZS5sb2coXCJTZW5kaW5nIG1lc3NhZ2VzIHRvIEJlZHJvY2s6XCIsIEpTT04uc3RyaW5naWZ5KG1lc3NhZ2VzLm1hcChtID0+ICh7IHJvbGU6IG0ucm9sZSwgbGVuOiBtLmNvbnRlbnQubGVuZ3RoIH0pKSkpO1xuXG4gICAgLy8gQ2FsbCBCZWRyb2NrIHRvIGludGVycHJldCB0aGUgcXVlc3Rpb25cbiAgICBjb25zdCBiZWRyb2NrUmVzcG9uc2UgPSBhd2FpdCBpbnZva2VCZWRyb2NrKG1lc3NhZ2VzKTtcbiAgICBjb25zb2xlLmxvZyhcIkJlZHJvY2sgcmVzcG9uc2U6XCIsIGJlZHJvY2tSZXNwb25zZSk7XG5cbiAgICAvLyBQYXJzZSBCZWRyb2NrJ3MgcmVzcG9uc2UgLSBleHRyYWN0IEpTT04gZnJvbSB0aGUgdGV4dFxuICAgIGxldCBwYXJzZWQ7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyeSB0byBleHRyYWN0IEpTT04gZnJvbSB0aGUgcmVzcG9uc2VcbiAgICAgIGNvbnN0IGpzb25NYXRjaCA9IGJlZHJvY2tSZXNwb25zZS5tYXRjaCgvXFx7W1xcc1xcU10qXFx9Lyk7XG4gICAgICBpZiAoanNvbk1hdGNoKSB7XG4gICAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbk1hdGNoWzBdKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoYmVkcm9ja1Jlc3BvbnNlKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChwYXJzZUVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHBhcnNlIEJlZHJvY2sgcmVzcG9uc2U6XCIsIHBhcnNlRXJyb3IpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgYW5zd2VyOiBiZWRyb2NrUmVzcG9uc2UsXG4gICAgICAgIHF1ZXJ5OiBudWxsLFxuICAgICAgICBkYXRhOiBudWxsLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBpZiAoIXBhcnNlZC5uZWVkc1F1ZXJ5KSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBhbnN3ZXI6IHBhcnNlZC5hbnN3ZXIgfHwgYmVkcm9ja1Jlc3BvbnNlLFxuICAgICAgICBxdWVyeTogbnVsbCxcbiAgICAgICAgZGF0YTogbnVsbCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gRXhlY3V0ZSB0aGUgR3JlbWxpbiBxdWVyeVxuICAgIGNvbnN0IGdyZW1saW5RdWVyeSA9IHBhcnNlZC5ncmVtbGluUXVlcnk7XG4gICAgY29uc29sZS5sb2coXCJFeGVjdXRpbmcgR3JlbWxpbiBxdWVyeTpcIiwgZ3JlbWxpblF1ZXJ5KTtcblxuICAgIGxldCBxdWVyeVJlc3VsdDtcbiAgICB0cnkge1xuICAgICAgcXVlcnlSZXN1bHQgPSBhd2FpdCBleGVjdXRlR3JlbWxpbihncmVtbGluUXVlcnkpO1xuICAgIH0gY2F0Y2ggKHF1ZXJ5RXJyb3I6IHVua25vd24pIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJHcmVtbGluIHF1ZXJ5IGVycm9yOlwiLCBxdWVyeUVycm9yKTtcbiAgICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9XG4gICAgICAgIHF1ZXJ5RXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IHF1ZXJ5RXJyb3IubWVzc2FnZSA6IFN0cmluZyhxdWVyeUVycm9yKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGFuc3dlcjogYEkgdHJpZWQgdG8gcXVlcnkgdGhlIGdyYXBoIGJ1dCBlbmNvdW50ZXJlZCBhbiBlcnJvci4gVGhlIHF1ZXJ5IHdhczogZy4ke2dyZW1saW5RdWVyeX0uIEVycm9yOiAke2Vycm9yTWVzc2FnZX1gLFxuICAgICAgICBxdWVyeTogYGcuJHtncmVtbGluUXVlcnl9YCxcbiAgICAgICAgZGF0YTogbnVsbCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gRm9ybWF0IHRoZSByZXN1bHRcbiAgICBjb25zdCByZXN1bHRTdHIgPSBKU09OLnN0cmluZ2lmeShxdWVyeVJlc3VsdCwgbnVsbCwgMik7XG4gICAgY29uc29sZS5sb2coXCJRdWVyeSByZXN1bHQ6XCIsIHJlc3VsdFN0cik7XG5cbiAgICAvLyBBc2sgQmVkcm9jayB0byBzdW1tYXJpemUgdGhlIHJlc3VsdHNcbiAgICBjb25zdCBzdW1tYXJ5TWVzc2FnZXM6IEJlZHJvY2tNZXNzYWdlW10gPSBbXG4gICAgICAuLi5tZXNzYWdlcyxcbiAgICAgIHtcbiAgICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgICAgY29udGVudDogYEkgZXhlY3V0ZWQgdGhlIEdyZW1saW4gcXVlcnk6IGcuJHtncmVtbGluUXVlcnl9YCxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIHJvbGU6IFwidXNlclwiLFxuICAgICAgICBjb250ZW50OiBgVGhlIHF1ZXJ5IHJldHVybmVkIHRoZXNlIHJlc3VsdHM6ICR7cmVzdWx0U3RyfVxcblxcblBsZWFzZSBwcm92aWRlIGEgY2xlYXIsIGNvbmNpc2UgbmF0dXJhbCBsYW5ndWFnZSBzdW1tYXJ5IG9mIHRoZXNlIHJlc3VsdHMgdG8gYW5zd2VyIG15IG9yaWdpbmFsIHF1ZXN0aW9uLiBEbyBub3QgcmV0dXJuIEpTT04sIGp1c3QgYSBwbGFpbiB0ZXh0IGFuc3dlci5gLFxuICAgICAgfSxcbiAgICBdO1xuXG4gICAgY29uc3Qgc3VtbWFyeSA9IGF3YWl0IGludm9rZUJlZHJvY2soc3VtbWFyeU1lc3NhZ2VzKTtcblxuICAgIHJldHVybiB7XG4gICAgICBhbnN3ZXI6IHN1bW1hcnksXG4gICAgICBxdWVyeTogYGcuJHtncmVtbGluUXVlcnl9YCxcbiAgICAgIGRhdGE6IHJlc3VsdFN0cixcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcjogdW5rbm93bikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJBSSBRdWVyeSBlcnJvcjpcIiwgZXJyb3IpO1xuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9XG4gICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgcmV0dXJuIHtcbiAgICAgIGFuc3dlcjogYFNvcnJ5LCBJIGVuY291bnRlcmVkIGFuIGVycm9yIHByb2Nlc3NpbmcgeW91ciBxdWVzdGlvbjogJHtlcnJvck1lc3NhZ2V9YCxcbiAgICAgIHF1ZXJ5OiBudWxsLFxuICAgICAgZGF0YTogbnVsbCxcbiAgICB9O1xuICB9XG59O1xuIl19