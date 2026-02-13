const MAP = {
  GUARDRAIL_DENIED: {
    httpStatus: 403,
    httpTitle: 'Guardrail Denied',
    graphqlCode: 'FORBIDDEN',
    graphqlTitle: 'Guardrail Denied'
  },
  EGRESS_POLICY_DENIED: {
    httpStatus: 403,
    httpTitle: 'Egress Policy Denied',
    graphqlCode: 'FORBIDDEN',
    graphqlTitle: 'Egress Policy Denied'
  },
  APPROVAL_REQUIRED: {
    httpStatus: 403,
    httpTitle: 'Approval Required',
    graphqlCode: 'FORBIDDEN',
    graphqlTitle: 'Approval Required'
  },
  RATE_LIMITED: {
    httpStatus: 429,
    httpTitle: 'Rate Limited',
    graphqlCode: 'TOO_MANY_REQUESTS',
    graphqlTitle: 'Rate Limited'
  },
  PLUGIN_BLOCKED: {
    httpStatus: 403,
    httpTitle: 'Plugin Blocked',
    graphqlCode: 'FORBIDDEN',
    graphqlTitle: 'Plugin Blocked'
  },
  PLUGIN_TIMEOUT: {
    httpStatus: 504,
    httpTitle: 'Plugin Timeout',
    graphqlCode: 'TIMEOUT',
    graphqlTitle: 'Plugin Timeout'
  }
};

/**
 * Resolve standard policy metadata for a runtime error code.
 * @param {unknown} input - Error code value.
 * @returns {{ code: string, httpStatus: number, httpTitle: string, graphqlCode: string, graphqlTitle: string } | null}
 */
export function policy(input) {
  const code = typeof input === 'string' ? input : '';
  const info = code ? MAP[code] : undefined;
  if (!info) return null;

  return {
    code,
    httpStatus: info.httpStatus,
    httpTitle: info.httpTitle,
    graphqlCode: info.graphqlCode,
    graphqlTitle: info.graphqlTitle
  };
}

