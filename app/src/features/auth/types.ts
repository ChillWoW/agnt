export type AuthState = {
    connected: boolean;
    accountId: string | null;
    email: string | null;
    expires: string | null;
    connectedAt: string | null;
    updatedAt: string | null;
};

export type AuthConnectStartResponse = {
    sessionId: string;
    authUrl: string;
};

export type AuthOauthSessionStatus =
    | {
          sessionId: string;
          status: "pending";
      }
    | {
          sessionId: string;
          status: "success";
      }
    | {
          sessionId: string;
          status: "error";
          error: string;
      };
