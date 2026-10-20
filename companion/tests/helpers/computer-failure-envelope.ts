/** Source-derived host_computer return bodies keep their real execution closure. */
import { observationNotice } from "../../src/computer/observation"

export function computerFailureEnvelope(statement: string, isWin = process.platform === "win32") {
  const actual = new Function("result", "isWin", "observationNotice", statement)
  return (result: unknown): any => actual(result, isWin, observationNotice)
}
