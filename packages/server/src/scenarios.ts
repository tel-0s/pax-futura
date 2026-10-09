import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ScenarioSchema, type Scenario } from "@pax/domain";

/** Scenario bundles are JSON files in the scenarios/ directory. */
export const loadScenarios = (scenariosDir: string): Map<string, Scenario> => {
  const result = new Map<string, Scenario>();
  let files: string[];
  try {
    files = readdirSync(scenariosDir).filter((name) => name.endsWith(".json"));
  } catch {
    return result;
  }
  for (const file of files) {
    try {
      const scenario = ScenarioSchema.parse(JSON.parse(readFileSync(join(scenariosDir, file), "utf8")));
      result.set(scenario.id, scenario);
    } catch (error) {
      console.warn(`Skipping invalid scenario ${file}:`, error instanceof Error ? error.message : error);
    }
  }
  return result;
};
