import type { PromptDraftState } from "@/lib/prompt-draft";

export const CREATE_APP_PROMPT_REPLACE_CONFIRMATION =
  "Replace the current composer draft with a Create App prompt?";

export const CREATE_APP_PROMPT_TEMPLATE = `You are creating a new global bb app.

Apps system reference — run \`bb guide app\` for full detail. Layout:
- <dataDir>/apps/<applicationId>/manifest.json — { manifestVersion: 1, id: applicationId, name?, icon | logo.svg, entry, capabilities: ["data"?, "message"?] }
- <dataDir>/apps/<applicationId>/README.md — scaffold notes and build instructions
- <dataDir>/apps/<applicationId>/public/index.html — prebuilt static web root served by bb; use flat relative asset refs
- <dataDir>/apps/<applicationId>/data/state.json — empty seed state; app data can also use nested records such as todos/<id>
- <dataDir>/apps/<applicationId>/skills/add-todos/SKILL.md — scaffold skill showing the Todo record shape
- <dataDir>/apps/<applicationId>/source/ — editable Vite + React + TypeScript project; run \`pnpm install\` and \`pnpm build\` here after edits

In the page, use the injected window.bb SDK: window.bb.data.read({ path }), window.bb.data.write({ path, value }), window.bb.data.delete({ path }), window.bb.data.list({ prefix }), window.bb.data.onChange({ prefix, callback }) for live state, and window.bb.message.send({ payload }) to send the thread a prompt.

Scaffold with \`bb app new --name "Name"\` or \`bb app new --slug my-app\`; new apps open immediately from committed \`public/\`. Edit \`source/\`, rebuild to \`public/\`, and do not rely on a localhost dev server for the installed app. Inside an app-capable runtime, inspect \`bb app current --json\` and write directly to \`BB_APP_ROOT\` / \`BB_APP_DATA_PATH\`. The application id is the lowercase slug folder name; display names are optional labels, not identifiers.

What I want:

`;

export function createCreateAppPromptDraft(): PromptDraftState {
  return {
    text: CREATE_APP_PROMPT_TEMPLATE,
    mentions: [],
    attachments: [],
  };
}
