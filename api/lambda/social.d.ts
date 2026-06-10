type G = any;
interface Ctx {
    g: G | null;
    identity: {
        sub?: string;
        username?: string;
        groups?: string[];
    } | null;
}
export declare function signRsvpToken(payload: {
    eventId: string;
    memberId: string;
    exp?: number;
}): Promise<string>;
export declare function verifyRsvpToken(token: string): Promise<{
    eventId: string;
    memberId: string;
    exp?: number;
} | null>;
export declare const SOCIAL_QUERY_FIELDS: Set<string>;
export declare function dispatchSocialQuery(field: string, args: any, ctx: Ctx): Promise<any>;
export declare const SOCIAL_MUTATION_FIELDS: Set<string>;
export declare function dispatchSocialMutation(field: string, args: any, ctx: Ctx): Promise<any>;
export {};
