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

export type AuthRateLimitWindow = {
    used_percent: number;
    limit_window_seconds: number;
    reset_after_seconds: number;
    reset_at: number;
};

export type AuthRateLimitBlock = {
    allowed: boolean;
    limit_reached: boolean;
    primary_window: AuthRateLimitWindow;
    secondary_window?: AuthRateLimitWindow;
};

export type AuthAdditionalRateLimit = {
    limit_name: string;
    rate_limit: {
        allowed: boolean;
        limit_reached: boolean;
        primary_window: AuthRateLimitWindow;
    };
};

export type AuthRateLimits = {
    plan_type: string;
    rate_limit: AuthRateLimitBlock;
    additional_rate_limits?: AuthAdditionalRateLimit[];
    credits?: {
        has_credits: boolean;
        unlimited: boolean;
        balance: string;
    };
};
