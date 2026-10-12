// The window's operations on agents and their models. Validation stays on this boundary; what an agent is and
// what it can run belongs to `main/agents.ts` and `main/models.ts`.
import { dialog, ipcMain, shell } from "electron";
import {
  addAgent,
  agentRow,
  createAgentIn,
  listAgents,
  openAgent,
  openAgentResult,
  registryFile,
  relocateAgent,
  resetAgentConfig,
  removeAgent,
  renameAgent,
  setAgentModel,
} from "../agents.ts";
import { modelsFor, offered, refreshModels } from "../models.ts";
import { refuse } from "../send.ts";
import { MODEL_UNAVAILABLE_CODE } from "../../shared/refusals.ts";
import { endAgent, rebindAgent, requireSession } from "./sessions.ts";

export function registerAgents(): void {
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:add", async () => {
    // createDirectory: the project you want an agent in may not exist yet, and macOS hides New Folder
    // unless it is asked for.
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (!picked.canceled && picked.filePaths[0]) return addAgent(picked.filePaths[0]);
  });
  ipcMain.handle("agent:open", (_e, agentId: string) => openAgentResult(agentId));
  ipcMain.handle("agent:relocate", async (_e, id: string) => {
    const row = await agentRow(id);
    const picked = await dialog.showOpenDialog({ properties: ["openDirectory"], message: `Where is "${row.name}" now?` });
    if (picked.canceled || !picked.filePaths[0]) return undefined;
    return relocateAgent(row.id, picked.filePaths[0]);
  });
  ipcMain.handle("agent:resetConfig", async (_e, id: string) => resetAgentConfig(await agentRow(id)));
  ipcMain.handle("agent:scaffold", async (_e, id: string) => createAgentIn((await agentRow(id)).dir));
  ipcMain.handle("agent:setModel", async (_e, id: string, model: string, session?: string) => {
    if (typeof model !== "string") throw new Error("Model must be a string");
    if (session !== undefined) requireSession(session);
    const row = await agentRow(id);
    if (!(await offered(row.dir, model)))
      return refuse(MODEL_UNAVAILABLE_CODE, `${model} is not available to this agent — pick another.`);
    const result = await setAgentModel(row, model, session);
    if (result.ok) await rebindAgent(id);
    return result;
  });
  ipcMain.handle("agent:remove", async (_e, id: string) => {
    const result = await removeAgent(id);
    if (result.ok) endAgent(id, "The agent was removed");
    return result;
  });
  ipcMain.handle("agent:rename", async (_e, id: string, name: string) => {
    if (typeof name !== "string" || !name.trim()) throw new Error("An agent name cannot be empty");
    await renameAgent((await agentRow(id)).id, name.trim());
  });
  ipcMain.handle("agent:commands", async (_e, id: string) =>
    (await openAgent(await agentRow(id))).control.commands(),
  );
  ipcMain.handle("agent:reveal", async (_e, id: string) => shell.showItemInFolder((await agentRow(id)).dir));
  ipcMain.handle("registry:reveal", () => shell.showItemInFolder(registryFile));
  ipcMain.handle("models:list", async (_e, id: string) => modelsFor((await agentRow(id)).dir));
  ipcMain.handle("models:refresh", async (_e, id: string) => refreshModels((await agentRow(id)).dir));
}
