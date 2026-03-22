#!/usr/bin/env node
/**
 * OpenBrain CLI
 *
 * Commands:
 *   think <text>       Save a thought and run extraction
 *   search <query>     Search the brain
 *   context <query>    Get structured context (L2)
 *   intent <query>     Derive intent (L3)
 *   spec <query>       Generate agent-ready spec (L4)
 *   pipeline <file|->  Full L1→L4 from file or stdin
 *   mcp-tools          List available MCP tools (for integration)
 */

import { readFileSync, existsSync } from "fs";
import { handleToolCall, getToolDefinitions, getThoughtCount } from "./mcp/server.js";

const HELP = `
openbrain — Context intelligence autopilot

  think <text>         Save a thought, extract entities + decisions
  search <query>       Search the brain semantically
  context <query>      Get structured context graph (Level 2)
  intent <query>       Derive strategic intent (Level 3)
  spec <text>          Generate agent-ready specification (Level 4)
  pipeline <file|->    Full transformation: thought → spec
  mcp-tools            List MCP tool definitions (for integration)

Options:
  --json               Output as JSON
  --source <type>      Thought source (meeting_notes, slack_message, etc.)

Example:
  openbrain think "Met with Sarah from Acme. They want JWT auth migration."
  openbrain pipeline meeting-notes.txt
  echo "notes..." | openbrain pipeline -
`;

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const isJson = args.includes("--json");
  const sourceIdx = args.indexOf("--source");
  const source = sourceIdx > -1 ? args[sourceIdx + 1] : "manual_entry";

  // Collect non-flag arguments
  const positional = args.filter((a, i) => a !== cmd && !a.startsWith("--") && (i === 0 || args[i - 1] !== "--source"));
  const text = positional.slice(1).join(" ");

  switch (cmd) {
    case "think": {
      const result = handleToolCall({ tool: "save_thought", arguments: { content: text, source } });
      output(result, isJson);
      break;
    }
    case "search": {
      const result = handleToolCall({ tool: "search_brain", arguments: { query: text } });
      output(result, isJson);
      break;
    }
    case "context": {
      const result = handleToolCall({ tool: "get_context", arguments: { query: text } });
      output(result, isJson);
      break;
    }
    case "intent": {
      const result = handleToolCall({ tool: "get_intent", arguments: { query: text } });
      output(result, isJson);
      break;
    }
    case "spec": {
      const content = text || readStdinOrFile(positional[1]);
      const result = handleToolCall({ tool: "get_spec", arguments: { query: content } });
      output(result, isJson);
      break;
    }
    case "pipeline": {
      const content = readStdinOrFile(positional[1] || text);
      if (!content.trim()) { console.error("Error: provide text, a file, or pipe stdin."); process.exit(1); }
      const result = handleToolCall({ tool: "run_pipeline", arguments: { content, source } });
      output(result, isJson);
      break;
    }
    case "mcp-tools": {
      const tools = getToolDefinitions();
      console.log(JSON.stringify(tools, null, 2));
      break;
    }
    case "help": case "--help": case "-h": case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

function readStdinOrFile(fileOrDash?: string): string {
  if (!fileOrDash || fileOrDash === "-") {
    try { return readFileSync("/dev/stdin", "utf-8"); } catch { return ""; }
  }
  if (existsSync(fileOrDash)) {
    return readFileSync(fileOrDash, "utf-8");
  }
  // If it looks like a filename but doesn't exist, error
  if (fileOrDash.includes(".") || fileOrDash.includes("/")) {
    console.error(`Error: File not found: ${fileOrDash}`);
    process.exit(1);
  }
  // Otherwise treat as literal text
  return fileOrDash;
}

function output(result: { content: Array<{ type: string; text: string }> }, isJson: boolean) {
  const text = result.content[0]?.text ?? "";
  if (isJson) {
    console.log(text);
  } else {
    try {
      const parsed = JSON.parse(text);
      prettyPrint(parsed);
    } catch {
      console.log(text);
    }
  }
}

function prettyPrint(obj: Record<string, unknown>, indent = 0) {
  const pad = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object" && !Array.isArray(value)) {
      console.log(`${pad}${key}:`);
      prettyPrint(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      console.log(`${pad}${key}: (${value.length})`);
      for (const item of value.slice(0, 8)) {
        if (typeof item === "object" && item !== null) {
          const summary = (item as Record<string, unknown>).name ?? (item as Record<string, unknown>).description ?? (item as Record<string, unknown>).title ?? JSON.stringify(item).slice(0, 80);
          console.log(`${pad}  - ${summary}`);
        } else {
          console.log(`${pad}  - ${String(item).slice(0, 100)}`);
        }
      }
      if (value.length > 8) console.log(`${pad}  ... and ${value.length - 8} more`);
    } else {
      console.log(`${pad}${key}: ${String(value).slice(0, 120)}`);
    }
  }
}

main();
