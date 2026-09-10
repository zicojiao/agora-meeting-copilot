import { z } from "zod";
import type { KanbanOperation } from "../domain.js";

const status = z.enum(["backlog", "in_progress", "blocked", "done"]);
const priority = z.enum(["low", "medium", "high", "urgent"]);
const cardReference = {
  card_id: optionalTrimmedString(100),
  card_query: optionalTrimmedString(120)
};

const schemas = {
  create_board_card: z.object({
    title: z.string().trim().min(1).max(120),
    notes: z.string().max(1_000).optional(),
    status: status.optional(),
    priority: priority.optional(),
    assignee: optionalTrimmedString(60),
    due_date: optionalDate(),
    tags: z.array(z.string().trim().min(1).max(24)).max(6).optional()
  }).strict(),
  move_board_card: z.object({ ...cardReference, status }).strict().refine((value) => value.card_id || value.card_query, "A card reference is required"),
  update_board_card: z.object({
    ...cardReference,
    title: z.string().trim().min(1).max(120).optional(),
    notes: z.string().max(1_000).optional(),
    status: status.optional(),
    priority: priority.optional(),
    assignee: optionalTrimmedString(60),
    due_date: optionalDate(),
    tags: z.array(z.string().trim().min(1).max(24)).max(6).optional(),
    clear_assignee: z.boolean().optional(),
    clear_due_date: z.boolean().optional()
  }).strict().refine((value) => value.card_id || value.card_query, "A card reference is required"),
  add_board_card_tags: z.object({
    ...cardReference,
    tags: z.array(z.string().trim().min(1).max(24)).min(1).max(6)
  }).strict().refine((value) => value.card_id || value.card_query, "A card reference is required")
} as const;

export type GptLiveBoardFunctionName = keyof typeof schemas;

type ParsedBoardFunction = {
  card_id?: string;
  card_query?: string;
  title?: string;
  notes?: string;
  status?: KanbanOperation["status"];
  priority?: KanbanOperation["priority"];
  assignee?: string;
  due_date?: string;
  tags?: string[];
  clear_assignee?: boolean;
  clear_due_date?: boolean;
};

export const GPT_LIVE_BOARD_TOOLS = [
  functionTool("create_board_card", "Create a card on the shared meeting board after the user asks for one.", {
    title: stringProperty("A short, specific card title"), notes: stringProperty("Optional supporting detail"),
    status: statusProperty(), priority: priorityProperty(), assignee: stringProperty("Exact display name of a meeting participant"),
    due_date: stringProperty("Due date in YYYY-MM-DD format"), tags: arrayProperty("Short lowercase labels")
  }, ["title"]),
  functionTool("move_board_card", "Move an existing shared-board card to another column.", {
    card_id: stringProperty("Exact card ID when known"), card_query: stringProperty("Distinctive words from the card title when the ID is unknown"), status: statusProperty()
  }, ["status"]),
  functionTool("update_board_card", "Update the details, assignment, due date, tags, priority, or status of an existing board card.", {
    card_id: stringProperty("Exact card ID when known"), card_query: stringProperty("Distinctive words from the card title when the ID is unknown"),
    title: stringProperty("Replacement title"), notes: stringProperty("Replacement notes"), status: statusProperty(), priority: priorityProperty(),
    assignee: stringProperty("Exact display name of a meeting participant"), due_date: stringProperty("Due date in YYYY-MM-DD format"),
    tags: arrayProperty("Replacement labels"), clear_assignee: booleanProperty("Remove the current assignee"), clear_due_date: booleanProperty("Remove the current due date")
  }, []),
  functionTool("add_board_card_tags", "Add one or more labels to an existing shared-board card without replacing its current labels.", {
    card_id: stringProperty("Exact card ID when known"), card_query: stringProperty("Distinctive words from the card title when the ID is unknown"), tags: arrayProperty("Labels to add")
  }, ["tags"])
] as const;

export function buildGptLiveDelegation(model: string) {
  return {
    type: "responses",
    responses: {
      model,
      ...buildGptLiveResponses()
    }
  };
}

export function buildGptLiveResponses() {
  return {
    instructions: [
      "You control the shared meeting board through the provided functions.",
      "Do not call any function unless the current participant utterance freshly and directly addresses Copilot by name.",
      "Call a function only when a participant explicitly asks to create, move, update, assign, or tag a board card.",
      "For an existing card, use a distinctive card_query unless an exact card_id is already available.",
      "Never claim that the board changed until the function result reports ok=true. If it fails, explain the failure briefly and ask for the missing clarification."
    ].join(" "),
    max_output_tokens: 1_024,
    reasoning: { effort: "low", summary: "auto" },
    text: { verbosity: "low" },
    tools: GPT_LIVE_BOARD_TOOLS,
    tool_choice: "auto"
  };
}

export function parseGptLiveBoardFunction(name: string, rawArguments: string): KanbanOperation {
  if (!(name in schemas)) throw new Error(`Unsupported board function: ${name}`);
  let input: unknown;
  try { input = JSON.parse(rawArguments); }
  catch { throw new Error("GPT Live returned invalid JSON function arguments"); }
  const value = schemas[name as GptLiveBoardFunctionName].parse(input) as ParsedBoardFunction;
  if (name === "create_board_card") return { type: "create", title: value.title, notes: value.notes, status: value.status, priority: value.priority, assignee: value.assignee, dueDate: value.due_date, tags: value.tags };
  if (name === "move_board_card") return { type: "move", cardId: value.card_id, cardQuery: value.card_query, status: value.status };
  if (name === "add_board_card_tags") return { type: "add_tags", cardId: value.card_id, cardQuery: value.card_query, tags: value.tags };
  return {
    type: "update", cardId: value.card_id, cardQuery: value.card_query, title: value.title, notes: value.notes,
    status: value.status, priority: value.priority, assignee: value.assignee, dueDate: value.due_date, tags: value.tags,
    clearAssignee: value.clear_assignee, clearDueDate: value.clear_due_date
  };
}

function functionTool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return { type: "function", name, description, parameters: { type: "object", properties, required, additionalProperties: false } } as const;
}
function stringProperty(description: string) { return { type: "string", description }; }
function booleanProperty(description: string) { return { type: "boolean", description }; }
function statusProperty() { return { type: "string", enum: ["backlog", "in_progress", "blocked", "done"] }; }
function priorityProperty() { return { type: "string", enum: ["low", "medium", "high", "urgent"] }; }
function arrayProperty(description: string) { return { type: "array", description, items: { type: "string" }, maxItems: 6 }; }
function optionalTrimmedString(max: number) {
  return z.preprocess(emptyStringToUndefined, z.string().trim().min(1).max(max).optional());
}
function optionalDate() {
  return z.preprocess(emptyStringToUndefined, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());
}
function emptyStringToUndefined(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
