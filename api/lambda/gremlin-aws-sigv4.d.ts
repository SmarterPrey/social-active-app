declare module "gremlin-aws-sigv4/lib/utils" {
  export interface GremlinConnectionDetails {
    url: string;
    headers: Record<string, string>;
  }

  export function getUrlAndHeaders(
    host?: string,
    port?: string,
    credentials?: Record<string, unknown>,
    path?: string,
    protocol?: string
  ): GremlinConnectionDetails;
}