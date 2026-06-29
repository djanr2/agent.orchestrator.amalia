import { Command } from "commander";
import { registerInit } from "./commands/init.js";
import { registerStart } from "./commands/start.js";
import { registerStop } from "./commands/stop.js";
import { registerHatch } from "./commands/hatch.js";
import { registerKill } from "./commands/kill.js";
import { registerTask } from "./commands/task.js";
import { registerCheck } from "./commands/check.js";
import { registerLogs } from "./commands/logs.js";
import { registerUpdate } from "./commands/update.js";
import { registerIntegrate } from "./commands/integrate.js";
import { registerSync } from "./commands/sync.js";
import { registerDoctor } from "./commands/doctor.js";

const program = new Command();

program
  .name("amalia")
  .description("Orquestador multi-agente sobre git worktrees")
  .version("0.1.0");

registerInit(program);
registerStart(program);
registerStop(program);
registerHatch(program);
registerKill(program);
registerTask(program);
registerCheck(program);
registerLogs(program);
registerUpdate(program);
registerIntegrate(program);
registerSync(program);
registerDoctor(program);

program.parse(process.argv);
