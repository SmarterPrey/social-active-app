"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
// Node 22+ defines a global WebSocket via undici. gremlin-aws-sigv4 injects
// SigV4 headers through the ws-npm API; if gremlin picks up the built-in
// WebSocket instead, auth headers are dropped and Neptune returns non-101.
// Removing the global forces gremlin to use the bundled ws npm package.
delete globalThis.WebSocket;
const gremlin = require("gremlin");
const utils_1 = require("gremlin-aws-sigv4/lib/utils");
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const P = gremlin.process.P;
const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const __ = gremlin.process.statics;
const TextP = gremlin.process.TextP;
const handler = async (event) => {
    let conn = null;
    const getConnectionDetails = () => {
        return (0, utils_1.getUrlAndHeaders)(process.env.NEPTUNE_ENDPOINT, process.env.NEPTUNE_PORT, {}, "/gremlin", "wss");
    };
    const createRemoteConnection = () => {
        const { url, headers } = getConnectionDetails();
        console.log(url);
        console.log(headers);
        const c = new DriverRemoteConnection(url, {
            mimeType: "application/vnd.gremlin-v2.0+json",
            headers: headers,
        });
        const socketConnection = c;
        socketConnection._client?._connection?.on("close", (code, message) => {
            console.info(`close - ${code} ${message}`);
            if (code == 1006) {
                console.error("Connection closed prematurely");
                throw new Error("Connection closed prematurely");
            }
        });
        return c;
    };
    let g = null;
    const type = event.arguments.type;
    console.log(type);
    try {
        if (conn == null) {
            console.info("Initializing connection");
            conn = createRemoteConnection();
            g = traversal().withRemote(conn);
        }
        // Entity search handlers
        const searchConfig = {
            Company: { label: 'Entity', fields: ['companyName'], entityType: 'Company' },
            Customer: { label: 'Entity', fields: ['name'], entityType: 'Customer' },
            Estimator: { label: 'Entity', fields: ['name'], entityType: 'Estimator' },
            Jobber: { label: 'Entity', fields: ['companyName'], entityType: 'Jobber' },
            Asset: { label: 'Asset', fields: ['make', 'model', 'vin'] },
            Job: { label: 'Job', fields: ['jobName'] },
            Part: { label: 'Part', fields: ['partName'] },
            Project_Data: { label: 'Project_Data', fields: ['projectName'] },
        };
        if (event.field === "searchEntities") {
            const { vertexType, searchValue } = event.arguments;
            const cfg = searchConfig[vertexType];
            if (!cfg)
                throw new Error(`Unknown vertex type: ${vertexType}`);
            let searchQuery = g.V().hasLabel(cfg.label);
            if (cfg.entityType) {
                searchQuery = searchQuery.has('entityTypes', cfg.entityType);
            }
            // Only apply text filter if searchValue is non-empty
            const trimmed = (searchValue || '').trim();
            if (trimmed && trimmed !== '*') {
                if (cfg.fields.length === 1) {
                    searchQuery = searchQuery.has(cfg.fields[0], TextP.containing(trimmed));
                }
                else {
                    searchQuery = searchQuery.or(...cfg.fields.map((f) => __.has(f, TextP.containing(trimmed))));
                }
            }
            const results = await searchQuery
                .project('id', 'name', 'label', 'entityType')
                .by(__.id())
                .by(__.coalesce(__.values('companyName'), __.values('name'), __.values('jobName'), __.values('partName'), __.values('make'), __.constant('Unknown')))
                .by(__.label())
                .by(__.coalesce(__.values('entityTypes'), __.constant('')))
                .limit(50)
                .toList();
            return results.map((r) => ({
                id: r.id ?? (r.get ? r.get('id') : undefined),
                name: r.name ?? (r.get ? r.get('name') : undefined),
                label: r.label ?? (r.get ? r.get('label') : undefined),
                entityType: r.entityType || (r.get ? r.get('entityType') : null) || null,
            }));
        }
        if (event.field === "searchProjects") {
            const { searchValue } = event.arguments;
            const trimmed = (searchValue || '').trim();
            let searchQuery = g.V().hasLabel('Project_Data');
            if (trimmed) {
                searchQuery = searchQuery.has('projectName', TextP.containing(trimmed));
            }
            const results = await searchQuery
                .project('id', 'projectName', 'DepartmentNumber', 'DataClassification', 'Team', 'OwnerGroup', 'Recovery', 'Tier')
                .by(__.id())
                .by(__.coalesce(__.values('projectName'), __.constant('')))
                .by(__.coalesce(__.values('DepartmentNumber'), __.constant('')))
                .by(__.coalesce(__.values('DataClassification'), __.constant('')))
                .by(__.coalesce(__.values('Team'), __.constant('')))
                .by(__.coalesce(__.values('OwnerGroup'), __.constant('')))
                .by(__.coalesce(__.values('Recovery'), __.constant('')))
                .by(__.coalesce(__.values('Tier'), __.constant('')))
                .limit(200)
                .toList();
            return results.map((r) => ({
                id: r.id ?? (r.get ? r.get('id') : undefined),
                projectName: r.projectName ?? (r.get ? r.get('projectName') : ''),
                DepartmentNumber: r.DepartmentNumber ?? (r.get ? r.get('DepartmentNumber') : ''),
                DataClassification: r.DataClassification ?? (r.get ? r.get('DataClassification') : ''),
                Team: r.Team ?? (r.get ? r.get('Team') : ''),
                OwnerGroup: r.OwnerGroup ?? (r.get ? r.get('OwnerGroup') : ''),
                Recovery: r.Recovery ?? (r.get ? r.get('Recovery') : ''),
                Tier: r.Tier ?? (r.get ? r.get('Tier') : ''),
            }));
        }
        if (event.field === "getProjectAccounts") {
            const { projectName } = event.arguments;
            const results = await g.V()
                .hasLabel('Project_Data')
                .has('projectName', projectName)
                .in_('owned_by')
                .hasLabel('Account')
                .project('id', 'Account_Name', 'Account_Id', 'Cloud', 'Environments')
                .by(__.id())
                .by(__.coalesce(__.values('Account_Name'), __.constant('')))
                .by(__.coalesce(__.values('Account_Id'), __.constant('')))
                .by(__.coalesce(__.values('Cloud'), __.constant('')))
                .by(__.coalesce(__.values('Environments'), __.constant('')))
                .toList();
            return results.map((r) => ({
                id: r.id ?? (r.get ? r.get('id') : undefined),
                Account_Name: r.Account_Name ?? (r.get ? r.get('Account_Name') : ''),
                Account_Id: r.Account_Id ?? (r.get ? r.get('Account_Id') : ''),
                Cloud: r.Cloud ?? (r.get ? r.get('Cloud') : ''),
                Environments: r.Environments ?? (r.get ? r.get('Environments') : ''),
            }));
        }
        if (event.field === "getEntityProperties" || event.field === "getEntityEdges") {
            const { vertexType, searchValue, vertexId: directVertexId } = event.arguments;
            const cfg = searchConfig[vertexType];
            if (!cfg)
                throw new Error(`Unknown vertex type: ${vertexType}`);
            let vertexId = directVertexId;
            if (!vertexId) {
                let searchQuery = g.V().hasLabel(cfg.label);
                if (cfg.entityType) {
                    searchQuery = searchQuery.has('entityTypes', cfg.entityType);
                }
                const trimmedSv = (searchValue || '').trim();
                if (trimmedSv && trimmedSv !== '*') {
                    if (cfg.fields.length === 1) {
                        searchQuery = searchQuery.has(cfg.fields[0], TextP.containing(trimmedSv));
                    }
                    else {
                        searchQuery = searchQuery.or(...cfg.fields.map((f) => __.has(f, TextP.containing(trimmedSv))));
                    }
                }
                const vertexIds = await searchQuery.id().limit(1).toList();
                if (vertexIds.length === 0)
                    return [];
                vertexId = vertexIds[0];
            }
            if (event.field === "getEntityProperties") {
                const result = await g.V(vertexId).valueMap().toList();
                if (result.length === 0)
                    return [];
                const vertexMap = result[0];
                const properties = [];
                const entries = vertexMap instanceof Map ? Array.from(vertexMap.entries()) : Object.entries(vertexMap);
                for (const [key, val] of entries) {
                    const propValue = Array.isArray(val) ? String(val[0]) : String(val);
                    if (propValue !== undefined && propValue !== 'undefined' && propValue !== '') {
                        properties.push({ key: String(key), value: propValue });
                    }
                }
                return properties;
            }
            if (event.field === "getEntityEdges") {
                const outEdges = await g.V(vertexId)
                    .outE()
                    .project('edgeLabel', 'targetLabel', 'targetName')
                    .by(__.label())
                    .by(__.inV().label())
                    .by(__.inV().coalesce(__.values('companyName'), __.values('name'), __.values('jobName'), __.values('partName'), __.values('make'), __.constant('Unknown')))
                    .toList();
                const inEdges = await g.V(vertexId)
                    .inE()
                    .project('edgeLabel', 'targetLabel', 'targetName')
                    .by(__.label())
                    .by(__.outV().label())
                    .by(__.outV().coalesce(__.values('companyName'), __.values('name'), __.values('jobName'), __.values('partName'), __.values('make'), __.constant('Unknown')))
                    .toList();
                const edges = [];
                for (const e of outEdges) {
                    edges.push({
                        edgeLabel: String(e.edgeLabel ?? (e.get ? e.get('edgeLabel') : '')),
                        direction: 'outgoing',
                        targetLabel: String(e.targetLabel ?? (e.get ? e.get('targetLabel') : '')),
                        targetName: String(e.targetName ?? (e.get ? e.get('targetName') : '')),
                    });
                }
                for (const e of inEdges) {
                    edges.push({
                        edgeLabel: String(e.edgeLabel ?? (e.get ? e.get('edgeLabel') : '')),
                        direction: 'incoming',
                        targetLabel: String(e.targetLabel ?? (e.get ? e.get('targetLabel') : '')),
                        targetName: String(e.targetName ?? (e.get ? e.get('targetName') : '')),
                    });
                }
                return edges;
            }
        }
        if (type === "profile") {
            console.log(g);
            let usage = [];
            let belong_to = [];
            let authored_by = [];
            let affiliated_with = [];
            let people = [];
            let made_by = [];
            const search_name = await g
                .V(event.arguments.name)
                .values("name")
                .toList();
            switch (event.arguments.value) {
                case "person":
                    usage = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .bothE()
                        .hasLabel("usage")
                        .otherV()
                        .values("name")
                        .toList();
                    belong_to = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .bothE()
                        .hasLabel("belong_to")
                        .otherV()
                        .values("name")
                        .toList();
                    authored_by = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .bothE()
                        .hasLabel("authored_by")
                        .otherV()
                        .values("name")
                        .toList();
                    affiliated_with = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .bothE()
                        .hasLabel("affiliated_with")
                        .otherV()
                        .values("name")
                        .toList();
                    return [
                        { search_name, usage, belong_to, authored_by, affiliated_with },
                    ];
                case "id":
                    usage = await g
                        .V()
                        .hasId(event.arguments.name)
                        .bothE()
                        .hasLabel("usage")
                        .otherV()
                        .values("name")
                        .toList();
                    if (event.arguments.name.match(/Doc/)) {
                        belong_to = await g
                            .V()
                            .hasId(event.arguments.name)
                            .bothE()
                            .hasLabel("belong_to")
                            .otherV()
                            .values("name")
                            .toList();
                    }
                    else {
                        belong_to = [];
                    }
                    authored_by = await g
                        .V()
                        .hasId(event.arguments.name)
                        .bothE()
                        .hasLabel("authored_by")
                        .otherV()
                        .values("name")
                        .toList();
                    affiliated_with = await g
                        .V()
                        .hasId(event.arguments.name)
                        .bothE()
                        .hasLabel("affiliated_with")
                        .otherV()
                        .values("name")
                        .toList();
                    if (event.arguments.name.match(/Prod/)) {
                        made_by = await g
                            .V()
                            .hasId(event.arguments.name)
                            .out("made_by")
                            .values("name")
                            .toList();
                    }
                    else {
                        made_by = [];
                    }
                    if (event.arguments.name.match(/Conf/)) {
                        people = await g
                            .V()
                            .hasId(event.arguments.name)
                            .in_()
                            .values("name")
                            .toList();
                    }
                    else {
                        people = [];
                    }
                    if (event.arguments.name.match(/Inst/)) {
                        affiliated_with = [];
                    }
                    return [
                        {
                            search_name,
                            usage,
                            belong_to,
                            authored_by,
                            affiliated_with,
                            made_by,
                            people,
                        },
                    ];
                case "product":
                    console.log(event.arguments);
                    made_by = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .out("made_by")
                        .values("name")
                        .toList();
                    return [{ search_name, made_by }];
                case "conference":
                    console.log(event.arguments);
                    people = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .in_()
                        .values("name")
                        .toList();
                    return [{ search_name, people }];
                default:
                    console.log("default");
                    return [];
            }
        }
        else if (type === "relation") {
            switch (event.arguments.value) {
                case "person":
                    const result = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .as(event.arguments.value)
                        .out("belong_to")
                        .in_()
                        .where(P.neq(event.arguments.value))
                        .values("name")
                        .dedup()
                        .toList();
                    return result.map((r) => {
                        return { name: r };
                    });
                case "product":
                    const result2 = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .as(event.arguments.value)
                        .in_("usage")
                        .as("p")
                        .in_("authored_by")
                        .out()
                        .where(P.neq("p"))
                        .values("name")
                        .dedup()
                        .toList();
                    return result2.map((r) => {
                        return { name: r };
                    });
                case "conference":
                    console.log(event.arguments);
                    const result3 = await g
                        .V()
                        .has(event.arguments.value, "name", event.arguments.name)
                        .as(event.arguments.value)
                        .in_()
                        .as("p")
                        .out()
                        .hasLabel("person")
                        .where(P.neq("p"))
                        .values("name")
                        .dedup()
                        .toList();
                    console.log(result3);
                    return result3.map((r) => {
                        return { name: r };
                    });
                default:
                    console.log("default");
                    return [];
            }
        }
        else {
            const result = await g.V().toList();
            const vertex = result.map((r) => {
                return { id: r.id, label: r.label };
            });
            const result2 = await g.E().toList();
            const edge = result2.map((r) => {
                console.log(r);
                return { source: r.outV.id, target: r.inV.id, value: r.label };
            });
            return { nodes: vertex, links: edge };
        }
    }
    catch (error) {
        console.log(error);
        console.error(JSON.stringify(error));
        throw error;
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnlHcmFwaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInF1ZXJ5R3JhcGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsNEVBQTRFO0FBQzVFLHlFQUF5RTtBQUN6RSwyRUFBMkU7QUFDM0Usd0VBQXdFO0FBQ3hFLE9BQVEsVUFBa0IsQ0FBQyxTQUFTLENBQUM7QUFFckMsbUNBQW1DO0FBQ25DLHVEQUErRDtBQUUvRCxNQUFNLHNCQUFzQixHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsc0JBQXNCLENBQUM7QUFDckUsTUFBTSxDQUFDLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7QUFDNUIsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQyxTQUFTLENBQUM7QUFDckUsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUM7QUFDbkMsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7QUFTN0IsTUFBTSxPQUFPLEdBQVksS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFO0lBQzlDLElBQUksSUFBSSxHQUFHLElBQUksQ0FBQztJQUNoQixNQUFNLG9CQUFvQixHQUFHLEdBQUcsRUFBRTtRQUNoQyxPQUFPLElBQUEsd0JBQWdCLEVBQ3JCLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQzVCLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxFQUN4QixFQUFFLEVBQ0YsVUFBVSxFQUNWLEtBQUssQ0FDTixDQUFDO0lBQ0osQ0FBQyxDQUFDO0lBRUYsTUFBTSxzQkFBc0IsR0FBRyxHQUFHLEVBQUU7UUFDbEMsTUFBTSxFQUFFLEdBQUcsRUFBRSxPQUFPLEVBQUUsR0FBRyxvQkFBb0IsRUFBRSxDQUFDO1FBRWhELE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNyQixNQUFNLENBQUMsR0FBRyxJQUFJLHNCQUFzQixDQUFDLEdBQUcsRUFBRTtZQUN4QyxRQUFRLEVBQUUsbUNBQW1DO1lBQzdDLE9BQU8sRUFBRSxPQUFPO1NBQ2pCLENBQUMsQ0FBQztRQUNILE1BQU0sZ0JBQWdCLEdBQUcsQ0FBK0IsQ0FBQztRQUN6RCxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsV0FBVyxFQUFFLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxJQUFZLEVBQUUsT0FBZSxFQUFFLEVBQUU7WUFDbkYsT0FBTyxDQUFDLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBQzNDLElBQUksSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDO2dCQUNqQixPQUFPLENBQUMsS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7Z0JBQy9DLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQztZQUNuRCxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7UUFDSCxPQUFPLENBQUMsQ0FBQztJQUNYLENBQUMsQ0FBQztJQUVGLElBQUksQ0FBQyxHQUFRLElBQUksQ0FBQztJQUVsQixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQztJQUNsQyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2xCLElBQUksQ0FBQztRQUNILElBQUksSUFBSSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ2pCLE9BQU8sQ0FBQyxJQUFJLENBQUMseUJBQXlCLENBQUMsQ0FBQztZQUN4QyxJQUFJLEdBQUcsc0JBQXNCLEVBQUUsQ0FBQztZQUNoQyxDQUFDLEdBQUcsU0FBUyxFQUFFLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ25DLENBQUM7UUFFRCx5QkFBeUI7UUFDekIsTUFBTSxZQUFZLEdBQTZFO1lBQzdGLE9BQU8sRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLENBQUMsYUFBYSxDQUFDLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRTtZQUM1RSxRQUFRLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLFVBQVUsRUFBRSxVQUFVLEVBQUU7WUFDdkUsU0FBUyxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFO1lBQ3pFLE1BQU0sRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLENBQUMsYUFBYSxDQUFDLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRTtZQUMxRSxLQUFLLEVBQUUsRUFBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxDQUFDLEVBQUU7WUFDM0QsR0FBRyxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsRUFBRTtZQUMxQyxJQUFJLEVBQUUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQzdDLFlBQVksRUFBRSxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLENBQUMsYUFBYSxDQUFDLEVBQUU7U0FDakUsQ0FBQztRQUVGLElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3JDLE1BQU0sRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztZQUNwRCxNQUFNLEdBQUcsR0FBRyxZQUFZLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDckMsSUFBSSxDQUFDLEdBQUc7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUVoRSxJQUFJLFdBQVcsR0FBRyxDQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUM3QyxJQUFJLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQztnQkFDbkIsV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUMvRCxDQUFDO1lBRUQscURBQXFEO1lBQ3JELE1BQU0sT0FBTyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQzNDLElBQUksT0FBTyxJQUFJLE9BQU8sS0FBSyxHQUFHLEVBQUUsQ0FBQztnQkFDL0IsSUFBSSxHQUFHLENBQUMsTUFBTSxDQUFDLE1BQU0sS0FBSyxDQUFDLEVBQUUsQ0FBQztvQkFDNUIsV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQzFFLENBQUM7cUJBQU0sQ0FBQztvQkFDTixXQUFXLEdBQUcsV0FBVyxDQUFDLEVBQUUsQ0FDMUIsR0FBRyxHQUFHLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQ3ZFLENBQUM7Z0JBQ0osQ0FBQztZQUNILENBQUM7WUFFRCxNQUFNLE9BQU8sR0FBRyxNQUFNLFdBQVc7aUJBQzlCLE9BQU8sQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxZQUFZLENBQUM7aUJBQzVDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7aUJBQ1gsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQ2IsRUFBRSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsRUFDeEIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFDakIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFDcEIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsRUFDckIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFDakIsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FDdkIsQ0FBQztpQkFDRCxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDO2lCQUNkLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUMxRCxLQUFLLENBQUMsRUFBRSxDQUFDO2lCQUNULE1BQU0sRUFBRSxDQUFDO1lBRVosT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUM5QixFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztnQkFDN0MsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7Z0JBQ25ELEtBQUssRUFBRSxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO2dCQUN0RCxVQUFVLEVBQUUsQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUk7YUFDekUsQ0FBQyxDQUFDLENBQUM7UUFDTixDQUFDO1FBRUQsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLGdCQUFnQixFQUFFLENBQUM7WUFDckMsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7WUFDeEMsTUFBTSxPQUFPLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7WUFFM0MsSUFBSSxXQUFXLEdBQUcsQ0FBRSxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUNsRCxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUNaLFdBQVcsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDMUUsQ0FBQztZQUVELE1BQU0sT0FBTyxHQUFHLE1BQU0sV0FBVztpQkFDOUIsT0FBTyxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUUsa0JBQWtCLEVBQUUsb0JBQW9CLEVBQUUsTUFBTSxFQUFFLFlBQVksRUFBRSxVQUFVLEVBQUUsTUFBTSxDQUFDO2lCQUNoSCxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO2lCQUNYLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUMxRCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUMvRCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLG9CQUFvQixDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUNqRSxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztpQkFDbkQsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQ3pELEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUN2RCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztpQkFDbkQsS0FBSyxDQUFDLEdBQUcsQ0FBQztpQkFDVixNQUFNLEVBQUUsQ0FBQztZQUVaLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDOUIsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7Z0JBQzdDLFdBQVcsRUFBRSxDQUFDLENBQUMsV0FBVyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNqRSxnQkFBZ0IsRUFBRSxDQUFDLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDaEYsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDLGtCQUFrQixJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3RGLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUM1QyxVQUFVLEVBQUUsQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDOUQsUUFBUSxFQUFFLENBQUMsQ0FBQyxRQUFRLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hELElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2FBQzdDLENBQUMsQ0FBQyxDQUFDO1FBQ04sQ0FBQztRQUVELElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxvQkFBb0IsRUFBRSxDQUFDO1lBQ3pDLE1BQU0sRUFBRSxXQUFXLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBRXhDLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBRSxDQUFDLENBQUMsRUFBRTtpQkFDekIsUUFBUSxDQUFDLGNBQWMsQ0FBQztpQkFDeEIsR0FBRyxDQUFDLGFBQWEsRUFBRSxXQUFXLENBQUM7aUJBQy9CLEdBQUcsQ0FBQyxVQUFVLENBQUM7aUJBQ2YsUUFBUSxDQUFDLFNBQVMsQ0FBQztpQkFDbkIsT0FBTyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsWUFBWSxFQUFFLE9BQU8sRUFBRSxjQUFjLENBQUM7aUJBQ3BFLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7aUJBQ1gsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQzNELEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsWUFBWSxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUN6RCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztpQkFDcEQsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQzNELE1BQU0sRUFBRSxDQUFDO1lBRVosT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUM5QixFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztnQkFDN0MsWUFBWSxFQUFFLENBQUMsQ0FBQyxZQUFZLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ3BFLFVBQVUsRUFBRSxDQUFDLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUM5RCxLQUFLLEVBQUUsQ0FBQyxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDL0MsWUFBWSxFQUFFLENBQUMsQ0FBQyxZQUFZLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7YUFDckUsQ0FBQyxDQUFDLENBQUM7UUFDTixDQUFDO1FBRUQsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLHFCQUFxQixJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztZQUM5RSxNQUFNLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsY0FBYyxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztZQUM5RSxNQUFNLEdBQUcsR0FBRyxZQUFZLENBQUMsVUFBVSxDQUFDLENBQUM7WUFDckMsSUFBSSxDQUFDLEdBQUc7Z0JBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyx3QkFBd0IsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUVoRSxJQUFJLFFBQVEsR0FBRyxjQUFjLENBQUM7WUFDOUIsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO2dCQUNkLElBQUksV0FBVyxHQUFHLENBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUM3QyxJQUFJLEdBQUcsQ0FBQyxVQUFVLEVBQUUsQ0FBQztvQkFDbkIsV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQztnQkFDL0QsQ0FBQztnQkFDRCxNQUFNLFNBQVMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDN0MsSUFBSSxTQUFTLElBQUksU0FBUyxLQUFLLEdBQUcsRUFBRSxDQUFDO29CQUNuQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO3dCQUM1QixXQUFXLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztvQkFDNUUsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLFdBQVcsR0FBRyxXQUFXLENBQUMsRUFBRSxDQUMxQixHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FDekUsQ0FBQztvQkFDSixDQUFDO2dCQUNILENBQUM7Z0JBQ0QsTUFBTSxTQUFTLEdBQUcsTUFBTSxXQUFXLENBQUMsRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUMzRCxJQUFJLFNBQVMsQ0FBQyxNQUFNLEtBQUssQ0FBQztvQkFBRSxPQUFPLEVBQUUsQ0FBQztnQkFDdEMsUUFBUSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMxQixDQUFDO1lBRUQsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLHFCQUFxQixFQUFFLENBQUM7Z0JBQzFDLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDeEQsSUFBSSxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUM7b0JBQUUsT0FBTyxFQUFFLENBQUM7Z0JBQ25DLE1BQU0sU0FBUyxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztnQkFDNUIsTUFBTSxVQUFVLEdBQTBDLEVBQUUsQ0FBQztnQkFDN0QsTUFBTSxPQUFPLEdBQUcsU0FBUyxZQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDdkcsS0FBSyxNQUFNLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQyxJQUFJLE9BQU8sRUFBRSxDQUFDO29CQUNqQyxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQztvQkFDcEUsSUFBSSxTQUFTLEtBQUssU0FBUyxJQUFJLFNBQVMsS0FBSyxXQUFXLElBQUksU0FBUyxLQUFLLEVBQUUsRUFBRSxDQUFDO3dCQUM3RSxVQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsR0FBRyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLENBQUMsQ0FBQztvQkFDMUQsQ0FBQztnQkFDSCxDQUFDO2dCQUNELE9BQU8sVUFBVSxDQUFDO1lBQ3BCLENBQUM7WUFFRCxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztnQkFDckMsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQztxQkFDbEMsSUFBSSxFQUFFO3FCQUNOLE9BQU8sQ0FBQyxXQUFXLEVBQUUsYUFBYSxFQUFFLFlBQVksQ0FBQztxQkFDakQsRUFBRSxDQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztxQkFDZCxFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDO3FCQUNwQixFQUFFLENBQUMsRUFBRSxDQUFDLEdBQUcsRUFBRSxDQUFDLFFBQVEsQ0FDbkIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsRUFDeEIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFDakIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFDcEIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsRUFDckIsRUFBRSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFDakIsRUFBRSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUMsQ0FDdkIsQ0FBQztxQkFDRCxNQUFNLEVBQUUsQ0FBQztnQkFFWixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO3FCQUNqQyxHQUFHLEVBQUU7cUJBQ0wsT0FBTyxDQUFDLFdBQVcsRUFBRSxhQUFhLEVBQUUsWUFBWSxDQUFDO3FCQUNqRCxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDO3FCQUNkLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7cUJBQ3JCLEVBQUUsQ0FBQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsUUFBUSxDQUNwQixFQUFFLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxFQUN4QixFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUNqQixFQUFFLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUNwQixFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUNyQixFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUNqQixFQUFFLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUN2QixDQUFDO3FCQUNELE1BQU0sRUFBRSxDQUFDO2dCQUVaLE1BQU0sS0FBSyxHQUE2RixFQUFFLENBQUM7Z0JBQzNHLEtBQUssTUFBTSxDQUFDLElBQUksUUFBK0UsRUFBRSxDQUFDO29CQUNoRyxLQUFLLENBQUMsSUFBSSxDQUFDO3dCQUNULFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNuRSxTQUFTLEVBQUUsVUFBVTt3QkFDckIsV0FBVyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsV0FBVyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ3pFLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3FCQUN2RSxDQUFDLENBQUM7Z0JBQ0wsQ0FBQztnQkFDRCxLQUFLLE1BQU0sQ0FBQyxJQUFJLE9BQThFLEVBQUUsQ0FBQztvQkFDL0YsS0FBSyxDQUFDLElBQUksQ0FBQzt3QkFDVCxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxTQUFTLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzt3QkFDbkUsU0FBUyxFQUFFLFVBQVU7d0JBQ3JCLFdBQVcsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLFdBQVcsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUN6RSxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxVQUFVLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztxQkFDdkUsQ0FBQyxDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1FBQ0gsQ0FBQztRQUVELElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3ZCLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDZixJQUFJLEtBQUssR0FBYSxFQUFFLENBQUM7WUFDekIsSUFBSSxTQUFTLEdBQWEsRUFBRSxDQUFDO1lBQzdCLElBQUksV0FBVyxHQUFhLEVBQUUsQ0FBQztZQUMvQixJQUFJLGVBQWUsR0FBYSxFQUFFLENBQUM7WUFDbkMsSUFBSSxNQUFNLEdBQWEsRUFBRSxDQUFDO1lBQzFCLElBQUksT0FBTyxHQUFhLEVBQUUsQ0FBQztZQUMzQixNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUU7aUJBQ3pCLENBQUMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQztpQkFDdkIsTUFBTSxDQUFDLE1BQU0sQ0FBQztpQkFDZCxNQUFNLEVBQWMsQ0FBQztZQUN4QixRQUFRLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQzlCLEtBQUssUUFBUTtvQkFDWCxLQUFLLEdBQUcsTUFBTSxDQUFDO3lCQUNaLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxLQUFLLEVBQUU7eUJBQ1AsUUFBUSxDQUFDLE9BQU8sQ0FBQzt5QkFDakIsTUFBTSxFQUFFO3lCQUNSLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLFNBQVMsR0FBRyxNQUFNLENBQUM7eUJBQ2hCLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxLQUFLLEVBQUU7eUJBQ1AsUUFBUSxDQUFDLFdBQVcsQ0FBQzt5QkFDckIsTUFBTSxFQUFFO3lCQUNSLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLFdBQVcsR0FBRyxNQUFNLENBQUM7eUJBQ2xCLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxLQUFLLEVBQUU7eUJBQ1AsUUFBUSxDQUFDLGFBQWEsQ0FBQzt5QkFDdkIsTUFBTSxFQUFFO3lCQUNSLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLGVBQWUsR0FBRyxNQUFNLENBQUM7eUJBQ3RCLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxLQUFLLEVBQUU7eUJBQ1AsUUFBUSxDQUFDLGlCQUFpQixDQUFDO3lCQUMzQixNQUFNLEVBQUU7eUJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsT0FBTzt3QkFDTCxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsU0FBUyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUU7cUJBQ2hFLENBQUM7Z0JBQ0osS0FBSyxJQUFJO29CQUNQLEtBQUssR0FBRyxNQUFNLENBQUM7eUJBQ1osQ0FBQyxFQUFFO3lCQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDM0IsS0FBSyxFQUFFO3lCQUNQLFFBQVEsQ0FBQyxPQUFPLENBQUM7eUJBQ2pCLE1BQU0sRUFBRTt5QkFDUixNQUFNLENBQUMsTUFBTSxDQUFDO3lCQUNkLE1BQU0sRUFBYyxDQUFDO29CQUN4QixJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO3dCQUN0QyxTQUFTLEdBQUcsTUFBTSxDQUFDOzZCQUNoQixDQUFDLEVBQUU7NkJBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDOzZCQUMzQixLQUFLLEVBQUU7NkJBQ1AsUUFBUSxDQUFDLFdBQVcsQ0FBQzs2QkFDckIsTUFBTSxFQUFFOzZCQUNSLE1BQU0sQ0FBQyxNQUFNLENBQUM7NkJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQzFCLENBQUM7eUJBQU0sQ0FBQzt3QkFDTixTQUFTLEdBQUcsRUFBRSxDQUFDO29CQUNqQixDQUFDO29CQUNELFdBQVcsR0FBRyxNQUFNLENBQUM7eUJBQ2xCLENBQUMsRUFBRTt5QkFDSCxLQUFLLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7eUJBQzNCLEtBQUssRUFBRTt5QkFDUCxRQUFRLENBQUMsYUFBYSxDQUFDO3lCQUN2QixNQUFNLEVBQUU7eUJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsZUFBZSxHQUFHLE1BQU0sQ0FBQzt5QkFDdEIsQ0FBQyxFQUFFO3lCQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDM0IsS0FBSyxFQUFFO3lCQUNQLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQzt5QkFDM0IsTUFBTSxFQUFFO3lCQUNSLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7d0JBQ3ZDLE9BQU8sR0FBRyxNQUFNLENBQUM7NkJBQ2QsQ0FBQyxFQUFFOzZCQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzs2QkFDM0IsR0FBRyxDQUFDLFNBQVMsQ0FBQzs2QkFDZCxNQUFNLENBQUMsTUFBTSxDQUFDOzZCQUNkLE1BQU0sRUFBYyxDQUFDO29CQUMxQixDQUFDO3lCQUFNLENBQUM7d0JBQ04sT0FBTyxHQUFHLEVBQUUsQ0FBQztvQkFDZixDQUFDO29CQUNELElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7d0JBQ3ZDLE1BQU0sR0FBRyxNQUFNLENBQUM7NkJBQ2IsQ0FBQyxFQUFFOzZCQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzs2QkFDM0IsR0FBRyxFQUFFOzZCQUNMLE1BQU0sQ0FBQyxNQUFNLENBQUM7NkJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQzFCLENBQUM7eUJBQU0sQ0FBQzt3QkFDTixNQUFNLEdBQUcsRUFBRSxDQUFDO29CQUNkLENBQUM7b0JBQ0QsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQzt3QkFDdkMsZUFBZSxHQUFHLEVBQUUsQ0FBQztvQkFDdkIsQ0FBQztvQkFDRCxPQUFPO3dCQUNMOzRCQUNFLFdBQVc7NEJBQ1gsS0FBSzs0QkFDTCxTQUFTOzRCQUNULFdBQVc7NEJBQ1gsZUFBZTs0QkFDZixPQUFPOzRCQUNQLE1BQU07eUJBQ1A7cUJBQ0YsQ0FBQztnQkFDSixLQUFLLFNBQVM7b0JBQ1osT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUM7b0JBQzdCLE9BQU8sR0FBRyxNQUFNLENBQUM7eUJBQ2QsQ0FBQyxFQUFFO3lCQUNILEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7eUJBQ3hELEdBQUcsQ0FBQyxTQUFTLENBQUM7eUJBQ2QsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsT0FBTyxDQUFDLEVBQUUsV0FBVyxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7Z0JBQ3BDLEtBQUssWUFBWTtvQkFDZixPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztvQkFDN0IsTUFBTSxHQUFHLE1BQU0sQ0FBQzt5QkFDYixDQUFDLEVBQUU7eUJBQ0gsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDeEQsR0FBRyxFQUFFO3lCQUNMLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLE9BQU8sQ0FBQyxFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDO2dCQUNuQztvQkFDRSxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUN2QixPQUFPLEVBQUUsQ0FBQztZQUNkLENBQUM7UUFDSCxDQUFDO2FBQU0sSUFBSSxJQUFJLEtBQUssVUFBVSxFQUFFLENBQUM7WUFDL0IsUUFBUSxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDO2dCQUM5QixLQUFLLFFBQVE7b0JBQ1gsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFDO3lCQUNuQixDQUFDLEVBQUU7eUJBQ0gsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDeEQsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO3lCQUN6QixHQUFHLENBQUMsV0FBVyxDQUFDO3lCQUNoQixHQUFHLEVBQUU7eUJBQ0wsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQzt5QkFDbkMsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxLQUFLLEVBQUU7eUJBQ1AsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLE9BQU8sTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFO3dCQUM5QixPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDO29CQUNyQixDQUFDLENBQUMsQ0FBQztnQkFFTCxLQUFLLFNBQVM7b0JBQ1osTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDO3lCQUNwQixDQUFDLEVBQUU7eUJBQ0gsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDeEQsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO3lCQUN6QixHQUFHLENBQUMsT0FBTyxDQUFDO3lCQUNaLEVBQUUsQ0FBQyxHQUFHLENBQUM7eUJBQ1AsR0FBRyxDQUFDLGFBQWEsQ0FBQzt5QkFDbEIsR0FBRyxFQUFFO3lCQUNMLEtBQUssQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3lCQUNqQixNQUFNLENBQUMsTUFBTSxDQUFDO3lCQUNkLEtBQUssRUFBRTt5QkFDUCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUU7d0JBQy9CLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7b0JBQ3JCLENBQUMsQ0FBQyxDQUFDO2dCQUNMLEtBQUssWUFBWTtvQkFDZixPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztvQkFDN0IsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDO3lCQUNwQixDQUFDLEVBQUU7eUJBQ0gsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDeEQsRUFBRSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO3lCQUN6QixHQUFHLEVBQUU7eUJBQ0wsRUFBRSxDQUFDLEdBQUcsQ0FBQzt5QkFDUCxHQUFHLEVBQUU7eUJBQ0wsUUFBUSxDQUFDLFFBQVEsQ0FBQzt5QkFDbEIsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7eUJBQ2pCLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsS0FBSyxFQUFFO3lCQUNQLE1BQU0sRUFBYyxDQUFDO29CQUN4QixPQUFPLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO29CQUNyQixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFTLEVBQUUsRUFBRTt3QkFDL0IsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQztvQkFDckIsQ0FBQyxDQUFDLENBQUM7Z0JBQ0w7b0JBQ0UsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztvQkFDdkIsT0FBTyxFQUFFLENBQUM7WUFDZCxDQUFDO1FBQ0gsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNwQyxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUU7Z0JBQ25DLE9BQU8sRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3RDLENBQUMsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDckMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFO2dCQUNsQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNmLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsTUFBTSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDakUsQ0FBQyxDQUFDLENBQUM7WUFDSCxPQUFPLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUM7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1FBQ3BCLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDbkIsT0FBTyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDckMsTUFBTSxLQUFLLENBQUM7SUFDZCxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBbmRXLFFBQUEsT0FBTyxXQW1kbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSBcImF3cy1sYW1iZGFcIjtcblxuLy8gTm9kZSAyMisgZGVmaW5lcyBhIGdsb2JhbCBXZWJTb2NrZXQgdmlhIHVuZGljaS4gZ3JlbWxpbi1hd3Mtc2lndjQgaW5qZWN0c1xuLy8gU2lnVjQgaGVhZGVycyB0aHJvdWdoIHRoZSB3cy1ucG0gQVBJOyBpZiBncmVtbGluIHBpY2tzIHVwIHRoZSBidWlsdC1pblxuLy8gV2ViU29ja2V0IGluc3RlYWQsIGF1dGggaGVhZGVycyBhcmUgZHJvcHBlZCBhbmQgTmVwdHVuZSByZXR1cm5zIG5vbi0xMDEuXG4vLyBSZW1vdmluZyB0aGUgZ2xvYmFsIGZvcmNlcyBncmVtbGluIHRvIHVzZSB0aGUgYnVuZGxlZCB3cyBucG0gcGFja2FnZS5cbmRlbGV0ZSAoZ2xvYmFsVGhpcyBhcyBhbnkpLldlYlNvY2tldDtcblxuaW1wb3J0ICogYXMgZ3JlbWxpbiBmcm9tIFwiZ3JlbWxpblwiO1xuaW1wb3J0IHsgZ2V0VXJsQW5kSGVhZGVycyB9IGZyb20gXCJncmVtbGluLWF3cy1zaWd2NC9saWIvdXRpbHNcIjtcblxuY29uc3QgRHJpdmVyUmVtb3RlQ29ubmVjdGlvbiA9IGdyZW1saW4uZHJpdmVyLkRyaXZlclJlbW90ZUNvbm5lY3Rpb247XG5jb25zdCBQID0gZ3JlbWxpbi5wcm9jZXNzLlA7XG5jb25zdCB0cmF2ZXJzYWwgPSBncmVtbGluLnByb2Nlc3MuQW5vbnltb3VzVHJhdmVyc2FsU291cmNlLnRyYXZlcnNhbDtcbmNvbnN0IF9fID0gZ3JlbWxpbi5wcm9jZXNzLnN0YXRpY3M7XG5jb25zdCBUZXh0UCA9IGdyZW1saW4ucHJvY2Vzcy5UZXh0UDtcblxudHlwZSBSZW1vdGVDb25uZWN0aW9uV2l0aFNvY2tldCA9IGdyZW1saW4uZHJpdmVyLkRyaXZlclJlbW90ZUNvbm5lY3Rpb24gJiB7XG4gIF9jbGllbnQ/OiB7XG4gICAgX2Nvbm5lY3Rpb24/OiB7XG4gICAgICBvbjogKGV2ZW50OiBzdHJpbmcsIGxpc3RlbmVyOiAoY29kZTogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpID0+IHZvaWQpID0+IHZvaWQ7XG4gICAgfTtcbiAgfTtcbn07XG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xuICBsZXQgY29ubiA9IG51bGw7XG4gIGNvbnN0IGdldENvbm5lY3Rpb25EZXRhaWxzID0gKCkgPT4ge1xuICAgIHJldHVybiBnZXRVcmxBbmRIZWFkZXJzKFxuICAgICAgcHJvY2Vzcy5lbnYuTkVQVFVORV9FTkRQT0lOVCxcbiAgICAgIHByb2Nlc3MuZW52Lk5FUFRVTkVfUE9SVCxcbiAgICAgIHt9LFxuICAgICAgXCIvZ3JlbWxpblwiLFxuICAgICAgXCJ3c3NcIlxuICAgICk7XG4gIH07XG5cbiAgY29uc3QgY3JlYXRlUmVtb3RlQ29ubmVjdGlvbiA9ICgpID0+IHtcbiAgICBjb25zdCB7IHVybCwgaGVhZGVycyB9ID0gZ2V0Q29ubmVjdGlvbkRldGFpbHMoKTtcblxuICAgIGNvbnNvbGUubG9nKHVybCk7XG4gICAgY29uc29sZS5sb2coaGVhZGVycyk7XG4gICAgY29uc3QgYyA9IG5ldyBEcml2ZXJSZW1vdGVDb25uZWN0aW9uKHVybCwge1xuICAgICAgbWltZVR5cGU6IFwiYXBwbGljYXRpb24vdm5kLmdyZW1saW4tdjIuMCtqc29uXCIsXG4gICAgICBoZWFkZXJzOiBoZWFkZXJzLFxuICAgIH0pO1xuICAgIGNvbnN0IHNvY2tldENvbm5lY3Rpb24gPSBjIGFzIFJlbW90ZUNvbm5lY3Rpb25XaXRoU29ja2V0O1xuICAgIHNvY2tldENvbm5lY3Rpb24uX2NsaWVudD8uX2Nvbm5lY3Rpb24/Lm9uKFwiY2xvc2VcIiwgKGNvZGU6IG51bWJlciwgbWVzc2FnZTogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zb2xlLmluZm8oYGNsb3NlIC0gJHtjb2RlfSAke21lc3NhZ2V9YCk7XG4gICAgICBpZiAoY29kZSA9PSAxMDA2KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJDb25uZWN0aW9uIGNsb3NlZCBwcmVtYXR1cmVseVwiKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29ubmVjdGlvbiBjbG9zZWQgcHJlbWF0dXJlbHlcIik7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGM7XG4gIH07XG5cbiAgbGV0IGc6IGFueSA9IG51bGw7XG5cbiAgY29uc3QgdHlwZSA9IGV2ZW50LmFyZ3VtZW50cy50eXBlO1xuICBjb25zb2xlLmxvZyh0eXBlKTtcbiAgdHJ5IHtcbiAgICBpZiAoY29ubiA9PSBudWxsKSB7XG4gICAgICBjb25zb2xlLmluZm8oXCJJbml0aWFsaXppbmcgY29ubmVjdGlvblwiKTtcbiAgICAgIGNvbm4gPSBjcmVhdGVSZW1vdGVDb25uZWN0aW9uKCk7XG4gICAgICBnID0gdHJhdmVyc2FsKCkud2l0aFJlbW90ZShjb25uKTtcbiAgICB9XG5cbiAgICAvLyBFbnRpdHkgc2VhcmNoIGhhbmRsZXJzXG4gICAgY29uc3Qgc2VhcmNoQ29uZmlnOiBSZWNvcmQ8c3RyaW5nLCB7IGxhYmVsOiBzdHJpbmc7IGZpZWxkczogc3RyaW5nW107IGVudGl0eVR5cGU/OiBzdHJpbmcgfT4gPSB7XG4gICAgICBDb21wYW55OiB7IGxhYmVsOiAnRW50aXR5JywgZmllbGRzOiBbJ2NvbXBhbnlOYW1lJ10sIGVudGl0eVR5cGU6ICdDb21wYW55JyB9LFxuICAgICAgQ3VzdG9tZXI6IHsgbGFiZWw6ICdFbnRpdHknLCBmaWVsZHM6IFsnbmFtZSddLCBlbnRpdHlUeXBlOiAnQ3VzdG9tZXInIH0sXG4gICAgICBFc3RpbWF0b3I6IHsgbGFiZWw6ICdFbnRpdHknLCBmaWVsZHM6IFsnbmFtZSddLCBlbnRpdHlUeXBlOiAnRXN0aW1hdG9yJyB9LFxuICAgICAgSm9iYmVyOiB7IGxhYmVsOiAnRW50aXR5JywgZmllbGRzOiBbJ2NvbXBhbnlOYW1lJ10sIGVudGl0eVR5cGU6ICdKb2JiZXInIH0sXG4gICAgICBBc3NldDogeyBsYWJlbDogJ0Fzc2V0JywgZmllbGRzOiBbJ21ha2UnLCAnbW9kZWwnLCAndmluJ10gfSxcbiAgICAgIEpvYjogeyBsYWJlbDogJ0pvYicsIGZpZWxkczogWydqb2JOYW1lJ10gfSxcbiAgICAgIFBhcnQ6IHsgbGFiZWw6ICdQYXJ0JywgZmllbGRzOiBbJ3BhcnROYW1lJ10gfSxcbiAgICAgIFByb2plY3RfRGF0YTogeyBsYWJlbDogJ1Byb2plY3RfRGF0YScsIGZpZWxkczogWydwcm9qZWN0TmFtZSddIH0sXG4gICAgfTtcblxuICAgIGlmIChldmVudC5maWVsZCA9PT0gXCJzZWFyY2hFbnRpdGllc1wiKSB7XG4gICAgICBjb25zdCB7IHZlcnRleFR5cGUsIHNlYXJjaFZhbHVlIH0gPSBldmVudC5hcmd1bWVudHM7XG4gICAgICBjb25zdCBjZmcgPSBzZWFyY2hDb25maWdbdmVydGV4VHlwZV07XG4gICAgICBpZiAoIWNmZykgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHZlcnRleCB0eXBlOiAke3ZlcnRleFR5cGV9YCk7XG5cbiAgICAgIGxldCBzZWFyY2hRdWVyeSA9IGchLlYoKS5oYXNMYWJlbChjZmcubGFiZWwpO1xuICAgICAgaWYgKGNmZy5lbnRpdHlUeXBlKSB7XG4gICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkuaGFzKCdlbnRpdHlUeXBlcycsIGNmZy5lbnRpdHlUeXBlKTtcbiAgICAgIH1cblxuICAgICAgLy8gT25seSBhcHBseSB0ZXh0IGZpbHRlciBpZiBzZWFyY2hWYWx1ZSBpcyBub24tZW1wdHlcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSAoc2VhcmNoVmFsdWUgfHwgJycpLnRyaW0oKTtcbiAgICAgIGlmICh0cmltbWVkICYmIHRyaW1tZWQgIT09ICcqJykge1xuICAgICAgICBpZiAoY2ZnLmZpZWxkcy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICBzZWFyY2hRdWVyeSA9IHNlYXJjaFF1ZXJ5LmhhcyhjZmcuZmllbGRzWzBdLCBUZXh0UC5jb250YWluaW5nKHRyaW1tZWQpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzZWFyY2hRdWVyeSA9IHNlYXJjaFF1ZXJ5Lm9yKFxuICAgICAgICAgICAgLi4uY2ZnLmZpZWxkcy5tYXAoKGY6IHN0cmluZykgPT4gX18uaGFzKGYsIFRleHRQLmNvbnRhaW5pbmcodHJpbW1lZCkpKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHNlYXJjaFF1ZXJ5XG4gICAgICAgIC5wcm9qZWN0KCdpZCcsICduYW1lJywgJ2xhYmVsJywgJ2VudGl0eVR5cGUnKVxuICAgICAgICAuYnkoX18uaWQoKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKFxuICAgICAgICAgIF9fLnZhbHVlcygnY29tcGFueU5hbWUnKSxcbiAgICAgICAgICBfXy52YWx1ZXMoJ25hbWUnKSxcbiAgICAgICAgICBfXy52YWx1ZXMoJ2pvYk5hbWUnKSxcbiAgICAgICAgICBfXy52YWx1ZXMoJ3BhcnROYW1lJyksXG4gICAgICAgICAgX18udmFsdWVzKCdtYWtlJyksXG4gICAgICAgICAgX18uY29uc3RhbnQoJ1Vua25vd24nKVxuICAgICAgICApKVxuICAgICAgICAuYnkoX18ubGFiZWwoKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnZW50aXR5VHlwZXMnKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmxpbWl0KDUwKVxuICAgICAgICAudG9MaXN0KCk7XG5cbiAgICAgIHJldHVybiByZXN1bHRzLm1hcCgocjogYW55KSA9PiAoe1xuICAgICAgICBpZDogci5pZCA/PyAoci5nZXQgPyByLmdldCgnaWQnKSA6IHVuZGVmaW5lZCksXG4gICAgICAgIG5hbWU6IHIubmFtZSA/PyAoci5nZXQgPyByLmdldCgnbmFtZScpIDogdW5kZWZpbmVkKSxcbiAgICAgICAgbGFiZWw6IHIubGFiZWwgPz8gKHIuZ2V0ID8gci5nZXQoJ2xhYmVsJykgOiB1bmRlZmluZWQpLFxuICAgICAgICBlbnRpdHlUeXBlOiByLmVudGl0eVR5cGUgfHwgKHIuZ2V0ID8gci5nZXQoJ2VudGl0eVR5cGUnKSA6IG51bGwpIHx8IG51bGwsXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LmZpZWxkID09PSBcInNlYXJjaFByb2plY3RzXCIpIHtcbiAgICAgIGNvbnN0IHsgc2VhcmNoVmFsdWUgfSA9IGV2ZW50LmFyZ3VtZW50cztcbiAgICAgIGNvbnN0IHRyaW1tZWQgPSAoc2VhcmNoVmFsdWUgfHwgJycpLnRyaW0oKTtcblxuICAgICAgbGV0IHNlYXJjaFF1ZXJ5ID0gZyEuVigpLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKTtcbiAgICAgIGlmICh0cmltbWVkKSB7XG4gICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkuaGFzKCdwcm9qZWN0TmFtZScsIFRleHRQLmNvbnRhaW5pbmcodHJpbW1lZCkpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgc2VhcmNoUXVlcnlcbiAgICAgICAgLnByb2plY3QoJ2lkJywgJ3Byb2plY3ROYW1lJywgJ0RlcGFydG1lbnROdW1iZXInLCAnRGF0YUNsYXNzaWZpY2F0aW9uJywgJ1RlYW0nLCAnT3duZXJHcm91cCcsICdSZWNvdmVyeScsICdUaWVyJylcbiAgICAgICAgLmJ5KF9fLmlkKCkpXG4gICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoJ3Byb2plY3ROYW1lJyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoJ0RlcGFydG1lbnROdW1iZXInKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnRGF0YUNsYXNzaWZpY2F0aW9uJyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoJ1RlYW0nKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnT3duZXJHcm91cCcpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdSZWNvdmVyeScpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdUaWVyJyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC5saW1pdCgyMDApXG4gICAgICAgIC50b0xpc3QoKTtcblxuICAgICAgcmV0dXJuIHJlc3VsdHMubWFwKChyOiBhbnkpID0+ICh7XG4gICAgICAgIGlkOiByLmlkID8/IChyLmdldCA/IHIuZ2V0KCdpZCcpIDogdW5kZWZpbmVkKSxcbiAgICAgICAgcHJvamVjdE5hbWU6IHIucHJvamVjdE5hbWUgPz8gKHIuZ2V0ID8gci5nZXQoJ3Byb2plY3ROYW1lJykgOiAnJyksXG4gICAgICAgIERlcGFydG1lbnROdW1iZXI6IHIuRGVwYXJ0bWVudE51bWJlciA/PyAoci5nZXQgPyByLmdldCgnRGVwYXJ0bWVudE51bWJlcicpIDogJycpLFxuICAgICAgICBEYXRhQ2xhc3NpZmljYXRpb246IHIuRGF0YUNsYXNzaWZpY2F0aW9uID8/IChyLmdldCA/IHIuZ2V0KCdEYXRhQ2xhc3NpZmljYXRpb24nKSA6ICcnKSxcbiAgICAgICAgVGVhbTogci5UZWFtID8/IChyLmdldCA/IHIuZ2V0KCdUZWFtJykgOiAnJyksXG4gICAgICAgIE93bmVyR3JvdXA6IHIuT3duZXJHcm91cCA/PyAoci5nZXQgPyByLmdldCgnT3duZXJHcm91cCcpIDogJycpLFxuICAgICAgICBSZWNvdmVyeTogci5SZWNvdmVyeSA/PyAoci5nZXQgPyByLmdldCgnUmVjb3ZlcnknKSA6ICcnKSxcbiAgICAgICAgVGllcjogci5UaWVyID8/IChyLmdldCA/IHIuZ2V0KCdUaWVyJykgOiAnJyksXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LmZpZWxkID09PSBcImdldFByb2plY3RBY2NvdW50c1wiKSB7XG4gICAgICBjb25zdCB7IHByb2plY3ROYW1lIH0gPSBldmVudC5hcmd1bWVudHM7XG5cbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBnIS5WKClcbiAgICAgICAgLmhhc0xhYmVsKCdQcm9qZWN0X0RhdGEnKVxuICAgICAgICAuaGFzKCdwcm9qZWN0TmFtZScsIHByb2plY3ROYW1lKVxuICAgICAgICAuaW5fKCdvd25lZF9ieScpXG4gICAgICAgIC5oYXNMYWJlbCgnQWNjb3VudCcpXG4gICAgICAgIC5wcm9qZWN0KCdpZCcsICdBY2NvdW50X05hbWUnLCAnQWNjb3VudF9JZCcsICdDbG91ZCcsICdFbnZpcm9ubWVudHMnKVxuICAgICAgICAuYnkoX18uaWQoKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnQWNjb3VudF9OYW1lJyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoJ0FjY291bnRfSWQnKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnQ2xvdWQnKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnRW52aXJvbm1lbnRzJyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC50b0xpc3QoKTtcblxuICAgICAgcmV0dXJuIHJlc3VsdHMubWFwKChyOiBhbnkpID0+ICh7XG4gICAgICAgIGlkOiByLmlkID8/IChyLmdldCA/IHIuZ2V0KCdpZCcpIDogdW5kZWZpbmVkKSxcbiAgICAgICAgQWNjb3VudF9OYW1lOiByLkFjY291bnRfTmFtZSA/PyAoci5nZXQgPyByLmdldCgnQWNjb3VudF9OYW1lJykgOiAnJyksXG4gICAgICAgIEFjY291bnRfSWQ6IHIuQWNjb3VudF9JZCA/PyAoci5nZXQgPyByLmdldCgnQWNjb3VudF9JZCcpIDogJycpLFxuICAgICAgICBDbG91ZDogci5DbG91ZCA/PyAoci5nZXQgPyByLmdldCgnQ2xvdWQnKSA6ICcnKSxcbiAgICAgICAgRW52aXJvbm1lbnRzOiByLkVudmlyb25tZW50cyA/PyAoci5nZXQgPyByLmdldCgnRW52aXJvbm1lbnRzJykgOiAnJyksXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LmZpZWxkID09PSBcImdldEVudGl0eVByb3BlcnRpZXNcIiB8fCBldmVudC5maWVsZCA9PT0gXCJnZXRFbnRpdHlFZGdlc1wiKSB7XG4gICAgICBjb25zdCB7IHZlcnRleFR5cGUsIHNlYXJjaFZhbHVlLCB2ZXJ0ZXhJZDogZGlyZWN0VmVydGV4SWQgfSA9IGV2ZW50LmFyZ3VtZW50cztcbiAgICAgIGNvbnN0IGNmZyA9IHNlYXJjaENvbmZpZ1t2ZXJ0ZXhUeXBlXTtcbiAgICAgIGlmICghY2ZnKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gdmVydGV4IHR5cGU6ICR7dmVydGV4VHlwZX1gKTtcblxuICAgICAgbGV0IHZlcnRleElkID0gZGlyZWN0VmVydGV4SWQ7XG4gICAgICBpZiAoIXZlcnRleElkKSB7XG4gICAgICAgIGxldCBzZWFyY2hRdWVyeSA9IGchLlYoKS5oYXNMYWJlbChjZmcubGFiZWwpO1xuICAgICAgICBpZiAoY2ZnLmVudGl0eVR5cGUpIHtcbiAgICAgICAgICBzZWFyY2hRdWVyeSA9IHNlYXJjaFF1ZXJ5LmhhcygnZW50aXR5VHlwZXMnLCBjZmcuZW50aXR5VHlwZSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdHJpbW1lZFN2ID0gKHNlYXJjaFZhbHVlIHx8ICcnKS50cmltKCk7XG4gICAgICAgIGlmICh0cmltbWVkU3YgJiYgdHJpbW1lZFN2ICE9PSAnKicpIHtcbiAgICAgICAgICBpZiAoY2ZnLmZpZWxkcy5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkuaGFzKGNmZy5maWVsZHNbMF0sIFRleHRQLmNvbnRhaW5pbmcodHJpbW1lZFN2KSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkub3IoXG4gICAgICAgICAgICAgIC4uLmNmZy5maWVsZHMubWFwKChmOiBzdHJpbmcpID0+IF9fLmhhcyhmLCBUZXh0UC5jb250YWluaW5nKHRyaW1tZWRTdikpKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmVydGV4SWRzID0gYXdhaXQgc2VhcmNoUXVlcnkuaWQoKS5saW1pdCgxKS50b0xpc3QoKTtcbiAgICAgICAgaWYgKHZlcnRleElkcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgICAgdmVydGV4SWQgPSB2ZXJ0ZXhJZHNbMF07XG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudC5maWVsZCA9PT0gXCJnZXRFbnRpdHlQcm9wZXJ0aWVzXCIpIHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZyEuVih2ZXJ0ZXhJZCkudmFsdWVNYXAoKS50b0xpc3QoKTtcbiAgICAgICAgaWYgKHJlc3VsdC5sZW5ndGggPT09IDApIHJldHVybiBbXTtcbiAgICAgICAgY29uc3QgdmVydGV4TWFwID0gcmVzdWx0WzBdO1xuICAgICAgICBjb25zdCBwcm9wZXJ0aWVzOiBBcnJheTx7IGtleTogc3RyaW5nOyB2YWx1ZTogc3RyaW5nIH0+ID0gW107XG4gICAgICAgIGNvbnN0IGVudHJpZXMgPSB2ZXJ0ZXhNYXAgaW5zdGFuY2VvZiBNYXAgPyBBcnJheS5mcm9tKHZlcnRleE1hcC5lbnRyaWVzKCkpIDogT2JqZWN0LmVudHJpZXModmVydGV4TWFwKTtcbiAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWxdIG9mIGVudHJpZXMpIHtcbiAgICAgICAgICBjb25zdCBwcm9wVmFsdWUgPSBBcnJheS5pc0FycmF5KHZhbCkgPyBTdHJpbmcodmFsWzBdKSA6IFN0cmluZyh2YWwpO1xuICAgICAgICAgIGlmIChwcm9wVmFsdWUgIT09IHVuZGVmaW5lZCAmJiBwcm9wVmFsdWUgIT09ICd1bmRlZmluZWQnICYmIHByb3BWYWx1ZSAhPT0gJycpIHtcbiAgICAgICAgICAgIHByb3BlcnRpZXMucHVzaCh7IGtleTogU3RyaW5nKGtleSksIHZhbHVlOiBwcm9wVmFsdWUgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9wZXJ0aWVzO1xuICAgICAgfVxuXG4gICAgICBpZiAoZXZlbnQuZmllbGQgPT09IFwiZ2V0RW50aXR5RWRnZXNcIikge1xuICAgICAgICBjb25zdCBvdXRFZGdlcyA9IGF3YWl0IGchLlYodmVydGV4SWQpXG4gICAgICAgICAgLm91dEUoKVxuICAgICAgICAgIC5wcm9qZWN0KCdlZGdlTGFiZWwnLCAndGFyZ2V0TGFiZWwnLCAndGFyZ2V0TmFtZScpXG4gICAgICAgICAgLmJ5KF9fLmxhYmVsKCkpXG4gICAgICAgICAgLmJ5KF9fLmluVigpLmxhYmVsKCkpXG4gICAgICAgICAgLmJ5KF9fLmluVigpLmNvYWxlc2NlKFxuICAgICAgICAgICAgX18udmFsdWVzKCdjb21wYW55TmFtZScpLFxuICAgICAgICAgICAgX18udmFsdWVzKCduYW1lJyksXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ2pvYk5hbWUnKSxcbiAgICAgICAgICAgIF9fLnZhbHVlcygncGFydE5hbWUnKSxcbiAgICAgICAgICAgIF9fLnZhbHVlcygnbWFrZScpLFxuICAgICAgICAgICAgX18uY29uc3RhbnQoJ1Vua25vd24nKVxuICAgICAgICAgICkpXG4gICAgICAgICAgLnRvTGlzdCgpO1xuXG4gICAgICAgIGNvbnN0IGluRWRnZXMgPSBhd2FpdCBnIS5WKHZlcnRleElkKVxuICAgICAgICAgIC5pbkUoKVxuICAgICAgICAgIC5wcm9qZWN0KCdlZGdlTGFiZWwnLCAndGFyZ2V0TGFiZWwnLCAndGFyZ2V0TmFtZScpXG4gICAgICAgICAgLmJ5KF9fLmxhYmVsKCkpXG4gICAgICAgICAgLmJ5KF9fLm91dFYoKS5sYWJlbCgpKVxuICAgICAgICAgIC5ieShfXy5vdXRWKCkuY29hbGVzY2UoXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ2NvbXBhbnlOYW1lJyksXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ25hbWUnKSxcbiAgICAgICAgICAgIF9fLnZhbHVlcygnam9iTmFtZScpLFxuICAgICAgICAgICAgX18udmFsdWVzKCdwYXJ0TmFtZScpLFxuICAgICAgICAgICAgX18udmFsdWVzKCdtYWtlJyksXG4gICAgICAgICAgICBfXy5jb25zdGFudCgnVW5rbm93bicpXG4gICAgICAgICAgKSlcbiAgICAgICAgICAudG9MaXN0KCk7XG5cbiAgICAgICAgY29uc3QgZWRnZXM6IEFycmF5PHsgZWRnZUxhYmVsOiBzdHJpbmc7IGRpcmVjdGlvbjogc3RyaW5nOyB0YXJnZXRMYWJlbDogc3RyaW5nOyB0YXJnZXROYW1lOiBzdHJpbmcgfT4gPSBbXTtcbiAgICAgICAgZm9yIChjb25zdCBlIG9mIG91dEVkZ2VzIGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+ICYgeyBnZXQ/OiAoa2V5OiBzdHJpbmcpID0+IHVua25vd24gfT4pIHtcbiAgICAgICAgICBlZGdlcy5wdXNoKHtcbiAgICAgICAgICAgIGVkZ2VMYWJlbDogU3RyaW5nKGUuZWRnZUxhYmVsID8/IChlLmdldCA/IGUuZ2V0KCdlZGdlTGFiZWwnKSA6ICcnKSksXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdvdXRnb2luZycsXG4gICAgICAgICAgICB0YXJnZXRMYWJlbDogU3RyaW5nKGUudGFyZ2V0TGFiZWwgPz8gKGUuZ2V0ID8gZS5nZXQoJ3RhcmdldExhYmVsJykgOiAnJykpLFxuICAgICAgICAgICAgdGFyZ2V0TmFtZTogU3RyaW5nKGUudGFyZ2V0TmFtZSA/PyAoZS5nZXQgPyBlLmdldCgndGFyZ2V0TmFtZScpIDogJycpKSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGUgb2YgaW5FZGdlcyBhcyBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiAmIHsgZ2V0PzogKGtleTogc3RyaW5nKSA9PiB1bmtub3duIH0+KSB7XG4gICAgICAgICAgZWRnZXMucHVzaCh7XG4gICAgICAgICAgICBlZGdlTGFiZWw6IFN0cmluZyhlLmVkZ2VMYWJlbCA/PyAoZS5nZXQgPyBlLmdldCgnZWRnZUxhYmVsJykgOiAnJykpLFxuICAgICAgICAgICAgZGlyZWN0aW9uOiAnaW5jb21pbmcnLFxuICAgICAgICAgICAgdGFyZ2V0TGFiZWw6IFN0cmluZyhlLnRhcmdldExhYmVsID8/IChlLmdldCA/IGUuZ2V0KCd0YXJnZXRMYWJlbCcpIDogJycpKSxcbiAgICAgICAgICAgIHRhcmdldE5hbWU6IFN0cmluZyhlLnRhcmdldE5hbWUgPz8gKGUuZ2V0ID8gZS5nZXQoJ3RhcmdldE5hbWUnKSA6ICcnKSksXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGVkZ2VzO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0eXBlID09PSBcInByb2ZpbGVcIikge1xuICAgICAgY29uc29sZS5sb2coZyk7XG4gICAgICBsZXQgdXNhZ2U6IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgYmVsb25nX3RvOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgbGV0IGF1dGhvcmVkX2J5OiBzdHJpbmdbXSA9IFtdO1xuICAgICAgbGV0IGFmZmlsaWF0ZWRfd2l0aDogc3RyaW5nW10gPSBbXTtcbiAgICAgIGxldCBwZW9wbGU6IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgbWFkZV9ieTogc3RyaW5nW10gPSBbXTtcbiAgICAgIGNvbnN0IHNlYXJjaF9uYW1lID0gYXdhaXQgZyFcbiAgICAgICAgLlYoZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgIHN3aXRjaCAoZXZlbnQuYXJndW1lbnRzLnZhbHVlKSB7XG4gICAgICAgIGNhc2UgXCJwZXJzb25cIjpcbiAgICAgICAgICB1c2FnZSA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYm90aEUoKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwidXNhZ2VcIilcbiAgICAgICAgICAgIC5vdGhlclYoKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICBiZWxvbmdfdG8gPSBhd2FpdCBnXG4gICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAuaGFzKGV2ZW50LmFyZ3VtZW50cy52YWx1ZSwgXCJuYW1lXCIsIGV2ZW50LmFyZ3VtZW50cy5uYW1lKVxuICAgICAgICAgICAgLmJvdGhFKClcbiAgICAgICAgICAgIC5oYXNMYWJlbChcImJlbG9uZ190b1wiKVxuICAgICAgICAgICAgLm90aGVyVigpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGF1dGhvcmVkX2J5ID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJhdXRob3JlZF9ieVwiKVxuICAgICAgICAgICAgLm90aGVyVigpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGFmZmlsaWF0ZWRfd2l0aCA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYm90aEUoKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiYWZmaWxpYXRlZF93aXRoXCIpXG4gICAgICAgICAgICAub3RoZXJWKClcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIHsgc2VhcmNoX25hbWUsIHVzYWdlLCBiZWxvbmdfdG8sIGF1dGhvcmVkX2J5LCBhZmZpbGlhdGVkX3dpdGggfSxcbiAgICAgICAgICBdO1xuICAgICAgICBjYXNlIFwiaWRcIjpcbiAgICAgICAgICB1c2FnZSA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXNJZChldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJ1c2FnZVwiKVxuICAgICAgICAgICAgLm90aGVyVigpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGlmIChldmVudC5hcmd1bWVudHMubmFtZS5tYXRjaCgvRG9jLykpIHtcbiAgICAgICAgICAgIGJlbG9uZ190byA9IGF3YWl0IGdcbiAgICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgICAuaGFzSWQoZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAgIC5oYXNMYWJlbChcImJlbG9uZ190b1wiKVxuICAgICAgICAgICAgICAub3RoZXJWKClcbiAgICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBiZWxvbmdfdG8gPSBbXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYXV0aG9yZWRfYnkgPSBhd2FpdCBnXG4gICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAuaGFzSWQoZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYm90aEUoKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiYXV0aG9yZWRfYnlcIilcbiAgICAgICAgICAgIC5vdGhlclYoKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICBhZmZpbGlhdGVkX3dpdGggPSBhd2FpdCBnXG4gICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAuaGFzSWQoZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYm90aEUoKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiYWZmaWxpYXRlZF93aXRoXCIpXG4gICAgICAgICAgICAub3RoZXJWKClcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgaWYgKGV2ZW50LmFyZ3VtZW50cy5uYW1lLm1hdGNoKC9Qcm9kLykpIHtcbiAgICAgICAgICAgIG1hZGVfYnkgPSBhd2FpdCBnXG4gICAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgICAgLmhhc0lkKGV2ZW50LmFyZ3VtZW50cy5uYW1lKVxuICAgICAgICAgICAgICAub3V0KFwibWFkZV9ieVwiKVxuICAgICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG1hZGVfYnkgPSBbXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGV2ZW50LmFyZ3VtZW50cy5uYW1lLm1hdGNoKC9Db25mLykpIHtcbiAgICAgICAgICAgIHBlb3BsZSA9IGF3YWl0IGdcbiAgICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgICAuaGFzSWQoZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAgIC5pbl8oKVxuICAgICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBlb3BsZSA9IFtdO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZXZlbnQuYXJndW1lbnRzLm5hbWUubWF0Y2goL0luc3QvKSkge1xuICAgICAgICAgICAgYWZmaWxpYXRlZF93aXRoID0gW107XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNlYXJjaF9uYW1lLFxuICAgICAgICAgICAgICB1c2FnZSxcbiAgICAgICAgICAgICAgYmVsb25nX3RvLFxuICAgICAgICAgICAgICBhdXRob3JlZF9ieSxcbiAgICAgICAgICAgICAgYWZmaWxpYXRlZF93aXRoLFxuICAgICAgICAgICAgICBtYWRlX2J5LFxuICAgICAgICAgICAgICBwZW9wbGUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF07XG4gICAgICAgIGNhc2UgXCJwcm9kdWN0XCI6XG4gICAgICAgICAgY29uc29sZS5sb2coZXZlbnQuYXJndW1lbnRzKTtcbiAgICAgICAgICBtYWRlX2J5ID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5vdXQoXCJtYWRlX2J5XCIpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIHJldHVybiBbeyBzZWFyY2hfbmFtZSwgbWFkZV9ieSB9XTtcbiAgICAgICAgY2FzZSBcImNvbmZlcmVuY2VcIjpcbiAgICAgICAgICBjb25zb2xlLmxvZyhldmVudC5hcmd1bWVudHMpO1xuICAgICAgICAgIHBlb3BsZSA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuaW5fKClcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgcmV0dXJuIFt7IHNlYXJjaF9uYW1lLCBwZW9wbGUgfV07XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgY29uc29sZS5sb2coXCJkZWZhdWx0XCIpO1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHR5cGUgPT09IFwicmVsYXRpb25cIikge1xuICAgICAgc3dpdGNoIChldmVudC5hcmd1bWVudHMudmFsdWUpIHtcbiAgICAgICAgY2FzZSBcInBlcnNvblwiOlxuICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlKVxuICAgICAgICAgICAgLm91dChcImJlbG9uZ190b1wiKVxuICAgICAgICAgICAgLmluXygpXG4gICAgICAgICAgICAud2hlcmUoUC5uZXEoZXZlbnQuYXJndW1lbnRzLnZhbHVlKSlcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAuZGVkdXAoKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIHJldHVybiByZXN1bHQubWFwKChyOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB7IG5hbWU6IHIgfTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICBjYXNlIFwicHJvZHVjdFwiOlxuICAgICAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCBnXG4gICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAuaGFzKGV2ZW50LmFyZ3VtZW50cy52YWx1ZSwgXCJuYW1lXCIsIGV2ZW50LmFyZ3VtZW50cy5uYW1lKVxuICAgICAgICAgICAgLmFzKGV2ZW50LmFyZ3VtZW50cy52YWx1ZSlcbiAgICAgICAgICAgIC5pbl8oXCJ1c2FnZVwiKVxuICAgICAgICAgICAgLmFzKFwicFwiKVxuICAgICAgICAgICAgLmluXyhcImF1dGhvcmVkX2J5XCIpXG4gICAgICAgICAgICAub3V0KClcbiAgICAgICAgICAgIC53aGVyZShQLm5lcShcInBcIikpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLmRlZHVwKClcbiAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0Mi5tYXAoKHI6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogciB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICBjYXNlIFwiY29uZmVyZW5jZVwiOlxuICAgICAgICAgIGNvbnNvbGUubG9nKGV2ZW50LmFyZ3VtZW50cyk7XG4gICAgICAgICAgY29uc3QgcmVzdWx0MyA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlKVxuICAgICAgICAgICAgLmluXygpXG4gICAgICAgICAgICAuYXMoXCJwXCIpXG4gICAgICAgICAgICAub3V0KClcbiAgICAgICAgICAgIC5oYXNMYWJlbChcInBlcnNvblwiKVxuICAgICAgICAgICAgLndoZXJlKFAubmVxKFwicFwiKSlcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAuZGVkdXAoKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGNvbnNvbGUubG9nKHJlc3VsdDMpO1xuICAgICAgICAgIHJldHVybiByZXN1bHQzLm1hcCgocjogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lOiByIH07XG4gICAgICAgICAgfSk7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgY29uc29sZS5sb2coXCJkZWZhdWx0XCIpO1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZy5WKCkudG9MaXN0KCk7XG4gICAgICBjb25zdCB2ZXJ0ZXggPSByZXN1bHQubWFwKChyOiBhbnkpID0+IHtcbiAgICAgICAgcmV0dXJuIHsgaWQ6IHIuaWQsIGxhYmVsOiByLmxhYmVsIH07XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHJlc3VsdDIgPSBhd2FpdCBnLkUoKS50b0xpc3QoKTtcbiAgICAgIGNvbnN0IGVkZ2UgPSByZXN1bHQyLm1hcCgocjogYW55KSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKHIpO1xuICAgICAgICByZXR1cm4geyBzb3VyY2U6IHIub3V0Vi5pZCwgdGFyZ2V0OiByLmluVi5pZCwgdmFsdWU6IHIubGFiZWwgfTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHsgbm9kZXM6IHZlcnRleCwgbGlua3M6IGVkZ2UgfTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICBjb25zb2xlLmxvZyhlcnJvcik7XG4gICAgY29uc29sZS5lcnJvcihKU09OLnN0cmluZ2lmeShlcnJvcikpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuIl19