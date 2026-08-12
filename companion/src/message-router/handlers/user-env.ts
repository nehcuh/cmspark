/**
 * User env / secrets family (ADR-019) — residual god-file extract from message-router.
 * Zero behavior change.
 */
import {
  buildUserEnvPublic,
  deleteUserEnvKeys,
  loadUserEnv,
  redactUserEnvVarsForLog,
  setUserEnvVars,
} from "../../user-env"
import { logger } from "../../logger"

export type UserEnvSession = {
  broadcast?: (data: any) => void
}

/**
 * Handle user_env.list / set / delete. Returns null if type is not in this family.
 */
export async function handleUserEnvFamily(
  type: string,
  rest: any,
  session?: UserEnvSession,
): Promise<any | null> {
  switch (type) {
    // set/delete success response type is deliberately `user_env.updated` (same

    // snapshot as the multi-client broadcast) — not a distinct ack. Extension UI

    // (PR-2) must dispatch on `user_env.updated` for both direct reply + broadcast.

    case "user_env.list": {

      // Outbound only via buildUserEnvPublic (R2 / S8)

      const pub = buildUserEnvPublic(loadUserEnv())

      return { type: "user_env.list", ...pub }

    }

    case "user_env.set": {

      const vars = rest.vars

      if (!vars || typeof vars !== "object" || Array.isArray(vars)) {

        return {

          type: "error",

          family: "user_env",

          error: "vars object required",

          error_code: "INVALID_PAYLOAD",

        }

      }

      const varsObj = vars as Record<string, unknown>

      // R1 / S3: never log plaintext values

      logger.info("user_env.set", {

        keys: Object.keys(varsObj),

        vars: redactUserEnvVarsForLog(varsObj),

      })

      const r = setUserEnvVars(varsObj)

      if (!r.ok) {

        return {

          type: "error",

          family: "user_env",

          error: r.error,

          error_code: r.error_code,

        }

      }

      const payload = { type: "user_env.updated" as const, ...r.public }

      try {

        session?.broadcast?.(payload)

      } catch {

        /* best-effort */

      }

      return payload

    }

    case "user_env.delete": {

      const keys = rest.keys

      if (!Array.isArray(keys)) {

        return {

          type: "error",

          family: "user_env",

          error: "keys array required",

          error_code: "INVALID_PAYLOAD",

        }

      }

      const safeKeys = keys.filter((k: unknown): k is string => typeof k === "string")

      logger.info("user_env.delete", { keys: safeKeys })

      const r = deleteUserEnvKeys(safeKeys)

      if (!r.ok) {

        return {

          type: "error",

          family: "user_env",

          error: r.error,

          error_code: r.error_code,

        }

      }

      const payload = { type: "user_env.updated" as const, ...r.public }

      try {

        session?.broadcast?.(payload)

      } catch {

        /* best-effort */

      }

      return payload

    }

    default:
      return null
  }
}
