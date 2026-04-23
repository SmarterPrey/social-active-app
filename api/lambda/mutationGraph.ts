import { Handler } from "aws-lambda";

// See queryGraph.ts — force gremlin to use ws npm package, not Node 22 built-in WebSocket.
delete (globalThis as any).WebSocket;

import * as gremlin from "gremlin";
import { getUrlAndHeaders } from "gremlin-aws-sigv4/lib/utils";
import { SOCIAL_MUTATION_FIELDS, dispatchSocialMutation } from "./social";

const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const __ = gremlin.process.statics;

type RemoteConnectionWithSocket = gremlin.driver.DriverRemoteConnection & {
  _client?: {
    _connection?: {
      on: (event: string, listener: (code: number, message: string) => void) => void;
    };
  };
};

export const handler: Handler = async (event) => {
  let conn = null;
  const getConnectionDetails = () => {
    return getUrlAndHeaders(
      process.env.NEPTUNE_ENDPOINT,
      process.env.NEPTUNE_PORT,
      {},
      "/gremlin",
      "wss"
    );
  };

  const createRemoteConnection = () => {
    const { url, headers } = getConnectionDetails();

    console.log(url);
    console.log(headers);
    const c = new DriverRemoteConnection(url, {
      mimeType: "application/vnd.gremlin-v2.0+json",
      headers: headers,
    });
    const socketConnection = c as RemoteConnectionWithSocket;
    socketConnection._client?._connection?.on("close", (code: number, message: string) => {
      console.info(`close - ${code} ${message}`);
      if (code == 1006) {
        console.error("Connection closed prematurely");
        throw new Error("Connection closed prematurely");
      }
    });
    return c;
  };

  let g: any = null;
  const id = gremlin.process.t.id;

  try {
    // Member-networking mutations use the social resolver module.
    if (SOCIAL_MUTATION_FIELDS.has(event.field)) {
      if (conn == null) {
        conn = createRemoteConnection();
        g = traversal().withRemote(conn);
      }
      const identity = (event.identity ?? null) as
        | { sub?: string; username?: string; groups?: string[] }
        | null;
      return await dispatchSocialMutation(event.field, event.arguments ?? {}, {
        g,
        identity,
      });
    }

    if (conn == null) {
      console.info("Initializing connection");
      conn = createRemoteConnection();
      g = traversal().withRemote(conn);
    }

    // ── Account mutations ──
    if (event.field === "addProjectAccount") {
      const { projectName, Account_Name, Account_Id, Cloud, Environments } = event.arguments.input;
      const accountVertexId = `account_${Date.now()}`;

      // Create the Account vertex
      await g!.addV('Account')
        .property(id, accountVertexId)
        .property('Account_Name', Account_Name)
        .property('Account_Id', Account_Id)
        .property('Cloud', Cloud)
        .property('Environments', Environments)
        .next();

      // Create owned_by edge from Account → Project_Data
      await g!.V(accountVertexId)
        .addE('owned_by')
        .to(__.V().hasLabel('Project_Data').has('projectName', projectName))
        .next();

      console.log("Created account:", accountVertexId, "linked to project:", projectName);
      return {
        id: accountVertexId,
        Account_Name,
        Account_Id,
        Cloud,
        Environments,
      };
    }

    if (event.field === "deleteProjectAccount") {
      const { accountId } = event.arguments;
      // Drop the vertex and all its edges
      await g!.V(accountId).drop().next();
      console.log("Deleted account vertex:", accountId);
      return { result: "deleted" };
    }

    // ── Generic insertData mutations ──
  const {
    value,
    edge,
    vertex,
    source,
    sourceLabel,
    destination,
    destLabel,
    properties: propertiesJson,
  } = event.arguments.input;

  // Parse properties JSON (new generic approach)
  const props: Record<string, unknown> =
    propertiesJson ? JSON.parse(propertiesJson) : {};

    switch (value) {
      case "vertex": {
        // Generate a unique vertex ID using label prefix + timestamp
        const vertexId = `${vertex.toLowerCase()}_${Date.now()}`;

        // Start the addV traversal
        let t = g!.addV(vertex).property(id, vertexId);

        // Add all properties from the properties JSON
        for (const [key, val] of Object.entries(props)) {
          if (val !== undefined && val !== null && val !== "") {
            t = t.property(key, val);
          }
        }

        const result = await t.next();
        console.log("Created vertex:", vertexId, vertex, props);
        return { result: JSON.stringify(result) };
      }

      default: {
        // Edge creation
        console.log("Creating edge:", edge, "from", sourceLabel, source, "to", destLabel, destination);

        // Find source vertex by label and any name-like property
        let t = g!
          .V()
          .hasLabel(sourceLabel)
          .or(
            __.has("name", source),
            __.has("companyName", source),
            __.has("jobName", source),
            __.has("partName", source)
          );

        // Add edge to destination vertex found by label and name-like property
        let edgeTraversal = t.addE(edge).to(
          __.V()
            .hasLabel(destLabel)
            .or(
              __.has("name", destination),
              __.has("companyName", destination),
              __.has("jobName", destination),
              __.has("partName", destination)
            )
        );

        // Add edge properties from the properties JSON
        for (const [key, val] of Object.entries(props)) {
          if (val !== undefined && val !== null && val !== "") {
            edgeTraversal = edgeTraversal.property(key, val);
          }
        }

        const res = await edgeTraversal.next();
        console.log("Created edge:", edge, props);
        return { result: JSON.stringify(res) };
      }
    }
  } catch (error: unknown) {
    console.log(error);
    console.error(JSON.stringify(error));
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
};
