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
const social_1 = require("./social");
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
    const type = event.arguments?.type;
    console.log(type);
    try {
        // Member-networking fields use the social resolver module. We still need
        // a Gremlin traversal source for these because they query Neptune for
        // feeds, members, events, etc.
        if (social_1.SOCIAL_QUERY_FIELDS.has(event.field)) {
            if (conn == null) {
                conn = createRemoteConnection();
                g = traversal().withRemote(conn);
            }
            const identity = (event.identity ?? null);
            return await (0, social_1.dispatchSocialQuery)(event.field, event.arguments ?? {}, {
                g,
                identity,
            });
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicXVlcnlHcmFwaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInF1ZXJ5R3JhcGgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBRUEsNEVBQTRFO0FBQzVFLHlFQUF5RTtBQUN6RSwyRUFBMkU7QUFDM0Usd0VBQXdFO0FBQ3hFLE9BQVEsVUFBa0IsQ0FBQyxTQUFTLENBQUM7QUFFckMsbUNBQW1DO0FBQ25DLHVEQUErRDtBQUMvRCxxQ0FBb0U7QUFFcEUsTUFBTSxzQkFBc0IsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLHNCQUFzQixDQUFDO0FBQ3JFLE1BQU0sQ0FBQyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQzVCLE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsd0JBQXdCLENBQUMsU0FBUyxDQUFDO0FBQ3JFLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDO0FBQ25DLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDO0FBUzdCLE1BQU0sT0FBTyxHQUFZLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTtJQUM5QyxJQUFJLElBQUksR0FBRyxJQUFJLENBQUM7SUFDaEIsTUFBTSxvQkFBb0IsR0FBRyxHQUFHLEVBQUU7UUFDaEMsT0FBTyxJQUFBLHdCQUFnQixFQUNyQixPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixFQUM1QixPQUFPLENBQUMsR0FBRyxDQUFDLFlBQVksRUFDeEIsRUFBRSxFQUNGLFVBQVUsRUFDVixLQUFLLENBQ04sQ0FBQztJQUNKLENBQUMsQ0FBQztJQUVGLE1BQU0sc0JBQXNCLEdBQUcsR0FBRyxFQUFFO1FBQ2xDLE1BQU0sRUFBRSxHQUFHLEVBQUUsT0FBTyxFQUFFLEdBQUcsb0JBQW9CLEVBQUUsQ0FBQztRQUVoRCxPQUFPLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2pCLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDckIsTUFBTSxDQUFDLEdBQUcsSUFBSSxzQkFBc0IsQ0FBQyxHQUFHLEVBQUU7WUFDeEMsUUFBUSxFQUFFLG1DQUFtQztZQUM3QyxPQUFPLEVBQUUsT0FBTztTQUNqQixDQUFDLENBQUM7UUFDSCxNQUFNLGdCQUFnQixHQUFHLENBQStCLENBQUM7UUFDekQsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLFdBQVcsRUFBRSxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsSUFBWSxFQUFFLE9BQWUsRUFBRSxFQUFFO1lBQ25GLE9BQU8sQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLElBQUksT0FBTyxFQUFFLENBQUMsQ0FBQztZQUMzQyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDakIsT0FBTyxDQUFDLEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxDQUFDO2dCQUMvQyxNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7WUFDbkQsQ0FBQztRQUNILENBQUMsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDLENBQUM7SUFFRixJQUFJLENBQUMsR0FBUSxJQUFJLENBQUM7SUFFbEIsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUM7SUFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNsQixJQUFJLENBQUM7UUFDSCx5RUFBeUU7UUFDekUsc0VBQXNFO1FBQ3RFLCtCQUErQjtRQUMvQixJQUFJLDRCQUFtQixDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN6QyxJQUFJLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDakIsSUFBSSxHQUFHLHNCQUFzQixFQUFFLENBQUM7Z0JBQ2hDLENBQUMsR0FBRyxTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDbkMsQ0FBQztZQUNELE1BQU0sUUFBUSxHQUFHLENBQUMsS0FBSyxDQUFDLFFBQVEsSUFBSSxJQUFJLENBRWhDLENBQUM7WUFDVCxPQUFPLE1BQU0sSUFBQSw0QkFBbUIsRUFBQyxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxTQUFTLElBQUksRUFBRSxFQUFFO2dCQUNuRSxDQUFDO2dCQUNELFFBQVE7YUFDVCxDQUFDLENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxJQUFJLElBQUksSUFBSSxFQUFFLENBQUM7WUFDakIsT0FBTyxDQUFDLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO1lBQ3hDLElBQUksR0FBRyxzQkFBc0IsRUFBRSxDQUFDO1lBQ2hDLENBQUMsR0FBRyxTQUFTLEVBQUUsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbkMsQ0FBQztRQUVELHlCQUF5QjtRQUN6QixNQUFNLFlBQVksR0FBNkU7WUFDN0YsT0FBTyxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxhQUFhLENBQUMsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFO1lBQzVFLFFBQVEsRUFBRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsVUFBVSxFQUFFLFVBQVUsRUFBRTtZQUN2RSxTQUFTLEVBQUUsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUU7WUFDekUsTUFBTSxFQUFFLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsQ0FBQyxhQUFhLENBQUMsRUFBRSxVQUFVLEVBQUUsUUFBUSxFQUFFO1lBQzFFLEtBQUssRUFBRSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUMsTUFBTSxFQUFFLE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRTtZQUMzRCxHQUFHLEVBQUUsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxDQUFDLFNBQVMsQ0FBQyxFQUFFO1lBQzFDLElBQUksRUFBRSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUU7WUFDN0MsWUFBWSxFQUFFLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxhQUFhLENBQUMsRUFBRTtTQUNqRSxDQUFDO1FBRUYsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLGdCQUFnQixFQUFFLENBQUM7WUFDckMsTUFBTSxFQUFFLFVBQVUsRUFBRSxXQUFXLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQ3BELE1BQU0sR0FBRyxHQUFHLFlBQVksQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUNyQyxJQUFJLENBQUMsR0FBRztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBRWhFLElBQUksV0FBVyxHQUFHLENBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzdDLElBQUksR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDO2dCQUNuQixXQUFXLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1lBQy9ELENBQUM7WUFFRCxxREFBcUQ7WUFDckQsTUFBTSxPQUFPLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDM0MsSUFBSSxPQUFPLElBQUksT0FBTyxLQUFLLEdBQUcsRUFBRSxDQUFDO2dCQUMvQixJQUFJLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUM1QixXQUFXLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztnQkFDMUUsQ0FBQztxQkFBTSxDQUFDO29CQUNOLFdBQVcsR0FBRyxXQUFXLENBQUMsRUFBRSxDQUMxQixHQUFHLEdBQUcsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FDdkUsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQztZQUVELE1BQU0sT0FBTyxHQUFHLE1BQU0sV0FBVztpQkFDOUIsT0FBTyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLFlBQVksQ0FBQztpQkFDNUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztpQkFDWCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FDYixFQUFFLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxFQUN4QixFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUNqQixFQUFFLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUNwQixFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUNyQixFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUNqQixFQUFFLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUN2QixDQUFDO2lCQUNELEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7aUJBQ2QsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQzFELEtBQUssQ0FBQyxFQUFFLENBQUM7aUJBQ1QsTUFBTSxFQUFFLENBQUM7WUFFWixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQzlCLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO2dCQUM3QyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztnQkFDbkQsS0FBSyxFQUFFLENBQUMsQ0FBQyxLQUFLLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7Z0JBQ3RELFVBQVUsRUFBRSxDQUFDLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSTthQUN6RSxDQUFDLENBQUMsQ0FBQztRQUNOLENBQUM7UUFFRCxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQztZQUNyQyxNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztZQUN4QyxNQUFNLE9BQU8sR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUUzQyxJQUFJLFdBQVcsR0FBRyxDQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ2xELElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQ1osV0FBVyxHQUFHLFdBQVcsQ0FBQyxHQUFHLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUMxRSxDQUFDO1lBRUQsTUFBTSxPQUFPLEdBQUcsTUFBTSxXQUFXO2lCQUM5QixPQUFPLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSxvQkFBb0IsRUFBRSxNQUFNLEVBQUUsWUFBWSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUM7aUJBQ2hILEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7aUJBQ1gsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQzFELEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQy9ELEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsb0JBQW9CLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQ2pFLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUNuRCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLFlBQVksQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztpQkFDekQsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxVQUFVLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQ3ZELEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUNuRCxLQUFLLENBQUMsR0FBRyxDQUFDO2lCQUNWLE1BQU0sRUFBRSxDQUFDO1lBRVosT0FBTyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUM5QixFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztnQkFDN0MsV0FBVyxFQUFFLENBQUMsQ0FBQyxXQUFXLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQ2pFLGdCQUFnQixFQUFFLENBQUMsQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNoRixrQkFBa0IsRUFBRSxDQUFDLENBQUMsa0JBQWtCLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDdEYsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQzVDLFVBQVUsRUFBRSxDQUFDLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUM5RCxRQUFRLEVBQUUsQ0FBQyxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDeEQsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7YUFDN0MsQ0FBQyxDQUFDLENBQUM7UUFDTixDQUFDO1FBRUQsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLG9CQUFvQixFQUFFLENBQUM7WUFDekMsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7WUFFeEMsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFFLENBQUMsQ0FBQyxFQUFFO2lCQUN6QixRQUFRLENBQUMsY0FBYyxDQUFDO2lCQUN4QixHQUFHLENBQUMsYUFBYSxFQUFFLFdBQVcsQ0FBQztpQkFDL0IsR0FBRyxDQUFDLFVBQVUsQ0FBQztpQkFDZixRQUFRLENBQUMsU0FBUyxDQUFDO2lCQUNuQixPQUFPLENBQUMsSUFBSSxFQUFFLGNBQWMsRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGNBQWMsQ0FBQztpQkFDcEUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztpQkFDWCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztpQkFDM0QsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLE1BQU0sQ0FBQyxZQUFZLENBQUMsRUFBRSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7aUJBQ3pELEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO2lCQUNwRCxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztpQkFDM0QsTUFBTSxFQUFFLENBQUM7WUFFWixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQzlCLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO2dCQUM3QyxZQUFZLEVBQUUsQ0FBQyxDQUFDLFlBQVksSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDcEUsVUFBVSxFQUFFLENBQUMsQ0FBQyxVQUFVLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7Z0JBQzlELEtBQUssRUFBRSxDQUFDLENBQUMsS0FBSyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUMvQyxZQUFZLEVBQUUsQ0FBQyxDQUFDLFlBQVksSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQzthQUNyRSxDQUFDLENBQUMsQ0FBQztRQUNOLENBQUM7UUFFRCxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUsscUJBQXFCLElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO1lBQzlFLE1BQU0sRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxjQUFjLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQzlFLE1BQU0sR0FBRyxHQUFHLFlBQVksQ0FBQyxVQUFVLENBQUMsQ0FBQztZQUNyQyxJQUFJLENBQUMsR0FBRztnQkFBRSxNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixVQUFVLEVBQUUsQ0FBQyxDQUFDO1lBRWhFLElBQUksUUFBUSxHQUFHLGNBQWMsQ0FBQztZQUM5QixJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQ2QsSUFBSSxXQUFXLEdBQUcsQ0FBRSxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzdDLElBQUksR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDO29CQUNuQixXQUFXLEdBQUcsV0FBVyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsR0FBRyxDQUFDLFVBQVUsQ0FBQyxDQUFDO2dCQUMvRCxDQUFDO2dCQUNELE1BQU0sU0FBUyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUM3QyxJQUFJLFNBQVMsSUFBSSxTQUFTLEtBQUssR0FBRyxFQUFFLENBQUM7b0JBQ25DLElBQUksR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7d0JBQzVCLFdBQVcsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO29CQUM1RSxDQUFDO3lCQUFNLENBQUM7d0JBQ04sV0FBVyxHQUFHLFdBQVcsQ0FBQyxFQUFFLENBQzFCLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUN6RSxDQUFDO29CQUNKLENBQUM7Z0JBQ0gsQ0FBQztnQkFDRCxNQUFNLFNBQVMsR0FBRyxNQUFNLFdBQVcsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQzNELElBQUksU0FBUyxDQUFDLE1BQU0sS0FBSyxDQUFDO29CQUFFLE9BQU8sRUFBRSxDQUFDO2dCQUN0QyxRQUFRLEdBQUcsU0FBUyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzFCLENBQUM7WUFFRCxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUsscUJBQXFCLEVBQUUsQ0FBQztnQkFDMUMsTUFBTSxNQUFNLEdBQUcsTUFBTSxDQUFFLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUN4RCxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQztvQkFBRSxPQUFPLEVBQUUsQ0FBQztnQkFDbkMsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUM1QixNQUFNLFVBQVUsR0FBMEMsRUFBRSxDQUFDO2dCQUM3RCxNQUFNLE9BQU8sR0FBRyxTQUFTLFlBQVksR0FBRyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUN2RyxLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksT0FBTyxFQUFFLENBQUM7b0JBQ2pDLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDO29CQUNwRSxJQUFJLFNBQVMsS0FBSyxTQUFTLElBQUksU0FBUyxLQUFLLFdBQVcsSUFBSSxTQUFTLEtBQUssRUFBRSxFQUFFLENBQUM7d0JBQzdFLFVBQVUsQ0FBQyxJQUFJLENBQUMsRUFBRSxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO29CQUMxRCxDQUFDO2dCQUNILENBQUM7Z0JBQ0QsT0FBTyxVQUFVLENBQUM7WUFDcEIsQ0FBQztZQUVELElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNyQyxNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO3FCQUNsQyxJQUFJLEVBQUU7cUJBQ04sT0FBTyxDQUFDLFdBQVcsRUFBRSxhQUFhLEVBQUUsWUFBWSxDQUFDO3FCQUNqRCxFQUFFLENBQUMsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDO3FCQUNkLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7cUJBQ3BCLEVBQUUsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsUUFBUSxDQUNuQixFQUFFLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxFQUN4QixFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUNqQixFQUFFLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxFQUNwQixFQUFFLENBQUMsTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUNyQixFQUFFLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUNqQixFQUFFLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxDQUN2QixDQUFDO3FCQUNELE1BQU0sRUFBRSxDQUFDO2dCQUVaLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBRSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7cUJBQ2pDLEdBQUcsRUFBRTtxQkFDTCxPQUFPLENBQUMsV0FBVyxFQUFFLGFBQWEsRUFBRSxZQUFZLENBQUM7cUJBQ2pELEVBQUUsQ0FBQyxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7cUJBQ2QsRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztxQkFDckIsRUFBRSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxRQUFRLENBQ3BCLEVBQUUsQ0FBQyxNQUFNLENBQUMsYUFBYSxDQUFDLEVBQ3hCLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQ2pCLEVBQUUsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQ3BCLEVBQUUsQ0FBQyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQ3JCLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQ2pCLEVBQUUsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQ3ZCLENBQUM7cUJBQ0QsTUFBTSxFQUFFLENBQUM7Z0JBRVosTUFBTSxLQUFLLEdBQTZGLEVBQUUsQ0FBQztnQkFDM0csS0FBSyxNQUFNLENBQUMsSUFBSSxRQUErRSxFQUFFLENBQUM7b0JBQ2hHLEtBQUssQ0FBQyxJQUFJLENBQUM7d0JBQ1QsU0FBUyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsU0FBUyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ25FLFNBQVMsRUFBRSxVQUFVO3dCQUNyQixXQUFXLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxXQUFXLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzt3QkFDekUsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsVUFBVSxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7cUJBQ3ZFLENBQUMsQ0FBQztnQkFDTCxDQUFDO2dCQUNELEtBQUssTUFBTSxDQUFDLElBQUksT0FBOEUsRUFBRSxDQUFDO29CQUMvRixLQUFLLENBQUMsSUFBSSxDQUFDO3dCQUNULFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLFNBQVMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3dCQUNuRSxTQUFTLEVBQUUsVUFBVTt3QkFDckIsV0FBVyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsV0FBVyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7d0JBQ3pFLFVBQVUsRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLFVBQVUsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO3FCQUN2RSxDQUFDLENBQUM7Z0JBQ0wsQ0FBQztnQkFDRCxPQUFPLEtBQUssQ0FBQztZQUNmLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxJQUFJLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDdkIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNmLElBQUksS0FBSyxHQUFhLEVBQUUsQ0FBQztZQUN6QixJQUFJLFNBQVMsR0FBYSxFQUFFLENBQUM7WUFDN0IsSUFBSSxXQUFXLEdBQWEsRUFBRSxDQUFDO1lBQy9CLElBQUksZUFBZSxHQUFhLEVBQUUsQ0FBQztZQUNuQyxJQUFJLE1BQU0sR0FBYSxFQUFFLENBQUM7WUFDMUIsSUFBSSxPQUFPLEdBQWEsRUFBRSxDQUFDO1lBQzNCLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBRTtpQkFDekIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO2lCQUN2QixNQUFNLENBQUMsTUFBTSxDQUFDO2lCQUNkLE1BQU0sRUFBYyxDQUFDO1lBQ3hCLFFBQVEsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztnQkFDOUIsS0FBSyxRQUFRO29CQUNYLEtBQUssR0FBRyxNQUFNLENBQUM7eUJBQ1osQ0FBQyxFQUFFO3lCQUNILEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7eUJBQ3hELEtBQUssRUFBRTt5QkFDUCxRQUFRLENBQUMsT0FBTyxDQUFDO3lCQUNqQixNQUFNLEVBQUU7eUJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsU0FBUyxHQUFHLE1BQU0sQ0FBQzt5QkFDaEIsQ0FBQyxFQUFFO3lCQUNILEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7eUJBQ3hELEtBQUssRUFBRTt5QkFDUCxRQUFRLENBQUMsV0FBVyxDQUFDO3lCQUNyQixNQUFNLEVBQUU7eUJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsV0FBVyxHQUFHLE1BQU0sQ0FBQzt5QkFDbEIsQ0FBQyxFQUFFO3lCQUNILEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7eUJBQ3hELEtBQUssRUFBRTt5QkFDUCxRQUFRLENBQUMsYUFBYSxDQUFDO3lCQUN2QixNQUFNLEVBQUU7eUJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsZUFBZSxHQUFHLE1BQU0sQ0FBQzt5QkFDdEIsQ0FBQyxFQUFFO3lCQUNILEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7eUJBQ3hELEtBQUssRUFBRTt5QkFDUCxRQUFRLENBQUMsaUJBQWlCLENBQUM7eUJBQzNCLE1BQU0sRUFBRTt5QkFDUixNQUFNLENBQUMsTUFBTSxDQUFDO3lCQUNkLE1BQU0sRUFBYyxDQUFDO29CQUN4QixPQUFPO3dCQUNMLEVBQUUsV0FBVyxFQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsV0FBVyxFQUFFLGVBQWUsRUFBRTtxQkFDaEUsQ0FBQztnQkFDSixLQUFLLElBQUk7b0JBQ1AsS0FBSyxHQUFHLE1BQU0sQ0FBQzt5QkFDWixDQUFDLEVBQUU7eUJBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUMzQixLQUFLLEVBQUU7eUJBQ1AsUUFBUSxDQUFDLE9BQU8sQ0FBQzt5QkFDakIsTUFBTSxFQUFFO3lCQUNSLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7d0JBQ3RDLFNBQVMsR0FBRyxNQUFNLENBQUM7NkJBQ2hCLENBQUMsRUFBRTs2QkFDSCxLQUFLLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUM7NkJBQzNCLEtBQUssRUFBRTs2QkFDUCxRQUFRLENBQUMsV0FBVyxDQUFDOzZCQUNyQixNQUFNLEVBQUU7NkJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzs2QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDMUIsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLFNBQVMsR0FBRyxFQUFFLENBQUM7b0JBQ2pCLENBQUM7b0JBQ0QsV0FBVyxHQUFHLE1BQU0sQ0FBQzt5QkFDbEIsQ0FBQyxFQUFFO3lCQUNILEtBQUssQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDM0IsS0FBSyxFQUFFO3lCQUNQLFFBQVEsQ0FBQyxhQUFhLENBQUM7eUJBQ3ZCLE1BQU0sRUFBRTt5QkFDUixNQUFNLENBQUMsTUFBTSxDQUFDO3lCQUNkLE1BQU0sRUFBYyxDQUFDO29CQUN4QixlQUFlLEdBQUcsTUFBTSxDQUFDO3lCQUN0QixDQUFDLEVBQUU7eUJBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUMzQixLQUFLLEVBQUU7eUJBQ1AsUUFBUSxDQUFDLGlCQUFpQixDQUFDO3lCQUMzQixNQUFNLEVBQUU7eUJBQ1IsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQzt3QkFDdkMsT0FBTyxHQUFHLE1BQU0sQ0FBQzs2QkFDZCxDQUFDLEVBQUU7NkJBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDOzZCQUMzQixHQUFHLENBQUMsU0FBUyxDQUFDOzZCQUNkLE1BQU0sQ0FBQyxNQUFNLENBQUM7NkJBQ2QsTUFBTSxFQUFjLENBQUM7b0JBQzFCLENBQUM7eUJBQU0sQ0FBQzt3QkFDTixPQUFPLEdBQUcsRUFBRSxDQUFDO29CQUNmLENBQUM7b0JBQ0QsSUFBSSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQzt3QkFDdkMsTUFBTSxHQUFHLE1BQU0sQ0FBQzs2QkFDYixDQUFDLEVBQUU7NkJBQ0gsS0FBSyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDOzZCQUMzQixHQUFHLEVBQUU7NkJBQ0wsTUFBTSxDQUFDLE1BQU0sQ0FBQzs2QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDMUIsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLE1BQU0sR0FBRyxFQUFFLENBQUM7b0JBQ2QsQ0FBQztvQkFDRCxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO3dCQUN2QyxlQUFlLEdBQUcsRUFBRSxDQUFDO29CQUN2QixDQUFDO29CQUNELE9BQU87d0JBQ0w7NEJBQ0UsV0FBVzs0QkFDWCxLQUFLOzRCQUNMLFNBQVM7NEJBQ1QsV0FBVzs0QkFDWCxlQUFlOzRCQUNmLE9BQU87NEJBQ1AsTUFBTTt5QkFDUDtxQkFDRixDQUFDO2dCQUNKLEtBQUssU0FBUztvQkFDWixPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztvQkFDN0IsT0FBTyxHQUFHLE1BQU0sQ0FBQzt5QkFDZCxDQUFDLEVBQUU7eUJBQ0gsR0FBRyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQzt5QkFDeEQsR0FBRyxDQUFDLFNBQVMsQ0FBQzt5QkFDZCxNQUFNLENBQUMsTUFBTSxDQUFDO3lCQUNkLE1BQU0sRUFBYyxDQUFDO29CQUN4QixPQUFPLENBQUMsRUFBRSxXQUFXLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztnQkFDcEMsS0FBSyxZQUFZO29CQUNmLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUM3QixNQUFNLEdBQUcsTUFBTSxDQUFDO3lCQUNiLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxHQUFHLEVBQUU7eUJBQ0wsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsT0FBTyxDQUFDLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7Z0JBQ25DO29CQUNFLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7b0JBQ3ZCLE9BQU8sRUFBRSxDQUFDO1lBQ2QsQ0FBQztRQUNILENBQUM7YUFBTSxJQUFJLElBQUksS0FBSyxVQUFVLEVBQUUsQ0FBQztZQUMvQixRQUFRLEtBQUssQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQzlCLEtBQUssUUFBUTtvQkFDWCxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUM7eUJBQ25CLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7eUJBQ3pCLEdBQUcsQ0FBQyxXQUFXLENBQUM7eUJBQ2hCLEdBQUcsRUFBRTt5QkFDTCxLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO3lCQUNuQyxNQUFNLENBQUMsTUFBTSxDQUFDO3lCQUNkLEtBQUssRUFBRTt5QkFDUCxNQUFNLEVBQWMsQ0FBQztvQkFDeEIsT0FBTyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBUyxFQUFFLEVBQUU7d0JBQzlCLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUM7b0JBQ3JCLENBQUMsQ0FBQyxDQUFDO2dCQUVMLEtBQUssU0FBUztvQkFDWixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUM7eUJBQ3BCLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7eUJBQ3pCLEdBQUcsQ0FBQyxPQUFPLENBQUM7eUJBQ1osRUFBRSxDQUFDLEdBQUcsQ0FBQzt5QkFDUCxHQUFHLENBQUMsYUFBYSxDQUFDO3lCQUNsQixHQUFHLEVBQUU7eUJBQ0wsS0FBSyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7eUJBQ2pCLE1BQU0sQ0FBQyxNQUFNLENBQUM7eUJBQ2QsS0FBSyxFQUFFO3lCQUNQLE1BQU0sRUFBYyxDQUFDO29CQUN4QixPQUFPLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFTLEVBQUUsRUFBRTt3QkFDL0IsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQztvQkFDckIsQ0FBQyxDQUFDLENBQUM7Z0JBQ0wsS0FBSyxZQUFZO29CQUNmLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUM3QixNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUM7eUJBQ3BCLENBQUMsRUFBRTt5QkFDSCxHQUFHLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDO3lCQUN4RCxFQUFFLENBQUMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7eUJBQ3pCLEdBQUcsRUFBRTt5QkFDTCxFQUFFLENBQUMsR0FBRyxDQUFDO3lCQUNQLEdBQUcsRUFBRTt5QkFDTCxRQUFRLENBQUMsUUFBUSxDQUFDO3lCQUNsQixLQUFLLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQzt5QkFDakIsTUFBTSxDQUFDLE1BQU0sQ0FBQzt5QkFDZCxLQUFLLEVBQUU7eUJBQ1AsTUFBTSxFQUFjLENBQUM7b0JBQ3hCLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7b0JBQ3JCLE9BQU8sT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQVMsRUFBRSxFQUFFO3dCQUMvQixPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDO29CQUNyQixDQUFDLENBQUMsQ0FBQztnQkFDTDtvQkFDRSxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUN2QixPQUFPLEVBQUUsQ0FBQztZQUNkLENBQUM7UUFDSCxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3BDLE1BQU0sTUFBTSxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFNLEVBQUUsRUFBRTtnQkFDbkMsT0FBTyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDdEMsQ0FBQyxDQUFDLENBQUM7WUFDSCxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNyQyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBTSxFQUFFLEVBQUU7Z0JBQ2xDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ2YsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNqRSxDQUFDLENBQUMsQ0FBQztZQUNILE9BQU8sRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQztRQUN4QyxDQUFDO0lBQ0gsQ0FBQztJQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7UUFDcEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNuQixPQUFPLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUNyQyxNQUFNLEtBQUssQ0FBQztJQUNkLENBQUM7QUFDSCxDQUFDLENBQUM7QUFwZVcsUUFBQSxPQUFPLFdBb2VsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tIFwiYXdzLWxhbWJkYVwiO1xuXG4vLyBOb2RlIDIyKyBkZWZpbmVzIGEgZ2xvYmFsIFdlYlNvY2tldCB2aWEgdW5kaWNpLiBncmVtbGluLWF3cy1zaWd2NCBpbmplY3RzXG4vLyBTaWdWNCBoZWFkZXJzIHRocm91Z2ggdGhlIHdzLW5wbSBBUEk7IGlmIGdyZW1saW4gcGlja3MgdXAgdGhlIGJ1aWx0LWluXG4vLyBXZWJTb2NrZXQgaW5zdGVhZCwgYXV0aCBoZWFkZXJzIGFyZSBkcm9wcGVkIGFuZCBOZXB0dW5lIHJldHVybnMgbm9uLTEwMS5cbi8vIFJlbW92aW5nIHRoZSBnbG9iYWwgZm9yY2VzIGdyZW1saW4gdG8gdXNlIHRoZSBidW5kbGVkIHdzIG5wbSBwYWNrYWdlLlxuZGVsZXRlIChnbG9iYWxUaGlzIGFzIGFueSkuV2ViU29ja2V0O1xuXG5pbXBvcnQgKiBhcyBncmVtbGluIGZyb20gXCJncmVtbGluXCI7XG5pbXBvcnQgeyBnZXRVcmxBbmRIZWFkZXJzIH0gZnJvbSBcImdyZW1saW4tYXdzLXNpZ3Y0L2xpYi91dGlsc1wiO1xuaW1wb3J0IHsgU09DSUFMX1FVRVJZX0ZJRUxEUywgZGlzcGF0Y2hTb2NpYWxRdWVyeSB9IGZyb20gXCIuL3NvY2lhbFwiO1xuXG5jb25zdCBEcml2ZXJSZW1vdGVDb25uZWN0aW9uID0gZ3JlbWxpbi5kcml2ZXIuRHJpdmVyUmVtb3RlQ29ubmVjdGlvbjtcbmNvbnN0IFAgPSBncmVtbGluLnByb2Nlc3MuUDtcbmNvbnN0IHRyYXZlcnNhbCA9IGdyZW1saW4ucHJvY2Vzcy5Bbm9ueW1vdXNUcmF2ZXJzYWxTb3VyY2UudHJhdmVyc2FsO1xuY29uc3QgX18gPSBncmVtbGluLnByb2Nlc3Muc3RhdGljcztcbmNvbnN0IFRleHRQID0gZ3JlbWxpbi5wcm9jZXNzLlRleHRQO1xuXG50eXBlIFJlbW90ZUNvbm5lY3Rpb25XaXRoU29ja2V0ID0gZ3JlbWxpbi5kcml2ZXIuRHJpdmVyUmVtb3RlQ29ubmVjdGlvbiAmIHtcbiAgX2NsaWVudD86IHtcbiAgICBfY29ubmVjdGlvbj86IHtcbiAgICAgIG9uOiAoZXZlbnQ6IHN0cmluZywgbGlzdGVuZXI6IChjb2RlOiBudW1iZXIsIG1lc3NhZ2U6IHN0cmluZykgPT4gdm9pZCkgPT4gdm9pZDtcbiAgICB9O1xuICB9O1xufTtcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XG4gIGxldCBjb25uID0gbnVsbDtcbiAgY29uc3QgZ2V0Q29ubmVjdGlvbkRldGFpbHMgPSAoKSA9PiB7XG4gICAgcmV0dXJuIGdldFVybEFuZEhlYWRlcnMoXG4gICAgICBwcm9jZXNzLmVudi5ORVBUVU5FX0VORFBPSU5ULFxuICAgICAgcHJvY2Vzcy5lbnYuTkVQVFVORV9QT1JULFxuICAgICAge30sXG4gICAgICBcIi9ncmVtbGluXCIsXG4gICAgICBcIndzc1wiXG4gICAgKTtcbiAgfTtcblxuICBjb25zdCBjcmVhdGVSZW1vdGVDb25uZWN0aW9uID0gKCkgPT4ge1xuICAgIGNvbnN0IHsgdXJsLCBoZWFkZXJzIH0gPSBnZXRDb25uZWN0aW9uRGV0YWlscygpO1xuXG4gICAgY29uc29sZS5sb2codXJsKTtcbiAgICBjb25zb2xlLmxvZyhoZWFkZXJzKTtcbiAgICBjb25zdCBjID0gbmV3IERyaXZlclJlbW90ZUNvbm5lY3Rpb24odXJsLCB7XG4gICAgICBtaW1lVHlwZTogXCJhcHBsaWNhdGlvbi92bmQuZ3JlbWxpbi12Mi4wK2pzb25cIixcbiAgICAgIGhlYWRlcnM6IGhlYWRlcnMsXG4gICAgfSk7XG4gICAgY29uc3Qgc29ja2V0Q29ubmVjdGlvbiA9IGMgYXMgUmVtb3RlQ29ubmVjdGlvbldpdGhTb2NrZXQ7XG4gICAgc29ja2V0Q29ubmVjdGlvbi5fY2xpZW50Py5fY29ubmVjdGlvbj8ub24oXCJjbG9zZVwiLCAoY29kZTogbnVtYmVyLCBtZXNzYWdlOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnNvbGUuaW5mbyhgY2xvc2UgLSAke2NvZGV9ICR7bWVzc2FnZX1gKTtcbiAgICAgIGlmIChjb2RlID09IDEwMDYpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkNvbm5lY3Rpb24gY2xvc2VkIHByZW1hdHVyZWx5XCIpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJDb25uZWN0aW9uIGNsb3NlZCBwcmVtYXR1cmVseVwiKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gYztcbiAgfTtcblxuICBsZXQgZzogYW55ID0gbnVsbDtcblxuICBjb25zdCB0eXBlID0gZXZlbnQuYXJndW1lbnRzPy50eXBlO1xuICBjb25zb2xlLmxvZyh0eXBlKTtcbiAgdHJ5IHtcbiAgICAvLyBNZW1iZXItbmV0d29ya2luZyBmaWVsZHMgdXNlIHRoZSBzb2NpYWwgcmVzb2x2ZXIgbW9kdWxlLiBXZSBzdGlsbCBuZWVkXG4gICAgLy8gYSBHcmVtbGluIHRyYXZlcnNhbCBzb3VyY2UgZm9yIHRoZXNlIGJlY2F1c2UgdGhleSBxdWVyeSBOZXB0dW5lIGZvclxuICAgIC8vIGZlZWRzLCBtZW1iZXJzLCBldmVudHMsIGV0Yy5cbiAgICBpZiAoU09DSUFMX1FVRVJZX0ZJRUxEUy5oYXMoZXZlbnQuZmllbGQpKSB7XG4gICAgICBpZiAoY29ubiA9PSBudWxsKSB7XG4gICAgICAgIGNvbm4gPSBjcmVhdGVSZW1vdGVDb25uZWN0aW9uKCk7XG4gICAgICAgIGcgPSB0cmF2ZXJzYWwoKS53aXRoUmVtb3RlKGNvbm4pO1xuICAgICAgfVxuICAgICAgY29uc3QgaWRlbnRpdHkgPSAoZXZlbnQuaWRlbnRpdHkgPz8gbnVsbCkgYXNcbiAgICAgICAgfCB7IHN1Yj86IHN0cmluZzsgdXNlcm5hbWU/OiBzdHJpbmc7IGdyb3Vwcz86IHN0cmluZ1tdIH1cbiAgICAgICAgfCBudWxsO1xuICAgICAgcmV0dXJuIGF3YWl0IGRpc3BhdGNoU29jaWFsUXVlcnkoZXZlbnQuZmllbGQsIGV2ZW50LmFyZ3VtZW50cyA/PyB7fSwge1xuICAgICAgICBnLFxuICAgICAgICBpZGVudGl0eSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChjb25uID09IG51bGwpIHtcbiAgICAgIGNvbnNvbGUuaW5mbyhcIkluaXRpYWxpemluZyBjb25uZWN0aW9uXCIpO1xuICAgICAgY29ubiA9IGNyZWF0ZVJlbW90ZUNvbm5lY3Rpb24oKTtcbiAgICAgIGcgPSB0cmF2ZXJzYWwoKS53aXRoUmVtb3RlKGNvbm4pO1xuICAgIH1cblxuICAgIC8vIEVudGl0eSBzZWFyY2ggaGFuZGxlcnNcbiAgICBjb25zdCBzZWFyY2hDb25maWc6IFJlY29yZDxzdHJpbmcsIHsgbGFiZWw6IHN0cmluZzsgZmllbGRzOiBzdHJpbmdbXTsgZW50aXR5VHlwZT86IHN0cmluZyB9PiA9IHtcbiAgICAgIENvbXBhbnk6IHsgbGFiZWw6ICdFbnRpdHknLCBmaWVsZHM6IFsnY29tcGFueU5hbWUnXSwgZW50aXR5VHlwZTogJ0NvbXBhbnknIH0sXG4gICAgICBDdXN0b21lcjogeyBsYWJlbDogJ0VudGl0eScsIGZpZWxkczogWyduYW1lJ10sIGVudGl0eVR5cGU6ICdDdXN0b21lcicgfSxcbiAgICAgIEVzdGltYXRvcjogeyBsYWJlbDogJ0VudGl0eScsIGZpZWxkczogWyduYW1lJ10sIGVudGl0eVR5cGU6ICdFc3RpbWF0b3InIH0sXG4gICAgICBKb2JiZXI6IHsgbGFiZWw6ICdFbnRpdHknLCBmaWVsZHM6IFsnY29tcGFueU5hbWUnXSwgZW50aXR5VHlwZTogJ0pvYmJlcicgfSxcbiAgICAgIEFzc2V0OiB7IGxhYmVsOiAnQXNzZXQnLCBmaWVsZHM6IFsnbWFrZScsICdtb2RlbCcsICd2aW4nXSB9LFxuICAgICAgSm9iOiB7IGxhYmVsOiAnSm9iJywgZmllbGRzOiBbJ2pvYk5hbWUnXSB9LFxuICAgICAgUGFydDogeyBsYWJlbDogJ1BhcnQnLCBmaWVsZHM6IFsncGFydE5hbWUnXSB9LFxuICAgICAgUHJvamVjdF9EYXRhOiB7IGxhYmVsOiAnUHJvamVjdF9EYXRhJywgZmllbGRzOiBbJ3Byb2plY3ROYW1lJ10gfSxcbiAgICB9O1xuXG4gICAgaWYgKGV2ZW50LmZpZWxkID09PSBcInNlYXJjaEVudGl0aWVzXCIpIHtcbiAgICAgIGNvbnN0IHsgdmVydGV4VHlwZSwgc2VhcmNoVmFsdWUgfSA9IGV2ZW50LmFyZ3VtZW50cztcbiAgICAgIGNvbnN0IGNmZyA9IHNlYXJjaENvbmZpZ1t2ZXJ0ZXhUeXBlXTtcbiAgICAgIGlmICghY2ZnKSB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gdmVydGV4IHR5cGU6ICR7dmVydGV4VHlwZX1gKTtcblxuICAgICAgbGV0IHNlYXJjaFF1ZXJ5ID0gZyEuVigpLmhhc0xhYmVsKGNmZy5sYWJlbCk7XG4gICAgICBpZiAoY2ZnLmVudGl0eVR5cGUpIHtcbiAgICAgICAgc2VhcmNoUXVlcnkgPSBzZWFyY2hRdWVyeS5oYXMoJ2VudGl0eVR5cGVzJywgY2ZnLmVudGl0eVR5cGUpO1xuICAgICAgfVxuXG4gICAgICAvLyBPbmx5IGFwcGx5IHRleHQgZmlsdGVyIGlmIHNlYXJjaFZhbHVlIGlzIG5vbi1lbXB0eVxuICAgICAgY29uc3QgdHJpbW1lZCA9IChzZWFyY2hWYWx1ZSB8fCAnJykudHJpbSgpO1xuICAgICAgaWYgKHRyaW1tZWQgJiYgdHJpbW1lZCAhPT0gJyonKSB7XG4gICAgICAgIGlmIChjZmcuZmllbGRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkuaGFzKGNmZy5maWVsZHNbMF0sIFRleHRQLmNvbnRhaW5pbmcodHJpbW1lZCkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkub3IoXG4gICAgICAgICAgICAuLi5jZmcuZmllbGRzLm1hcCgoZjogc3RyaW5nKSA9PiBfXy5oYXMoZiwgVGV4dFAuY29udGFpbmluZyh0cmltbWVkKSkpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgc2VhcmNoUXVlcnlcbiAgICAgICAgLnByb2plY3QoJ2lkJywgJ25hbWUnLCAnbGFiZWwnLCAnZW50aXR5VHlwZScpXG4gICAgICAgIC5ieShfXy5pZCgpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoXG4gICAgICAgICAgX18udmFsdWVzKCdjb21wYW55TmFtZScpLFxuICAgICAgICAgIF9fLnZhbHVlcygnbmFtZScpLFxuICAgICAgICAgIF9fLnZhbHVlcygnam9iTmFtZScpLFxuICAgICAgICAgIF9fLnZhbHVlcygncGFydE5hbWUnKSxcbiAgICAgICAgICBfXy52YWx1ZXMoJ21ha2UnKSxcbiAgICAgICAgICBfXy5jb25zdGFudCgnVW5rbm93bicpXG4gICAgICAgICkpXG4gICAgICAgIC5ieShfXy5sYWJlbCgpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdlbnRpdHlUeXBlcycpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAubGltaXQoNTApXG4gICAgICAgIC50b0xpc3QoKTtcblxuICAgICAgcmV0dXJuIHJlc3VsdHMubWFwKChyOiBhbnkpID0+ICh7XG4gICAgICAgIGlkOiByLmlkID8/IChyLmdldCA/IHIuZ2V0KCdpZCcpIDogdW5kZWZpbmVkKSxcbiAgICAgICAgbmFtZTogci5uYW1lID8/IChyLmdldCA/IHIuZ2V0KCduYW1lJykgOiB1bmRlZmluZWQpLFxuICAgICAgICBsYWJlbDogci5sYWJlbCA/PyAoci5nZXQgPyByLmdldCgnbGFiZWwnKSA6IHVuZGVmaW5lZCksXG4gICAgICAgIGVudGl0eVR5cGU6IHIuZW50aXR5VHlwZSB8fCAoci5nZXQgPyByLmdldCgnZW50aXR5VHlwZScpIDogbnVsbCkgfHwgbnVsbCxcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQuZmllbGQgPT09IFwic2VhcmNoUHJvamVjdHNcIikge1xuICAgICAgY29uc3QgeyBzZWFyY2hWYWx1ZSB9ID0gZXZlbnQuYXJndW1lbnRzO1xuICAgICAgY29uc3QgdHJpbW1lZCA9IChzZWFyY2hWYWx1ZSB8fCAnJykudHJpbSgpO1xuXG4gICAgICBsZXQgc2VhcmNoUXVlcnkgPSBnIS5WKCkuaGFzTGFiZWwoJ1Byb2plY3RfRGF0YScpO1xuICAgICAgaWYgKHRyaW1tZWQpIHtcbiAgICAgICAgc2VhcmNoUXVlcnkgPSBzZWFyY2hRdWVyeS5oYXMoJ3Byb2plY3ROYW1lJywgVGV4dFAuY29udGFpbmluZyh0cmltbWVkKSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBzZWFyY2hRdWVyeVxuICAgICAgICAucHJvamVjdCgnaWQnLCAncHJvamVjdE5hbWUnLCAnRGVwYXJ0bWVudE51bWJlcicsICdEYXRhQ2xhc3NpZmljYXRpb24nLCAnVGVhbScsICdPd25lckdyb3VwJywgJ1JlY292ZXJ5JywgJ1RpZXInKVxuICAgICAgICAuYnkoX18uaWQoKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygncHJvamVjdE5hbWUnKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnRGVwYXJ0bWVudE51bWJlcicpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdEYXRhQ2xhc3NpZmljYXRpb24nKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnVGVhbScpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdPd25lckdyb3VwJyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoJ1JlY292ZXJ5JyksIF9fLmNvbnN0YW50KCcnKSkpXG4gICAgICAgIC5ieShfXy5jb2FsZXNjZShfXy52YWx1ZXMoJ1RpZXInKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmxpbWl0KDIwMClcbiAgICAgICAgLnRvTGlzdCgpO1xuXG4gICAgICByZXR1cm4gcmVzdWx0cy5tYXAoKHI6IGFueSkgPT4gKHtcbiAgICAgICAgaWQ6IHIuaWQgPz8gKHIuZ2V0ID8gci5nZXQoJ2lkJykgOiB1bmRlZmluZWQpLFxuICAgICAgICBwcm9qZWN0TmFtZTogci5wcm9qZWN0TmFtZSA/PyAoci5nZXQgPyByLmdldCgncHJvamVjdE5hbWUnKSA6ICcnKSxcbiAgICAgICAgRGVwYXJ0bWVudE51bWJlcjogci5EZXBhcnRtZW50TnVtYmVyID8/IChyLmdldCA/IHIuZ2V0KCdEZXBhcnRtZW50TnVtYmVyJykgOiAnJyksXG4gICAgICAgIERhdGFDbGFzc2lmaWNhdGlvbjogci5EYXRhQ2xhc3NpZmljYXRpb24gPz8gKHIuZ2V0ID8gci5nZXQoJ0RhdGFDbGFzc2lmaWNhdGlvbicpIDogJycpLFxuICAgICAgICBUZWFtOiByLlRlYW0gPz8gKHIuZ2V0ID8gci5nZXQoJ1RlYW0nKSA6ICcnKSxcbiAgICAgICAgT3duZXJHcm91cDogci5Pd25lckdyb3VwID8/IChyLmdldCA/IHIuZ2V0KCdPd25lckdyb3VwJykgOiAnJyksXG4gICAgICAgIFJlY292ZXJ5OiByLlJlY292ZXJ5ID8/IChyLmdldCA/IHIuZ2V0KCdSZWNvdmVyeScpIDogJycpLFxuICAgICAgICBUaWVyOiByLlRpZXIgPz8gKHIuZ2V0ID8gci5nZXQoJ1RpZXInKSA6ICcnKSxcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQuZmllbGQgPT09IFwiZ2V0UHJvamVjdEFjY291bnRzXCIpIHtcbiAgICAgIGNvbnN0IHsgcHJvamVjdE5hbWUgfSA9IGV2ZW50LmFyZ3VtZW50cztcblxuICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGchLlYoKVxuICAgICAgICAuaGFzTGFiZWwoJ1Byb2plY3RfRGF0YScpXG4gICAgICAgIC5oYXMoJ3Byb2plY3ROYW1lJywgcHJvamVjdE5hbWUpXG4gICAgICAgIC5pbl8oJ293bmVkX2J5JylcbiAgICAgICAgLmhhc0xhYmVsKCdBY2NvdW50JylcbiAgICAgICAgLnByb2plY3QoJ2lkJywgJ0FjY291bnRfTmFtZScsICdBY2NvdW50X0lkJywgJ0Nsb3VkJywgJ0Vudmlyb25tZW50cycpXG4gICAgICAgIC5ieShfXy5pZCgpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdBY2NvdW50X05hbWUnKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLmJ5KF9fLmNvYWxlc2NlKF9fLnZhbHVlcygnQWNjb3VudF9JZCcpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdDbG91ZCcpLCBfXy5jb25zdGFudCgnJykpKVxuICAgICAgICAuYnkoX18uY29hbGVzY2UoX18udmFsdWVzKCdFbnZpcm9ubWVudHMnKSwgX18uY29uc3RhbnQoJycpKSlcbiAgICAgICAgLnRvTGlzdCgpO1xuXG4gICAgICByZXR1cm4gcmVzdWx0cy5tYXAoKHI6IGFueSkgPT4gKHtcbiAgICAgICAgaWQ6IHIuaWQgPz8gKHIuZ2V0ID8gci5nZXQoJ2lkJykgOiB1bmRlZmluZWQpLFxuICAgICAgICBBY2NvdW50X05hbWU6IHIuQWNjb3VudF9OYW1lID8/IChyLmdldCA/IHIuZ2V0KCdBY2NvdW50X05hbWUnKSA6ICcnKSxcbiAgICAgICAgQWNjb3VudF9JZDogci5BY2NvdW50X0lkID8/IChyLmdldCA/IHIuZ2V0KCdBY2NvdW50X0lkJykgOiAnJyksXG4gICAgICAgIENsb3VkOiByLkNsb3VkID8/IChyLmdldCA/IHIuZ2V0KCdDbG91ZCcpIDogJycpLFxuICAgICAgICBFbnZpcm9ubWVudHM6IHIuRW52aXJvbm1lbnRzID8/IChyLmdldCA/IHIuZ2V0KCdFbnZpcm9ubWVudHMnKSA6ICcnKSxcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQuZmllbGQgPT09IFwiZ2V0RW50aXR5UHJvcGVydGllc1wiIHx8IGV2ZW50LmZpZWxkID09PSBcImdldEVudGl0eUVkZ2VzXCIpIHtcbiAgICAgIGNvbnN0IHsgdmVydGV4VHlwZSwgc2VhcmNoVmFsdWUsIHZlcnRleElkOiBkaXJlY3RWZXJ0ZXhJZCB9ID0gZXZlbnQuYXJndW1lbnRzO1xuICAgICAgY29uc3QgY2ZnID0gc2VhcmNoQ29uZmlnW3ZlcnRleFR5cGVdO1xuICAgICAgaWYgKCFjZmcpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biB2ZXJ0ZXggdHlwZTogJHt2ZXJ0ZXhUeXBlfWApO1xuXG4gICAgICBsZXQgdmVydGV4SWQgPSBkaXJlY3RWZXJ0ZXhJZDtcbiAgICAgIGlmICghdmVydGV4SWQpIHtcbiAgICAgICAgbGV0IHNlYXJjaFF1ZXJ5ID0gZyEuVigpLmhhc0xhYmVsKGNmZy5sYWJlbCk7XG4gICAgICAgIGlmIChjZmcuZW50aXR5VHlwZSkge1xuICAgICAgICAgIHNlYXJjaFF1ZXJ5ID0gc2VhcmNoUXVlcnkuaGFzKCdlbnRpdHlUeXBlcycsIGNmZy5lbnRpdHlUeXBlKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB0cmltbWVkU3YgPSAoc2VhcmNoVmFsdWUgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgaWYgKHRyaW1tZWRTdiAmJiB0cmltbWVkU3YgIT09ICcqJykge1xuICAgICAgICAgIGlmIChjZmcuZmllbGRzLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgICAgc2VhcmNoUXVlcnkgPSBzZWFyY2hRdWVyeS5oYXMoY2ZnLmZpZWxkc1swXSwgVGV4dFAuY29udGFpbmluZyh0cmltbWVkU3YpKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc2VhcmNoUXVlcnkgPSBzZWFyY2hRdWVyeS5vcihcbiAgICAgICAgICAgICAgLi4uY2ZnLmZpZWxkcy5tYXAoKGY6IHN0cmluZykgPT4gX18uaGFzKGYsIFRleHRQLmNvbnRhaW5pbmcodHJpbW1lZFN2KSkpXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2ZXJ0ZXhJZHMgPSBhd2FpdCBzZWFyY2hRdWVyeS5pZCgpLmxpbWl0KDEpLnRvTGlzdCgpO1xuICAgICAgICBpZiAodmVydGV4SWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgICB2ZXJ0ZXhJZCA9IHZlcnRleElkc1swXTtcbiAgICAgIH1cblxuICAgICAgaWYgKGV2ZW50LmZpZWxkID09PSBcImdldEVudGl0eVByb3BlcnRpZXNcIikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBnIS5WKHZlcnRleElkKS52YWx1ZU1hcCgpLnRvTGlzdCgpO1xuICAgICAgICBpZiAocmVzdWx0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuICAgICAgICBjb25zdCB2ZXJ0ZXhNYXAgPSByZXN1bHRbMF07XG4gICAgICAgIGNvbnN0IHByb3BlcnRpZXM6IEFycmF5PHsga2V5OiBzdHJpbmc7IHZhbHVlOiBzdHJpbmcgfT4gPSBbXTtcbiAgICAgICAgY29uc3QgZW50cmllcyA9IHZlcnRleE1hcCBpbnN0YW5jZW9mIE1hcCA/IEFycmF5LmZyb20odmVydGV4TWFwLmVudHJpZXMoKSkgOiBPYmplY3QuZW50cmllcyh2ZXJ0ZXhNYXApO1xuICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbF0gb2YgZW50cmllcykge1xuICAgICAgICAgIGNvbnN0IHByb3BWYWx1ZSA9IEFycmF5LmlzQXJyYXkodmFsKSA/IFN0cmluZyh2YWxbMF0pIDogU3RyaW5nKHZhbCk7XG4gICAgICAgICAgaWYgKHByb3BWYWx1ZSAhPT0gdW5kZWZpbmVkICYmIHByb3BWYWx1ZSAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvcFZhbHVlICE9PSAnJykge1xuICAgICAgICAgICAgcHJvcGVydGllcy5wdXNoKHsga2V5OiBTdHJpbmcoa2V5KSwgdmFsdWU6IHByb3BWYWx1ZSB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb3BlcnRpZXM7XG4gICAgICB9XG5cbiAgICAgIGlmIChldmVudC5maWVsZCA9PT0gXCJnZXRFbnRpdHlFZGdlc1wiKSB7XG4gICAgICAgIGNvbnN0IG91dEVkZ2VzID0gYXdhaXQgZyEuVih2ZXJ0ZXhJZClcbiAgICAgICAgICAub3V0RSgpXG4gICAgICAgICAgLnByb2plY3QoJ2VkZ2VMYWJlbCcsICd0YXJnZXRMYWJlbCcsICd0YXJnZXROYW1lJylcbiAgICAgICAgICAuYnkoX18ubGFiZWwoKSlcbiAgICAgICAgICAuYnkoX18uaW5WKCkubGFiZWwoKSlcbiAgICAgICAgICAuYnkoX18uaW5WKCkuY29hbGVzY2UoXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ2NvbXBhbnlOYW1lJyksXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ25hbWUnKSxcbiAgICAgICAgICAgIF9fLnZhbHVlcygnam9iTmFtZScpLFxuICAgICAgICAgICAgX18udmFsdWVzKCdwYXJ0TmFtZScpLFxuICAgICAgICAgICAgX18udmFsdWVzKCdtYWtlJyksXG4gICAgICAgICAgICBfXy5jb25zdGFudCgnVW5rbm93bicpXG4gICAgICAgICAgKSlcbiAgICAgICAgICAudG9MaXN0KCk7XG5cbiAgICAgICAgY29uc3QgaW5FZGdlcyA9IGF3YWl0IGchLlYodmVydGV4SWQpXG4gICAgICAgICAgLmluRSgpXG4gICAgICAgICAgLnByb2plY3QoJ2VkZ2VMYWJlbCcsICd0YXJnZXRMYWJlbCcsICd0YXJnZXROYW1lJylcbiAgICAgICAgICAuYnkoX18ubGFiZWwoKSlcbiAgICAgICAgICAuYnkoX18ub3V0VigpLmxhYmVsKCkpXG4gICAgICAgICAgLmJ5KF9fLm91dFYoKS5jb2FsZXNjZShcbiAgICAgICAgICAgIF9fLnZhbHVlcygnY29tcGFueU5hbWUnKSxcbiAgICAgICAgICAgIF9fLnZhbHVlcygnbmFtZScpLFxuICAgICAgICAgICAgX18udmFsdWVzKCdqb2JOYW1lJyksXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ3BhcnROYW1lJyksXG4gICAgICAgICAgICBfXy52YWx1ZXMoJ21ha2UnKSxcbiAgICAgICAgICAgIF9fLmNvbnN0YW50KCdVbmtub3duJylcbiAgICAgICAgICApKVxuICAgICAgICAgIC50b0xpc3QoKTtcblxuICAgICAgICBjb25zdCBlZGdlczogQXJyYXk8eyBlZGdlTGFiZWw6IHN0cmluZzsgZGlyZWN0aW9uOiBzdHJpbmc7IHRhcmdldExhYmVsOiBzdHJpbmc7IHRhcmdldE5hbWU6IHN0cmluZyB9PiA9IFtdO1xuICAgICAgICBmb3IgKGNvbnN0IGUgb2Ygb3V0RWRnZXMgYXMgQXJyYXk8UmVjb3JkPHN0cmluZywgdW5rbm93bj4gJiB7IGdldD86IChrZXk6IHN0cmluZykgPT4gdW5rbm93biB9Pikge1xuICAgICAgICAgIGVkZ2VzLnB1c2goe1xuICAgICAgICAgICAgZWRnZUxhYmVsOiBTdHJpbmcoZS5lZGdlTGFiZWwgPz8gKGUuZ2V0ID8gZS5nZXQoJ2VkZ2VMYWJlbCcpIDogJycpKSxcbiAgICAgICAgICAgIGRpcmVjdGlvbjogJ291dGdvaW5nJyxcbiAgICAgICAgICAgIHRhcmdldExhYmVsOiBTdHJpbmcoZS50YXJnZXRMYWJlbCA/PyAoZS5nZXQgPyBlLmdldCgndGFyZ2V0TGFiZWwnKSA6ICcnKSksXG4gICAgICAgICAgICB0YXJnZXROYW1lOiBTdHJpbmcoZS50YXJnZXROYW1lID8/IChlLmdldCA/IGUuZ2V0KCd0YXJnZXROYW1lJykgOiAnJykpLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZSBvZiBpbkVkZ2VzIGFzIEFycmF5PFJlY29yZDxzdHJpbmcsIHVua25vd24+ICYgeyBnZXQ/OiAoa2V5OiBzdHJpbmcpID0+IHVua25vd24gfT4pIHtcbiAgICAgICAgICBlZGdlcy5wdXNoKHtcbiAgICAgICAgICAgIGVkZ2VMYWJlbDogU3RyaW5nKGUuZWRnZUxhYmVsID8/IChlLmdldCA/IGUuZ2V0KCdlZGdlTGFiZWwnKSA6ICcnKSksXG4gICAgICAgICAgICBkaXJlY3Rpb246ICdpbmNvbWluZycsXG4gICAgICAgICAgICB0YXJnZXRMYWJlbDogU3RyaW5nKGUudGFyZ2V0TGFiZWwgPz8gKGUuZ2V0ID8gZS5nZXQoJ3RhcmdldExhYmVsJykgOiAnJykpLFxuICAgICAgICAgICAgdGFyZ2V0TmFtZTogU3RyaW5nKGUudGFyZ2V0TmFtZSA/PyAoZS5nZXQgPyBlLmdldCgndGFyZ2V0TmFtZScpIDogJycpKSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZWRnZXM7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHR5cGUgPT09IFwicHJvZmlsZVwiKSB7XG4gICAgICBjb25zb2xlLmxvZyhnKTtcbiAgICAgIGxldCB1c2FnZTogc3RyaW5nW10gPSBbXTtcbiAgICAgIGxldCBiZWxvbmdfdG86IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgYXV0aG9yZWRfYnk6IHN0cmluZ1tdID0gW107XG4gICAgICBsZXQgYWZmaWxpYXRlZF93aXRoOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgbGV0IHBlb3BsZTogc3RyaW5nW10gPSBbXTtcbiAgICAgIGxldCBtYWRlX2J5OiBzdHJpbmdbXSA9IFtdO1xuICAgICAgY29uc3Qgc2VhcmNoX25hbWUgPSBhd2FpdCBnIVxuICAgICAgICAuVihldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgc3dpdGNoIChldmVudC5hcmd1bWVudHMudmFsdWUpIHtcbiAgICAgICAgY2FzZSBcInBlcnNvblwiOlxuICAgICAgICAgIHVzYWdlID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJ1c2FnZVwiKVxuICAgICAgICAgICAgLm90aGVyVigpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGJlbG9uZ190byA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYm90aEUoKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwiYmVsb25nX3RvXCIpXG4gICAgICAgICAgICAub3RoZXJWKClcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgYXV0aG9yZWRfYnkgPSBhd2FpdCBnXG4gICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAuaGFzKGV2ZW50LmFyZ3VtZW50cy52YWx1ZSwgXCJuYW1lXCIsIGV2ZW50LmFyZ3VtZW50cy5uYW1lKVxuICAgICAgICAgICAgLmJvdGhFKClcbiAgICAgICAgICAgIC5oYXNMYWJlbChcImF1dGhvcmVkX2J5XCIpXG4gICAgICAgICAgICAub3RoZXJWKClcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgYWZmaWxpYXRlZF93aXRoID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJhZmZpbGlhdGVkX3dpdGhcIilcbiAgICAgICAgICAgIC5vdGhlclYoKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgeyBzZWFyY2hfbmFtZSwgdXNhZ2UsIGJlbG9uZ190bywgYXV0aG9yZWRfYnksIGFmZmlsaWF0ZWRfd2l0aCB9LFxuICAgICAgICAgIF07XG4gICAgICAgIGNhc2UgXCJpZFwiOlxuICAgICAgICAgIHVzYWdlID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhc0lkKGV2ZW50LmFyZ3VtZW50cy5uYW1lKVxuICAgICAgICAgICAgLmJvdGhFKClcbiAgICAgICAgICAgIC5oYXNMYWJlbChcInVzYWdlXCIpXG4gICAgICAgICAgICAub3RoZXJWKClcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgaWYgKGV2ZW50LmFyZ3VtZW50cy5uYW1lLm1hdGNoKC9Eb2MvKSkge1xuICAgICAgICAgICAgYmVsb25nX3RvID0gYXdhaXQgZ1xuICAgICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAgIC5oYXNJZChldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgICAgLmJvdGhFKClcbiAgICAgICAgICAgICAgLmhhc0xhYmVsKFwiYmVsb25nX3RvXCIpXG4gICAgICAgICAgICAgIC5vdGhlclYoKVxuICAgICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGJlbG9uZ190byA9IFtdO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhdXRob3JlZF9ieSA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXNJZChldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJhdXRob3JlZF9ieVwiKVxuICAgICAgICAgICAgLm90aGVyVigpXG4gICAgICAgICAgICAudmFsdWVzKFwibmFtZVwiKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIGFmZmlsaWF0ZWRfd2l0aCA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXNJZChldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5ib3RoRSgpXG4gICAgICAgICAgICAuaGFzTGFiZWwoXCJhZmZpbGlhdGVkX3dpdGhcIilcbiAgICAgICAgICAgIC5vdGhlclYoKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICBpZiAoZXZlbnQuYXJndW1lbnRzLm5hbWUubWF0Y2goL1Byb2QvKSkge1xuICAgICAgICAgICAgbWFkZV9ieSA9IGF3YWl0IGdcbiAgICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgICAuaGFzSWQoZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAgIC5vdXQoXCJtYWRlX2J5XCIpXG4gICAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgbWFkZV9ieSA9IFtdO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZXZlbnQuYXJndW1lbnRzLm5hbWUubWF0Y2goL0NvbmYvKSkge1xuICAgICAgICAgICAgcGVvcGxlID0gYXdhaXQgZ1xuICAgICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAgIC5oYXNJZChldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgICAgLmluXygpXG4gICAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcGVvcGxlID0gW107XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChldmVudC5hcmd1bWVudHMubmFtZS5tYXRjaCgvSW5zdC8pKSB7XG4gICAgICAgICAgICBhZmZpbGlhdGVkX3dpdGggPSBbXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc2VhcmNoX25hbWUsXG4gICAgICAgICAgICAgIHVzYWdlLFxuICAgICAgICAgICAgICBiZWxvbmdfdG8sXG4gICAgICAgICAgICAgIGF1dGhvcmVkX2J5LFxuICAgICAgICAgICAgICBhZmZpbGlhdGVkX3dpdGgsXG4gICAgICAgICAgICAgIG1hZGVfYnksXG4gICAgICAgICAgICAgIHBlb3BsZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXTtcbiAgICAgICAgY2FzZSBcInByb2R1Y3RcIjpcbiAgICAgICAgICBjb25zb2xlLmxvZyhldmVudC5hcmd1bWVudHMpO1xuICAgICAgICAgIG1hZGVfYnkgPSBhd2FpdCBnXG4gICAgICAgICAgICAuVigpXG4gICAgICAgICAgICAuaGFzKGV2ZW50LmFyZ3VtZW50cy52YWx1ZSwgXCJuYW1lXCIsIGV2ZW50LmFyZ3VtZW50cy5uYW1lKVxuICAgICAgICAgICAgLm91dChcIm1hZGVfYnlcIilcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgcmV0dXJuIFt7IHNlYXJjaF9uYW1lLCBtYWRlX2J5IH1dO1xuICAgICAgICBjYXNlIFwiY29uZmVyZW5jZVwiOlxuICAgICAgICAgIGNvbnNvbGUubG9nKGV2ZW50LmFyZ3VtZW50cyk7XG4gICAgICAgICAgcGVvcGxlID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5pbl8oKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC50b0xpc3QoKSBhcyBzdHJpbmdbXTtcbiAgICAgICAgICByZXR1cm4gW3sgc2VhcmNoX25hbWUsIHBlb3BsZSB9XTtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImRlZmF1bHRcIik7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodHlwZSA9PT0gXCJyZWxhdGlvblwiKSB7XG4gICAgICBzd2l0Y2ggKGV2ZW50LmFyZ3VtZW50cy52YWx1ZSkge1xuICAgICAgICBjYXNlIFwicGVyc29uXCI6XG4gICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5hcyhldmVudC5hcmd1bWVudHMudmFsdWUpXG4gICAgICAgICAgICAub3V0KFwiYmVsb25nX3RvXCIpXG4gICAgICAgICAgICAuaW5fKClcbiAgICAgICAgICAgIC53aGVyZShQLm5lcShldmVudC5hcmd1bWVudHMudmFsdWUpKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC5kZWR1cCgpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC5tYXAoKHI6IHN0cmluZykgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHsgbmFtZTogciB9O1xuICAgICAgICAgIH0pO1xuXG4gICAgICAgIGNhc2UgXCJwcm9kdWN0XCI6XG4gICAgICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IGdcbiAgICAgICAgICAgIC5WKClcbiAgICAgICAgICAgIC5oYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlLCBcIm5hbWVcIiwgZXZlbnQuYXJndW1lbnRzLm5hbWUpXG4gICAgICAgICAgICAuYXMoZXZlbnQuYXJndW1lbnRzLnZhbHVlKVxuICAgICAgICAgICAgLmluXyhcInVzYWdlXCIpXG4gICAgICAgICAgICAuYXMoXCJwXCIpXG4gICAgICAgICAgICAuaW5fKFwiYXV0aG9yZWRfYnlcIilcbiAgICAgICAgICAgIC5vdXQoKVxuICAgICAgICAgICAgLndoZXJlKFAubmVxKFwicFwiKSlcbiAgICAgICAgICAgIC52YWx1ZXMoXCJuYW1lXCIpXG4gICAgICAgICAgICAuZGVkdXAoKVxuICAgICAgICAgICAgLnRvTGlzdCgpIGFzIHN0cmluZ1tdO1xuICAgICAgICAgIHJldHVybiByZXN1bHQyLm1hcCgocjogc3RyaW5nKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4geyBuYW1lOiByIH07XG4gICAgICAgICAgfSk7XG4gICAgICAgIGNhc2UgXCJjb25mZXJlbmNlXCI6XG4gICAgICAgICAgY29uc29sZS5sb2coZXZlbnQuYXJndW1lbnRzKTtcbiAgICAgICAgICBjb25zdCByZXN1bHQzID0gYXdhaXQgZ1xuICAgICAgICAgICAgLlYoKVxuICAgICAgICAgICAgLmhhcyhldmVudC5hcmd1bWVudHMudmFsdWUsIFwibmFtZVwiLCBldmVudC5hcmd1bWVudHMubmFtZSlcbiAgICAgICAgICAgIC5hcyhldmVudC5hcmd1bWVudHMudmFsdWUpXG4gICAgICAgICAgICAuaW5fKClcbiAgICAgICAgICAgIC5hcyhcInBcIilcbiAgICAgICAgICAgIC5vdXQoKVxuICAgICAgICAgICAgLmhhc0xhYmVsKFwicGVyc29uXCIpXG4gICAgICAgICAgICAud2hlcmUoUC5uZXEoXCJwXCIpKVxuICAgICAgICAgICAgLnZhbHVlcyhcIm5hbWVcIilcbiAgICAgICAgICAgIC5kZWR1cCgpXG4gICAgICAgICAgICAudG9MaXN0KCkgYXMgc3RyaW5nW107XG4gICAgICAgICAgY29uc29sZS5sb2cocmVzdWx0Myk7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdDMubWFwKChyOiBzdHJpbmcpID0+IHtcbiAgICAgICAgICAgIHJldHVybiB7IG5hbWU6IHIgfTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICBjb25zb2xlLmxvZyhcImRlZmF1bHRcIik7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBnLlYoKS50b0xpc3QoKTtcbiAgICAgIGNvbnN0IHZlcnRleCA9IHJlc3VsdC5tYXAoKHI6IGFueSkgPT4ge1xuICAgICAgICByZXR1cm4geyBpZDogci5pZCwgbGFiZWw6IHIubGFiZWwgfTtcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcmVzdWx0MiA9IGF3YWl0IGcuRSgpLnRvTGlzdCgpO1xuICAgICAgY29uc3QgZWRnZSA9IHJlc3VsdDIubWFwKChyOiBhbnkpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2cocik7XG4gICAgICAgIHJldHVybiB7IHNvdXJjZTogci5vdXRWLmlkLCB0YXJnZXQ6IHIuaW5WLmlkLCB2YWx1ZTogci5sYWJlbCB9O1xuICAgICAgfSk7XG4gICAgICByZXR1cm4geyBub2RlczogdmVydGV4LCBsaW5rczogZWRnZSB9O1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgIGNvbnNvbGUubG9nKGVycm9yKTtcbiAgICBjb25zb2xlLmVycm9yKEpTT04uc3RyaW5naWZ5KGVycm9yKSk7XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cbn07XG4iXX0=